import { uid } from './ids'
import { SCHEMA_VERSION, type MapDoc, type MindNode, type ChecklistItem, type NodeImage, type Relation, type ShapeKind } from './types'

export function createDoc(title = 'Central idea'): MapDoc {
  const rootId = uid()
  const now = Date.now()
  return {
    v: SCHEMA_VERSION,
    meta: { id: uid(12), title, createdAt: now, updatedAt: now, nodeCount: 1, tags: [] },
    root: rootId,
    nodes: { [rootId]: { id: rootId, parentId: null, children: [], text: title } },
    relations: [],
    layout: 'mindmap',
    edge: 'curve',
    themeId: 'mint',
    bg: 'dots',
  }
}

export function visibleChildren(doc: MapDoc, id: string): string[] {
  const n = doc.nodes[id]
  return n && !n.collapsed ? n.children : []
}

export function depthOf(doc: MapDoc, id: string): number {
  let d = 0
  for (let n = doc.nodes[id]; n?.parentId; n = doc.nodes[n.parentId]) d++
  return d
}

/** True when `anc` is a strict ancestor of `id`. */
export function isAncestor(doc: MapDoc, anc: string, id: string): boolean {
  for (let n = doc.nodes[id]; n?.parentId; n = doc.nodes[n.parentId]) {
    if (n.parentId === anc) return true
  }
  return false
}

export function walk(doc: MapDoc, id: string, fn: (n: MindNode, depth: number) => void, depth = 0, respectCollapse = false) {
  const n = doc.nodes[id]
  if (!n) return
  fn(n, depth)
  if (respectCollapse && n.collapsed) return
  for (const c of n.children) walk(doc, c, fn, depth + 1, respectCollapse)
}

/** Ids in depth-first document order. */
export function orderedIds(doc: MapDoc, respectCollapse = false): string[] {
  const out: string[] = []
  walk(doc, doc.root, (n) => out.push(n.id), 0, respectCollapse)
  return out
}

export function subtreeIds(doc: MapDoc, id: string): string[] {
  const out: string[] = []
  walk(doc, id, (n) => out.push(n.id))
  return out
}

/** Drop ids that already sit inside another selected subtree; keep document order. */
export function topLevel(doc: MapDoc, ids: string[]): string[] {
  const set = new Set(ids)
  const keep = new Set(ids.filter((id) => doc.nodes[id]))
  for (const id of set) {
    for (let n = doc.nodes[id]; n?.parentId; n = doc.nodes[n.parentId]) {
      if (set.has(n.parentId)) {
        keep.delete(id)
        break
      }
    }
  }
  return orderedIds(doc).filter((id) => keep.has(id))
}

/** Like `topLevel`, but ignores the root so "select all" + an edit still acts on the branches. */
export function movable(doc: MapDoc, ids: string[]): string[] {
  return topLevel(doc, ids.filter((id) => id !== doc.root))
}

export function addChild(doc: MapDoc, parentId: string, text = '', index?: number): string {
  const parent = doc.nodes[parentId]
  if (!parent) throw new Error(`addChild: unknown parent ${parentId}`)
  const id = uid()
  doc.nodes[id] = { id, parentId, children: [], text }
  const at = index === undefined ? parent.children.length : Math.max(0, Math.min(index, parent.children.length))
  parent.children.splice(at, 0, id)
  parent.collapsed = false
  return id
}

/** Adds a sibling after (default) or before `id`. For the root it adds a child instead. */
export function addSibling(doc: MapDoc, id: string, before = false, text = ''): string {
  const n = doc.nodes[id]
  if (!n?.parentId) return addChild(doc, doc.root, text)
  const parent = doc.nodes[n.parentId]
  const i = parent.children.indexOf(id)
  const newId = addChild(doc, parent.id, text, before ? i : i + 1)
  // keep mind-map side stable for root children
  if (parent.id === doc.root && n.side) doc.nodes[newId].side = n.side
  return newId
}

