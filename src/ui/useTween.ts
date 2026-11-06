import { useEffect, useRef, useState } from 'react'
import type { LayoutResult } from '../core/layout'
import type { Box, MapDoc } from '../core/types'

const MAX_ANIMATED = 500

/**
 * Glide node positions to their new layout positions. Sizes always come straight from the
 * target layout, so only x/y are interpolated. New nodes grow out of their parent.
 */
export function useTweenedBoxes(layout: LayoutResult, doc: MapDoc, animate: boolean): Record<string, Box> {
  const [boxes, setBoxes] = useState(layout.boxes)
  const current = useRef(layout.boxes)
  const raf = useRef(0)
  const first = useRef(true)

  useEffect(() => {
    cancelAnimationFrame(raf.current)
    const to = layout.boxes
    const from = current.current
    const ids = Object.keys(to)
    const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
    let moves = false
    for (const id of ids) {
      const a = from[id]
      if (a && (Math.abs(a.x - to[id].x) > 0.5 || Math.abs(a.y - to[id].y) > 0.5)) {
        moves = true
        break
      }
    }
    if (first.current || !animate || reduced || ids.length > MAX_ANIMATED || !moves) {
      first.current = false
      current.current = to
      setBoxes(to)
      return
    }
    const start: Record<string, Box> = {}
    for (const id of ids) {
      const parent = doc.nodes[id]?.parentId
      const src = from[id] ?? (parent ? from[parent] : undefined) ?? to[id]
      start[id] = { x: src.x, y: src.y, w: to[id].w, h: to[id].h }
    }
    const t0 = performance.now()
    const D = 230
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / D)
      const e = 1 - Math.pow(1 - t, 3)
      const next: Record<string, Box> = {}
      for (const id of ids) {
        const a = start[id]
        const b = to[id]
        next[id] = t >= 1 ? b : { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, w: b.w, h: b.h }
      }
      current.current = next
      setBoxes(next)
      if (t < 1) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [layout, doc, animate])

  return boxes
}
