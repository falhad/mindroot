import { floatIds } from '../tree'
import type { MapDoc } from '../types'

/** Characters XML 1.0 does not allow (control characters except tab, newline, carriage return). */
// eslint-disable-next-line no-control-regex
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g

const attr = (s: string) =>
  s.replace(BAD_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r?\n/g, '&#10;')

/** OPML 2.0: the map as nested outline items (notes in `_note`, links in `url`). Floating nodes follow the main outline. */
export function toOpml(doc: MapDoc): string {
  const line = (id: string, depth: number): string => {
    const n = doc.nodes[id]
    const pad = '  '.repeat(depth + 2)
    const a = [`text="${attr(n.text)}"`]
    if (n.notes?.trim()) a.push(`_note="${attr(n.notes)}"`)
    if (n.link) a.push(`url="${attr(n.link)}"`)
    if (!n.children.length) return `${pad}<outline ${a.join(' ')}/>`
    return `${pad}<outline ${a.join(' ')}>\n${n.children.map((c) => line(c, depth + 1)).join('\n')}\n${pad}</outline>`
  }
  const items = [doc.root, ...floatIds(doc)].map((id) => line(id, 0)).join('\n')
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head>\n    <title>${attr(doc.meta.title)}</title>\n` +
    `    <dateCreated>${new Date(doc.meta.createdAt).toUTCString()}</dateCreated>\n  </head>\n  <body>\n${items}\n  </body>\n</opml>\n`
  )
}
