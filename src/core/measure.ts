import type { MindNode } from './types'

export const FONT_FAMILY =
  '"Inter Variable", "Vazirmatn Variable", Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Arabic", sans-serif'

let ctx: CanvasRenderingContext2D | null | undefined
function getCtx(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx
  try {
    ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
  } catch {
    ctx = null
  }
  return ctx
}

const widthCache = new Map<string, number>()

/** Call after web fonts finish loading so cached widths are re-measured. */
export function resetMeasureCache() {
  widthCache.clear()
  wrapCache.clear()
}

export function textWidth(s: string, font: string): number {
  const key = font + '|' + s
  const hit = widthCache.get(key)
  if (hit !== undefined) return hit
  const c = getCtx()
  let w: number
  if (c) {
    c.font = font
    w = c.measureText(s).width
  } else {
    const size = Number(/(\d+)px/.exec(font)?.[1] ?? 14)
    w = s.length * size * 0.56
  }
  if (widthCache.size > 20000) widthCache.clear()
  widthCache.set(key, w)
  return w
}

export interface Wrapped {
  lines: string[]
  width: number
}

const wrapCache = new Map<string, Wrapped>()

/** Greedy word wrap that also breaks over-long words. Explicit "\n" always breaks. */
export function wrapText(text: string, font: string, maxWidth: number): Wrapped {
  const key = font + '|' + maxWidth + '|' + text
  const hit = wrapCache.get(key)
  if (hit) return hit
  const lines: string[] = []
  for (const para of text.split('\n')) {
    if (para === '') {
      lines.push('')
      continue
    }
    let line = ''
    for (const word of para.match(/\S+\s*|\s+/g) ?? []) {
      const tryLine = line + word
      if (textWidth(tryLine.trimEnd(), font) <= maxWidth || line === '') {
        line = tryLine
        // a single word wider than the box: hard-break by characters
        while (textWidth(line.trimEnd(), font) > maxWidth && [...line].length > 1) {
          const chars = [...line]
          let cut = chars.length - 1
          while (cut > 1 && textWidth(chars.slice(0, cut).join(''), font) > maxWidth) cut--
          lines.push(chars.slice(0, cut).join(''))
          line = chars.slice(cut).join('')
        }
      } else {
        lines.push(line.trimEnd())
        line = word
      }
    }
    lines.push(line.trimEnd())
  }
  const width = Math.max(0, ...lines.map((l) => textWidth(l, font)))
  const res = { lines, width }
  if (wrapCache.size > 5000) wrapCache.clear()
  wrapCache.set(key, res)
  return res
}

export const PLACEHOLDER = 'New idea'

export interface NodeMetrics {
  w: number
  h: number
  lines: string[]
  font: string
  fontSize: number
  fontWeight: number
  lineH: number
  padX: number
  padY: number
  iconW: number
  badgeW: number
  imgW: number
  imgH: number
}

const STYLE_BY_DEPTH = [
  { size: 20, weight: 700, padX: 22, padY: 13, minW: 120, maxText: 320 },
  { size: 16, weight: 600, padX: 16, padY: 9, minW: 72, maxText: 260 },
  { size: 14, weight: 500, padX: 12, padY: 7, minW: 48, maxText: 260 },
]

export function depthStyle(depth: number) {
  return STYLE_BY_DEPTH[Math.min(depth, 2)]
}

export function badgeCount(n: MindNode): number {
  return (n.notes?.trim() ? 1 : 0) + (n.link ? 1 : 0) + (n.checklist?.length ? 1 : 0) + (n.tags?.length ? 1 : 0)
}

/** `textOverride` lets the editor measure the live draft while typing. */
export function measureNode(n: MindNode, depth: number, textOverride?: string): NodeMetrics {
  const st = depthStyle(depth)
  const font = `${st.weight} ${st.size}px ${FONT_FAMILY}`
  const lineH = Math.round(st.size * 1.4)
  const padX = n.shape === 'plain' ? Math.min(st.padX, 6) : st.padX
  const iconW = n.icon ? st.size + 8 : 0
  const badges = badgeCount(n)
  const badgeW = badges ? badges * 18 + 4 : 0
  const raw = textOverride ?? n.text
  const text = raw === '' ? PLACEHOLDER : raw
  const wrapped = wrapText(text, font, st.maxText)
  let w = Math.max(st.minW, Math.ceil(wrapped.width) + iconW + badgeW + padX * 2 + 2)
  let imgW = 0
  let imgH = 0
  if (n.image) {
    imgW = Math.min(n.image.w, 220)
    imgH = Math.round((imgW * n.image.h) / n.image.w)
    if (imgH > 200) {
      imgH = 200
      imgW = Math.round((imgH * n.image.w) / n.image.h)
    }
    w = Math.max(w, imgW + padX * 2)
  }
  const h = wrapped.lines.length * lineH + st.padY * 2 + (imgH ? imgH + 8 : 0)
  return { w, h, lines: wrapped.lines, font, fontSize: st.size, fontWeight: st.weight, lineH, padX, padY: st.padY, iconW, badgeW, imgW, imgH }
}
