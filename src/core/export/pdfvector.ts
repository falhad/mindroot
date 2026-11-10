import type { MapDoc } from '../types'

/**
 * Characters a PDF base font (Helvetica, WinAnsi encoding) can draw: Latin-1 plus the common
 * typographic marks. A PDF font cannot shape Persian, Arabic or Hebrew, and has no CJK or emoji.
 */
const DRAWABLE = /^[ -~ -ÿ–—‘’‚“”„•…‹›€™\n\t]*$/

/** Text that ends up on the drawing: node text, link labels, group and bracket labels. */
export function drawnText(doc: MapDoc): string[] {
  return [
    ...Object.values(doc.nodes).map((n) => n.text),
    ...doc.relations.map((r) => r.label ?? ''),
    ...(doc.groups ?? []).map((g) => g.label ?? ''),
    ...(doc.summaries ?? []).map((s) => s.label),
  ]
}

/** True when every drawn character fits the PDF base font, so a vector PDF with real text is possible. */
export function canExportVectorPdf(doc: MapDoc): boolean {
  return drawnText(doc).every((t) => DRAWABLE.test(t))
}
