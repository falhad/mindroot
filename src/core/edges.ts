import type { Attach } from './layout'
import type { Box, EdgeKind } from './types'

interface Pt { x: number; y: number }

function edgePoint(b: Box, toward: Pt): Pt {
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  if (dx === 0 && dy === 0) return c
  const sx = dx === 0 ? Infinity : b.w / 2 / Math.abs(dx)
  const sy = dy === 0 ? Infinity : b.h / 2 / Math.abs(dy)
  const s = Math.min(sx, sy)
  return { x: c.x + dx * s, y: c.y + dy * s }
}

export function anchors(from: Box, to: Box, attach: Attach): [Pt, Pt] {
  switch (attach) {
    case 'right':
      return [{ x: from.x + from.w, y: from.y + from.h / 2 }, { x: to.x, y: to.y + to.h / 2 }]
    case 'left':
      return [{ x: from.x, y: from.y + from.h / 2 }, { x: to.x + to.w, y: to.y + to.h / 2 }]
    case 'down':
      return [{ x: from.x + from.w / 2, y: from.y + from.h }, { x: to.x + to.w / 2, y: to.y }]
    case 'up':
      return [{ x: from.x + from.w / 2, y: from.y }, { x: to.x + to.w / 2, y: to.y + to.h }]
    default: {
      const fc = { x: from.x + from.w / 2, y: from.y + from.h / 2 }
      const tc = { x: to.x + to.w / 2, y: to.y + to.h / 2 }
      return [edgePoint(from, tc), edgePoint(to, fc)]
    }
  }
}

const f = (n: number) => Math.round(n * 10) / 10

/** SVG path between a parent and child box. */
export function edgePath(kind: EdgeKind, from: Box, to: Box, attach: Attach): string {
  const [a, b] = anchors(from, to, attach)
  const horizontal = attach === 'left' || attach === 'right'
  const vertical = attach === 'up' || attach === 'down'

  if (kind === 'straight' || attach === 'radial') {
    if (attach === 'radial' && kind !== 'straight') {
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      const nx = -(b.y - a.y) * 0.06
      const ny = (b.x - a.x) * 0.06
      return `M${f(a.x)} ${f(a.y)}Q${f(mx + nx)} ${f(my + ny)} ${f(b.x)} ${f(b.y)}`
    }
    return `M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}`
  }

  if (kind === 'curve') {
    if (horizontal) {
      const k = (b.x - a.x) * 0.55
      return `M${f(a.x)} ${f(a.y)}C${f(a.x + k)} ${f(a.y)} ${f(b.x - k)} ${f(b.y)} ${f(b.x)} ${f(b.y)}`
    }
    if (vertical) {
      const k = (b.y - a.y) * 0.55
      return `M${f(a.x)} ${f(a.y)}C${f(a.x)} ${f(a.y + k)} ${f(b.x)} ${f(b.y - k)} ${f(b.x)} ${f(b.y)}`
    }
  }

  // elbow with rounded corners
  if (horizontal) {
    const mx = a.x + (b.x - a.x) / 2
    const dy = b.y - a.y
    const sx = Math.sign(b.x - a.x) || 1
    const sy = Math.sign(dy) || 1
    const r = Math.min(14, Math.abs(b.x - a.x) / 4, Math.abs(dy) / 2)
    if (Math.abs(dy) < 1) return `M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}`
    return (
      `M${f(a.x)} ${f(a.y)}H${f(mx - sx * r)}Q${f(mx)} ${f(a.y)} ${f(mx)} ${f(a.y + sy * r)}` +
      `V${f(b.y - sy * r)}Q${f(mx)} ${f(b.y)} ${f(mx + sx * r)} ${f(b.y)}H${f(b.x)}`
    )
  }
  const my = a.y + (b.y - a.y) / 2
  const dx = b.x - a.x
  const sy = Math.sign(b.y - a.y) || 1
  const sx = Math.sign(dx) || 1
  const r = Math.min(14, Math.abs(b.y - a.y) / 4, Math.abs(dx) / 2)
  if (Math.abs(dx) < 1) return `M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}`
  return (
    `M${f(a.x)} ${f(a.y)}V${f(my - sy * r)}Q${f(a.x)} ${f(my)} ${f(a.x + sx * r)} ${f(my)}` +
    `H${f(b.x - sx * r)}Q${f(b.x)} ${f(my)} ${f(b.x)} ${f(my + sy * r)}V${f(b.y)}`
  )
}

