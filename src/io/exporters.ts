import { toHtml } from '../core/export/html'
import { canExportVectorPdf } from '../core/export/pdfvector'
import { toOpml } from '../core/export/opml'
import { computeLayout } from '../core/layout'
import { exportJson, toMarkdown } from '../core/outline'
import { renderSvg } from '../core/svg'
import type { MapDoc } from '../core/types'
import { safeFileName, saveFile } from './files'

export type ExportFormat = 'json' | 'md' | 'png' | 'svg' | 'pdf' | 'pdfimage' | 'opml' | 'html' | `plugin:${string}`

export interface ExportOptions {
  dark: boolean
  transparent: boolean
  /** Pixel density for PNG / PDF. */
  scale: 1 | 2 | 3
}

const MAX_PIXELS = 64_000_000

async function iconResolver() {
  const [{ renderToStaticMarkup }, { createElement }, { lucideIcons }] = await Promise.all([
    import('react-dom/server'),
    import('react'),
    import('../ui/icons'),
  ])
  return (name: string) => {
    const C = lucideIcons[name]
    if (!C) return null
    const html = renderToStaticMarkup(createElement(C))
    return html.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
  }
}

const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/

/** Embed the app fonts as data URLs: an SVG rendered as an <img> cannot see the page's web fonts. */
async function fontCss(doc: MapDoc): Promise<string> {
  const face = (family: string, url: string, range: string) =>
    `@font-face{font-family:'${family}';font-weight:100 900;font-style:normal;src:url(${url}) format('woff2');unicode-range:${range}}`
  const latin = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
  const arabic = 'U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC'
  const parts = [face('Inter Variable', (await import('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?inline')).default, latin)]
  const needsArabic = Object.values(doc.nodes).some((n) => ARABIC_SCRIPT.test(n.text))
  if (needsArabic) {
    parts.push(face('Vazirmatn Variable', (await import('@fontsource-variable/vazirmatn/files/vazirmatn-arabic-wght-normal.woff2?inline')).default, arabic))
  }
  return parts.join('')
}

export async function buildSvg(doc: MapDoc, o: ExportOptions) {
  const layout = computeLayout(doc)
  return renderSvg(doc, layout, {
    dark: o.dark,
    background: !o.transparent,
    iconMarkup: await iconResolver(),
    fontCss: await fontCss(doc),
  })
}

export async function buildPng(doc: MapDoc, o: ExportOptions): Promise<{ blob: Blob; width: number; height: number }> {
  const { svg, width, height } = await buildSvg(doc, o)
  let scale: number = o.scale
  while (scale > 1 && width * height * scale * scale > MAX_PIXELS) scale -= 1
  if (width * height > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (width * height))
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error('Could not render the map to an image'))
      i.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG encoding failed'))), 'image/png'),
    )
    return { blob, width, height }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * A PDF with vector shapes and real, selectable text. Text uses the PDF base font (Helvetica), so
 * call `canExportVectorPdf` first: other scripts (Persian, Arabic, CJK) cannot be drawn this way.
 */
export async function buildVectorPdf(doc: MapDoc, o: ExportOptions): Promise<Uint8Array> {
  const layout = computeLayout(doc)
  const { svg, width, height } = renderSvg(doc, layout, { dark: o.dark, background: !o.transparent, iconMarkup: await iconResolver(), pdfSafe: true })
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-99999px;top:0;visibility:hidden'
  host.innerHTML = svg.replace(/font-family="[^"]*"/, 'font-family="helvetica"').replace(/font-weight="(\d+)"/g, (_m, w: string) => `font-weight="${Number(w) >= 600 ? 'bold' : 'normal'}"`) // base fonts have only regular and bold
  document.body.appendChild(host)
  try {
    const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')])
    const k = Math.min(1, 14000 / Math.max(width, height)) // the PDF spec limits a page to 14400 units
    const w = width * k
    const h = height * k
    const pdf = new jsPDF({ unit: 'pt', format: [w, h], orientation: w >= h ? 'landscape' : 'portrait', compress: false })
    pdf.setProperties({ title: doc.meta.title, creator: 'Branchmint' })
    await svg2pdf(host.firstElementChild as SVGElement, pdf, { x: 0, y: 0, width: w, height: h })
    return new Uint8Array(pdf.output('arraybuffer'))
  } finally {
    host.remove()
  }
}