/** Removes the subtrees of `ids` (root is never removed). Returns a good next selection. */
export function removeNodes(doc: MapDoc, ids: string[]): string | null {
  const targets = movable(doc, ids)
  if (!targets.length) return null
  let next: string | null = null
  for (const id of targets) {
    const n = doc.nodes[id]
    if (!n) continue
    const parent = n.parentId ? doc.nodes[n.parentId] : null
    if (parent) {
      const i = parent.children.indexOf(id)
      parent.children.splice(i, 1)
      next = parent.children[Math.min(i, parent.children.length - 1)] ?? parent.id
    }
    for (const sid of subtreeIds(doc, id)) delete doc.nodes[sid]
  }
  doc.relations = doc.relations.filter((r) => doc.nodes[r.from] && doc.nodes[r.to])
  return next && doc.nodes[next] ? next : doc.root
}

/** Move `id` under `newParentId` at `index`. Returns false when the move is illegal. */
export function moveNode(doc: MapDoc, id: string, newParentId: string, index?: number): boolean {
  const n = doc.nodes[id]
  const target = doc.nodes[newParentId]
  if (!n || !target || id === doc.root || id === newParentId) return false
  if (isAncestor(doc, id, newParentId)) return false
  const oldParent = doc.nodes[n.parentId!]
  const oldIndex = oldParent.children.indexOf(id)
  oldParent.children.splice(oldIndex, 1)
  let at = index === undefined ? target.children.length : index
  if (oldParent.id === target.id && oldIndex < at) at-- // removal shifted later slots
  at = Math.max(0, Math.min(at, target.children.length))
  target.children.splice(at, 0, id)
  n.parentId = target.id
  target.collapsed = false
  if (target.id !== doc.root) delete n.side
  return true
}

export function indentNode(doc: MapDoc, id: string): boolean {
  const n = doc.nodes[id]
  if (!n?.parentId) return false
  const sibs = doc.nodes[n.parentId].children
  const i = sibs.indexOf(id)
  if (i <= 0) return false
  return moveNode(doc, id, sibs[i - 1])
}

export function outdentNode(doc: MapDoc, id: string): boolean {
  const n = doc.nodes[id]
  const parent = n?.parentId ? doc.nodes[n.parentId] : null
  if (!parent?.parentId) return false
  const grand = doc.nodes[parent.parentId]
  return moveNode(doc, id, grand.id, grand.children.indexOf(parent.id) + 1)
}

export function reorderNode(doc: MapDoc, id: string, delta: -1 | 1): boolean {
  const n = doc.nodes[id]
  if (!n?.parentId) return false
  const sibs = doc.nodes[n.parentId].children
  const i = sibs.indexOf(id)
  const j = i + delta
  if (j < 0 || j >= sibs.length) return false
  sibs.splice(i, 1)
  sibs.splice(j, 0, id)
  return true
}

export function toggleCollapse(doc: MapDoc, id: string, force?: boolean) {
  const n = doc.nodes[id]
  if (!n || !n.children.length) return
  n.collapsed = force ?? !n.collapsed
  if (!n.collapsed) delete n.collapsed
}

/** Collapse everything deeper than `level` (0 = only root visible). `null` expands all. */
export function collapseToLevel(doc: MapDoc, level: number | null) {
  walk(doc, doc.root, (n, d) => {
    if (!n.children.length) return
    if (level === null || d < level) delete n.collapsed
    else n.collapsed = true
  })
}

export function setText(doc: MapDoc, id: string, text: string) {
  const n = doc.nodes[id]
  if (n) n.text = text
}

export function setNodeColor(doc: MapDoc, ids: string[], color: string | undefined) {
  for (const id of ids) {
    const n = doc.nodes[id]
    if (!n) continue
    if (color === undefined) delete n.color
    else n.color = color
  }
}

export function setNodeShape(doc: MapDoc, ids: string[], shape: ShapeKind | undefined) {
  for (const id of ids) {
    const n = doc.nodes[id]
    if (!n) continue
    if (!shape) delete n.shape
    else n.shape = shape
  }
}

export function setNodeIcon(doc: MapDoc, ids: string[], icon: string | undefined) {
  for (const id of ids) {
    const n = doc.nodes[id]
    if (!n) continue
    if (!icon) delete n.icon
    else n.icon = icon
  }
}

export function setNodeImage(doc: MapDoc, id: string, image: NodeImage | undefined) {
  const n = doc.nodes[id]
  if (!n) return
  if (image) n.image = image
  else delete n.image
}

export function addChecklistItem(doc: MapDoc, id: string, text: string, done = false): ChecklistItem | null {
  const n = doc.nodes[id]
  if (!n) return null
  const item = { id: uid(8), text, done }
  ;(n.checklist ??= []).push(item)
  return item
}

