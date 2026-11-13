import { create } from 'zustand'
import { buildOutlineDoc, type OutNode } from '../core/outline'
import { docFromTemplate, TEMPLATES } from '../core/templates'
import { createDoc, plainTitle } from '../core/tree'
import { uid } from '../core/ids'
import type { MapDoc, MapMeta } from '../core/types'
import { docFromFile } from '../io/importers'
import { prepareForSave, store } from '../io/storage'
import { refreshDigests } from './digest'
import { toast } from './ui'

export type Filter = 'all' | 'starred' | 'trash'
export type Sort = 'updated' | 'created' | 'title'

interface LibraryState {
  items: MapMeta[]
  loading: boolean
  loaded: boolean
  query: string
  filter: Filter
  sort: Sort
  tag: string | null
}

export const useLibrary = create<LibraryState>(() => ({
  items: [],
  loading: false,
  loaded: false,
  query: '',
  filter: 'all',
  sort: 'updated',
  tag: null,
}))
const set = useLibrary.setState

export async function refreshLibrary() {
  set({ loading: true })
  try {
    const items = await store.list()
    set({ items, loaded: true })
    void rebuildDerived(items)
    void refreshDigests(items)
  } catch (e) {
    toast(`Could not read your maps: ${e instanceof Error ? e.message : e}`, 'error')
  } finally {
    set({ loading: false })
  }
}

let rebuilding = false

/**
 * Thumbnails and search text are not part of the synced file. Maps that arrived from another
 * device (or an older version) have none yet, so build them in the background.
 */
async function rebuildDerived(items: MapMeta[]) {
  if (rebuilding) return
  const todo = items.filter((m) => !m.thumb).slice(0, 60)
  if (!todo.length) return
  rebuilding = true
  try {
    for (const m of todo) {
      const doc = await store.load(m.id).catch(() => null)
      if (!doc) continue
      prepareForSave(doc)
      await store.saveCache(doc).catch(() => {})
      set((s) => ({ items: s.items.map((x) => (x.id === m.id ? { ...x, thumb: doc.meta.thumb, search: doc.meta.search } : x)) }))
    }
  } finally {
    rebuilding = false
  }
}

async function persistNew(doc: MapDoc): Promise<MapDoc> {
  prepareForSave(doc)
  await store.save(doc)
  return doc
}

export async function createMap(templateId = 'blank'): Promise<string> {
  const t = TEMPLATES.find((x) => x.id === templateId) ?? TEMPLATES[0]
  const doc = t.id === 'blank' ? createDoc('Central idea') : docFromTemplate(t)
  if (t.id === 'blank') doc.themeId = t.themeId
  await persistNew(doc)
  void refreshLibrary()
  return doc.meta.id
}

/** Most ideas a plugin can put into a new map. */
export const MAX_OUTLINE_IDEAS = 2000

/** Make a new map from a tree of ideas (used by plugins). Texts are trimmed and the size is limited. */
export async function createFromOutline(outline: { text: string; notes?: string; children?: unknown[] }): Promise<string> {
  let left = MAX_OUTLINE_IDEAS
  const clean = (o: any, depth: number): OutNode | null => {
    if (!o || typeof o !== 'object' || left <= 0 || depth > 40) return null
    left--
    const text = typeof o.text === 'string' ? o.text.replace(/\s+/g, ' ').trim().slice(0, 500) : ''
    const node: OutNode = { text, children: [] }
    if (typeof o.notes === 'string' && o.notes.trim()) node.notes = o.notes.slice(0, 20_000)
    for (const c of Array.isArray(o.children) ? o.children : []) {
      const child = clean(c, depth + 1)
      if (child && (child.text || child.children.length)) node.children.push(child)
    }
    return node
  }
  const root = clean(outline, 0)
  if (!root || !root.text) throw new Error('A new map needs a central idea with text')
  const { doc } = buildOutlineDoc([root])
  await persistNew(doc)
  void refreshLibrary()
  return doc.meta.id
}

export async function importFile(file: File): Promise<string | null> {
  try {
    const { useRegistry } = await import('../plugins/host') // loaded on use: the host imports this module
    const doc = await docFromFile(file, useRegistry.getState().importers)
    await persistNew(doc)
    void refreshLibrary()
    return doc.meta.id
  } catch (e) {
    toast(`Could not import ${file.name}: ${e instanceof Error ? e.message : e}`, 'error')
    return null
  }
}

/** Change a map on disk (it is not open in the editor), then refresh the library. */
export async function mutate(id: string, fn: (d: MapDoc) => void) {
  const doc = await store.load(id)
  if (!doc) return
  fn(doc)
  doc.meta.updatedAt = Date.now()
  prepareForSave(doc)
  await store.save(doc)
  void refreshLibrary()
}

export const renameMap = (id: string, title: string) =>
  mutate(id, (d) => {
    d.nodes[d.root].text = title.trim() || plainTitle(d)
  })

export const toggleStar = (id: string, starred: boolean) => mutate(id, (d) => void (d.meta.starred = starred))
export const setTags = (id: string, tags: string[]) => mutate(id, (d) => void (d.meta.tags = tags))

export async function duplicateMap(id: string) {
  const doc = await store.load(id)
  if (!doc) return
  doc.meta = { ...doc.meta, id: uid(12), createdAt: Date.now(), updatedAt: Date.now(), starred: false, trashedAt: null }
  doc.nodes[doc.root].text = `${plainTitle(doc)} copy`
  await persistNew(doc)
  void refreshLibrary()
  toast('Map duplicated', 'success')
}

export async function trashMap(id: string) {
  await mutate(id, (d) => void (d.meta.trashedAt = Date.now()))
  toast('Moved to trash', 'info', { label: 'Undo', run: () => void restoreMap(id) })
}
export const restoreMap = (id: string) => mutate(id, (d) => void (d.meta.trashedAt = null))

export async function deleteForever(id: string) {
  await store.remove(id)
  void refreshLibrary()
}

export async function emptyTrash() {
  const trashed = useLibrary.getState().items.filter((m) => m.trashedAt)
  await Promise.all(trashed.map((m) => store.remove(m.id)))
  void refreshLibrary()
}

export function visibleItems(s: LibraryState): MapMeta[] {
  const q = s.query.trim().toLowerCase()
  let list = s.items.filter((m) => (s.filter === 'trash' ? !!m.trashedAt : !m.trashedAt))
  if (s.filter === 'starred') list = list.filter((m) => m.starred)
  if (s.tag) list = list.filter((m) => m.tags.includes(s.tag!))
  if (q) list = list.filter((m) => m.title.toLowerCase().includes(q) || m.search?.includes(q) || m.tags.some((t) => t.toLowerCase().includes(q)))
  const by: Record<Sort, (a: MapMeta, b: MapMeta) => number> = {
    updated: (a, b) => b.updatedAt - a.updatedAt,
    created: (a, b) => b.createdAt - a.createdAt,
    title: (a, b) => a.title.localeCompare(b.title),
  }
  return [...list].sort(by[s.sort])
}

export const libraryActions = {
  setQuery: (query: string) => set({ query }),
  setFilter: (filter: Filter) => set({ filter, tag: null }),
  setSort: (sort: Sort) => set({ sort }),
  setTag: (tag: string | null) => set({ tag }),
}
