import { produce } from 'immer'
import { create } from 'zustand'
import { computeLayout, type LayoutResult } from '../core/layout'
import * as T from '../core/tree'
import type { MapDoc } from '../core/types'

const HISTORY_LIMIT = 300
const COALESCE_MS = 1500

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

interface DocState {
  doc: MapDoc | null
  /** The version last written to disk (base for merging remote changes into unsaved edits). */
  savedDoc: MapDoc | null
  layout: LayoutResult | null
  past: MapDoc[]
  future: MapDoc[]
  selection: string[]
  editingId: string | null
  /** Live text while editing, so the node box grows as you type. */
  draft: { id: string; text: string } | null
  /** Node created by the last "add" action and not yet named (cancel removes it). */
  freshId: string | null
  /** Source node while picking a target for a cross-link. */
  connectFrom: string | null
  saveState: SaveState
  saveError: string | null
  lastCoalesce: { key: string; at: number } | null
}

export const useDoc = create<DocState>(() => ({
  doc: null,
  savedDoc: null,
  layout: null,
  past: [],
  future: [],
  selection: [],
  editingId: null,
  draft: null,
  freshId: null,
  connectFrom: null,
  saveState: 'idle',
  saveError: null,
  lastCoalesce: null,
}))

const get = useDoc.getState
const set = useDoc.setState

function relayout(doc: MapDoc, draft: DocState['draft']): LayoutResult {
  return computeLayout(doc, { draft: draft ?? undefined })
}

function sanitizeSelection(doc: MapDoc, layout: LayoutResult, sel: string[]): string[] {
  const ok = sel.filter((id) => layout.boxes[id])
  return ok.length ? ok : [doc.root]
}

export function openDoc(doc: MapDoc) {
  set({
    doc,
    savedDoc: doc,
    layout: relayout(doc, null),
    past: [],
    future: [],
    selection: [doc.root],
    editingId: null,
    draft: null,
    freshId: null,
    connectFrom: null,
    saveState: 'idle',
    saveError: null,
    lastCoalesce: null,
  })
}

export function closeDoc() {
  set({ doc: null, savedDoc: null, layout: null, past: [], future: [], selection: [], editingId: null, draft: null, freshId: null, connectFrom: null })
}

/**
 * Apply an edit as one undo step. `coalesce` merges rapid edits with the same key
 * (e.g. typing in the notes box) into a single step.
 */
export function commit(recipe: (d: MapDoc) => void, opts: { coalesce?: string; silent?: boolean } = {}): boolean {
  const s = get()
  if (!s.doc) return false
  const next = produce(s.doc, (d) => {
    recipe(d)
  })
  if (next === s.doc) return false
  const stamped = produce(next, (d) => {
    d.meta.updatedAt = Date.now()
  })
  const now = Date.now()
  const merge = !!opts.coalesce && s.lastCoalesce?.key === opts.coalesce && now - s.lastCoalesce.at < COALESCE_MS
  const past = merge || opts.silent ? s.past : [...s.past, s.doc].slice(-HISTORY_LIMIT)
  const layout = relayout(stamped, s.draft)
  set({
    doc: stamped,
    layout,
    past,
    future: opts.silent ? s.future : [],
    selection: sanitizeSelection(stamped, layout, s.selection),
    saveState: 'dirty',
    lastCoalesce: opts.coalesce ? { key: opts.coalesce, at: now } : null,
    connectFrom: s.connectFrom && stamped.nodes[s.connectFrom] ? s.connectFrom : null,
  })
  return true
}

function jump(from: 'past' | 'future') {
  const s = get()
  if (!s.doc) return
  const stack = s[from]
  const target = stack[stack.length - 1]
  if (!target) return
  const other = from === 'past' ? 'future' : 'past'
  const layout = relayout(target, null)
  set({
    doc: target,
    layout,
    [from]: stack.slice(0, -1),
    [other]: [...s[other], s.doc],
    selection: sanitizeSelection(target, layout, s.selection),
    editingId: null,
    draft: null,
    freshId: null,
    saveState: 'dirty',
    lastCoalesce: null,
  } as Partial<DocState>)
}

