/**
 * Branchmint map file, version 2 (JSON Lines). One record per line:
 *
 *   {"t":"map","v":2,"meta":{...},"root":"...","layout":"mindmap","edge":"curve","themeId":"mint","bg":"dots"}
 *   {"t":"node","id":"a1","parentId":null,"children":["b2"],"text":"Root"}
 *   {"t":"rel","id":"r1","from":"a1","to":"b2"}
 *
 * Why: Git merges by line. With one record per line, two people editing different nodes
 * never touch the same line. Records are sorted by id (not by tree position) and keys have a
 * fixed order, so an edit changes exactly the lines of the nodes that changed.
 * Derived data (thumbnail, search text) is not stored here, and images are references to
 * files in `assets/` (`{"asset":"<sha256>.png","w":..,"h":..}`) instead of inline data.
 */
import type { MapDoc, MindNode } from './types'

export const FORMAT_VERSION = 2

const NODE_KEYS: (keyof MindNode)[] = [
  'id', 'parentId', 'children', 'text', 'collapsed', 'color', 'shape', 'icon', 'notes', 'link', 'image', 'checklist', 'side',
]
const META_KEYS = ['id', 'title', 'createdAt', 'updatedAt', 'nodeCount', 'starred', 'tags', 'trashedAt'] as const

/** Raw (unvalidated) document as found on disk. Images may be `{asset,w,h}`. */
export type RawDoc = Record<string, any>

const line = (o: unknown) => JSON.stringify(o)

/** `imageRef` maps an inline image (data URL) to its asset file name. */
export function serializeDoc(doc: MapDoc, imageRef: (src: string) => string | undefined): string {
  const meta: Record<string, unknown> = {}
  for (const k of META_KEYS) {
    const v = (doc.meta as unknown as Record<string, unknown>)[k]
    if (v !== undefined && v !== false && v !== null) meta[k] = v
  }
  const out: string[] = [
    line({ t: 'map', v: FORMAT_VERSION, meta, root: doc.root, layout: doc.layout, edge: doc.edge, themeId: doc.themeId, bg: doc.bg }),
  ]
  for (const id of Object.keys(doc.nodes).sort()) {
    const n = doc.nodes[id]
    const rec: Record<string, unknown> = { t: 'node' }
    for (const k of NODE_KEYS) {
      let v: unknown = n[k]
      if (v === undefined || v === false || (Array.isArray(v) && k === 'checklist' && !v.length)) continue
      if (k === 'image') {
        const img = n.image!
        const asset = (img as { asset?: string }).asset ?? imageRef(img.src)
        if (!asset) continue // image could not be stored; drop it rather than write a bad reference
        v = { asset, w: img.w, h: img.h }
      }
      rec[k] = v
    }
    out.push(line(rec))
  }
  for (const r of [...doc.relations].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    out.push(line({ t: 'rel', id: r.id, from: r.from, to: r.to, ...(r.label ? { label: r.label } : {}) }))
  }
  return out.join('\n') + '\n'
}

/** Parse a map file of either version into a raw doc (feed it to `sanitizeDoc`). */
export function parseDocText(text: string): RawDoc {
  const lines = text.split('\n').filter((l) => l.trim())
  if (!lines.length) throw new Error('Empty map file')
  let first: RawDoc
  try {
    first = JSON.parse(lines[0])
  } catch {
    throw new Error('Map file is not valid JSON')
  }
  if (first.t !== 'map') return first // version 1: a single JSON document
  const doc: RawDoc = { ...first, nodes: {}, relations: [] }
  delete doc.t
  for (let i = 1; i < lines.length; i++) {
    let rec: RawDoc
    try {
      rec = JSON.parse(lines[i])
    } catch {
      throw new Error(`Map file line ${i + 1} is not valid JSON`)
    }
    const { t, ...rest } = rec
    if (t === 'node' && typeof rest.id === 'string') doc.nodes[rest.id] = rest
    else if (t === 'rel') doc.relations.push(rest)
    // unknown record types are ignored so newer files still open
  }
  return doc
}

export interface ParsedRecords {
  header: RawDoc
  nodes: Record<string, RawDoc>
  relations: Record<string, RawDoc>
}

export function toRecords(raw: RawDoc): ParsedRecords {
  const { nodes, relations, ...header } = raw
  const rels: Record<string, RawDoc> = {}
  for (const r of relations ?? []) rels[r.id] = r
  return { header, nodes: nodes ?? {}, relations: rels }
}
