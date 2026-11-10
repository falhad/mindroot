import type { LayoutResult } from './layout'
import { getTheme, onColor, resolveColor, withAlpha, type MapTheme } from './themes'
import type { MapDoc } from './types'

export interface Palette {
  bg: string
  surface: string
  ink: string
  muted: string
  grid: string
}

export const LIGHT: Palette = { bg: '#f5f6f8', surface: '#ffffff', ink: '#0f172a', muted: '#64748b', grid: '#cfd5df' }
export const DARK: Palette = { bg: '#0e1016', surface: '#1b2030', ink: '#e8ebf2', muted: '#8b93a7', grid: '#2a3042' }

export interface NodeVisual {
  /** Branch / accent colour for the node and its edge. */
  accent: string
  fill: string | null
  /** Two-stop gradient (root only). */
  gradient?: [string, string]
  stroke: string | null
  strokeWidth: number
  radius: number
  text: string
  /** Underline colour for the "plain" shape. */
  underline: string | null
  edgeWidth: number
}

export interface VisualContext {
  theme: MapTheme
  dark: boolean
  palette: Palette
  /** Resolved accent per node id. */
  accent: Record<string, string>
}

export function makeVisualContext(doc: MapDoc, layout: LayoutResult, dark: boolean): VisualContext {
  const theme = getTheme(doc.themeId)
  const accent: Record<string, string> = {}
  const rootAccent = (dark ? theme.root.dark : theme.root.light)[0]
  const palette = dark ? DARK : LIGHT
  const rootKids = doc.nodes[doc.root].children
  let floats = 0
  for (const id of layout.order) {
    const n = doc.nodes[id]
    const own = resolveColor(n.color, theme, dark)
    if (id === doc.root) accent[id] = own ?? rootAccent
    else if (!n.parentId) accent[id] = own ?? resolveColor(String((rootKids.length + floats++) % 8), theme, dark)! // floating subtree
    else if (n.parentId === doc.root) {
      const slot = Math.max(0, rootKids.indexOf(id))
      accent[id] = own ?? resolveColor(String(slot), theme, dark)!
    } else accent[id] = own ?? accent[n.parentId!]
  }
  return { theme, dark, palette, accent }
}

export function nodeVisual(doc: MapDoc, layout: LayoutResult, ctx: VisualContext, id: string): NodeVisual {
  const n = doc.nodes[id]
  const d = layout.depth[id]
  const box = layout.boxes[id]
  const accent = ctx.accent[id]
  const explicit = !!n.color
  if (n.sticky) {
    // a sticky note: pale paper (or the chosen colour), dark ink, small corners, no outline
    const fill = explicit ? withAlpha(accent, ctx.dark ? 0.32 : 0.28) : ctx.dark ? '#5b4b12' : '#fef3a6'
    return { accent, fill, stroke: null, strokeWidth: 0, radius: 4, text: ctx.dark ? '#fdf0b0' : '#3b2f05', underline: null, edgeWidth: 2 }
  }
  const shape = n.shape ?? (d === 0 ? 'rounded' : d === 1 ? 'pill' : 'rounded')
  const radius =
    shape === 'pill' ? Math.min(box.h / 2, 24) : shape === 'rounded' ? (d === 0 ? 16 : 10) : shape === 'rect' ? 3 : 0
  const edgeWidth = d <= 1 ? 3.5 : d === 2 ? 2.5 : 2

  if (d === 0) {
    const grad = explicit ? ([accent, accent] as [string, string]) : (ctx.dark ? ctx.theme.root.dark : ctx.theme.root.light)
    return {
      accent, fill: grad[0], gradient: grad, stroke: null, strokeWidth: 0, radius,
      text: onColor(grad[0]), underline: null, edgeWidth,
    }
  }
  if (shape === 'plain') {
    return {
      accent, fill: null, stroke: null, strokeWidth: 0, radius: 0,
      text: ctx.palette.ink, underline: accent, edgeWidth,
    }
  }
  if (d === 1) {
    return {
      accent, fill: accent, stroke: null, strokeWidth: 0, radius,
      text: onColor(accent), underline: null, edgeWidth,
    }
  }
  return {
    accent,
    fill: explicit ? withAlpha(accent, ctx.dark ? 0.2 : 0.12) : ctx.palette.surface,
    stroke: explicit ? accent : withAlpha(accent, ctx.dark ? 0.75 : 0.6),
    strokeWidth: 1.5,
    radius,
    text: ctx.palette.ink,
    underline: null,
    edgeWidth,
  }
}

export function isRtl(s: string): boolean {
  return /[֐-ࣿיִ-﷿ﹰ-﻿]/.test(s.replace(/[\s\d\p{P}]/gu, '').charAt(0) || '')
}
