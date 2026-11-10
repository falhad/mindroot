import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DASH, edgePath, hitRelation, relationPath } from '../core/edges'
import { hitTest, type LayoutResult } from '../core/layout'
import { tagFilterState } from '../core/tags'
import { attachFloat, moveFloat, subtreeIds, movable, updateRelation } from '../core/tree'
import type { Box, MapDoc } from '../core/types'
import { isRtl, makeVisualContext, nodeVisual } from '../core/visual'
import { openExternal } from '../io/files'
import { inTextField } from '../state/clipboard'
import { addFloatAt, commit, connectNodes, dropNodes, select, setConnectFrom, startEdit, toggleCollapse, useDoc, type DropDest } from '../state/doc'
import { useSearch } from '../state/search'
import { ui, useUi } from '../state/ui'
import { MAX_ZOOM, MIN_ZOOM, screenToWorld, setView, setViewport, useView, zoomAt } from '../state/view'
import { usePresent } from '../state/present'
import { GroupBoxes, SummaryBraces } from './GroupView'
import { NodeView } from './NodeView'
import { useTweenedBoxes } from './useTween'

type Drop = { kind: 'into'; id: string } | { kind: 'before' | 'after'; id: string }

interface DragState {
  ids: string[]
  skip: Set<string>
  dx: number
  dy: number
  drop: Drop | null
}

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { kind: 'press'; id: string; sx: number; sy: number }
  | { kind: 'drag'; sx: number; sy: number }
  | { kind: 'marquee'; sx: number; sy: number; base: string[] }
  | { kind: 'pinch'; dist: number; k: number }

function findDrop(layout: LayoutResult, doc: MapDoc, px: number, py: number, skip: Set<string>): Drop | null {
  const hit = hitTest(layout, px, py, skip, 4)
  if (hit) return { kind: 'into', id: hit }
  let best: string | null = null
  let bestD = Infinity
  for (const id of layout.order) {
    if (skip.has(id)) continue
    const b = layout.boxes[id]
    const dx = Math.max(b.x - px, 0, px - (b.x + b.w))
    const dy = Math.max(b.y - py, 0, py - (b.y + b.h))
    const d = Math.hypot(dx, dy)
    if (d < bestD) {
      bestD = d
      best = id
    }
  }
  if (!best || bestD > 150) return null
  if (!doc.nodes[best].parentId) return { kind: 'into', id: best }
  const b = layout.boxes[best]
  const vertical = layout.attach[best] === 'down' || layout.attach[best] === 'up'
  const before = vertical ? px < b.x + b.w / 2 : py < b.y + b.h / 2
  return { kind: before ? 'before' : 'after', id: best }
}

function dropToDest(layout: LayoutResult, doc: MapDoc, drop: Drop, px: number): DropDest {
  if (drop.kind === 'into') {
    const dest: DropDest = { parent: drop.id }
    if (drop.id === doc.root && doc.layout === 'mindmap') {
      const rb = layout.boxes[doc.root]
      dest.side = px < rb.x + rb.w / 2 ? 'left' : 'right'
    }
    return dest
  }
  const parent = doc.nodes[drop.id].parentId!
  const dest: DropDest = { parent, anchor: { id: drop.id, after: drop.kind === 'after' } }
  if (parent === doc.root && doc.layout === 'mindmap') {
    const a = layout.attach[drop.id]
    if (a === 'left' || a === 'right') dest.side = a
  }
  return dest
}

/** The side of a node its children grow towards (where the collapse button goes). */
function childSide(doc: MapDoc, layout: LayoutResult, id: string): 'left' | 'right' | 'up' | 'down' {
  if (!doc.nodes[id].parentId) {
    const side = doc.layout === 'right' ? 'right' : doc.layout === 'left' ? 'left' : doc.layout === 'up' ? 'up' : 'down'
    return doc.dir === 'rtl' ? (side === 'right' ? 'left' : side === 'left' ? 'right' : side) : side
  }
  const a = layout.attach[id]
  if (a === 'radial') {
    const b = layout.boxes[id]
    return b.x + b.w / 2 >= 0 ? 'right' : 'left' // the root sits at the origin; children grow outwards
  }
  return a
}

