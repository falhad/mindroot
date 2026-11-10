import { arrowHead, bracketPath, DASH, relationPath, edgePath } from './edges'
import { resolveColor, withAlpha } from './themes'
import type { LayoutResult } from './layout'
import { boundsOf } from './layout'
import { PLACEHOLDER } from './measure'
import { DARK, LIGHT, isRtl, makeVisualContext, nodeVisual } from './visual'
import type { MapDoc } from './types'

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface SvgOptions {
  dark: boolean
  /** Paint the canvas background (PNG/PDF) or leave transparent (SVG). */
  background: boolean
  padding?: number
  /** Resolve "lucide:name" to inner SVG markup (24x24 viewBox). */
  iconMarkup?: (name: string) => string | null
  /** CSS @font-face rules (data URLs) so exported images keep the app fonts. */
  fontCss?: string
}

export interface SvgResult {
  svg: string
  width: number
  height: number
}

export function renderSvg(doc: MapDoc, layout: LayoutResult, opts: SvgOptions): SvgResult {
  const ctx = makeVisualContext(doc, layout, opts.dark)
  const pal = opts.dark ? DARK : LIGHT
  const pad = opts.padding ?? 48
  const rb = layout.bounds
  const extra = doc.relations.length ? 40 : 0
  const b = { x: rb.x - pad - extra, y: rb.y - pad - extra, w: rb.w + (pad + extra) * 2, h: rb.h + (pad + extra) * 2 }
  const font = (m: { fontWeight: number; fontSize: number }) => `font-weight="${m.fontWeight}" font-size="${m.fontSize}"`
  const out: string[] = []

  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${Math.ceil(b.w)}" height="${Math.ceil(b.h)}" viewBox="${b.x} ${b.y} ${b.w} ${b.h}" font-family="'Inter Variable', 'Vazirmatn Variable', Inter, -apple-system, 'Segoe UI', Roboto, sans-serif">`,
  )
  if (opts.fontCss) out.push(`<style>${opts.fontCss}</style>`)
  out.push(`<title>${esc(doc.meta.title)}</title>`)
  out.push('<defs>')
  for (const id of layout.order) {
    const v = nodeVisual(doc, layout, ctx, id)
    if (v.gradient) out.push(`<linearGradient id="g-${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${v.gradient[0]}"/><stop offset="1" stop-color="${v.gradient[1]}"/></linearGradient>`)
  }
  out.push('</defs>')
  if (opts.background) out.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${pal.bg}"/>`)

  // group boundaries sit behind everything
  for (const g of doc.groups ?? []) {
    const gb = layout.groupBoxes[g.id]
    if (!gb) continue
    const c = resolveColor(g.color, ctx.theme, opts.dark) ?? pal.muted
    out.push(`<rect data-group="${g.id}" x="${gb.x}" y="${gb.y}" width="${gb.w}" height="${gb.h}" rx="16" fill="${withAlpha(c, 0.08)}" stroke="${c}" stroke-width="1.5" stroke-dasharray="6 5"/>`)
    if (g.label) out.push(`<text x="${gb.x + 12}" y="${gb.y + 14}" font-size="12" font-weight="600" fill="${c}" dominant-baseline="central">${esc(g.label)}</text>`)
  }

  // edges
  out.push('<g fill="none" stroke-linecap="round" stroke-linejoin="round">')
  for (const s of doc.summaries ?? []) {
    const sb = layout.summaryBoxes[s.id]
    if (!sb) continue
    out.push(`<path data-summary="${s.id}" d="${bracketPath(sb.bracket, sb.side)}" stroke="${pal.muted}" stroke-width="2"/>`)
  }
  for (const id of layout.order) {
    const n = doc.nodes[id]
    if (!n.parentId || n.sticky) continue
    const v = nodeVisual(doc, layout, ctx, id)
    out.push(`<path d="${edgePath(doc.edge, layout.boxes[n.parentId], layout.boxes[id], layout.attach[id])}" stroke="${v.accent}" stroke-width="${v.edgeWidth}" opacity="0.85"/>`)
  }
  for (const r of doc.relations) {
    const a = layout.boxes[r.from]
    const c = layout.boxes[r.to]
    if (!a || !c) continue
    const p = relationPath(a, c)
    const dash = DASH[r.dash ?? 'dashed']
    const arrow = r.arrow ?? 'end'
    out.push(`<path d="${p.d}" stroke="${pal.muted}" stroke-width="1.8"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`)
    if (arrow !== 'none') out.push(`<path data-arrow="end" d="${arrowHead(p.end, p.angle)}" stroke="${pal.muted}" stroke-width="1.8"/>`)
    if (arrow === 'both') out.push(`<path data-arrow="start" d="${arrowHead(p.start, p.startAngle)}" stroke="${pal.muted}" stroke-width="1.8"/>`)
    if (r.label) {
      // a halo in the background colour keeps the text readable over the line
      out.push(
        `<text x="${p.mid.x}" y="${p.mid.y}" text-anchor="middle" dominant-baseline="central" font-size="12" font-weight="500" fill="${pal.muted}" stroke="${pal.bg}" stroke-width="4" paint-order="stroke" stroke-linejoin="round">${esc(r.label)}</text>`,
      )
    }
  }
  out.push('</g>')
  for (const s of doc.summaries ?? []) {
    const sb = layout.summaryBoxes[s.id]
    if (!sb || !s.label) continue
    out.push(`<text x="${sb.label.x + sb.label.w / 2}" y="${sb.label.y + sb.label.h / 2}" text-anchor="middle" dominant-baseline="central" font-size="13" font-weight="500" fill="${pal.ink}"${isRtl(s.label) ? ' direction="rtl"' : ''}>${esc(s.label)}</text>`)
  }

  // nodes
  for (const id of layout.order) {
    const n = doc.nodes[id]
    const bx = layout.boxes[id]
    const m = layout.metrics[id]
    const v = nodeVisual(doc, layout, ctx, id)
    out.push(`<g transform="translate(${bx.x} ${bx.y})">`)
    if (v.fill || v.stroke) {
      const fill = v.gradient ? `url(#g-${id})` : (v.fill ?? 'none')
      out.push(
        `<rect width="${bx.w}" height="${bx.h}" rx="${v.radius}" fill="${fill}" ${v.stroke ? `stroke="${v.stroke}" stroke-width="${v.strokeWidth}"` : ''}/>`,
      )
    }
    if (v.underline) out.push(`<rect y="${bx.h - 2.5}" width="${bx.w}" height="2.5" rx="1.25" fill="${v.underline}"/>`)

    const textBlockH = m.lines.length * m.lineH
    const left = m.padX + m.iconW
    const right = bx.w - m.padX - m.badgeW
    const cx = (left + right) / 2
    const top = m.padY
    if (n.icon) {
      const ix = m.padX
      const iy = top + (m.lineH - m.fontSize) / 2
      if (n.icon.startsWith('emoji:')) {
        out.push(`<text x="${ix}" y="${top + m.lineH * 0.75}" font-size="${m.fontSize}">${esc(n.icon.slice(6))}</text>`)
      } else if (n.icon.startsWith('lucide:') && opts.iconMarkup) {
        const inner = opts.iconMarkup(n.icon.slice(7))
        if (inner) out.push(`<svg x="${ix}" y="${iy}" width="${m.fontSize}" height="${m.fontSize}" viewBox="0 0 24 24" fill="none" stroke="${v.text}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`)
      }
    }
    const lines = n.text === '' ? [PLACEHOLDER] : m.lines
    lines.forEach((line, i) => {
      const rtl = isRtl(line)
      out.push(
        `<text x="${cx}" y="${top + i * m.lineH + m.lineH * 0.72}" text-anchor="middle" ${font(m)} fill="${v.text}" ${n.text === '' ? 'opacity="0.55"' : ''}${rtl ? ' direction="rtl" unicode-bidi="plaintext"' : ''} xml:space="preserve">${esc(line)}</text>`,
      )
    })

    // badges
    let bxp = bx.w - m.padX - m.badgeW + 4
    const badge = (glyph: string) => {
      out.push(`<text x="${bxp + 7}" y="${top + m.lineH * 0.72}" text-anchor="middle" font-size="${Math.max(11, m.fontSize - 2)}" fill="${v.text}" opacity="0.75">${glyph}</text>`)
      bxp += 18
    }
    if (n.notes?.trim()) badge('¶')
    if (n.link) badge('↗')
    if (n.checklist?.length) badge('☑')
    if (n.tags?.length) badge('#')

    if (n.image) {
      out.push(`<image x="${(bx.w - m.imgW) / 2}" y="${top + textBlockH + 8}" width="${m.imgW}" height="${m.imgH}" href="${esc(n.image.src)}" preserveAspectRatio="xMidYMid slice"/>`)
    }
    out.push('</g>')

    if (n.collapsed && n.children.length) {
      const right = layout.attach[id] === 'left' ? bx.x - 16 : bx.x + bx.w + 16
      out.push(
        `<g><circle cx="${right}" cy="${bx.y + bx.h / 2}" r="11" fill="${pal.surface}" stroke="${v.accent}" stroke-width="1.5"/><text x="${right}" y="${bx.y + bx.h / 2 + 4}" text-anchor="middle" font-size="11" font-weight="600" fill="${pal.ink}">${n.children.length}</text></g>`,
      )
    }
  }
  out.push('</svg>')
  return { svg: out.join(''), width: Math.ceil(b.w), height: Math.ceil(b.h) }
}

