import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import * as T from '../core/tree'
import { commit, select, toggleCollapse, useDoc, useRenderDoc } from '../state/doc'
import { ui } from '../state/ui'

const ROW = 30
const OVERSCAN = 14

/**
 * The map as an indented list. Typing here edits the same nodes as the canvas (they stay in step).
 * Rows are windowed, so a map with thousands of ideas stays smooth.
 */
export function Outline() {
  const doc = useRenderDoc()!
  const selection = useDoc((s) => s.selection)
  const scroller = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(600)
  const pendingFocus = useRef<string | null>(null)

  const rows = useMemo(() => {
    const out: { id: string; depth: number }[] = []
    const walk = (id: string, depth: number) => {
      out.push({ id, depth })
      const n = doc.nodes[id]
      if (n && !n.collapsed) for (const c of n.children) walk(c, depth + 1)
    }
    walk(doc.root, 0)
    for (const f of T.floatIds(doc)) walk(f, 0)
    return out
  }, [doc])
  const index = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows])
  const primary = selection[selection.length - 1]

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    setHeight(el.clientHeight)
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // keep the row of the selected node in view (when the selection came from the canvas)
  useEffect(() => {
    const el = scroller.current
    const i = primary ? index.get(primary) : undefined
    if (!el || i === undefined) return
    const top = i * ROW
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW - el.clientHeight
  }, [primary, index])

  // after Enter / Tab etc. the row of a node may mount later: focus it when it appears
  useEffect(() => {
    const id = pendingFocus.current
    if (!id) return
    const input = scroller.current?.querySelector<HTMLInputElement>(`input[data-row="${id}"]`)
    if (input) {
      input.focus()
      pendingFocus.current = null
    }
  })

  const first = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN)
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW) + OVERSCAN)
  const visible = rows.slice(first, last)
  const focusIndex = (i: number) => {
    const r = rows[Math.max(0, Math.min(i, rows.length - 1))]
    if (!r) return
    pendingFocus.current = r.id
    const el = scroller.current
    if (el) {
      const top = (index.get(r.id) ?? 0) * ROW
      if (top < el.scrollTop) el.scrollTop = top
      else if (top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW - el.clientHeight
    }
    const input = el?.querySelector<HTMLInputElement>(`input[data-row="${r.id}"]`)
    if (input) {
      input.focus()
      pendingFocus.current = null
    } else setScrollTop(scroller.current?.scrollTop ?? 0)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, id: string, i: number) => {
    e.stopPropagation() // the canvas shortcuts must not fire while typing here
    if (e.nativeEvent.isComposing) return
    const input = e.currentTarget
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0
    const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length
    if (e.key === 'Enter') {
      e.preventDefault()
      let nid = ''
      commit((d) => {
        nid = T.addSibling(d, id, e.shiftKey)
      })
      pendingFocus.current = nid
      select([nid])
    } else if (e.key === 'Tab') {
      e.preventDefault()
      commit((d) => void (e.shiftKey ? T.outdentNode(d, id) : T.indentNode(d, id)))
      pendingFocus.current = id
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      commit((d) => void T.reorderNode(d, id, e.key === 'ArrowUp' ? -1 : 1))
      pendingFocus.current = id
    } else if (e.key === 'ArrowUp' && !e.altKey) {
      e.preventDefault()
      focusIndex(i - 1)
    } else if (e.key === 'ArrowDown' && !e.altKey) {
      e.preventDefault()
      focusIndex(i + 1)
    } else if (e.key === 'Backspace' && input.value === '' && id !== doc.root && !doc.nodes[id].children.length) {
      e.preventDefault()
      commit((d) => void T.removeNodes(d, [id]))
      focusIndex(i - 1)
    } else if (e.key === 'ArrowLeft' && atStart && e.metaKey === false && doc.nodes[id].children.length && !doc.nodes[id].collapsed && e.altKey === false && e.shiftKey) {
      e.preventDefault()
      toggleCollapse([id])
    } else if (e.key === 'ArrowRight' && atEnd && e.shiftKey && doc.nodes[id].collapsed) {
      e.preventDefault()
      toggleCollapse([id])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      input.blur()
    }
  }

  return (
    <aside aria-label="Outline" className="glass rise absolute bottom-3 left-3 top-14 z-20 flex w-[min(320px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl" style={{ background: 'var(--panel)' }}>
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <div className="label">Outline</div>
        <span className="mr-auto ml-2 text-[11.5px] tabular-nums text-muted">{rows.length}</span>
        <button className="btn icon" style={{ width: 26, height: 26 }} aria-label="Close outline" onClick={() => ui.setOutline(false)}><X size={15} /></button>
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} role="tree" data-testid="outline-scroll">
        <div style={{ height: rows.length * ROW, position: 'relative' }}>
          {visible.map((r, k) => {
            const i = first + k
            const n = doc.nodes[r.id]
            if (!n) return null
            const lines = n.text.split('\n')
            const selected = selection.includes(r.id)
            return (
              <div
                key={r.id}
                role="treeitem"
                aria-level={r.depth + 1}
                aria-expanded={n.children.length ? !n.collapsed : undefined}
                aria-selected={selected}
                data-outline-row={r.id}
                data-selected={selected ? 'true' : undefined}
                className={`absolute left-0 right-0 flex items-center gap-1 pr-2 ${selected ? 'bg-hover' : ''}`}
                style={{ top: i * ROW, height: ROW, paddingLeft: 8 + r.depth * 16 }}
              >
                {n.children.length ? (
                  <button className="grid h-5 w-5 shrink-0 place-items-center rounded text-muted hover:text-ink" aria-label={n.collapsed ? 'Expand' : 'Collapse'} onClick={() => toggleCollapse([r.id])}>
                    {n.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  </button>
                ) : (
                  <span className="h-5 w-5 shrink-0" aria-hidden />
                )}
                <input
                  data-row={r.id}
                  className="h-[26px] min-w-0 flex-1 rounded-md bg-transparent px-1.5 text-[13px] outline-none focus:bg-[var(--panel-solid)] focus:ring-1 focus:ring-[var(--accent)]"
                  style={{ fontWeight: r.depth === 0 ? 650 : 450 }}
                  dir="auto"
                  spellCheck
                  value={lines[0]}
                  title={lines.length > 1 ? 'This idea has more lines. Edit them on the map.' : undefined}
                  placeholder="New idea"
                  onFocus={() => {
                    if (!(selection.length === 1 && selection[0] === r.id)) select([r.id])
                  }}
                  onChange={(e) => {
                    const rest = n.text.slice(lines[0].length) // keep the other lines of a multi-line idea
                    commit((d) => T.setText(d, r.id, e.target.value + rest), { coalesce: `outline:${r.id}` })
                  }}
                  onKeyDown={(e) => onKeyDown(e, r.id, i)}
                />
                {lines.length > 1 && <span className="shrink-0 text-[11px] text-muted" aria-hidden>⏎</span>}
              </div>
            )
          })}
        </div>
      </div>
      <p className="border-t border-line px-3 py-1.5 text-[11.5px] text-muted">Enter new idea · Tab indent · ⇧Tab outdent · ⌥↑↓ move</p>
    </aside>
  )
}
