/**
 * Three-way merge of two versions of one map (`ours`, `theirs`) from a common ancestor (`base`).
 *
 * The map is a table of small records (nodes, relations), so we merge per record and per field,
 * not per text line:
 *  - only one side changed a record or field -> take that change
 *  - both changed the same field differently -> the side with the newer `meta.updatedAt` wins
 *    (counted in `conflicts`, so the UI can say so)
 *  - `children` lists merge as sets: additions from both sides are kept, removals are kept,
 *    ours order wins
 *  - changed on one side and deleted on the other -> keep the changed record (never lose work)
 * Then the tree is repaired (stale links, cycles, orphans), so a merged map is always valid.
 */
import { serializeDoc, parseDocText, toRecords, type RawDoc } from '../core/format'
import { sanitizeDoc } from '../core/outline'
import { syncMeta } from '../core/tree'
import type { MapDoc } from '../core/types'

type Rec = Record<string, any>

export interface MergeResult {
  doc: MapDoc
  /** Fields both sides changed differently (the newer side won). */
  conflicts: number
  /** Nodes re-attached to the central idea because a concurrent move left them unreachable. */
  rescued: number
}

function canon(v: unknown): string {
  if (v === undefined) return 'u'
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']'
  if (v && typeof v === 'object') {
    const o = v as Rec
    return '{' + Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}'
  }
  return JSON.stringify(v)
}

/** Images compare by file (or data), so `{asset}` and a hydrated `{src}` of the same image match. */
function fieldEq(key: string, a: unknown, b: unknown): boolean {
  if (key === 'image') {
    const id = (i: any) => (i ? `${i.asset ?? i.src}|${i.w}x${i.h}` : '')
    return id(a) === id(b)
  }
  return canon(a) === canon(b)
}

class Merger {
  conflicts = 0
  constructor(private oursNewer: boolean) {}

  scalar(key: string, b: unknown, o: unknown, t: unknown): unknown {
    if (fieldEq(key, o, t)) return o
    if (fieldEq(key, o, b)) return t
    if (fieldEq(key, t, b)) return o
    this.conflicts++
    return this.oursNewer ? o : t
  }

  children(b: string[] | undefined, o: string[] | undefined, t: string[] | undefined): string[] {
    const base = new Set(b ?? [])
    const ours = o ?? []
    const theirs = t ?? []
    if (canon(ours) === canon(theirs)) return ours
    if (canon(ours) === canon(b ?? [])) return theirs
    if (canon(theirs) === canon(b ?? [])) return ours
    const tset = new Set(theirs)
    const result = ours.filter((x) => !(base.has(x) && !tset.has(x))) // theirs removed it
    const have = new Set(result)
    theirs.forEach((x, i) => {
      if (have.has(x) || base.has(x)) return // already there, or ours removed it
      const pred = theirs.slice(0, i).reverse().find((p) => have.has(p))
      result.splice(pred === undefined ? 0 : result.indexOf(pred) + 1, 0, x)
      have.add(x)
    })
    return result
  }

  record(b: Rec | undefined, o: Rec | undefined, t: Rec | undefined): Rec | undefined {
    if (!o && !t) return undefined
    if (canon(o) === canon(t)) return o
    if (canon(o) === canon(b)) return t
    if (canon(t) === canon(b)) return o
    if (!o) return t // we deleted it, they edited it: keep the edit
    if (!t) return o
    const out: Rec = {}
    for (const k of new Set([...Object.keys(o), ...Object.keys(t), ...Object.keys(b ?? {})])) {
      const v = k === 'children' ? this.children(b?.children, o.children, t.children) : this.scalar(k, b?.[k], o[k], t[k])
      if (v !== undefined) out[k] = v
    }
    return out
  }

  table(b: Record<string, Rec>, o: Record<string, Rec>, t: Record<string, Rec>): Record<string, Rec> {
    const out: Record<string, Rec> = {}
    for (const id of new Set([...Object.keys(b), ...Object.keys(o), ...Object.keys(t)])) {
      const r = this.record(b[id], o[id], t[id])
      if (r) out[id] = r
    }
    return out
  }
}

