import { subtreeIds } from './tree'
import type { MapDoc, MindNode } from './types'

const cache = new WeakMap<MapDoc, Map<string, MapDoc>>()

/**
 * A view of one branch as if it were the whole map: the same node objects, with the focus node
 * as a parentless root. Links that leave the branch are hidden. It never copies node data and
 * never changes `doc`, so edits made in focus mode still go to the real map by node id.
 */
export function focusDoc(doc: MapDoc, id: string): MapDoc {
  const inside = subtreeIds(doc, id)
  const set = new Set(inside)
  const nodes: MapDoc['nodes'] = {}
  for (const n of inside) nodes[n] = doc.nodes[n]
  const { side: _side, ...root } = doc.nodes[id]
  nodes[id] = { ...root, parentId: null }
  return { ...doc, root: id, nodes, relations: doc.relations.filter((r) => set.has(r.from) && set.has(r.to)) }
}

/** `focusDoc` when `focusId` is a usable focus (not the root, still in the map), else `doc` itself. Memoized. */
export function projectDoc(doc: MapDoc, focusId: string | null): MapDoc {
  if (!focusId || focusId === doc.root || !doc.nodes[focusId]) return doc
  let perDoc = cache.get(doc)
  if (!perDoc) cache.set(doc, (perDoc = new Map()))
  let projected = perDoc.get(focusId)
  if (!projected) perDoc.set(focusId, (projected = focusDoc(doc, focusId)))
  return projected
}

/** Node ids from the map's root down to `id`, for the breadcrumb. */
export function focusPath(doc: MapDoc, id: string): string[] {
  const out: string[] = []
  for (let n: MindNode | undefined = doc.nodes[id]; n; n = n.parentId ? doc.nodes[n.parentId] : undefined) out.unshift(n.id)
  return out
}
