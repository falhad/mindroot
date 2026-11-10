import type { PluginPermission } from './types'

/** Where the list of installable plugins is published. It can be changed in Settings. */
export const DEFAULT_INDEX_URL = 'https://raw.githubusercontent.com/falhad/branchmint/main/plugins/index.json'

export interface GalleryEntry {
  id: string
  name: string
  version: string
  description: string
  author?: string
  permissions: PluginPermission[]
  /** https address of the plugin zip. */
  url: string
  /** Lower-case SHA-256 of the zip. The app refuses a download that does not match. */
  sha256: string
}

const ID = /^[a-z0-9][a-z0-9._-]{1,63}$/
const SHA = /^[0-9a-f]{64}$/

/** Read the gallery list. Entries that are not valid are skipped (and counted), never trusted. */
export function parseIndex(text: string): { entries: GalleryEntry[]; skipped: number } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('The plugin gallery list is not valid JSON')
  }
  const list = (data as { plugins?: unknown } | null)?.plugins
  if (!Array.isArray(list)) throw new Error('This is not a Branchmint plugin gallery list (no "plugins" array)')
  const entries: GalleryEntry[] = []
  const seen = new Set<string>()
  let skipped = 0
  for (const raw of list) {
    const e = raw as Record<string, unknown> | null
    const sha = typeof e?.sha256 === 'string' ? e.sha256.toLowerCase() : ''
    const ok =
      e && typeof e === 'object' &&
      typeof e.id === 'string' && ID.test(e.id) && !e.id.includes('..') &&
      typeof e.name === 'string' && e.name.trim() !== '' &&
      typeof e.version === 'string' && e.version !== '' &&
      typeof e.url === 'string' && e.url.length <= 500 && /^https:\/\/[^\s]+$/i.test(e.url) &&
      SHA.test(sha)
    if (!ok || !e) {
      skipped++
      continue
    }
    if (seen.has(e.id as string)) continue
    seen.add(e.id as string)
    entries.push({
      id: e.id as string,
      name: (e.name as string).trim(),
      version: e.version as string,
      description: typeof e.description === 'string' ? e.description : '',
      ...(typeof e.author === 'string' && e.author ? { author: e.author } : {}),
      permissions: (Array.isArray(e.permissions) ? e.permissions : []).filter((p): p is PluginPermission => p === 'native' || p === 'net' || p === 'secrets'),
      url: e.url as string,
      sha256: sha,
    })
  }
  return { entries, skipped }
}

/** -1, 0 or 1. Dotted numbers compare by value (1.10 is newer than 1.2). A pre-release (`-beta`) is older than the release. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const parse = (v: string) => {
    const [core, pre] = v.split('-', 2)
    return { nums: core.split('.').map((n) => parseInt(n, 10) || 0), pre: pre ?? null }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d) return d > 0 ? 1 : -1
  }
  if (x.pre === y.pre) return 0
  if (x.pre === null) return 1
  if (y.pre === null) return -1
  return x.pre > y.pre ? 1 : -1
}

export type EntryState = 'new' | 'installed' | 'update'

export function entryState(entry: GalleryEntry, installed: { id: string; version: string }[]): EntryState {
  const have = installed.find((p) => p.id === entry.id)
  if (!have) return 'new'
  return compareVersions(entry.version, have.version) > 0 ? 'update' : 'installed'
}
