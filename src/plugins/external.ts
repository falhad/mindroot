import { PLUGIN_API_VERSION, SUPPORTED_API_VERSIONS, type Plugin, type PluginManifest, type PluginPermission } from './types'

/**
 * Plugins installed by the user live in `<app-data>/plugins/<name>/`:
 *
 *   manifest.json   { "id": "acme.word-count", "name": "...", "version": "1.0.0", "main": "index.js" }
 *   index.js        an ES module whose default export is { activate(ctx), deactivate?() }
 *
 * They are trusted code: once enabled, a plugin runs with the same power as the app.
 */

const ID = /^[a-z0-9][a-z0-9._-]{1,63}$/

export interface PluginFiles {
  list(): Promise<{ dir: string; manifest: unknown }[]>
  read(dir: string, file: string): Promise<string>
}

export type ModuleImporter = (code: string) => Promise<any>

export function validateManifest(raw: unknown): PluginManifest | string {
  const m = raw as Partial<PluginManifest> | null
  if (!m || typeof m !== 'object') return 'manifest.json is not an object'
  if (typeof m.id !== 'string' || !ID.test(m.id) || m.id.includes('..')) return 'manifest "id" must be lower-case letters, digits, dots, dashes (e.g. acme.word-count)'
  if (typeof m.name !== 'string' || !m.name.trim()) return 'manifest "name" is missing'
  if (typeof m.version !== 'string') return 'manifest "version" is missing'
  const api = (m as { api?: unknown }).api
  if (api !== undefined && !SUPPORTED_API_VERSIONS.includes(api as number)) return `needs plugin API ${String(api)}, this app has ${PLUGIN_API_VERSION}`
  const main = m.main ?? 'index.js'
  if (typeof main !== 'string' || !/^[A-Za-z0-9._-]+$/.test(main) || main.startsWith('.')) return 'manifest "main" must be a file name in the plugin folder'
  const permissions = Array.isArray(m.permissions) ? m.permissions.filter((p): p is PluginPermission => p === 'native' || p === 'net' || p === 'secrets') : []
  return { id: m.id, name: m.name.trim(), version: m.version, description: typeof m.description === 'string' ? m.description : undefined, main, permissions }
}

/** Import an ES module from source text through a Blob URL (needs `script-src blob:`). */
export const importFromBlob: ModuleImporter = async (code) => {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  try {
    return await import(/* @vite-ignore */ url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export interface Discovered {
  plugin: Plugin
  builtin: false
  error?: string
}

/** Load every installed plugin. A broken one is reported, never thrown. `taken` ids are reserved. */
export async function discoverPlugins(files: PluginFiles, importer: ModuleImporter, taken: Set<string>): Promise<Discovered[]> {
  const out: Discovered[] = []
  let entries: { dir: string; manifest: unknown }[] = []
  try {
    entries = await files.list()
  } catch {
    return out
  }
  const seen = new Set(taken)
  for (const { dir, manifest: raw } of entries) {
    const m = validateManifest(raw)
    if (typeof m === 'string') {
      out.push({ plugin: { manifest: { id: `invalid.${dir}`, name: typeof (raw as any)?.name === 'string' ? (raw as any).name : dir, version: '?' }, activate() {} }, builtin: false, error: `${dir}: ${m}` })
      continue
    }
    if (seen.has(m.id)) {
      out.push({ plugin: { manifest: m, activate() {} }, builtin: false, error: `The id "${m.id}" is already used by another plugin.` })
      continue
    }
    seen.add(m.id)
    try {
      const mod = await importer(await files.read(dir, m.main!))
      const impl = mod?.default ?? mod?.plugin
      if (!impl || typeof impl.activate !== 'function') throw new Error('the script must export default { activate(ctx) { ... } }')
      out.push({ plugin: { manifest: m, activate: (ctx) => impl.activate(ctx), deactivate: () => impl.deactivate?.() }, builtin: false })
    } catch (e) {
      out.push({ plugin: { manifest: m, activate() {} }, builtin: false, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return out
}

export async function tauriPluginFiles(): Promise<PluginFiles> {
  const { invoke } = await import('@tauri-apps/api/core')
  return {
    list: () => invoke('plugins_list'),
    read: (dir, file) => invoke('plugin_read', { dir, file }),
  }
}
