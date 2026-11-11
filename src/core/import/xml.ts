/** Parse XML text or throw a readable error naming the expected format. */
export function parseXml(text: string, what: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error(`This is not a valid ${what} file (the XML is damaged)`)
  return doc
}

/** Direct child elements with this tag name. */
export function childrenNamed(el: Element, name: string): Element[] {
  return Array.from(el.children).filter((c) => c.tagName === name)
}

/** Only web addresses are kept as links (never `javascript:` or `file:`). */
export function safeLink(raw: string | null | undefined): string | undefined {
  const v = raw?.trim()
  return v && /^https?:\/\//i.test(v) ? v : undefined
}

/** Plain text of an HTML fragment inside XML (FreeMind rich content): paragraphs on their own lines. */
export function richText(el: Element | undefined): string {
  if (!el) return ''
  const paras = Array.from(el.getElementsByTagName('p'))
  const parts = paras.length ? paras.map((p) => p.textContent ?? '') : [el.textContent ?? '']
  return parts.map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
}
