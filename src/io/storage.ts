import { computeLayout } from '../core/layout'
import { sanitizeDoc } from '../core/outline'
import { renderThumb } from '../core/svg'
import { syncMeta } from '../core/tree'
import type { MapDoc, MapMeta } from '../core/types'
import { isTauri } from './env'

export interface MapStore {
  list(): Promise<MapMeta[]>
  load(id: string): Promise<MapDoc | null>
  save(doc: MapDoc): Promise<void>
  remove(id: string): Promise<void>
}

/** Refresh derived metadata (title, counts, search text, thumbnail) before persisting. */
export function prepareForSave(doc: MapDoc): MapDoc {
  syncMeta(doc)
  try {
    doc.meta.thumb = renderThumb(doc, computeLayout(doc))
  } catch {
    doc.meta.thumb = undefined
  }
  return doc
}

class TauriStore implements MapStore {
  private async call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<T>(cmd, args)
  }
  async list() {
    return this.call<MapMeta[]>('list_maps')
  }
  async load(id: string) {
    const text = await this.call<string | null>('load_map', { id })
    return text ? sanitizeDoc(JSON.parse(text)) : null
  }
  async save(doc: MapDoc) {
    await this.call('save_map', { id: doc.meta.id, json: JSON.stringify(doc) })
  }
  async remove(id: string) {
    await this.call('delete_map', { id })
  }
}

/** Browser fallback (dev, tests, web preview): IndexedDB. */
class IdbStore implements MapStore {
  private db: Promise<IDBDatabase> | null = null
  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open('branchmint', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('maps')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return this.db
  }
  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open()
    return new Promise((resolve, reject) => {
      const req = fn(db.transaction('maps', mode).objectStore('maps'))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  async list() {
    const all = await this.tx<MapDoc[]>('readonly', (s) => s.getAll())
    return all.map((d) => d.meta)
  }
  async load(id: string) {
    const raw = await this.tx<unknown>('readonly', (s) => s.get(id))
    return raw ? sanitizeDoc(raw) : null
  }
  async save(doc: MapDoc) {
    await this.tx('readwrite', (s) => s.put(JSON.parse(JSON.stringify(doc)), doc.meta.id))
  }
  async remove(id: string) {
    await this.tx('readwrite', (s) => s.delete(id))
  }
}

export const store: MapStore = isTauri ? new TauriStore() : new IdbStore()
