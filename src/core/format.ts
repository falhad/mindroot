/**
 * Branchmint map file, version 3 (JSON Lines). Version 3 only adds optional fields and the
 * `group` / `sum` records; anything this version does not know is kept and written back. One record per line:
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

export const FORMAT_VERSION = 3

const NODE_KEYS: (keyof MindNode)[] = [
  'id', 'parentId', 'children', 'text', 'collapsed', 'color', 'shape', 'icon', 'notes', 'link', 'image', 'checklist', 'side',
  'tags', 'due', 'done', 'mapLink', 'attachments', 'pos', 'sticky', 'notesFmt',
]
const KNOWN_NODE = new Set<string>(['t', ...NODE_KEYS])
/** Header keys this version understands; any other key of the header line is preserved in `extra.header`. */
const HEADER_KEYS = new Set(['t', 'v', 'meta', 'root', 'layout', 'edge', 'themeId', 'bg', 'font', 'dir', 'customTheme'])
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
  const header: Record<string, unknown> = {
    t: 'map', v: FORMAT_VERSION, meta, root: doc.root, layout: doc.layout, edge: doc.edge, themeId: doc.themeId, bg: doc.bg,
  }
  if (doc.font) header.font = doc.font
  if (doc.dir) header.dir = doc.dir
  if (doc.customTheme?.length) header.customTheme = doc.customTheme
  const unknownHeader = doc.extra?.header ?? {}
  for (const k of Object.keys(unknownHeader).sort()) if (!HEADER_KEYS.has(k)) header[k] = unknownHeader[k]
  const out: string[] = [line(header)]
  for (const id of Object.keys(doc.nodes).sort()) {
    const n = doc.nodes[id]
    const rec: Record<string, unknown> = { t: 'node' }
    for (const k of NODE_KEYS) {
      let v: unknown = n[k]
      if (v === undefined || (v === false && k !== 'done') || (Array.isArray(v) && k === 'checklist' && !v.length)) continue
      if (k === 'image') {
        const img = n.image!
        const asset = (img as { asset?: string }).asset ?? imageRef(img.src)
        if (!asset) continue // image could not be stored; drop it rather than write a bad reference
        v = { asset, w: img.w, h: img.h }
      }
      rec[k] = v
    }
    for (const k of Object.keys(n).sort()) {
      const v = (n as unknown as Record<string, unknown>)[k]
      if (!KNOWN_NODE.has(k) && v !== undefined) rec[k] = v // fields from a newer version
    }
    out.push(line(rec))
  }
  for (const r of [...doc.relations].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    out.push(
      line({
        t: 'rel', id: r.id, from: r.from, to: r.to,
        ...(r.label ? { label: r.label } : {}),
        ...(r.arrow ? { arrow: r.arrow } : {}),
        ...(r.dash ? { dash: r.dash } : {}),
      }),
    )
  }
  for (const g of [...(doc.groups ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    out.push(line({ t: 'group', id: g.id, ids: g.ids, ...(g.label ? { label: g.label } : {}), ...(g.color ? { color: g.color } : {}) }))
  }
  for (const s of [...(doc.summaries ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    out.push(line({ t: 'sum', id: s.id, parentId: s.parentId, from: s.from, to: s.to, label: s.label }))
  }
  for (const rec of [...(doc.extra?.records ?? [])].sort()) out.push(rec)
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
  const doc: RawDoc = { nodes: {}, relations: [], groups: [], summaries: [] }
  const unknownHeader: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(first)) {
    if (k === 't') continue
    if (HEADER_KEYS.has(k)) doc[k] = v
    else unknownHeader[k] = v
  }
  const unknownRecords: string[] = []
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
    else if (t === 'group') doc.groups.push(rest)
    else if (t === 'sum') doc.summaries.push(rest)
    else unknownRecords.push(lines[i].trim()) // a newer version's record: keep it, do not drop it
  }
  if (Object.keys(unknownHeader).length || unknownRecords.length) {
    doc.extra = { ...(Object.keys(unknownHeader).length ? { header: unknownHeader } : {}), ...(unknownRecords.length ? { records: unknownRecords } : {}) }
  }
  return doc
}

export interface ParsedRecords {
  header: RawDoc
  nodes: Record<string, RawDoc>
  relations: Record<string, RawDoc>
  groups: Record<string, RawDoc>
  summaries: Record<string, RawDoc>
}

export function toRecords(raw: RawDoc): ParsedRecords {
  const { nodes, relations, groups, summaries, ...header } = raw
  const byId = (list: RawDoc[] | undefined) => {
    const out: Record<string, RawDoc> = {}
    for (const r of list ?? []) out[r.id] = r
    return out
  }
  return { header, nodes: nodes ?? {}, relations: byId(relations), groups: byId(groups), summaries: byId(summaries) }
}