export async function buildPdf(doc: MapDoc, o: ExportOptions): Promise<Uint8Array> {
  const { blob, width, height } = await buildPng(doc, { ...o, scale: Math.max(2, o.scale) as 2 | 3 })
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result as string)
    r.onerror = () => rej(r.error)
    r.readAsDataURL(blob)
  })
  const { jsPDF } = await import('jspdf')
  // PDF user units are 1/72in. Keep the page within the spec's 14400-unit limit.
  const k = Math.min(1, 14000 / Math.max(width, height))
  const w = width * k
  const h = height * k
  const pdf = new jsPDF({ unit: 'pt', format: [w, h], orientation: w >= h ? 'landscape' : 'portrait', compress: true })
  pdf.setProperties({ title: doc.meta.title, creator: 'Branchmint' })
  pdf.addImage(dataUrl, 'PNG', 0, 0, w, h, undefined, 'FAST')
  return new Uint8Array(pdf.output('arraybuffer'))
}

/** The single-file interactive page: pan, zoom, collapse, notes. Light and dark drawings, fonts embedded. */
export async function buildHtmlPage(doc: MapDoc): Promise<string> {
  const layout = computeLayout(doc)
  const icons = await iconResolver()
  const draw = (dark: boolean) => renderSvg(doc, layout, { dark, background: false, iconMarkup: icons, interactive: true })
  const light = draw(false)
  const dark = draw(true)
  return toHtml(doc, { light: light.svg, dark: dark.svg, width: light.width, height: light.height, fontCss: await fontCss(doc) })
}

/** Build and save one export. Resolves false when the user cancels the save dialog. */
export async function exportMap(doc: MapDoc, format: ExportFormat, o: ExportOptions): Promise<boolean> {
  const name = safeFileName(doc.meta.title)
  if (format.startsWith('plugin:')) {
    const { useRegistry } = await import('../plugins/host') // loaded on use: the host imports the library
    const spec = useRegistry.getState().exporters.find((e) => `plugin:${e.id}` === format)
    if (!spec) throw new Error('That export format is no longer available')
    const data = await spec.build(doc)
    const ext = spec.extension.replace(/^\./, '')
    return saveFile(typeof data === 'string' ? data : new Blob([data as BlobPart], { type: spec.mime }), { defaultName: `${name}.${ext}`, extensions: [ext], label: spec.title })
  }
  switch (format) {
    case 'opml':
      return saveFile(toOpml(doc), { defaultName: `${name}.opml`, extensions: ['opml'], label: 'OPML outline' })
    case 'html':
      return saveFile(await buildHtmlPage(doc), { defaultName: `${name}.html`, extensions: ['html'], label: 'Web page' })
    case 'json':
      return saveFile(exportJson(doc), { defaultName: `${name}.branchmint.json`, extensions: ['json'], label: 'Branchmint map' })
    case 'md':
      return saveFile(toMarkdown(doc), { defaultName: `${name}.md`, extensions: ['md'], label: 'Markdown' })
    case 'svg':
      return saveFile((await buildSvg(doc, o)).svg, { defaultName: `${name}.svg`, extensions: ['svg'], label: 'SVG image' })
    case 'png':
      return saveFile((await buildPng(doc, o)).blob, { defaultName: `${name}.png`, extensions: ['png'], label: 'PNG image' })
    case 'pdf':
      // vector when the text fits the PDF font; otherwise the image-based PDF (the dialog tells the user)
      return saveFile(canExportVectorPdf(doc) ? await buildVectorPdf(doc, o) : await buildPdf(doc, o), { defaultName: `${name}.pdf`, extensions: ['pdf'], label: 'PDF document' })
    case 'pdfimage':
      return saveFile(await buildPdf(doc, o), { defaultName: `${name}.pdf`, extensions: ['pdf'], label: 'PDF document' })
    default:
      throw new Error(`Unknown export format: ${format}`)
  }
}
