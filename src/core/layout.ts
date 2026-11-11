import { fontStack, measureNode, type NodeMetrics } from './measure'
import { floatIds, visibleChildren } from './tree'
import type { Box, Direction, MapDoc } from './types'

export type Attach = Direction | 'radial'

export interface LayoutResult {
  boxes: Record<string, Box>
  metrics: Record<string, NodeMetrics>
  depth: Record<string, number>
  /** How each non-root node attaches to its parent. */
  attach: Record<string, Attach>
  /** Visible node ids in depth-first order. */
  order: string[]
  bounds: Box
  /** Boundary rectangle of each group (by group id). */
  groupBoxes: Record<string, Box>
  /** Bracket and label of each summary (by summary id). */
  summaryBoxes: Record<string, SummaryBox>
}

export interface SummaryBox {
  bracket: Box
  label: Box
  /** The side of the covered nodes the bracket is on. */
  side: Direction
}

export interface LayoutOptions {
  /** Live text of the node being edited, so the box grows while typing. */
  draft?: { id: string; text: string }
  /** Depth given to the root (floating subtrees start at 1 so they look like branches, not a map root). */
  rootDepth?: number
  /** Internal: do not lay out floating subtrees (used while laying out one of them). */
  skipFloats?: boolean
}

const GROUP_PAD = 12
const BRACKET_GAP = 8
const BRACKET_W = 10

const GAP_MAIN_ROOT = 84
const GAP_MAIN = 52
const GAP_CROSS_TOP = 26
const GAP_CROSS = 11

export function computeLayout(doc: MapDoc, opts: LayoutOptions = {}): LayoutResult {
  const boxes: Record<string, Box> = {}
  const metrics: Record<string, NodeMetrics> = {}
  const depth: Record<string, number> = {}
  const attach: Record<string, Attach> = {}
  const order: string[] = []

  const family = fontStack(doc.font)
  // 1. visible nodes, depth, metrics
  const visit = (id: string, d: number) => {
    const n = doc.nodes[id]
    depth[id] = d
    order.push(id)
    metrics[id] = measureNode(n, d, opts.draft?.id === id ? opts.draft.text : undefined, family)
    for (const c of visibleChildren(doc, id)) visit(c, d + 1)
  }
  visit(doc.root, opts.rootDepth ?? 0)

  const rootM = metrics[doc.root]
  boxes[doc.root] = { x: -rootM.w / 2, y: -rootM.h / 2, w: rootM.w, h: rootM.h }

  const kids = (id: string) => visibleChildren(doc, id)
  const kind = doc.layout

  if (kind === 'radial') {
    layoutRadial(doc, boxes, metrics, depth, attach, kids)
  } else if (kind === 'mindmap') {
    const { left, right } = splitSides(doc, metrics, kids)
    placeBlock(doc.root, right, 'h', 1, boxes, metrics, depth, attach, kids)
    placeBlock(doc.root, left, 'h', -1, boxes, metrics, depth, attach, kids)
  } else {
    const horizontal = kind === 'right' || kind === 'left'
    const sign = kind === 'right' || kind === 'down' ? 1 : -1
    placeBlock(doc.root, kids(doc.root), horizontal ? 'h' : 'v', sign, boxes, metrics, depth, attach, kids)
  }

  const groupBoxes: Record<string, Box> = {}
  const summaryBoxes: Record<string, SummaryBox> = {}
  const result: LayoutResult = { boxes, metrics, depth, attach, order, bounds: boundsOf(Object.values(boxes)), groupBoxes, summaryBoxes }
  addGroupsAndSummaries(doc, result, kids)

  if (!opts.skipFloats) {
    for (const f of floatIds(doc)) {
      const pos = doc.nodes[f].pos
      if (!pos) continue
      // Lay the floating subtree out as if it were its own map (same layout kind), then move it into place.
      const sub = computeLayout({ ...doc, root: f }, { draft: opts.draft, rootDepth: 1, skipFloats: true })
      const move = (b: Box): Box => ({ ...b, x: b.x + pos.x, y: b.y + pos.y })
      for (const id of sub.order) {
        boxes[id] = move(sub.boxes[id])
        metrics[id] = sub.metrics[id]
        depth[id] = sub.depth[id]
        if (sub.attach[id]) attach[id] = sub.attach[id]
        order.push(id)
      }
      for (const [gid, b] of Object.entries(sub.groupBoxes)) groupBoxes[gid] = move(b)
      for (const [sid, s] of Object.entries(sub.summaryBoxes)) summaryBoxes[sid] = { ...s, bracket: move(s.bracket), label: move(s.label) }
    }
  }
  result.bounds = boundsOf([
    ...Object.values(boxes),
    ...Object.values(groupBoxes),
    ...Object.values(summaryBoxes).flatMap((s) => [s.bracket, s.label]),
  ])
  // right-to-left maps are the mirror image of the same layout (floating subtrees are mirrored once, here)
  return doc.dir === 'rtl' && !opts.skipFloats ? mirrorLayout(result) : result
}

