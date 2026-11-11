import { unzipSync } from 'fflate'
import { buildOutlineDoc, type OutNode } from '../outline'
import { normalizeTag } from '../tags'
import type { MapDoc } from '../types'
import { childrenNamed, parseXml, safeLink } from './xml'

const text = (b: Uint8Array) => new TextDecoder().decode(b)

/** Import an XMind file (`.xmind`, a zip). Reads the current JSON format and the older XML format; first sheet only. */
export async function fromXmind(bytes: Uint8Array): Promise<MapDoc> {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, { filter: (f) => f.name === 'content.json' || f.name === 'content.xml' })
  } catch {
    throw new Error('This is not an XMind file (it is not a zip archive)')
  }
  let root: OutNode | null = null
  if (files['content.json']) root = fromJson(text(files['content.json']))
  else if (files['content.xml']) root = fromXml(text(files['content.xml']))
  else throw new Error('This is not an XMind file (no content.json or content.xml inside)')
  if (!root) throw new Error('This XMind file has no map on its first sheet')
  return buildOutlineDoc([root], 'Imported XMind map').doc
}

interface JTopic {
  title?: unknown
  href?: unknown
  labels?: unknown
  notes?: { plain?: { content?: unknown } }
  children?: { attached?: JTopic[] }
}

function fromJson(src: string): OutNode | null {
  let sheets: { rootTopic?: JTopic }[]
  try {
    sheets = JSON.parse(src)
  } catch {
    throw new Error('This XMind file is damaged (content.json is not valid JSON)')
  }
  const top = Array.isArray(sheets) ? sheets.find((s) => s?.rootTopic)?.rootTopic : undefined
  if (!top) return null
  const convert = (t: JTopic): OutNode => {
    const notes = typeof t.notes?.plain?.content === 'string' ? t.notes.plain.content.trim() : ''
    const link = typeof t.href === 'string' ? safeLink(t.href) : undefined
    const tags = Array.isArray(t.labels) ? t.labels.filter((l): l is string => typeof l === 'string').map(normalizeTag).filter(Boolean) : []
    return {
      text: typeof t.title === 'string' ? t.title : '',
      ...(notes ? { notes } : {}),
      ...(link ? { link } : {}),
      ...(tags.length ? { tags } : {}),
      children: (t.children?.attached ?? []).map(convert),
    }
  }
  return convert(top)
}

function fromXml(src: string): OutNode | null {
  const dom = parseXml(src, 'XMind')
  const sheet = dom.getElementsByTagName('sheet')[0]
  const top = sheet ? childrenNamed(sheet, 'topic')[0] : undefined
  if (!top) return null
  const convert = (el: Element): OutNode => {
    const topics = childrenNamed(childrenNamed(el, 'children')[0] ?? el, 'topics').find((t) => t.getAttribute('type') === 'attached')
    const notes = childrenNamed(childrenNamed(el, 'notes')[0] ?? el, 'plain')[0]?.textContent?.trim() ?? ''
    return {
      text: childrenNamed(el, 'title')[0]?.textContent ?? '',
      ...(notes ? { notes } : {}),
      children: topics ? childrenNamed(topics, 'topic').map(convert) : [],
    }
  }
  return convert(top)
}
