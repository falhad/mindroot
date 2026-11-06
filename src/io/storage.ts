import { computeLayout } from '../core/layout'
import { parseDocText, serializeDoc } from '../core/format'
import { sanitizeDoc } from '../core/outline'
import { renderThumb } from '../core/svg'
import { syncMeta } from '../core/tree'
import type { MapDoc, MapMeta } from '../core/types'
import { collectAssets, hydrateImages, type AssetIO } from './assets'
import { isTauri } from './env'

export interface MapStore {
  list(): Promise<MapMeta[]>
  load(id: string): Promise<MapDoc | null>
  save(doc: MapDoc): Promise<void>
  /** Persist derived data (thumbnail, search text) that is not part of the synced file. */
  saveCache(doc: MapDoc): Promise<void>
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

async function invoke<T>(cmd: string, args?: Record<string, unknown>, opts?: { headers: Record<string, string> }): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args, opts)
}

export const tauriAssets: AssetIO = {
  exists: (name) => invoke<boolean>('asset_exists', { name }),
  save: async (name, bytes) => {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('save_asset', bytes, { headers: { name } })
  },
  load: async (name) => new Uint8Array(await invoke<ArrayBuffer>('load_asset', { name })),
}

/** Parse + repair + load images of a map file's text. */
export async function docFromText(text: string, assets: AssetIO): Promise<MapDoc> {
  const raw = parseDocText(text)
  await hydrateImages(raw, assets)
  return sanitizeDoc(raw)
}

class TauriStore implements MapStore {
  list() {
    return invoke<MapMeta[]>('list_maps')
  }
  async load(id: string) {
    const text = await invoke<string | null>('load_map', { id })
    return text ? docFromText(text, tauriAssets) : null
  }
  async save(doc: MapDoc) {
    const refs = await collectAssets(doc, tauriAssets)
    await invoke('save_map', { id: doc.meta.id, text: serializeDoc(doc, (src) => refs.get(src)) })
    await this.saveCache(doc).catch(() => {}) // derived data: never fail a save over it
  }
  async saveCache(doc: MapDoc) {
    const { thumb, search, updatedAt } = doc.meta
    await invoke('save_cache', { id: doc.meta.id, json: JSON.stringify({ updatedAt, thumb, search }) })
  }
  async remove(id: string) {
    await invoke('delete_map', { id })
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
  async saveCache() {
    /* derived data is stored inside the document here */
  }
  async remove(id: string) {
    await this.tx('readwrite', (s) => s.delete(id))
  }
}

export const store: MapStore = isTauri ? new TauriStore() : new IdbStore()
