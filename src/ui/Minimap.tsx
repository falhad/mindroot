import { useEffect, useRef } from 'react'
import type { LayoutResult } from '../core/layout'
import type { MapDoc } from '../core/types'
import { makeVisualContext } from '../core/visual'
import { useDoc } from '../state/doc'
import { useUi } from '../state/ui'
import { setView, useView } from '../state/view'

const W = 184
const H = 124

export function Minimap({ doc, layout }: { doc: MapDoc; layout: LayoutResult }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const view = useView()
  const dark = useUi((s) => s.dark)
  const selection = useDoc((s) => s.selection)
  const geo = useRef({ s: 1, ox: 0, oy: 0, bx: 0, by: 0 })

  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = W * dpr
    c.height = H * dpr
    const ctx = c.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, W, H)

    // world rect = map bounds ∪ current viewport, so the viewport box never leaves the minimap
    const vw = { x: -view.x / view.k, y: -view.y / view.k, w: view.w / view.k, h: view.h / view.k }
    const b = layout.bounds
    const x0 = Math.min(b.x, vw.x)
    const y0 = Math.min(b.y, vw.y)
    const x1 = Math.max(b.x + b.w, vw.x + vw.w)
    const y1 = Math.max(b.y + b.h, vw.y + vw.h)
    const pad = 12
    const s = Math.min((W - pad * 2) / Math.max(1, x1 - x0), (H - pad * 2) / Math.max(1, y1 - y0))
    const ox = (W - (x1 - x0) * s) / 2
    const oy = (H - (y1 - y0) * s) / 2
    geo.current = { s, ox, oy, bx: x0, by: y0 }

    const vctx = makeVisualContext(doc, layout, dark)
    const sel = new Set(selection)
    for (const id of layout.order) {
      const r = layout.boxes[id]
      ctx.fillStyle = vctx.accent[id]
      ctx.globalAlpha = layout.depth[id] <= 1 ? 0.95 : 0.55
      const x = ox + (r.x - x0) * s
      const y = oy + (r.y - y0) * s
      const w = Math.max(2, r.w * s)
      const h = Math.max(1.5, r.h * s)
      ctx.beginPath()
      ctx.roundRect(x, y, w, h, Math.min(2, h / 2))
      ctx.fill()
      if (sel.has(id)) {
        ctx.globalAlpha = 1
        ctx.strokeStyle = dark ? '#fff' : '#0f172a'
        ctx.lineWidth = 1
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
    const rx = ox + (vw.x - x0) * s
    const ry = oy + (vw.y - y0) * s
    ctx.fillStyle = dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)'
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.7)' : 'rgba(15,23,42,0.6)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.roundRect(rx, ry, vw.w * s, vw.h * s, 4)
    ctx.fill()
    ctx.stroke()
  }, [doc, layout, view, dark, selection])

  const panTo = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const { s, ox, oy, bx, by } = geo.current
    const wx = (e.clientX - r.left - ox) / s + bx
    const wy = (e.clientY - r.top - oy) / s + by
    const v = useView.getState()
    setView({ x: v.w / 2 - wx * v.k, y: v.h / 2 - wy * v.k })
  }

  return (
    <canvas
      ref={ref}
      aria-label="Minimap"
      className="glass absolute bottom-3 left-3 z-10 hidden cursor-pointer rounded-xl sm:block"
      style={{ width: W, height: H, touchAction: 'none' }}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); panTo(e) }}
      onPointerMove={(e) => { if (e.buttons) panTo(e) }}
    />
  )
}
