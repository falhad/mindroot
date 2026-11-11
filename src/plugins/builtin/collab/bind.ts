/**
 * The map as a Yjs document, so several people can edit it at once.
 *
 *   meta    doc-level settings (root, layout, edge, themeId, bg, font, dir, customTheme)
 *   nodes   id -> Y.Map of fields. There is no `children` list: a node has `parentId` and a fractional
 *           `order` key, and children are the nodes with that parent sorted by key. Two people adding
 *           or moving nodes at the same time therefore never overwrite one another's lists.
 *   rels / groups / sums   id -> Y.Map
 *
 * Fields that hold arrays or objects are stored as JSON text under a `j:` key. Nothing here knows
 * about the network: `docToY`, `applyDocToY` and `yToDoc` are pure functions of the two documents.
 */
import * as Y from 'yjs'
import { sanitizeDoc } from '../../../core/outline'
import type { MapDoc, MapMeta, MindNode } from '../../../core/types'
import { between } from './order'

/** Origin of this device's own edits. Undo tracks only this origin. */
export const LOCAL = 'branchmint-local'

const JSON_PREFIX = 'j:'
const DOC_FIELDS = ['layout', 'edge', 'themeId', 'bg', 'font', 'dir', 'customTheme'] as const

type Rec = Record<string, unknown>

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function setField(ym: Y.Map<unknown>, key: string, value: unknown) {
  const isPlain = value === null || ['string', 'number', 'boolean'].includes(typeof value)
  if (isPlain) {
    ym.delete(JSON_PREFIX + key)
    if (ym.get(key) !== value) ym.set(key, value)
  } else {
    ym.delete(key)
    const text = JSON.stringify(value)
    if (ym.get(JSON_PREFIX + key) !== text) ym.set(JSON_PREFIX + key, text)
  }
}

function clearField(ym: Y.Map<unknown>, key: string) {
  ym.delete(key)
  ym.delete(JSON_PREFIX + key)
}

function readRecord(ym: Y.Map<unknown>): Rec {
  const out: Rec = {}
  ym.forEach((v, k) => {
    if (k.startsWith(JSON_PREFIX)) {
      try {
        out[k.slice(JSON_PREFIX.length)] = JSON.parse(String(v))
      } catch {
        /* a damaged value is dropped */
      }
    } else out[k] = v
  })
  return out
}

/** Write a record's fields (all but `skip`) into a Y.Map, removing fields the record no longer has. */
function writeRecord(ym: Y.Map<unknown>, next: Rec, prev: Rec | undefined, skip: Set<string>) {
  const keys = new Set([...Object.keys(next), ...Object.keys(prev ?? {})])
  for (const k of keys) {
    if (skip.has(k)) continue
    const v = next[k]
    if (v === undefined) {
      if (prev && prev[k] !== undefined) clearField(ym, k)
      continue
    }
    if (prev && same(prev[k], v)) continue
    setField(ym, k, v)
  }
}

/** True when the document has no map content yet (a room nobody has written to). */
export function isEmptyY(y: Y.Doc): boolean {
  return y.getMap('nodes').size === 0
}

const NODE_SKIP = new Set(['id', 'children', 'parentId', 'order'])

/** Give `kids` (in their wanted order) keys that sort in that order, keeping existing keys where possible. */
function assignOrders(ynodes: Y.Map<Y.Map<unknown>>, kids: string[]) {
  let prevKey: string | null = null
  for (let i = 0; i < kids.length; i++) {
    const ym = ynodes.get(kids[i])
    if (!ym) continue
    const k = ym.get('order') as string | undefined
    if (k !== undefined && (prevKey === null || k > prevKey)) {
      prevKey = k
      continue
    }
    let upper: string | null = null
    for (let j = i + 1; j < kids.length; j++) {
      const kj = ynodes.get(kids[j])?.get('order') as string | undefined
      if (kj !== undefined && (prevKey === null || kj > prevKey)) {
        upper = kj
        break
      }
    }
    const nk = between(prevKey, upper)
    ym.set('order', nk)
    prevKey = nk
  }
}

/**
 * Bring `y` from the state of `prev` to the state of `next`, writing only what changed.
 * `prev` is null for the first write. Runs as one Yjs transaction with the given origin.
 */