const FLIP: Record<Direction, Direction> = { left: 'right', right: 'left', up: 'up', down: 'down' }

/** The mirror image of a layout about the vertical axis through the centre idea. Mirroring twice gives the original. */
export function mirrorLayout(l: LayoutResult): LayoutResult {
  const flip = (b: Box): Box => ({ x: -(b.x + b.w), y: b.y, w: b.w, h: b.h })
  const boxes: Record<string, Box> = {}
  for (const [id, b] of Object.entries(l.boxes)) boxes[id] = flip(b)
  const attach: LayoutResult['attach'] = {}
  for (const [id, a] of Object.entries(l.attach)) attach[id] = a === 'radial' ? a : FLIP[a]
  const groupBoxes: Record<string, Box> = {}
  for (const [id, b] of Object.entries(l.groupBoxes)) groupBoxes[id] = flip(b)
  const summaryBoxes: Record<string, SummaryBox> = {}
  for (const [id, s] of Object.entries(l.summaryBoxes)) summaryBoxes[id] = { bracket: flip(s.bracket), label: flip(s.label), side: FLIP[s.side] }
  const bounds = boundsOf([...Object.values(boxes), ...Object.values(groupBoxes), ...Object.values(summaryBoxes).flatMap((s) => [s.bracket, s.label])])
  return { ...l, boxes, attach, groupBoxes, summaryBoxes, bounds }
}

/** Rectangles for groups and brackets for summaries, from the boxes already placed. */
function addGroupsAndSummaries(doc: MapDoc, r: LayoutResult, kids: (id: string) => string[]) {
  const subtree = (id: string): Box[] => [r.boxes[id], ...kids(id).flatMap(subtree)]
  for (const g of doc.groups ?? []) {
    const members = g.ids.filter((id) => r.boxes[id])
    if (!members.length) continue
    const b = boundsOf(members.flatMap(subtree))
    r.groupBoxes[g.id] = { x: b.x - GROUP_PAD, y: b.y - GROUP_PAD, w: b.w + GROUP_PAD * 2, h: b.h + GROUP_PAD * 2 }
  }
  for (const s of doc.summaries ?? []) {
    const parent = doc.nodes[s.parentId]
    if (!parent) continue
    const from = parent.children.indexOf(s.from)
    const to = parent.children.indexOf(s.to)
    const covered = parent.children.slice(from, to + 1).filter((id) => r.boxes[id])
    if (from < 0 || to < from || !covered.length) continue
    const b = boundsOf(covered.flatMap(subtree))
    const a = r.attach[covered[0]]
    const side: Direction = a === 'radial' || !a ? 'right' : a
    const m = measureNode({ id: 's', parentId: null, children: [], text: s.label || ' ' }, 2, undefined, fontStack(doc.font))
    const lw = m.w
    const lh = m.h
    let bracket: Box
    let label: Box
    if (side === 'right') {
      bracket = { x: b.x + b.w + BRACKET_GAP, y: b.y, w: BRACKET_W, h: b.h }
      label = { x: bracket.x + BRACKET_W + 6, y: b.y + b.h / 2 - lh / 2, w: lw, h: lh }
    } else if (side === 'left') {
      bracket = { x: b.x - BRACKET_GAP - BRACKET_W, y: b.y, w: BRACKET_W, h: b.h }
      label = { x: bracket.x - 6 - lw, y: b.y + b.h / 2 - lh / 2, w: lw, h: lh }
    } else if (side === 'down') {
      bracket = { x: b.x, y: b.y + b.h + BRACKET_GAP, w: b.w, h: BRACKET_W }
      label = { x: b.x + b.w / 2 - lw / 2, y: bracket.y + BRACKET_W + 6, w: lw, h: lh }
    } else {
      bracket = { x: b.x, y: b.y - BRACKET_GAP - BRACKET_W, w: b.w, h: BRACKET_W }
      label = { x: b.x + b.w / 2 - lw / 2, y: bracket.y - 6 - lh, w: lw, h: lh }
    }
    r.summaryBoxes[s.id] = { bracket, label, side }
  }
}

