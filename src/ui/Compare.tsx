import { useEffect, useMemo, useRef, useState } from 'react'
import { GitCompare, Loader2, X } from 'lucide-react'
import { diffDocs } from '../core/diff'
import type { MapDoc } from '../core/types'
import { buildMarkedSvg } from '../io/exporters'
import { store } from '../io/storage'
import { useDoc } from '../state/doc'
import { useLibrary } from '../state/library'
import { toast, ui, useUi } from '../state/ui'
import { Modal } from './Overlays'

interface View {
  x: number
  y: number
  k: number
}

type Marks = Record<string, 'added' | 'removed' | 'changed' | 'moved'>

/** Two versions of a map side by side. Panning and zooming either one moves both. */
export function CompareView() {
  const compare = useUi((s) => s.compare)
  const dark = useUi((s) => s.dark)
  const [images, setImages] = useState<{ a: { url: string; w: number; h: number }; b: { url: string; w: number; h: number } } | null>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 })
  const paneRef = useRef<HTMLDivElement>(null)

  const diff = useMemo(() => (compare ? diffDocs(compare.a, compare.b) : null), [compare])

  useEffect(() => {
    if (!compare || !diff) return
    let alive = true
    const urls: string[] = []
    const marksA: Marks = {}
    const marksB: Marks = {}
    for (const id of diff.removed) marksA[id] = 'removed'
    for (const [aid, bid] of diff.match) if (diff.changed.includes(bid)) marksA[aid] = 'changed'
    for (const id of diff.added) marksB[id] = 'added'
    for (const id of diff.changed) marksB[id] = 'changed'
    for (const id of diff.moved) if (!marksB[id]) marksB[id] = 'moved'
    void (async () => {
      const [ra, rb] = await Promise.all([buildMarkedSvg(compare.a, marksA, dark), buildMarkedSvg(compare.b, marksB, dark)])
      if (!alive) return
      const make = (r: { svg: string; width: number; height: number }) => {
        const url = URL.createObjectURL(new Blob([r.svg], { type: 'image/svg+xml' }))
        urls.push(url)
        return { url, w: r.width, h: r.height }
      }
      setImages({ a: make(ra), b: make(rb) })
    })()
    return () => {
      alive = false
      urls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [compare, diff, dark])

  // fit both pictures into one pane when they appear
  useEffect(() => {
    const el = paneRef.current
    if (!el || !images) return
    const w = Math.max(images.a.w, images.b.w)
    const h = Math.max(images.a.h, images.b.h)
    const k = Math.min(1.2, (el.clientWidth - 24) / w, (el.clientHeight - 24) / h)
    setView({ k, x: (el.clientWidth - w * k) / 2, y: (el.clientHeight - h * k) / 2 })
  }, [images])

  if (!compare || !diff) return null
  const close = () => ui.setCompare(null)
  const counts = { added: diff.added.length, removed: diff.removed.length, changed: diff.changed.length, moved: diff.moved.length }

  return (
    <Modal onClose={close} label="Compare versions" width={1280} top="4vh">
      <div className="flex items-center gap-3 border-b border-line px-5 py-3">
        <GitCompare size={17} className="text-accent" aria-hidden />
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold" dir="auto">{compare.labelA} <span className="text-muted">vs</span> {compare.labelB}</h2>
        <ul className="hidden items-center gap-3 text-[12.5px] sm:flex" aria-label="Differences">
          <li data-count="added" style={{ color: '#16a34a' }}>{counts.added} added</li>
          <li data-count="removed" style={{ color: '#dc2626' }}>{counts.removed} removed</li>
          <li data-count="changed" style={{ color: '#d97706' }}>{counts.changed} changed</li>
          <li data-count="moved" style={{ color: '#2563eb' }}>{counts.moved} moved</li>
        </ul>
        <button className="btn icon" aria-label="Close" onClick={close}><X size={16} /></button>
      </div>
      <div className="grid h-[72vh] grid-rows-2 gap-px bg-[var(--line)] md:grid-cols-2 md:grid-rows-1">
        {(['a', 'b'] as const).map((side, i) => (
          <Pane key={side} label={i === 0 ? compare.labelA : compare.labelB} image={images?.[side] ?? null} view={view} onView={setView} paneRef={i === 0 ? paneRef : undefined} side={side} />
        ))}
      </div>
    </Modal>
  )
}

function Pane({ label, image, view, onView, paneRef, side }: { label: string; image: { url: string; w: number; h: number } | null; view: View; onView: (v: View) => void; paneRef?: React.RefObject<HTMLDivElement | null>; side: string }) {
  const drag = useRef<{ x: number; y: number } | null>(null)
  const own = useRef<HTMLDivElement>(null)
  const ref = paneRef ?? own
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const k = Math.min(4, Math.max(0.1, view.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))))
      const f = k / view.k
      const cx = e.clientX - r.left
      const cy = e.clientY - r.top
      onView({ k, x: cx - (cx - view.x) * f, y: cy - (cy - view.y) * f })
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [view, onView, ref])
  return (
    <div className="relative min-h-0 overflow-hidden bg-[var(--canvas)]">
      <div className="absolute left-3 top-2 z-10 rounded-md bg-[var(--panel-solid)] px-2 py-0.5 text-[12px] font-medium shadow-sm" dir="auto">{label}</div>
      <div
        ref={ref}
        data-compare-pane={side}
        className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY } }}
        onPointerMove={(e) => {
          if (!drag.current) return
          onView({ ...view, x: view.x + e.clientX - drag.current.x, y: view.y + e.clientY - drag.current.y })
          drag.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerUp={() => { drag.current = null }}
      >
        {image ? (
          <img src={image.url} alt={`Map: ${label}`} draggable={false} className="max-w-none select-none" style={{ width: image.w, height: image.h, transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, transformOrigin: '0 0' }} />
        ) : (
          <div className="grid h-full place-items-center"><Loader2 className="animate-spin text-muted" /></div>
        )}
      </div>
    </div>
  )
}

/** Choose another map to compare the open one with. */
export function ComparePicker() {
  const open = useUi((s) => s.comparePicker)
  const items = useLibrary((s) => s.items)
  const here = useDoc((s) => s.doc?.meta.id)
  const [busy, setBusy] = useState<string | null>(null)
  if (!open) return null
  const maps = items.filter((m) => !m.trashedAt && m.id !== here).sort((a, b) => b.updatedAt - a.updatedAt)
  const pick = async (id: string, title: string) => {
    setBusy(id)
    try {
      const other = await store.load(id)
      const current = useDoc.getState().doc
      if (!other || !current) throw new Error('That map could not be opened')
      ui.setComparePicker(false)
      ui.setCompare({ a: other as MapDoc, b: current, labelA: title || 'Untitled map', labelB: `${current.meta.title} (open)` })
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(null)
    }
  }
  return (
    <Modal onClose={() => ui.setComparePicker(false)} label="Compare with another map" width={460} top="14vh">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="text-[15px] font-semibold">Compare with…</h2>
        <button className="btn icon" aria-label="Close" onClick={() => ui.setComparePicker(false)}><X size={16} /></button>
      </div>
      <ul className="max-h-[52vh] overflow-y-auto p-2" aria-label="Maps">
        {maps.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-muted">You have no other maps to compare with.</li>}
        {maps.map((m) => (
          <li key={m.id}>
            <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13.5px] hover:bg-hover" disabled={busy !== null} onClick={() => void pick(m.id, m.title)}>
              <span className="min-w-0 flex-1 truncate" dir="auto">{m.title || 'Untitled map'}</span>
              {busy === m.id && <Loader2 size={14} className="animate-spin" />}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