/** Make the tree consistent after merging. Returns how many nodes had to be re-attached. */
function repairTree(nodes: Record<string, Rec>, root: string): number {
  for (const n of Object.values(nodes)) {
    // `parentId` is the truth; `children` only lists nodes that point back, once each
    n.children = [...new Set((n.children ?? []) as string[])].filter((c) => nodes[c] && nodes[c].parentId === n.id && c !== n.id)
  }
  if (nodes[root]) nodes[root].parentId = null
  for (const n of Object.values(nodes)) {
    if (n.id === root || !n.parentId) continue
    const p = nodes[n.parentId]
    if (p && !p.children.includes(n.id)) p.children.push(n.id)
  }
  const reach = new Set<string>()
  const mark = (id: string) => {
    if (reach.has(id) || !nodes[id]) return
    reach.add(id)
    for (const c of nodes[id].children) mark(c)
  }
  mark(root)
  let rescued = 0
  for (const id of Object.keys(nodes).sort()) {
    if (reach.has(id)) continue
    const n = nodes[id]
    const old = n.parentId && nodes[n.parentId]
    if (old) old.children = old.children.filter((c: string) => c !== id)
    n.parentId = root
    nodes[root].children.push(id)
    mark(id)
    rescued++
  }
  return rescued
}

const HEADER_KEYS = ['root', 'layout', 'edge', 'themeId', 'bg']

export function mergeDocs(base: RawDoc | null, ours: RawDoc, theirs: RawDoc): MergeResult {
  const B = toRecords(base ?? { nodes: {}, relations: [], meta: {} })
  const O = toRecords(ours)
  const T = toRecords(theirs)
  const oursNewer = (O.header.meta?.updatedAt ?? 0) >= (T.header.meta?.updatedAt ?? 0)
  const m = new Merger(oursNewer)

  const header: Rec = {}
  for (const k of HEADER_KEYS) {
    const v = m.scalar(k, B.header[k], O.header[k], T.header[k])
    if (v !== undefined) header[k] = v
  }
  const meta: Rec = {}
  for (const k of new Set([...Object.keys(O.header.meta ?? {}), ...Object.keys(T.header.meta ?? {})])) {
    if (k === 'updatedAt') meta[k] = Math.max(O.header.meta?.[k] ?? 0, T.header.meta?.[k] ?? 0)
    else if (k === 'createdAt') meta[k] = Math.min(O.header.meta?.[k] ?? Infinity, T.header.meta?.[k] ?? Infinity)
    else {
      const v = m.scalar(k, B.header.meta?.[k], O.header.meta?.[k], T.header.meta?.[k])
      if (v !== undefined) meta[k] = v
    }
  }
  // the id never changes; take it from ours so a weird theirs cannot rename the file
  meta.id = O.header.meta?.id ?? T.header.meta?.id

  const nodes = m.table(B.nodes, O.nodes, T.nodes)
  const relations = m.table(B.relations, O.relations, T.relations)
  const root = header.root ?? O.header.root
  const rescued = nodes[root] ? repairTree(nodes, root) : 0
  const keepRel = Object.values(relations).filter((r) => nodes[r.from] && nodes[r.to])

  const doc = sanitizeDoc({ ...header, v: 2, meta, nodes, relations: keepRel })
  doc.meta.updatedAt = meta.updatedAt
  syncMeta(doc)
  return { doc, conflicts: m.conflicts, rescued }
}

export interface TextMerge {
  text: string
  conflicts: number
  rescued: number
}

/** Merge three map files (as text). `base` is null when the ancestor is unknown. */
export function mergeMapTexts(base: string | null, ours: string, theirs: string): TextMerge {
  const r = mergeDocs(base ? parseDocText(base) : null, parseDocText(ours), parseDocText(theirs))
  return { text: serializeDoc(r.doc, () => undefined), conflicts: r.conflicts, rescued: r.rescued }
}
