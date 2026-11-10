import { buildOutlineDoc, type OutNode } from '../outline'
import type { MapDoc } from '../types'
import { childrenNamed, parseXml, safeLink } from './xml'

/** Import an OPML outline (the format outliners and feed readers export). */
export function fromOpml(xml: string): MapDoc {
  const dom = parseXml(xml, 'OPML')
  const root = dom.documentElement
  if (root.tagName !== 'opml') throw new Error('This is not an OPML file (no <opml> element)')
  const body = childrenNamed(root, 'body')[0]
  const title = childrenNamed(childrenNamed(root, 'head')[0] ?? root, 'title')[0]?.textContent?.trim() || 'Imported outline'

  const convert = (el: Element): OutNode => {
    const note = el.getAttribute('_note') ?? el.getAttribute('note') ?? ''
    const link = safeLink(el.getAttribute('url') ?? el.getAttribute('htmlUrl') ?? el.getAttribute('xmlUrl'))
    return {
      text: el.getAttribute('text') ?? el.getAttribute('title') ?? '',
      ...(note.trim() ? { notes: note } : {}),
      ...(link ? { link } : {}),
      children: childrenNamed(el, 'outline').map(convert),
    }
  }
  const forest = body ? childrenNamed(body, 'outline').map(convert) : []
  if (!forest.length) throw new Error('This OPML file is empty (no outline items)')
  return buildOutlineDoc(forest, title).doc
}
