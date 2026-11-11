import { uid } from './ids'
import { orderedIds } from './tree'
import type { MapDoc, MindNode } from './types'

export interface DocDiff {
  /** Ids in `b` with no counterpart in `a`. */
  added: string[]
  /** Ids in `a` with no counterpart in `b`. */
  removed: string[]
  /** Ids in `b` whose content differs from their counterpart in `a`. */
  changed: string[]
  /** Ids in `b` whose parent differs from the counterpart's parent in `a` (only the top of a moved branch). */
  moved: string[]
  /** For each id in `a`, the matching id in `b`. */
  match: Map<string, string>
}

/** The parts of a node whose change is worth showing (not its position or fold state). */
const sig = (n: MindNode) =>
  JSON.stringify([
    n.text, n.notes ?? '', n.color ?? '', n.shape ?? '', n.icon ?? '', n.link ?? '', n.tags ?? [], n.due ?? '', n.done ?? null, n.sticky ?? false,
    n.image ? [n.image.w, n.image.h, n.image.src.length] : null,
    (n.checklist ?? []).map((c) => [c.text, c.done]),
    (n.attachments ?? []).map((x) => x.asset),
    n.mapLink ?? null,
  ])

/** A key for a node made of the texts on its path from the root, so two maps with different ids can be lined up. */
function pathKeys(doc: MapDoc): Map<string, string> {
  const keys = new Map<string, string>()
  const seen = new Map<string, number>()
  for (const id of orderedIds(doc)) {
    const n = doc.nodes[id]
    const base = n.parentId && keys.has(n.parentId) ? `${keys.get(n.parentId)}\u0001${n.text}` : n.text
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    keys.set(id, `${base}\u0002${count}`) // the n-th sibling with the same text
  }
  return keys
}

/** Compare two versions of a map (or two maps). Nodes are matched by id first, then by path and text. */
export function diffDocs(a: MapDoc, b: MapDoc): DocDiff {
  const match = new Map<string, string>()
  const usedB = new Set<string>()
  for (const id of Object.keys(a.nodes)) {
    if (b.nodes[id]) {
      match.set(id, id)
      usedB.add(id)
    }
  }
  if (match.size < Object.keys(a.nodes).length && match.size < Object.keys(b.nodes).length) {
    const ka = pathKeys(a)
    const kb = pathKeys(b)
    const byKey = new Map<string, string>()
    for (const [id, k] of kb) if (!usedB.has(id)) byKey.set(k, id)
    for (const [id, k] of ka) {
      if (match.has(id)) continue
      const other = byKey.get(k)
      if (other && !usedB.has(other)) {
        match.set(id, other)
        usedB.add(other)
      }
    }
  }
  const out: DocDiff = { added: [], removed: [], changed: [], moved: [], match }
  for (const id of orderedIds(a)) if (!match.has(id)) out.removed.push(id)
  for (const id of orderedIds(b)) if (!usedB.has(id)) out.added.push(id)
  const reverse = new Map([...match].map(([x, y]) => [y, x]))
  for (const id of orderedIds(b)) {
    const aid = reverse.get(id)
    if (!aid) continue
    const na = a.nodes[aid]
    const nb = b.nodes[id]
    if (sig(na) !== sig(nb)) out.changed.push(id)
    const pa = na.parentId ? match.get(na.parentId) : null
    if ((na.parentId ?? null) !== null && nb.parentId !== null && pa !== nb.parentId) out.moved.push(id)
  }
  return out
}

/**
 * Copy the branch of `nodeId` from the older version `old` into `doc` (which is edited in place),
 * with new ids, under its old parent if that still exists, else under the root. Returns the new id.
 */
export function restoreSubtree(doc: MapDoc, old: MapDoc, nodeId: string): string | null {
  const src = old.nodes[nodeId]
  if (!src || nodeId === old.root) return null
  const parentId = src.parentId && doc.nodes[src.parentId] ? src.parentId : doc.root
  const copy = (id: string, parent: string): string => {
    const n = old.nodes[id]
    const nid = uid()
    const { id: _i, parentId: _p, children: _c, ...rest } = structuredClone(n)
    doc.nodes[nid] = { ...rest, id: nid, parentId: parent, children: [] }
    doc.nodes[parent].children.push(nid)
    for (const c of n.children) copy(c, nid)
    return nid
  }
  const restored = copy(nodeId, parentId)
  delete doc.nodes[restored].side
  delete doc.nodes[restored].pos
  doc.nodes[parentId].collapsed = false
  return restored
}
