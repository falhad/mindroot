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

let idb: Promise<IDBDatabase> | null = null

function openIdb(): Promise<IDBDatabase> {
  idb ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('mindroot', 3)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('maps')) db.createObjectStore('maps')
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets')
      if (!db.objectStoreNames.contains('templates')) db.createObjectStore('templates')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  // Ask the browser not to delete the maps when the disk is full. Browsers can refuse; that is not an error.
  void navigator.storage?.persist?.().catch(() => {})
  return idb
}

async function idbTx<T>(storeName: 'maps' | 'assets' | 'templates', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openIdb()
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(storeName, mode).objectStore(storeName))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Browser fallback for attachment files: IndexedDB. */
export const idbAssets: AssetIO = {
  exists: async (name) => (await idbTx<number>('assets', 'readonly', (s) => s.count(name))) !== 0,
  save: async (name, bytes) => void (await idbTx('assets', 'readwrite', (s) => s.put(bytes, name))),
  load: async (name) => {
    const v = await idbTx<Uint8Array | undefined>('assets', 'readonly', (s) => s.get(name))
    if (!v) throw new Error('missing asset')
    return v
  },
}

/** Browser fallback (dev, tests, web preview): IndexedDB. */
class IdbStore implements MapStore {
  private tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return idbTx('maps', mode, fn)
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

/** User templates: maps saved as starting points (vault `templates/` folder on desktop, IndexedDB in the browser). */
export interface TemplateStore {
  list(): Promise<{ id: string; doc: MapDoc }[]>
  save(id: string, doc: MapDoc): Promise<void>
  remove(id: string): Promise<void>
}

class TauriTemplates implements TemplateStore {
  async list() {
    const files = await invoke<{ id: string; text: string }[]>('template_list')
    const out: { id: string; doc: MapDoc }[] = []
    for (const f of files) {
      try {
        out.push({ id: f.id, doc: await docFromText(f.text, tauriAssets) })
      } catch {
        /* a damaged template is skipped */
      }
    }
    return out
  }
  async save(id: string, doc: MapDoc) {
    const refs = await collectAssets(doc, tauriAssets)
    await invoke('template_save', { id, text: serializeDoc(doc, (src) => refs.get(src)) })
  }
  async remove(id: string) {
    await invoke('template_delete', { id })
  }
}

class IdbTemplates implements TemplateStore {
  async list() {
    const keys = await idbTx<IDBValidKey[]>('templates', 'readonly', (s) => s.getAllKeys())
    const out: { id: string; doc: MapDoc }[] = []
    for (const k of keys) {
      const raw = await idbTx<unknown>('templates', 'readonly', (s) => s.get(k))
      try {
        out.push({ id: String(k), doc: sanitizeDoc(raw) })
      } catch {
        /* skip */
      }
    }
    return out
  }
  async save(id: string, doc: MapDoc) {
    await idbTx('templates', 'readwrite', (s) => s.put(JSON.parse(JSON.stringify(doc)), id))
  }
  async remove(id: string) {
    await idbTx('templates', 'readwrite', (s) => s.delete(id))
  }
}

export const templateStore: TemplateStore = isTauri ? new TauriTemplates() : new IdbTemplates()

export const store: MapStore = isTauri ? new TauriStore() : new IdbStore()

/** Where attachment files live: the vault `assets/` folder (desktop) or IndexedDB (browser). */
export const assetIO: AssetIO = isTauri ? tauriAssets : idbAssets