export const undo = () => jump('past')
export const redo = () => jump('future')

// ---------- selection ----------

export const primary = (s = get()): string | null => s.selection[s.selection.length - 1] ?? null

export function select(ids: string[]) {
  const { doc, layout } = get()
  if (!doc || !layout) return
  set({ selection: ids.length ? sanitizeSelection(doc, layout, ids) : [] })
}

export function toggleSelect(id: string) {
  const sel = get().selection
  select(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id])
}

export function selectAll() {
  const l = get().layout
  if (l) select(l.order)
}

export function setDraft(draft: DocState['draft']) {
  const s = get()
  if (!s.doc) return
  set({ draft, layout: relayout(s.doc, draft) })
}

// ---------- editing ----------

export function startEdit(id?: string | null, fresh = false) {
  const s = get()
  const target = id ?? primary(s)
  if (!s.doc || !target || !s.doc.nodes[target]) return
  set({ editingId: target, selection: [target], freshId: fresh ? target : null, draft: { id: target, text: s.doc.nodes[target].text } })
}

export function endEdit(text: string | null) {
  const s = get()
  const id = s.editingId
  if (!s.doc || !id) return
  const fresh = s.freshId === id
  const node = s.doc.nodes[id]
  set({ editingId: null, draft: null, layout: node ? relayout(s.doc, null) : s.layout })
  if (!node) return
  if (text === null) {
    // cancelled
    if (fresh && node.text === '') {
      set({ freshId: null })
      undoCreation(id)
    }
    set({ freshId: null })
    return
  }
  const clean = text.replace(/\s+$/g, '')
  if (fresh && clean === '') {
    set({ freshId: null })
    undoCreation(id)
    return
  }
  set({ freshId: null })
  if (clean !== node.text) commit((d) => T.setText(d, id, clean))
}

/** Undo the node creation that started an edit (it is the newest history step). */
function undoCreation(id: string) {
  const s = get()
  if (s.doc?.nodes[id] && s.doc.nodes[id].text === '') {
    const parent = s.doc.nodes[id].parentId
    undo()
    if (parent) select([parent])
  }
}

// ---------- structural actions (all operate on the selection) ----------

export function addChild(parentId?: string | null) {
  const s = get()
  if (!s.doc) return
  const p = parentId ?? primary(s) ?? s.doc.root
  let id = ''
  commit((d) => {
    id = T.addChild(d, p)
  })
  select([id])
  startEdit(id, true)
}

export function addSibling(before = false) {
  const s = get()
  if (!s.doc) return
  const p = primary(s) ?? s.doc.root
  let id = ''
  commit((d) => {
    id = T.addSibling(d, p, before)
  })
  select([id])
  startEdit(id, true)
}

/** Add a floating node (or sticky note) at a world position and start typing in it. */
export function addFloatAt(x: number, y: number, sticky = false) {
  const s = get()
  if (!s.doc) return
  let id = ''
  commit((d) => {
    id = T.addFloat(d, x, y, '', sticky)
  })
  select([id])
  startEdit(id, true)
}

/** Draw a boundary around the selected sibling nodes. Returns false (and does nothing) if they are not siblings. */
export function groupSelection(label?: string): boolean {
  let ok = false
  commit((d) => {
    ok = !!T.groupSiblings(d, get().selection, label)
  })
  return ok
}

/** Remove the groups that contain any selected node. */
export function ungroupSelection(): boolean {
  const sel = new Set(get().selection)
  return commit((d) => {
    for (const g of [...(d.groups ?? [])]) if (g.ids.some((id) => sel.has(id))) T.ungroup(d, g.id)
  })
}

/** Put a labelled bracket over the selected consecutive siblings. False when they are not consecutive siblings. */
export function summarizeSelection(label = 'Summary'): boolean {
  let ok = false
  commit((d) => {
    ok = !!T.summarize(d, get().selection, label)
  })
  return ok
}