export function applyDocToY(y: Y.Doc, prev: MapDoc | null, next: MapDoc, origin: unknown = LOCAL) {
  y.transact(() => {
    const meta = y.getMap('meta')
    if (meta.get('root') !== next.root) meta.set('root', next.root)
    for (const k of DOC_FIELDS) {
      const v = (next as unknown as Rec)[k]
      if (v === undefined) {
        if (prev && (prev as unknown as Rec)[k] !== undefined) clearField(meta, k)
      } else if (!prev || !same((prev as unknown as Rec)[k], v)) setField(meta, k, v)
    }

    const ynodes = y.getMap('nodes') as Y.Map<Y.Map<unknown>>
    // removed nodes
    if (prev) for (const id of Object.keys(prev.nodes)) if (!next.nodes[id]) ynodes.delete(id)
    // new and changed nodes
    for (const id of Object.keys(next.nodes)) {
      const n = next.nodes[id]
      const p = prev?.nodes[id]
      if (p === n) continue
      let ym = ynodes.get(id)
      if (!ym) {
        ym = new Y.Map<unknown>()
        ynodes.set(id, ym)
      }
      if (!p || p.parentId !== n.parentId) ym.set('parentId', n.parentId)
      writeRecord(ym, n as unknown as Rec, p as unknown as Rec | undefined, NODE_SKIP)
    }
    // sibling order: for every parent whose list changed, and for new roots of floating subtrees
    for (const id of Object.keys(next.nodes)) {
      const n = next.nodes[id]
      const p = prev?.nodes[id]
      if (!p || !same(p.children, n.children)) assignOrders(ynodes, n.children)
      if (!p && !n.parentId) {
        const ym = ynodes.get(id)
        if (ym && ym.get('order') === undefined) ym.set('order', between(null, null))
      }
    }

    const table = (name: string, nextList: Rec[] | undefined, prevList: Rec[] | undefined, skip: Set<string>) => {
      const ym = y.getMap(name) as Y.Map<Y.Map<unknown>>
      const nextBy = new Map((nextList ?? []).map((r) => [r.id as string, r]))
      const prevBy = new Map((prevList ?? []).map((r) => [r.id as string, r]))
      for (const id of prevBy.keys()) if (!nextBy.has(id)) ym.delete(id)
      for (const [id, r] of nextBy) {
        const old = prevBy.get(id)
        if (old && same(old, r)) continue
        let row = ym.get(id)
        if (!row) {
          row = new Y.Map<unknown>()
          ym.set(id, row)
        }
        writeRecord(row, r, old, skip)
      }
    }
    const skipId = new Set(['id'])
    table('rels', next.relations as unknown as Rec[], prev?.relations as unknown as Rec[] | undefined, skipId)
    table('groups', next.groups as unknown as Rec[] | undefined, prev?.groups as unknown as Rec[] | undefined, skipId)
    table('sums', next.summaries as unknown as Rec[] | undefined, prev?.summaries as unknown as Rec[] | undefined, skipId)
  }, origin)
}

/** Write a whole map into an empty Yjs document. */
export function docToY(y: Y.Doc, doc: MapDoc, origin: unknown = 'init') {
  applyDocToY(y, null, doc, origin)
}

/**
 * Read the shared document back as a map. `meta` (title, stars, tags, dates) stays what this device has.
 * A node whose parent is missing, or that is only reachable through a loop made by two people moving
 * nodes at once, is put back under the central idea, so nothing is ever lost and the tree is always valid.
 */
export function yToDoc(y: Y.Doc, meta: MapMeta): MapDoc {
  const metaMap = readRecord(y.getMap('meta'))
  const root = String(metaMap.root ?? '')
  const rows: { id: string; order: string; rec: Rec }[] = []
  ;(y.getMap('nodes') as Y.Map<Y.Map<unknown>>).forEach((ym, id) => {
    const rec = readRecord(ym)
    rows.push({ id, order: typeof rec.order === 'string' ? rec.order : '', rec })
  })
  rows.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : 1))

  const nodes: Record<string, MindNode> = {}
  for (const { id, rec } of rows) {
    const { order: _o, ...rest } = rec
    nodes[id] = { ...(rest as object), id, parentId: typeof rec.parentId === 'string' ? rec.parentId : null, children: [], text: typeof rec.text === 'string' ? rec.text : '' } as MindNode
  }
  const attach = (id: string) => {
    const p = nodes[id].parentId
    if (p && nodes[p]) nodes[p].children.push(id)
  }
  for (const { id } of rows) attach(id) // rows are already in sibling order

  if (nodes[root]) {
    nodes[root].parentId = null
    // reachable = from the root and from floating roots (no parent, with a position)
    const reach = new Set<string>()
    const mark = (id: string) => {
      if (reach.has(id) || !nodes[id]) return
      reach.add(id)
      for (const c of nodes[id].children) mark(c)
    }
    mark(root)
    for (const n of Object.values(nodes)) if (n.id !== root && !n.parentId && n.pos) mark(n.id)
    for (const id of Object.keys(nodes).sort()) {
      if (reach.has(id)) continue
      const n = nodes[id]
      const old = n.parentId ? nodes[n.parentId] : undefined
      if (old) old.children = old.children.filter((c) => c !== id)
      n.parentId = root
      delete n.side
      nodes[root].children.push(id)
      mark(id)
    }
  }

  const tableRows = (name: string) => {
    const out: Rec[] = []
    ;(y.getMap(name) as Y.Map<Y.Map<unknown>>).forEach((ym, id) => out.push({ ...readRecord(ym), id }))
    return out.sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1))
  }
  const raw: Rec = {
    v: 1,
    meta,
    root,
    nodes,
    relations: tableRows('rels'),
    groups: tableRows('groups'),
    summaries: tableRows('sums'),
  }
  for (const k of DOC_FIELDS) if (metaMap[k] !== undefined) raw[k] = metaMap[k]
  return sanitizeDoc(raw)
}