const EdgeView = memo(function EdgeView({ d, color, width, hot }: { d: string; color: string; width: number; hot: boolean }) {
  return <path d={d} stroke={color} strokeWidth={hot ? width + 1 : width} opacity={hot ? 1 : 0.82} />
})

interface Props {
  doc: MapDoc
  layout: LayoutResult
  onContext: (e: { x: number; y: number; nodeId: string | null }) => void
}

export function Canvas({ doc, layout, onContext }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const view = useView()
  const dark = useUi((s) => s.dark)
  const selection = useDoc((s) => s.selection)
  const editingId = useDoc((s) => s.editingId)
  const connectFrom = useDoc((s) => s.connectFrom)
  const search = useSearch()

  const boxes = useTweenedBoxes(layout, doc, !editingId)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [panning, setPanning] = useState(false)
  const [editingRel, setEditingRel] = useState<string | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const selRef = useRef(selection)
  selRef.current = selection

  const vctx = useMemo(() => makeVisualContext(doc, layout, dark), [doc, layout, dark])
  const visuals = useMemo(() => {
    const out: Record<string, ReturnType<typeof nodeVisual>> = {}
    for (const id of layout.order) out[id] = nodeVisual(doc, layout, vctx, id)
    return out
  }, [doc, layout, vctx])

  // ---- viewport size ----
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewport(el.clientWidth, el.clientHeight))
    ro.observe(el)
    setViewport(el.clientWidth, el.clientHeight)
    return () => ro.disconnect()
  }, [])

  // ---- wheel / trackpad / Safari pinch ----
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (inTextField(e.target) && (e.target as HTMLElement).closest('.node-edit')) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const cx = e.clientX - r.left
      const cy = e.clientY - r.top
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
      const mouseWheel = e.deltaMode === 1 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 100 && (Math.abs(e.deltaY) % 100 === 0 || Math.abs(e.deltaY) % 120 === 0))
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-dy * 0.012), cx, cy)
      else if (mouseWheel) zoomAt(Math.exp(-dy * 0.0016), cx, cy)
      else {
        const v = useView.getState()
        setView({ x: v.x - e.deltaX, y: v.y - dy })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })

    let startK = 1
    const gs = (e: Event) => {
      e.preventDefault()
      startK = useView.getState().k
    }
    const gc = (e: Event) => {
      e.preventDefault()
      const ge = e as Event & { scale: number; clientX: number; clientY: number }
      const r = el.getBoundingClientRect()
      const target = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, startK * ge.scale))
      zoomAt(target / useView.getState().k, ge.clientX - r.left, ge.clientY - r.top)
    }
    el.addEventListener('gesturestart', gs)
    el.addEventListener('gesturechange', gc)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('gesturestart', gs)
      el.removeEventListener('gesturechange', gc)
    }
  }, [])

  const local = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const el = ref.current!
    const p = local(e)
    pointers.current.set(e.pointerId, p)
    if (!(e.target as HTMLElement).closest('.node-edit')) el.focus({ preventScroll: true })

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      gesture.current = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), k: useView.getState().k }
      setDrag(null)
      setMarquee(null)
      return
    }
    if ((e.target as HTMLElement).closest('[data-collapse],[data-badge],.node-edit')) return
    el.setPointerCapture(e.pointerId)

    const nodeEl = (e.target as HTMLElement).closest('[data-node-id]') as HTMLElement | null
    const v = useView.getState()

    if (e.button === 1 || (e.button === 0 && !nodeEl && !e.shiftKey)) {
      gesture.current = { kind: 'pan', sx: p.x, sy: p.y, vx: v.x, vy: v.y, moved: false }
      setPanning(true)
      return
    }
    if (e.button === 2) return
    if (!nodeEl) {
      gesture.current = { kind: 'marquee', sx: p.x, sy: p.y, base: e.metaKey || e.ctrlKey ? selRef.current : [] }
      return
    }
    const id = nodeEl.dataset.nodeId!
    if (connectFrom) {
      if (id !== connectFrom) connectNodes(connectFrom, id)
      else setConnectFrom(null)
      return
    }
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      const sel = selRef.current
      select(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id])
    } else if (!selRef.current.includes(id)) select([id])
    gesture.current = { kind: 'press', id, sx: p.x, sy: p.y }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current
    const p = local(e)
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p)
    if (!g) return

    if (g.kind === 'pinch') {
      if (pointers.current.size < 2) return
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const target = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (g.k * dist) / g.dist))
      zoomAt(target / useView.getState().k, (a.x + b.x) / 2, (a.y + b.y) / 2)
      return
    }
    if (g.kind === 'pan') {
      const dx = p.x - g.sx
      const dy = p.y - g.sy
      if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true
      setView({ x: g.vx + dx, y: g.vy + dy })
      return
    }
    if (g.kind === 'press') {
      if (Math.hypot(p.x - g.sx, p.y - g.sy) < 5) return
      const ids = movable(doc, selRef.current)
      if (!ids.length) {
        // the root can't be moved: dragging it pans the map instead
        const v = useView.getState()
        gesture.current = { kind: 'pan', sx: g.sx, sy: g.sy, vx: v.x, vy: v.y, moved: true }
        setPanning(true)
        return
      }
      const skip = new Set<string>()
      for (const id of ids) for (const s of subtreeIds(doc, id)) skip.add(s)
      gesture.current = { kind: 'drag', sx: g.sx, sy: g.sy }
      setDrag({ ids, skip, dx: 0, dy: 0, drop: null })
      return
    }
    if (g.kind === 'drag') {
      const k = useView.getState().k
      const w = screenToWorld(p.x, p.y)
      setDrag((d) => {
        if (!d) return d
        return { ...d, dx: (p.x - g.sx) / k, dy: (p.y - g.sy) / k, drop: findDrop(layout, doc, w.x, w.y, d.skip) }
      })
      return
    }
    if (g.kind === 'marquee') {
      setMarquee({ x0: g.sx, y0: g.sy, x1: p.x, y1: p.y })
    }
  }

  const finish = (e: React.PointerEvent, cancelled = false) => {
    pointers.current.delete(e.pointerId)
    const g = gesture.current
    if (pointers.current.size === 0) gesture.current = null
    else if (g?.kind === 'pinch') gesture.current = null
    setPanning(false)
    if (!g) return
    const p = local(e)

    if (g.kind === 'pan' && !g.moved && !cancelled && e.button === 0) select([])
    if (g.kind === 'press' && !cancelled && !e.shiftKey && !e.metaKey && !e.ctrlKey && selRef.current.length > 1) select([g.id])
    if (g.kind === 'drag') {
      const d = drag
      setDrag(null)
      if (d && !cancelled) {
        const w = screenToWorld(p.x, p.y)
        const floating = d.ids.filter((id) => !doc.nodes[id]?.parentId)
        const attached = d.ids.filter((id) => doc.nodes[id]?.parentId)
        // floating branches move with the pointer; only dropping straight onto a node attaches them
        if (floating.length) {
          const onto = d.drop?.kind === 'into' ? d.drop.id : null
          commit((dd) => {
            for (const id of floating) {
              const pos = dd.nodes[id]?.pos
              if (onto && attachFloat(dd, id, onto)) continue
              if (pos) moveFloat(dd, id, pos.x + (dd.dir === 'rtl' ? -d.dx : d.dx), pos.y + d.dy)
            }
          })
        }
        if (attached.length && d.drop) dropNodes(attached, dropToDest(layout, doc, d.drop, w.x))
      }
    }
    if (g.kind === 'marquee') {
      setMarquee(null)
      if (!cancelled) {
        const a = screenToWorld(Math.min(g.sx, p.x), Math.min(g.sy, p.y))
        const b = screenToWorld(Math.max(g.sx, p.x), Math.max(g.sy, p.y))
        if (Math.abs(p.x - g.sx) + Math.abs(p.y - g.sy) < 4) select(g.base)
        else {
          const inside = layout.order.filter((id) => {
            const r = layout.boxes[id]
            return r.x < b.x && r.x + r.w > a.x && r.y < b.y && r.y + r.h > a.y
          })
          select([...new Set([...g.base, ...inside])])
        }
      }
    }
  }

  const onClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement
    const col = t.closest('[data-collapse]') as HTMLElement | null
    if (col) {
      toggleCollapse([col.dataset.collapse!])
      return
    }
    const bd = t.closest('[data-badge]') as HTMLElement | null
    const nodeEl = t.closest('[data-node-id]') as HTMLElement | null
    if (bd && nodeEl) {
      const n = doc.nodes[nodeEl.dataset.nodeId!]
      select([n.id])
      if (bd.dataset.badge === 'link' && n.link && (e.metaKey || e.ctrlKey)) void openExternal(n.link)
      else ui.setInspector(true)
    }
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    const nodeEl = (e.target as HTMLElement).closest('[data-node-id]') as HTMLElement | null
    if (nodeEl && !(e.target as HTMLElement).closest('.node-edit,[data-collapse],[data-badge]')) return startEdit(nodeEl.dataset.nodeId!)
    if ((e.target as HTMLElement).closest('.node-edit,input')) return
    // the canvas captures the pointer, so find a link line by distance instead of by event target
    const p = local(e)
    const w = screenToWorld(p.x, p.y)
    const rel = hitRelation(doc.relations, layout.boxes, w.x, w.y, 10 / useView.getState().k)
    if (rel) return setEditingRel(rel)
    // empty canvas: a new floating node (Shift = sticky note)
    if (!(e.target as HTMLElement).closest('.node-edit,input,button,[data-node-id]')) addFloatAt(w.x, w.y, e.shiftKey)
  }

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    const nodeEl = (e.target as HTMLElement).closest('[data-node-id]') as HTMLElement | null
    const id = nodeEl?.dataset.nodeId ?? null
    if (id && !selRef.current.includes(id)) select([id])
    onContext({ x: e.clientX, y: e.clientY, nodeId: id })
  }

  // ---- derive render boxes (dragged subtree follows the pointer) ----
  const renderBox = useCallback(
    (id: string): Box => {
      const base = boxes[id] ?? layout.boxes[id]
      if (drag && drag.skip.has(id)) return { x: base.x + drag.dx, y: base.y + drag.dy, w: base.w, h: base.h }
      return base
    },
    [boxes, layout, drag],
  )

  const matches = useMemo(() => new Set(search.hits.map((h) => h.id)), [search.hits])
  const searching = search.query.trim() !== ''
  const selSet = useMemo(() => new Set(selection), [selection])
  const presentActive = usePresent((s) => s.active)
  const presentStep = usePresent((s) => s.step)
  const presentSteps = usePresent((s) => s.steps)
  // ids shown so far in a presentation; null when not presenting
  const shown = useMemo(() => (presentActive ? new Set(presentSteps.slice(0, presentStep + 1).flat()) : null), [presentActive, presentStep, presentSteps])
  const tagFilter = useUi((s) => s.tagFilter)
  const tagState = useMemo(() => tagFilterState(doc, tagFilter), [doc, tagFilter])

  const dropIndicator = (() => {
    if (!drag?.drop || drag.drop.kind === 'into') return null
    const b = layout.boxes[drag.drop.id]
    const vertical = layout.attach[drag.drop.id] === 'down' || layout.attach[drag.drop.id] === 'up'
    const before = drag.drop.kind === 'before'
    return vertical
      ? { left: before ? b.x - 8 : b.x + b.w + 4, top: b.y, width: 4, height: b.h }
      : { left: b.x, top: before ? b.y - 8 : b.y + b.h + 4, width: b.w, height: 4 }
  })()

  const bg = doc.bg
  let gap = 28 * view.k
  while (gap < 14) gap *= 2 // keep the pattern calm when zoomed far out
  const background =
    bg === 'dots'
      ? { backgroundImage: 'radial-gradient(circle, var(--dot) 1.2px, transparent 1.4px)', backgroundSize: `${gap}px ${gap}px`, backgroundPosition: `${view.x}px ${view.y}px` }
      : bg === 'grid'
        ? {
            backgroundImage: 'linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px)',
            backgroundSize: `${gap}px ${gap}px`,
            backgroundPosition: `${view.x}px ${view.y}px`,
          }
        : {}

  return (
    <div
      ref={ref}
      className={`canvas${panning ? ' panning' : ''}${connectFrom ? ' connecting' : ''}`}
      style={background}
      tabIndex={-1}
      data-testid="canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e)}
      onPointerCancel={(e) => finish(e, true)}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      <div className="world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <GroupBoxes doc={doc} layout={layout} dark={dark} shown={shown} />
        <svg className="edges" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M1 1L9 5L1 9" fill="none" stroke="var(--muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </marker>
          </defs>
          {layout.order.map((id) => {
            const n = doc.nodes[id]
            if (!n.parentId || n.sticky || (shown && !(shown.has(id) && shown.has(n.parentId)))) return null
            const hot = selSet.has(id) || selSet.has(n.parentId)
            return (
              <EdgeView
                key={id}
                d={edgePath(doc.edge, renderBox(n.parentId), renderBox(id), layout.attach[id])}
                color={visuals[id].accent}
                width={visuals[id].edgeWidth}
                hot={hot}
              />
            )
          })}
          <SummaryBraces doc={doc} layout={layout} shown={shown} />
          {doc.relations.map((r) => {
            if (!layout.boxes[r.from] || !layout.boxes[r.to] || (shown && !(shown.has(r.from) && shown.has(r.to)))) return null
            const p = relationPath(renderBox(r.from), renderBox(r.to))
            const arrow = r.arrow ?? 'end'
            return (
              <g key={r.id} data-relation={r.id}>
                <path d={p.d} stroke="var(--muted)" strokeWidth={1.8} strokeDasharray={DASH[r.dash ?? 'dashed']}
                  markerEnd={arrow !== 'none' ? 'url(#arrow)' : undefined} markerStart={arrow === 'both' ? 'url(#arrow)' : undefined} />
                {r.label && editingRel !== r.id && (
                  <text x={p.mid.x} y={p.mid.y} textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={500} fill="var(--muted)" stroke="var(--canvas)" strokeWidth={4}
                    paintOrder="stroke" strokeLinejoin="round" pointerEvents="none" direction={isRtl(r.label) ? 'rtl' : 'ltr'}>{r.label}</text>
                )}
              </g>
            )
          })}
        </svg>
        {layout.order.map((id) => (
          <NodeView
            key={id}
            node={doc.nodes[id]}
            box={renderBox(id)}
            m={layout.metrics[id]}
            vis={visuals[id]}
            side={childSide(doc, layout, id)}
            selected={selSet.has(id)}
            editing={editingId === id}
            dim={searching ? !matches.has(id) : tagState?.get(id) === 'dim'}
            soft={!searching && tagState?.get(id) === 'path'}
            stepHidden={!!shown && !shown.has(id)}
            match={searching && matches.has(id)}
            dropInto={drag?.drop?.kind === 'into' && drag.drop.id === id}
            dragging={!!drag && drag.skip.has(id)}
            connecting={!!connectFrom && connectFrom !== id}
          />
        ))}
        {dropIndicator && <div className="drop-line" style={dropIndicator} />}
        {editingRel && (() => {
          const r = doc.relations.find((x) => x.id === editingRel)
          if (!r || !layout.boxes[r.from] || !layout.boxes[r.to]) return null
          const mid = relationPath(renderBox(r.from), renderBox(r.to)).mid
          const done = (save: boolean, value: string) => {
            setEditingRel(null)
            if (save) commit((d) => updateRelation(d, r.id, { label: value }))
          }
          return (
            <input
              autoFocus
              aria-label="Link label"
              className="field"
              dir="auto"
              defaultValue={r.label ?? ''}
              placeholder="Label"
              style={{ position: 'absolute', left: mid.x, top: mid.y, transform: 'translate(-50%, -50%)', width: 140, height: 28, textAlign: 'center', zIndex: 6 }}
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.nativeEvent.isComposing) return
                if (e.key === 'Enter') done(true, e.currentTarget.value)
                else if (e.key === 'Escape') done(false, '')
              }}
              onBlur={(e) => done(true, e.currentTarget.value)}
            />
          )
        })()}
      </div>
      {marquee && (
        <div
          className="marquee"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
          }}
        />
      )}
    </div>
  )
}
