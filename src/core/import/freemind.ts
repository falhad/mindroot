import { buildOutlineDoc, type OutNode } from '../outline'
import type { MapDoc } from '../types'
import { childrenNamed, parseXml, richText, safeLink } from './xml'

/** Import a FreeMind / Freeplane `.mm` map. Keeps text, colours, folded branches, links, notes and the side of the first level. */
export function fromFreeMind(xml: string): MapDoc {
  const dom = parseXml(xml, 'FreeMind')
  const root = dom.documentElement
  const top = root.tagName === 'map' ? childrenNamed(root, 'node')[0] : undefined
  if (!top) throw new Error('This is not a FreeMind map (no <map><node> found)')

  const convert = (el: Element): OutNode => {
    const rich = childrenNamed(el, 'richcontent')
    const text = el.getAttribute('TEXT') ?? richText(rich.find((r) => r.getAttribute('TYPE') === 'NODE'))
    const notes = richText(rich.find((r) => r.getAttribute('TYPE') === 'NOTE'))
    const color = el.getAttribute('COLOR')
    const pos = el.getAttribute('POSITION')
    return {
      text,
      ...(notes ? { notes } : {}),
      ...(safeLink(el.getAttribute('LINK')) ? { link: safeLink(el.getAttribute('LINK')) } : {}),
      ...(el.getAttribute('FOLDED') === 'true' ? { collapsed: true } : {}),
      ...(color && /^#[0-9a-fA-F]{6}$/.test(color) ? { color: color.toLowerCase() } : {}),
      ...(pos === 'left' || pos === 'right' ? { side: pos } : {}),
      children: childrenNamed(el, 'node').map(convert),
    }
  }
  return buildOutlineDoc([convert(top)], 'Imported FreeMind map').doc
}