export function boundsOf(list: Box[]): Box {
  if (!list.length) return { x: 0, y: 0, w: 0, h: 0 }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const b of list) {
    x0 = Math.min(x0, b.x)
    y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.w)
    y1 = Math.max(y1, b.y + b.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

type Axis = 'h' | 'v'

/** Subtree extent along the cross axis. */
function makeSub(axis: Axis, metrics: Record<string, NodeMetrics>, depth: Record<string, number>, kids: (id: string) => string[]) {
  const memo = new Map<string, number>()
  const gapCross = (d: number) => (d <= 1 ? GAP_CROSS_TOP : GAP_CROSS)
  const sub = (id: string): number => {
    const hit = memo.get(id)
    if (hit !== undefined) return hit
    const m = metrics[id]
    const own = axis === 'h' ? m.h : m.w
    const ks = kids(id)
    let res = own
    if (ks.length) {
      const total = ks.reduce((s, k) => s + sub(k), 0) + gapCross(depth[id] + 1) * (ks.length - 1)
      res = Math.max(own, total)
    }
    memo.set(id, res)
    return res
  }
  return { sub, gapCross }
}

/** Lay out `children` of `parentId` as a block growing in direction `sign` along `axis`. */
function placeBlock(
  parentId: string,
  children: string[],
  axis: Axis,
  sign: 1 | -1,
  boxes: Record<string, Box>,
  metrics: Record<string, NodeMetrics>,
  depth: Record<string, number>,
  attach: Record<string, Attach>,
  kids: (id: string) => string[],
) {
  if (!children.length) return
  const { sub, gapCross } = makeSub(axis, metrics, depth, kids)
  const dir: Direction = axis === 'h' ? (sign > 0 ? 'right' : 'left') : sign > 0 ? 'down' : 'up'

  const put = (id: string, mainStart: number, crossCenter: number) => {
    const m = metrics[id]
    const main = axis === 'h' ? m.w : m.h
    const cross = axis === 'h' ? m.h : m.w
    const m0 = sign > 0 ? mainStart : mainStart - main
    const c0 = crossCenter - cross / 2
    boxes[id] = axis === 'h' ? { x: m0, y: c0, w: m.w, h: m.h } : { x: c0, y: m0, w: m.w, h: m.h }
    attach[id] = dir
    const ks = kids(id)
    if (!ks.length) return
    const next = sign > 0 ? m0 + main + GAP_MAIN : m0 - GAP_MAIN
    stack(ks, next, crossCenter, depth[id] + 1)
  }

  const stack = (ids: string[], mainStart: number, center: number, d: number) => {
    const gap = gapCross(d)
    const total = ids.reduce((s, k) => s + sub(k), 0) + gap * (ids.length - 1)
    let cur = center - total / 2
    for (const k of ids) {
      const s = sub(k)
      put(k, mainStart, cur + s / 2)
      cur += s + gap
    }
  }

  const pb = boxes[parentId]
  const parentMainEdge = axis === 'h' ? (sign > 0 ? pb.x + pb.w : pb.x) : sign > 0 ? pb.y + pb.h : pb.y
  const parentCrossCenter = axis === 'h' ? pb.y + pb.h / 2 : pb.x + pb.w / 2
  const start = sign > 0 ? parentMainEdge + GAP_MAIN_ROOT : parentMainEdge - GAP_MAIN_ROOT
  stack(children, start, parentCrossCenter, depth[children[0]])
}

/** Split root children into right/left columns, honouring explicit `side`, balancing the rest. */
function splitSides(doc: MapDoc, metrics: Record<string, NodeMetrics>, kids: (id: string) => string[]) {
  const ks = kids(doc.root)
  const weight = (id: string) => Math.max(1, countVisible(id, kids)) * 1 + metrics[id].h / 100
  const right: string[] = []
  const left: string[] = []
  let rw = 0
  let lw = 0
  for (const id of ks) {
    const side = doc.nodes[id].side
    if (side === 'right') { right.push(id); rw += weight(id) }
    else if (side === 'left') { left.push(id); lw += weight(id) }
  }
  const auto = ks.filter((id) => !doc.nodes[id].side)
  // Fill the right side first, then balance greedily, so the first branches read top-right.
  for (const id of auto) {
    if (rw <= lw) { right.push(id); rw += weight(id) }
    else { left.push(id); lw += weight(id) }
  }
  const byOrder = (a: string, b: string) => ks.indexOf(a) - ks.indexOf(b)
  right.sort(byOrder)
  left.sort(byOrder)
  return { left, right }
}

function countVisible(id: string, kids: (id: string) => string[]): number {
  const k = kids(id)
  return k.length ? k.reduce((s, c) => s + countVisible(c, kids), 0) : 1
}

function layoutRadial(
  doc: MapDoc,
  boxes: Record<string, Box>,
  metrics: Record<string, NodeMetrics>,
  depth: Record<string, number>,
  attach: Record<string, Attach>,
  kids: (id: string) => string[],
) {
  // radius per ring
  const byDepth: string[][] = []
  for (const id of Object.keys(metrics)) (byDepth[depth[id]] ??= []).push(id)
  const radii: number[] = [0]
  for (let d = 1; d < byDepth.length; d++) {
    const ring = byDepth[d]
    const avgW = ring.reduce((s, id) => s + metrics[id].w, 0) / ring.length
    const prevAvg = d === 1 ? metrics[doc.root].w : byDepth[d - 1].reduce((s, id) => s + metrics[id].w, 0) / byDepth[d - 1].length
    const spacing = prevAvg / 2 + avgW / 2 + 46
    const capacity = ring.reduce((s, id) => s + Math.sqrt(metrics[id].w * metrics[id].h) + 16, 0) / (2 * Math.PI)
    radii[d] = Math.max(radii[d - 1] + spacing, capacity)
  }

  const place = (id: string, a0: number, a1: number) => {
    const ks = kids(id)
    const total = ks.reduce((s, k) => s + countVisible(k, kids), 0)
    let cur = a0
    for (const k of ks) {
      const share = ((a1 - a0) * countVisible(k, kids)) / total
      const mid = cur + share / 2
      const r = radii[depth[k]]
      const m = metrics[k]
      boxes[k] = { x: Math.cos(mid) * r - m.w / 2, y: Math.sin(mid) * r - m.h / 2, w: m.w, h: m.h }
      attach[k] = 'radial'
      place(k, cur, cur + share)
      cur += share
    }
  }
  place(doc.root, -Math.PI / 2, (3 * Math.PI) / 2)
}

// ---------- navigation & hit-testing ----------

/** Spatial arrow-key navigation: nearest visible node in `dir` from `from`. */
export function navigate(layout: LayoutResult, from: string, dir: Direction): string | null {
  const a = layout.boxes[from]
  if (!a) return null
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 }
  let best: string | null = null
  let bestScore = Infinity
  for (const id of layout.order) {
    if (id === from) continue
    const b = layout.boxes[id]
    const dx = b.x + b.w / 2 - ac.x
    const dy = b.y + b.h / 2 - ac.y
    const primary = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy
    if (primary <= 1) continue
    const cross = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx)
    if (cross > primary * 2.5 + 40) continue // outside a ~70° cone
    const score = primary + cross * 2.2
    if (score < bestScore) {
      bestScore = score
      best = id
    }
  }
  return best
}

export function hitTest(layout: LayoutResult, x: number, y: number, skip?: Set<string>, pad = 0): string | null {
  // iterate in reverse so later (deeper) nodes win on overlaps
  for (let i = layout.order.length - 1; i >= 0; i--) {
    const id = layout.order[i]
    if (skip?.has(id)) continue
    const b = layout.boxes[id]
    if (x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad) return id
  }
  return null
}