export const DASH: Record<'dashed' | 'solid' | 'dotted', string | undefined> = { dashed: '6 5', solid: undefined, dotted: '1.5 5' }

/** Arrowhead (two short strokes) with its tip at `tip`, pointing along `angle`. */
export function arrowHead(tip: Pt, angle: number, size = 8): string {
  const x1 = tip.x - Math.cos(angle - 0.45) * size
  const y1 = tip.y - Math.sin(angle - 0.45) * size
  const x2 = tip.x - Math.cos(angle + 0.45) * size
  const y2 = tip.y - Math.sin(angle + 0.45) * size
  return `M${f(x1)} ${f(y1)}L${f(tip.x)} ${f(tip.y)}L${f(x2)} ${f(y2)}`
}

export interface RelationGeometry {
  d: string
  start: Pt
  end: Pt
  /** Direction of travel at the end point (arrow tip) and, pointing outward, at the start point. */
  angle: number
  startAngle: number
  /** Middle of the curve: where the label sits. */
  mid: Pt
  /** Control point of the quadratic curve. */
  ctrl: Pt
}

/** Cross-link between two arbitrary nodes, bowed away from the straight line. */
export function relationPath(from: Box, to: Box): RelationGeometry {
  const fc = { x: from.x + from.w / 2, y: from.y + from.h / 2 }
  const tc = { x: to.x + to.w / 2, y: to.y + to.h / 2 }
  const a = edgePoint(from, tc)
  const b = edgePoint(to, fc)
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const bow = Math.min(60, len * 0.2)
  const cx = mx + (-(b.y - a.y) / len) * bow
  const cy = my + ((b.x - a.x) / len) * bow
  const angle = Math.atan2(b.y - cy, b.x - cx)
  const startAngle = Math.atan2(a.y - cy, a.x - cx)
  const mid = { x: (a.x + 2 * cx + b.x) / 4, y: (a.y + 2 * cy + b.y) / 4 }
  return { d: `M${f(a.x)} ${f(a.y)}Q${f(cx)} ${f(cy)} ${f(b.x)} ${f(b.y)}`, start: a, end: b, angle, startAngle, mid, ctrl: { x: cx, y: cy } }
}

/**
 * The cross link closest to the point (x, y) within `tol` world units, or null. Used for
 * double-click: the canvas captures the pointer, so the line itself never receives the event.
 */
export function hitRelation(relations: { id: string; from: string; to: string }[], boxes: Record<string, Box>, x: number, y: number, tol: number): string | null {
  let best: string | null = null
  let bestD = tol
  for (const r of relations) {
    const a = boxes[r.from]
    const b = boxes[r.to]
    if (!a || !b) continue
    const g = relationPath(a, b)
    const steps = 28
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const u = 1 - t
      const px = u * u * g.start.x + 2 * u * t * g.ctrl.x + t * t * g.end.x
      const py = u * u * g.start.y + 2 * u * t * g.ctrl.y + t * t * g.end.y
      const d = Math.hypot(px - x, py - y)
      if (d < bestD) {
        bestD = d
        best = r.id
      }
    }
  }
  return best
}

/**
 * A brace (curly bracket) in the thin box `b`: its ends curl toward the covered nodes and its
 * tip points away from them, toward the label. `side` is the side of the nodes it sits on.
 */
export function bracketPath(b: Box, side: 'left' | 'right' | 'up' | 'down'): string {
  const vertical = side === 'right' || side === 'left'
  const len = vertical ? b.h : b.w
  const th = vertical ? b.w : b.h
  const k = Math.min(th / 2, len / 4)
  const mid = len / 2
  // u runs along the bar, v goes outward (0 next to the nodes, th at the tip)
  const P = (u: number, v: number): string => {
    const [x, y] = side === 'right' ? [b.x + v, b.y + u] : side === 'left' ? [b.x + b.w - v, b.y + u] : side === 'down' ? [b.x + u, b.y + v] : [b.x + u, b.y + b.h - v]
    return `${f(x)} ${f(y)}`
  }
  const h = th / 2
  return (
    `M${P(0, 0)}Q${P(0, h)} ${P(k, h)}L${P(mid - k, h)}Q${P(mid, h)} ${P(mid, th)}` +
    `Q${P(mid, h)} ${P(mid + k, h)}L${P(len - k, h)}Q${P(len, h)} ${P(len, 0)}`
  )
}
