import type { MapDoc, MindNode } from './types'

/** Trim, drop a leading `#`, lower-case, NFC, and join words with `-`. Empty means "not a tag". */
export function normalizeTag(s: string): string {
  return s.normalize('NFC').trim().replace(/^#+/, '').trim().toLowerCase().replace(/\s+/g, '-')
}

/** Replace the tags of `ids`. Normalizes, removes duplicates, and deletes the field when none are left. */
export function setNodeTags(doc: MapDoc, ids: string[], tags: string[]) {
  const clean = [...new Set(tags.map(normalizeTag).filter(Boolean))]
  for (const id of ids) {
    const n = doc.nodes[id]
    if (!n) continue
    if (clean.length) n.tags = [...clean]
    else delete n.tags
  }
}

export function allTags(doc: MapDoc): { tag: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const n of Object.values(doc.nodes)) for (const t of n.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1)
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

/** True when the node has at least one of the selected tags (an empty filter matches everything). */
export function matchesTags(node: MindNode, filter: string[]): boolean {
  return filter.length === 0 || (node.tags ?? []).some((t) => filter.includes(t))
}

export type TagState = 'match' | 'path' | 'dim'

/**
 * How each node is shown while a tag filter is on: matches normally, their ancestors softly
 * (so you can still see where a match sits), everything else dimmed. Null when no filter is set.
 */
export function tagFilterState(doc: MapDoc, filter: string[]): Map<string, TagState> | null {
  if (!filter.length) return null
  const out = new Map<string, TagState>()
  for (const id of Object.keys(doc.nodes)) out.set(id, 'dim')
  for (const n of Object.values(doc.nodes)) {
    if (!matchesTags(n, filter)) continue
    out.set(n.id, 'match')
    let p = n.parentId
    while (p) {
      if (out.get(p) !== 'match') out.set(p, 'path')
      p = doc.nodes[p]?.parentId ?? null
    }
  }
  return out
}
