import { fromFreeMind } from '../core/import/freemind'
import { fromObsidianCanvas } from '../core/import/obsidian'
import { fromOpml } from '../core/import/opml'
import { fromXmind } from '../core/import/xmind'
import { uid } from '../core/ids'
import { importJson, importMarkdown, sanitizeDoc } from '../core/outline'
import type { MapDoc } from '../core/types'
import type { ImporterSpec } from '../plugins/types'

export const IMPORT_EXTENSIONS = ['.json', '.md', '.markdown', '.txt', '.mm', '.opml', '.xml', '.xmind', '.canvas']

/** The `accept` list for file pickers: built-in formats plus the ones plugins add. */
export function importAccept(extra: ImporterSpec[] = []): string {
  return [...new Set([...IMPORT_EXTENSIONS, ...extra.flatMap((i) => i.extensions)])].join(',') + ',application/json'
}

const extOf = (name: string) => (/\.[^.]+$/.exec(name)?.[0] ?? '').toLowerCase()

/** Read any supported file into a new map (fresh map id). Throws an error with a readable message. */
export async function docFromFile(file: File, plugins: ImporterSpec[] = []): Promise<MapDoc> {
  const ext = extOf(file.name)
  const base = file.name.replace(/\.[^.]+$/, '').replace(/\.branchmint$/, '')

  const plugin = plugins.find((p) => p.extensions.includes(ext))
  if (plugin) {
    const doc = sanitizeDoc(await plugin.parse(file))
    const now = Date.now()
    doc.meta = { ...doc.meta, id: uid(12), createdAt: now, updatedAt: now, trashedAt: null, starred: false }
    return doc
  }
  if (ext === '.xmind') return fromXmind(new Uint8Array(await file.arrayBuffer()))

  const text = await file.text()
  if (ext === '.mm') return fromFreeMind(text)
  if (ext === '.opml') return fromOpml(text)
  if (ext === '.canvas') return fromObsidianCanvas(text, base)
  if (ext === '.xml') return /<opml[\s>]/i.test(text) ? fromOpml(text) : fromFreeMind(text)
  if (ext === '.json' || /^\s*[{[]/.test(text)) {
    if (/"edges"\s*:/.test(text) && /"nodes"\s*:\s*\[/.test(text) && /"fromNode"/.test(text)) return fromObsidianCanvas(text, base)
    return importJson(text)
  }
  return importMarkdown(text, base)
}
