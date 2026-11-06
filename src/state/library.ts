import { create } from 'zustand'
import { importJson, importMarkdown } from '../core/outline'
import { docFromTemplate, TEMPLATES } from '../core/templates'
import { createDoc, plainTitle } from '../core/tree'
import { uid } from '../core/ids'
import type { MapDoc, MapMeta } from '../core/types'
import { prepareForSave, store } from '../io/storage'
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
  } catch (e) {
    toast(`Could not read your maps: ${e instanceof Error ? e.message : e}`, 'error')
  } finally {
    set({ loading: false })
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

export async function importFile(file: File): Promise<string | null> {
  try {
    const text = await file.text()
    const base = file.name.replace(/\.[^.]+$/, '').replace(/\.branchmint$/, '')
    const isJson = /\.json$/i.test(file.name) || /^\s*[{[]/.test(text)
    const doc = isJson ? importJson(text) : importMarkdown(text, base)
    await persistNew(doc)
    void refreshLibrary()
    return doc.meta.id
  } catch (e) {
    toast(`Could not import ${file.name}: ${e instanceof Error ? e.message : e}`, 'error')
    return null
  }
}

async function mutate(id: string, fn: (d: MapDoc) => void) {
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
