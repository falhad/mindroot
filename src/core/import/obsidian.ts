import { uid } from '../ids'
import { buildOutlineDoc, type OutNode } from '../outline'
import type { MapDoc } from '../types'

interface CanvasNode {
  id: string
  type?: string
  text?: string
  file?: string
  url?: string
  label?: string
  color?: string
  x: number
  y: number
  width?: number
  height?: number
}
interface CanvasEdge {
  id?: string
  fromNode: string
  toNode: string
  label?: string
}

const PRESET_COLORS = ['#fb464c', '#e9973f', '#e0de71', '#44cf6e', '#53dfdd', '#a882ff']
const HEX = /^#[0-9a-fA-F]{6}$/

/**
 * Import an Obsidian canvas (`.canvas`). Cards become ideas and arrows become the tree: edges are
 * read in file order and an edge that would give a card a second parent, or close a loop, becomes a
 * cross link instead. Several separate roots get a central idea. A canvas group becomes a boundary
 * when all its cards are siblings.
 */
export function fromObsidianCanvas(text: string, fallbackTitle = 'Imported canvas'): MapDoc {
  let data: { nodes?: unknown; edges?: unknown }
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('This is not an Obsidian canvas (the file is not valid JSON)')
  }
  if (!data || !Array.isArray(data.nodes)) throw new Error('This is not an Obsidian canvas (no "nodes" list)')
  const all = (data.nodes as CanvasNode[]).filter((n) => n && typeof n.id === 'string' && Number.isFinite(n.x) && Number.isFinite(n.y))
  const cards = all.filter((n) => n.type !== 'group')
  const groups = all.filter((n) => n.type === 'group')
  if (!cards.length) throw new Error('This canvas has no cards to import (it is empty)')
  const byId = new Map(cards.map((c) => [c.id, c]))
  const edges = (Array.isArray(data.edges) ? (data.edges as CanvasEdge[]) : []).filter((e) => e && byId.has(e.fromNode) && byId.has(e.toNode) && e.fromNode !== e.toNode)

  // reading order: top to bottom, then left to right
  const pos = (a: CanvasNode, b: CanvasNode) => a.y - b.y || a.x - b.x

  // spanning forest from the edges, in file order; the rest become links
  const parent = new Map<string, string>()
  const extra: CanvasEdge[] = []
  const isAncestor = (anc: string, of: string) => {
    for (let p = parent.get(of); p !== undefined; p = parent.get(p)) if (p === anc) return true
    return false
  }
  for (const e of edges) {
    if (parent.has(e.toNode) || isAncestor(e.toNode, e.fromNode)) extra.push(e)
    else parent.set(e.toNode, e.fromNode)
  }

  const label = (c: CanvasNode): string => {
    if (c.type === 'file' && c.file) return (c.file.split('/').pop() ?? c.file).replace(/\.md$/i, '')
    if (c.type === 'link' && c.url) return c.url
    return c.text ?? c.label ?? ''
  }
  const color = (c: CanvasNode): string | undefined => {
    if (!c.color) return undefined
    if (HEX.test(c.color)) return c.color
    const i = Number(c.color)
    return Number.isInteger(i) && i >= 1 && i <= 6 ? PRESET_COLORS[i - 1] : undefined
  }

  const kids = new Map<string, CanvasNode[]>()
  for (const c of cards) {
    const p = parent.get(c.id)
    if (p) kids.set(p, [...(kids.get(p) ?? []), c])
  }
  const toOut = (c: CanvasNode): OutNode => ({
    text: label(c),
    ref: c.id,
    ...(color(c) ? { color: color(c) } : {}),
    children: (kids.get(c.id) ?? []).sort(pos).map(toOut),
  })
  const roots = cards.filter((c) => !parent.has(c.id)).sort(pos)
  const { doc, idByRef } = buildOutlineDoc(roots.map(toOut), fallbackTitle)

  const seen = new Set<string>()
  for (const e of extra) {
    const from = idByRef.get(e.fromNode)
    const to = idByRef.get(e.toNode)
    if (!from || !to) continue
    const key = [from, to].sort().join('|')
    if (seen.has(key)) continue
    seen.add(key)
    doc.relations.push({ id: uid(8), from, to, ...(e.label?.trim() ? { label: e.label.trim() } : {}) })
  }

  for (const g of groups) {
    const w = g.width ?? 0
    const h = g.height ?? 0
    const members = cards
      .filter((c) => c.x + (c.width ?? 0) / 2 >= g.x && c.x + (c.width ?? 0) / 2 <= g.x + w && c.y + (c.height ?? 0) / 2 >= g.y && c.y + (c.height ?? 0) / 2 <= g.y + h)
      .map((c) => idByRef.get(c.id))
      .filter((id): id is string => !!id)
    if (!members.length) continue
    const p = doc.nodes[members[0]].parentId
    if (!p || !members.every((id) => doc.nodes[id].parentId === p)) continue
    const order = doc.nodes[p].children
    members.sort((a, b) => order.indexOf(a) - order.indexOf(b))
    doc.groups = [...(doc.groups ?? []), { id: uid(8), ids: members, ...(g.label?.trim() ? { label: g.label.trim() } : {}) }]
  }
  return doc
}