/** Detach the selected nodes (with their subtrees) from the tree so they float where they are. */
export function floatSelection(): boolean {
  const s = get()
  if (!s.doc || !s.layout) return false
  const layout = s.layout
  return commit((d) => {
    for (const id of T.movable(d, s.selection)) {
      const b = layout.boxes[id]
      if (b) T.floatNode(d, id, b.x + b.w / 2, b.y + b.h / 2)
    }
  })
}

export function deleteSelection() {
  const s = get()
  if (!s.doc) return
  let next: string | null = null
  const changed = commit((d) => {
    next = T.removeNodes(d, s.selection)
  })
  if (changed && next) select([next])
}

export function toggleCollapse(ids?: string[]) {
  const s = get()
  const targets = ids ?? s.selection
  commit((d) => {
    const first = d.nodes[targets[0]]
    const force = first ? !first.collapsed : undefined
    for (const id of targets) T.toggleCollapse(d, id, force)
  })
}

export function indent() {
  const s = get()
  commit((d) => {
    for (const id of T.movable(d, s.selection)) T.indentNode(d, id)
  })
}
export function outdent() {
  const s = get()
  commit((d) => {
    for (const id of T.movable(d, s.selection).reverse()) T.outdentNode(d, id)
  })
}
export function reorder(delta: -1 | 1) {
  const s = get()
  commit((d) => {
    const ids = T.movable(d, s.selection)
    for (const id of delta < 0 ? ids : [...ids].reverse()) T.reorderNode(d, id, delta)
  })
}

export function duplicateSelection() {
  const s = get()
  let ids: string[] = []
  commit((d) => {
    ids = T.duplicateNodes(d, s.selection)
  })
  if (ids.length) select(ids)
}

export interface DropDest {
  parent: string
  /** Insert next to this sibling; omit to append as the last child. */
  anchor?: { id: string; after: boolean }
  /** Mind-map layout: pin root children to a column. */
  side?: 'left' | 'right'
}

/** Move `ids` to a new place in the tree as one undo step. */
export function dropNodes(ids: string[], dest: DropDest) {
  commit((d) => {
    let placed = 0
    for (const id of T.movable(d, ids)) {
      let index: number | undefined
      if (dest.anchor) {
        const at = d.nodes[dest.parent].children.indexOf(dest.anchor.id)
        if (at >= 0) index = at + (dest.anchor.after ? 1 + placed : 0)
      }
      if (!T.moveNode(d, id, dest.parent, index)) continue
      placed++
      if (dest.parent === d.root && dest.side) d.nodes[id].side = dest.side
    }
  })
}

export function connectNodes(from: string, to: string): boolean {
  let ok = false
  commit((d) => {
    ok = T.addRelation(d, from, to)
  })
  set({ connectFrom: null })
  return ok
}

export function setConnectFrom(id: string | null) {
  set({ connectFrom: id })
}

export function expandToLevel(level: number | null) {
  commit((d) => T.collapseToLevel(d, level))
}

/** Record that `doc` is what is on disk now. */
export function markSaved(doc: MapDoc) {
  set({ savedDoc: doc })
}

/**
 * Swap in a version that came from outside (e.g. a sync). History is cleared because older
 * snapshots would undo the incoming changes. `dirty` keeps the map queued for saving.
 */
export function replaceDoc(next: MapDoc, dirty: boolean) {
  const s = get()
  if (!s.doc) return
  const layout = relayout(next, null)
  set({
    doc: next,
    layout,
    past: [],
    future: [],
    selection: sanitizeSelection(next, layout, s.selection),
    editingId: null,
    draft: null,
    freshId: null,
    connectFrom: null,
    saveState: dirty ? 'dirty' : 'saved',
    lastCoalesce: null,
  })
}

export function setSaveState(saveState: SaveState, saveError: string | null = null) {
  set({ saveState, saveError })
}