/** Compact, text-free preview used on dashboard cards. */
export function renderThumb(doc: MapDoc, layout: LayoutResult): string {
  const ctx = makeVisualContext(doc, layout, false)
  const ids = layout.order.slice(0, 140)
  const set = new Set(ids)
  const b = boundsOf(ids.map((i) => layout.boxes[i]))
  const pad = 30
  const f = (n: number) => Math.round(n)
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(b.x - pad)} ${f(b.y - pad)} ${f(b.w + pad * 2)} ${f(b.h + pad * 2)}" preserveAspectRatio="xMidYMid meet">`,
  ]
  let paths = ''
  for (const id of ids) {
    const n = doc.nodes[id]
    if (!n.parentId || !set.has(n.parentId)) continue
    paths += `<path d="${edgePath(doc.edge, layout.boxes[n.parentId], layout.boxes[id], layout.attach[id])}" stroke="${ctx.accent[id]}" stroke-width="${layout.depth[id] <= 1 ? 7 : 4}" fill="none" stroke-linecap="round" opacity=".7"/>`
  }
  parts.push(paths)
  for (const id of ids) {
    const bx = layout.boxes[id]
    const d = layout.depth[id]
    const fill = d === 0 ? ctx.accent[id] : d === 1 ? ctx.accent[id] : '#ffffff'
    const stroke = d >= 2 ? ` stroke="${ctx.accent[id]}" stroke-width="3"` : ''
    parts.push(`<rect x="${f(bx.x)}" y="${f(bx.y)}" width="${f(bx.w)}" height="${f(bx.h)}" rx="${Math.min(14, f(bx.h / 2))}" fill="${fill}"${stroke}/>`)
  }
  parts.push('</svg>')
  return parts.join('')
}
