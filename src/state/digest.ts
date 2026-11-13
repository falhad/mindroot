import { create } from 'zustand'
import { digestDoc, type MapDigest } from '../core/digest'
import type { MapDoc, MapMeta } from '../core/types'
import { store } from '../io/storage'

/**
 * Links and tasks of every map, kept small so the tasks view and backlinks do not load whole maps.
 * Remembered between runs (local to this device, rebuilt from the maps if missing) and refreshed
 * for the maps whose `updatedAt` changed.
 */
interface DigestState {
  byMap: Record<string, MapDigest>
  /** True after the first refresh against the map list finished. */
  ready: boolean
}

const KEY = 'mr.digest.v1'

function restore(): Record<string, MapDigest> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, MapDigest>
    const out: Record<string, MapDigest> = {}
    for (const [id, g] of Object.entries(raw)) {
      if (g && typeof g.updatedAt === 'number' && Array.isArray(g.links) && Array.isArray(g.tasks) && typeof g.title === 'string') out[id] = g
    }
    return out
  } catch {
    return {}
  }
}

export const useDigest = create<DigestState>(() => ({ byMap: restore(), ready: false }))
const set = useDigest.setState

function remember() {
  try {
    localStorage.setItem(KEY, JSON.stringify(useDigest.getState().byMap))
  } catch {
    /* storage full or blocked: the digests are rebuilt next start */
  }
}

/** Update one map's digest from an in-memory document (called after every save). */
export function updateDigest(doc: MapDoc) {
  set((s) => ({ byMap: { ...s.byMap, [doc.meta.id]: digestDoc(doc) } }))
  remember()
}

let running = false
let again: MapMeta[] | null = null

/** Bring the digests in line with the map list: drop maps that are gone or in the trash, rebuild stale ones. */
export async function refreshDigests(metas: MapMeta[]): Promise<void> {
  if (running) {
    again = metas
    return
  }
  running = true
  try {
    const live = metas.filter((m) => !m.trashedAt)
    const ids = new Set(live.map((m) => m.id))
    const current = useDigest.getState().byMap
    const next: Record<string, MapDigest> = {}
    for (const [id, g] of Object.entries(current)) if (ids.has(id)) next[id] = g
    set({ byMap: next })
    for (const m of live) {
      if (useDigest.getState().byMap[m.id]?.updatedAt === m.updatedAt) continue
      const doc = await store.load(m.id).catch(() => null)
      if (!doc) continue
      set((s) => ({ byMap: { ...s.byMap, [m.id]: digestDoc(doc) } }))
    }
    remember()
    set({ ready: true })
  } finally {
    running = false
    if (again) {
      const m = again
      again = null
      void refreshDigests(m)
    }
  }
}