// ---------- clipboard / duplication ----------

export interface ClipNode {
  text: string
  collapsed?: boolean
  color?: string
  shape?: ShapeKind
  icon?: string
  notes?: string
  link?: string
  image?: NodeImage
  checklist?: { text: string; done: boolean }[]
  children: ClipNode[]
}

export function copyTree(doc: MapDoc, id: string): ClipNode {
  const n = doc.nodes[id]
  const c: ClipNode = { text: n.text, children: n.children.map((k) => copyTree(doc, k)) }
  if (n.collapsed) c.collapsed = true
  if (n.color) c.color = n.color
  if (n.shape) c.shape = n.shape
  if (n.icon) c.icon = n.icon
  if (n.notes) c.notes = n.notes
  if (n.link) c.link = n.link
  if (n.image) c.image = n.image
  if (n.checklist?.length) c.checklist = n.checklist.map((i) => ({ text: i.text, done: i.done }))
  return c
}

export function pasteTree(doc: MapDoc, parentId: string, clip: ClipNode, index?: number): string {
  const id = addChild(doc, parentId, clip.text, index)
  const n = doc.nodes[id]
  if (clip.collapsed) n.collapsed = true
  if (clip.color) n.color = clip.color
  if (clip.shape) n.shape = clip.shape
  if (clip.icon) n.icon = clip.icon
  if (clip.notes) n.notes = clip.notes
  if (clip.link) n.link = clip.link
  if (clip.image) n.image = clip.image
  if (clip.checklist?.length) n.checklist = clip.checklist.map((i) => ({ id: uid(8), text: i.text, done: i.done }))
  for (const c of clip.children) pasteTree(doc, id, c)
  return id
}

export function duplicateNodes(doc: MapDoc, ids: string[]): string[] {
  const out: string[] = []
  for (const id of movable(doc, ids)) {
    const n = doc.nodes[id]
    if (!n?.parentId) continue
    const parent = doc.nodes[n.parentId]
    const at = parent.children.indexOf(id) + 1
    const copy = pasteTree(doc, parent.id, copyTree(doc, id), at)
    if (n.side) doc.nodes[copy].side = n.side
    out.push(copy)
  }
  return out
}

export function addRelation(doc: MapDoc, from: string, to: string): boolean {
  if (from === to || !doc.nodes[from] || !doc.nodes[to]) return false
  if (doc.relations.some((r) => (r.from === from && r.to === to) || (r.from === to && r.to === from))) return false
  doc.relations.push({ id: uid(8), from, to })
  return true
}

/** Change a cross link's label, arrow or line style. Default values and empty text are removed. */
export function updateRelation(doc: MapDoc, id: string, patch: Partial<Pick<Relation, 'label' | 'arrow' | 'dash'>>) {
  const r = doc.relations.find((x) => x.id === id)
  if (!r) return
  if ('label' in patch) {
    const label = (patch.label ?? '').trim()
    if (label) r.label = label
    else delete r.label
  }
  if ('arrow' in patch) {
    if (patch.arrow && patch.arrow !== 'end') r.arrow = patch.arrow
    else delete r.arrow
  }
  if ('dash' in patch) {
    if (patch.dash && patch.dash !== 'dashed') r.dash = patch.dash
    else delete r.dash
  }
}

export function removeRelation(doc: MapDoc, id: string) {
  doc.relations = doc.relations.filter((r) => r.id !== id)
}

// ---------- derived metadata ----------

export function plainTitle(doc: MapDoc): string {
  const t = doc.nodes[doc.root]?.text.replace(/\s+/g, ' ').trim()
  return t || 'Untitled map'
}

/** Refresh the derived `meta` fields. Call before persisting. */
export function syncMeta(doc: MapDoc) {
  doc.meta.title = plainTitle(doc)
  doc.meta.nodeCount = Object.keys(doc.nodes).length
  const parts: string[] = []
  let len = 0
  for (const id of orderedIds(doc)) {
    const n = doc.nodes[id]
    const s = (n.text + ' ' + (n.notes ?? '')).toLowerCase().replace(/\s+/g, ' ').trim()
    if (!s) continue
    parts.push(s)
    len += s.length
    if (len > 3000) break
  }
  doc.meta.search = parts.join(' · ')
}
