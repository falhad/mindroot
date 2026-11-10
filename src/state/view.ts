import { create } from 'zustand'
import type { Box } from '../core/types'

export interface View {
  x: number
  y: number
  k: number
}

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 3

interface ViewState extends View {
  /** Viewport size in CSS px, set by the canvas. */
  w: number
  h: number
  /** Width on the right covered by a floating panel; fits avoid it. */
  insetRight: number
  /** Width on the left covered by the outline panel. */
  insetLeft: number
}

export const useView = create<ViewState>(() => ({ x: 0, y: 0, k: 1, w: 800, h: 600, insetRight: 0, insetLeft: 0 }))
const set = useView.setState
const get = useView.getState

let anim = 0

export function setViewport(w: number, h: number) {
  set({ w, h })
}

export const setInsetRight = (insetRight: number) => set({ insetRight })
export const setInsetLeft = (insetLeft: number) => set({ insetLeft })

export function setView(v: Partial<View>) {
  cancelAnimationFrame(anim)
  set(v)
}

/** Zoom keeping the point (cx, cy) in screen space fixed. */
export function zoomAt(factor: number, cx: number, cy: number) {
  const { x, y, k } = get()
  const nk = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k * factor))
  const f = nk / k
  setView({ k: nk, x: cx - (cx - x) * f, y: cy - (cy - y) * f })
}

export function zoomBy(factor: number) {
  const { w, h } = get()
  animateTo(zoomTarget(factor, w / 2, h / 2))
}

function zoomTarget(factor: number, cx: number, cy: number): View {
  const { x, y, k } = get()
  const nk = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k * factor))
  const f = nk / k
  return { k: nk, x: cx - (cx - x) * f, y: cy - (cy - y) * f }
}

export function animateTo(target: View, ms = 260) {
  cancelAnimationFrame(anim)
  const from = { x: get().x, y: get().y, k: get().k }
  if (matchMedia?.('(prefers-reduced-motion: reduce)').matches) return set(target)
  const t0 = performance.now()
  const ease = (t: number) => 1 - Math.pow(1 - t, 3)
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / ms)
    const e = ease(t)
    // interpolate zoom geometrically so it feels even
    const k = from.k * Math.pow(target.k / from.k, e)
    set({ x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, k })
    if (t < 1) anim = requestAnimationFrame(step)
  }
  anim = requestAnimationFrame(step)
}

/** View that fits `b` inside the viewport with `pad` px margin. */
export function fitTarget(b: Box, pad = 70, maxK = 1.25): View {
  const { h, insetRight, insetLeft } = get()
  const w = get().w - insetRight - insetLeft
  if (b.w <= 0 || b.h <= 0) return { x: insetLeft + w / 2, y: h / 2, k: 1 }
  const k = Math.min(maxK, Math.max(MIN_ZOOM, Math.min((w - pad * 2) / b.w, (h - pad * 2) / b.h)))
  return { k, x: insetLeft + w / 2 - (b.x + b.w / 2) * k, y: h / 2 - (b.y + b.h / 2) * k }
}

export function fitView(b: Box, animate = true) {
  const t = fitTarget(b)
  if (animate) animateTo(t)
  else setView(t)
}

/** Pan (minimally) so `b` is fully visible, with a margin. */
export function revealBox(b: Box, margin = 90) {
  const { x, y, k, w, h } = get()
  const l = b.x * k + x
  const r = (b.x + b.w) * k + x
  const t = b.y * k + y
  const bt = (b.y + b.h) * k + y
  let dx = 0
  let dy = 0
  if (l < margin) dx = margin - l
  else if (r > w - margin) dx = w - margin - r
  if (t < margin + 40) dy = margin + 40 - t
  else if (bt > h - margin) dy = h - margin - bt
  if (dx || dy) animateTo({ x: x + dx, y: y + dy, k }, 200)
}

export function screenToWorld(sx: number, sy: number) {
  const { x, y, k } = get()
  return { x: (sx - x) / k, y: (sy - y) / k }
}

/** Smoothly centre `b` on screen, zooming in a little if the map is tiny on screen. */
export function centerOnBox(b: Box, minK = 0.8) {
  const { h, k, insetRight } = get()
  const w = get().w - insetRight
  const nk = Math.max(k, minK)
  animateTo({ k: nk, x: w / 2 - (b.x + b.w / 2) * nk, y: h / 2 - (b.y + b.h / 2) * nk })
}
