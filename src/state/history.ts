import { sanitizeDoc } from '../core/outline'
import { isTauri } from '../io/env'
import { docFromText, tauriAssets } from '../io/storage'
import type { MapDoc } from '../core/types'
import type { GitOut } from '../sync/engine'
import { listVersions, loadVersionText, type Version } from '../sync/history'
import { commit } from './doc'

/** Git in the vault folder (desktop only). Null in the browser, where there is no vault repository. */
export function vaultGit(): ((args: string[]) => Promise<GitOut>) | null {
  if (!isTauri) return null
  return async (args) => {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<GitOut>('git_run', { args })
  }
}

export interface HistoryResult {
  /** False when history cannot exist here (browser, or Git is not available). */
  available: boolean
  versions: Version[]
}

export async function loadHistory(mapId: string): Promise<HistoryResult> {
  const git = vaultGit()
  if (!git) return { available: false, versions: [] }
  return { available: true, versions: await listVersions(git, mapId) }
}

/** The map as it was in a commit. Images are read from the vault's asset files. */
export async function loadVersionDoc(mapId: string, sha: string): Promise<MapDoc> {
  const git = vaultGit()
  if (!git) throw new Error('History needs the desktop app')
  return docFromText(await loadVersionText(git, mapId, sha), tauriAssets)
}

/**
 * Replace the content of the open map with an older version, as one undo step. The map keeps its id.
 * Returns false (and changes nothing) when the version is not a usable map.
 */
export function restoreWholeMap(version: MapDoc): boolean {
  let next: MapDoc
  try {
    next = sanitizeDoc(structuredClone(version))
  } catch {
    return false
  }
  return commit((d) => {
    const meta = { ...d.meta }
    for (const k of Object.keys(d)) delete (d as unknown as Record<string, unknown>)[k]
    Object.assign(d, next)
    d.meta = { ...meta, nodeCount: Object.keys(next.nodes).length }
  })
}
