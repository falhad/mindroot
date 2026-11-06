import { orderedIds } from './tree'
import type { MapDoc } from './types'

export interface Hit {
  id: string
  /** Where the match is: node text or its notes. */
  field: 'text' | 'notes'
}

/** Case-insensitive search through node text, notes and checklist items, in document order. */
export function searchNodes(doc: MapDoc, query: string): Hit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: Hit[] = []
  for (const id of orderedIds(doc)) {
    const n = doc.nodes[id]
    if (n.text.toLowerCase().includes(q)) hits.push({ id, field: 'text' })
    else if (
      n.notes?.toLowerCase().includes(q) ||
      n.checklist?.some((c) => c.text.toLowerCase().includes(q))
    )
      hits.push({ id, field: 'notes' })
  }
  return hits
}

/** Make sure every ancestor of `id` is expanded so the node is visible. */
export function revealPath(doc: MapDoc, id: string) {
  let p = doc.nodes[id]?.parentId
  while (p) {
    const n = doc.nodes[p]
    if (!n) break
    delete n.collapsed
    p = n.parentId
  }
}
