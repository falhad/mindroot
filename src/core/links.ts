import type { MapDigest } from './digest'
import type { MapDoc, MapMeta } from './types'

export interface LinkRef {
  /** The node that holds the link. */
  from: string
  fromText: string
  /** The map linked to, and optionally a node in it. */
  mapId: string
  nodeId?: string
}

export interface Backlink {
  fromMapId: string
  fromMapTitle: string
  from: string
  fromText: string
}

export function collectLinks(doc: MapDoc): LinkRef[] {
  const out: LinkRef[] = []
  for (const n of Object.values(doc.nodes)) {
    if (n.mapLink) out.push({ from: n.id, fromText: n.text.replace(/\s+/g, ' ').trim().slice(0, 80), mapId: n.mapLink.mapId, nodeId: n.mapLink.nodeId })
  }
  return out
}

/** Every node, in any map, that links to `mapId` (or, if `nodeId` is given, to that node). */
export function backlinksTo(digests: Record<string, MapDigest>, mapId: string, nodeId?: string): Backlink[] {
  const out: Backlink[] = []
  for (const [fromMapId, g] of Object.entries(digests)) {
    if (fromMapId === mapId) continue
    for (const l of g.links) {
      if (l.mapId === mapId && (nodeId === undefined || l.nodeId === nodeId)) out.push({ fromMapId, fromMapTitle: g.title, from: l.from, fromText: l.fromText })
    }
  }
  return out.sort((a, b) => a.fromMapTitle.localeCompare(b.fromMapTitle) || a.fromText.localeCompare(b.fromText))
}

export type LinkStatus = 'ok' | 'trashed' | 'missing'

/** Whether the map a link points to can be opened. */
export function linkStatus(link: { mapId: string }, metas: Pick<MapMeta, 'id' | 'trashedAt'>[]): LinkStatus {
  const m = metas.find((x) => x.id === link.mapId)
  return !m ? 'missing' : m.trashedAt ? 'trashed' : 'ok'
}
