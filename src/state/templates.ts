import { create } from 'zustand'
import { computeLayout } from '../core/layout'
import { cloneDocWithNewIds, templateDoc } from '../core/templates'
import { renderThumb } from '../core/svg'
import { uid } from '../core/ids'
import { plainTitle } from '../core/tree'
import type { MapDoc } from '../core/types'
import { prepareForSave, store, templateStore } from '../io/storage'
import { useDoc } from './doc'
import { refreshLibrary } from './library'

export interface UserTemplate {
  id: string
  name: string
  thumb?: string
  doc: MapDoc
}

interface TemplatesState {
  items: UserTemplate[]
  loaded: boolean
}

export const useTemplates = create<TemplatesState>(() => ({ items: [], loaded: false }))

export async function refreshTemplates() {
  try {
    const list = await templateStore.list()
    const items: UserTemplate[] = list.map(({ id, doc }) => {
      let thumb: string | undefined
      try {
        thumb = renderThumb(doc, computeLayout(doc))
      } catch {
        thumb = undefined
      }
      return { id, name: plainTitle(doc), thumb, doc }
    })
    items.sort((a, b) => a.name.localeCompare(b.name))
    useTemplates.setState({ items, loaded: true })
  } catch (e) {
    console.error('could not read templates', e)
    useTemplates.setState({ loaded: true })
  }
}

/** Save the open map as a template. Returns the template id. */
export async function saveAsTemplate(name?: string): Promise<string> {
  const doc = useDoc.getState().doc
  if (!doc) throw new Error('Open a map first')
  const tpl = templateDoc(doc, name ?? plainTitle(doc))
  const id = uid(12)
  await templateStore.save(id, tpl)
  await refreshTemplates()
  return id
}

export async function deleteTemplate(id: string) {
  await templateStore.remove(id)
  await refreshTemplates()
}

/** A new map from a user template (every node gets a new id). Returns the new map id. */
export async function createMapFromUserTemplate(id: string): Promise<string> {
  const t = useTemplates.getState().items.find((x) => x.id === id)
  if (!t) throw new Error('That template is gone')
  const doc = cloneDocWithNewIds(t.doc)
  const now = Date.now()
  doc.meta = { id: uid(12), title: t.name, createdAt: now, updatedAt: now, nodeCount: Object.keys(doc.nodes).length, tags: [], trashedAt: null }
  prepareForSave(doc)
  await store.save(doc)
  void refreshLibrary()
  return doc.meta.id
}
