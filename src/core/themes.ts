export interface MapTheme {
  id: string
  name: string
  /** Root fill gradient [from, to] for light / dark app mode. */
  root: { light: [string, string]; dark: [string, string] }
  /** Eight branch colours. Chosen dark enough for white text in light mode. */
  light: string[]
  dark: string[]
}

export const THEMES: MapTheme[] = [
  {
    id: 'mint',
    name: 'Mint',
    root: { light: ['#0f766e', '#0d9488'], dark: ['#14b8a6', '#2dd4bf'] },
    light: ['#0d9488', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#ca8a04', '#16a34a', '#475569'],
    dark: ['#2dd4bf', '#60a5fa', '#a78bfa', '#f472b6', '#fb923c', '#facc15', '#4ade80', '#94a3b8'],
  },
  {
    id: 'ocean',
    name: 'Ocean',
    root: { light: ['#1e3a8a', '#1d4ed8'], dark: ['#3b82f6', '#60a5fa'] },
    light: ['#0369a1', '#1d4ed8', '#4f46e5', '#0891b2', '#0f766e', '#6d28d9', '#0284c7', '#475569'],
    dark: ['#38bdf8', '#60a5fa', '#818cf8', '#22d3ee', '#2dd4bf', '#a78bfa', '#7dd3fc', '#94a3b8'],
  },
  {
    id: 'sunset',
    name: 'Sunset',
    root: { light: ['#be123c', '#e11d48'], dark: ['#fb7185', '#fda4af'] },
    light: ['#e11d48', '#ea580c', '#d97706', '#c026d3', '#9333ea', '#dc2626', '#b45309', '#57534e'],
    dark: ['#fb7185', '#fb923c', '#fbbf24', '#e879f9', '#c084fc', '#f87171', '#fcd34d', '#a8a29e'],
  },
  {
    id: 'forest',
    name: 'Forest',
    root: { light: ['#14532d', '#166534'], dark: ['#22c55e', '#4ade80'] },
    light: ['#15803d', '#0f766e', '#4d7c0f', '#a16207', '#047857', '#3f6212', '#0d9488', '#44403c'],
    dark: ['#4ade80', '#2dd4bf', '#a3e635', '#fbbf24', '#34d399', '#bef264', '#5eead4', '#a8a29e'],
  },
  {
    id: 'grape',
    name: 'Grape',
    root: { light: ['#581c87', '#6d28d9'], dark: ['#a855f7', '#c084fc'] },
    light: ['#7c3aed', '#c026d3', '#db2777', '#4f46e5', '#9333ea', '#be185d', '#6d28d9', '#52525b'],
    dark: ['#a78bfa', '#e879f9', '#f472b6', '#818cf8', '#c084fc', '#f9a8d4', '#c4b5fd', '#a1a1aa'],
  },
  {
    id: 'mono',
    name: 'Mono',
    root: { light: ['#18181b', '#27272a'], dark: ['#e4e4e7', '#fafafa'] },
    light: ['#3f3f46', '#52525b', '#71717a', '#27272a', '#57534e', '#44403c', '#334155', '#1e293b'],
    dark: ['#d4d4d8', '#a1a1aa', '#e4e4e7', '#a8a29e', '#cbd5e1', '#94a3b8', '#d6d3d1', '#f4f4f5'],
  },
]

export const DEFAULT_THEME = THEMES[0]

const HEX6 = /^#[0-9a-fA-F]{6}$/

/** A theme made of eight chosen colours (used in light and dark). The root gradient uses the first two. */
export function customTheme(colors: string[]): MapTheme {
  return { id: 'custom', name: 'Custom', root: { light: [colors[0], colors[1]], dark: [colors[0], colors[1]] }, light: [...colors], dark: [...colors] }
}

/** The palette a map uses: its own eight colours if it has them, else the chosen built-in theme. */
export function resolveTheme(doc: { themeId: string; customTheme?: string[] }): MapTheme {
  const c = doc.customTheme
  return c && c.length === 8 && c.every((x) => HEX6.test(x)) ? customTheme(c) : getTheme(doc.themeId)
}

export function getTheme(id: string): MapTheme {
  return THEMES.find((t) => t.id === id) ?? DEFAULT_THEME
}

/** Resolve a stored colour ("3" slot or "#hex") to a concrete hex colour. */
export function resolveColor(c: string | undefined, theme: MapTheme, dark: boolean): string | undefined {
  if (!c) return undefined
  if (c.startsWith('#')) return c
  const i = Number(c)
  if (Number.isInteger(i)) return (dark ? theme.dark : theme.light)[((i % 8) + 8) % 8]
  return undefined
}

/** White or near-black, whichever reads better on `hex`. */
export function onColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return '#fff'
  const n = parseInt(m[1], 16)
  const lin = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
  // pick whichever of white / near-black has the higher WCAG contrast ratio
  const white = 1.05 / (L + 0.05)
  const dark = (L + 0.05) / 0.056
  return dark > white ? '#0b1220' : '#ffffff'
}

/** Mix `hex` with white/black by alpha for tinted backgrounds. */
export function withAlpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
