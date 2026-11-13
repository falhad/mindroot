import { create } from 'zustand'
import type { MapDoc } from '../core/types'

export type ThemeMode = 'light' | 'dark' | 'system'
export type Route = { name: 'dashboard' } | { name: 'editor'; id: string } | { name: 'tasks' } | { name: 'capture' }

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'error' | 'success'
  action?: { label: string; run: () => void }
}

export interface ConfirmRequest {
  title: string
  body?: string
  confirmLabel: string
  danger?: boolean
  resolve: (ok: boolean) => void
}

export interface PromptRequest {
  title: string
  body?: string
  placeholder?: string
  multiline?: boolean
  confirmLabel: string
  initial?: string
  submit?: (value: string, state: { cancelled(): boolean; status(text: string): void }) => Promise<string | void>
  resolve: (value: string | null) => void
}

interface UiState {
  confirm: ConfirmRequest | null
  prompt: PromptRequest | null
  route: Route
  themeMode: ThemeMode
  dark: boolean
  inspectorOpen: boolean
  outlineOpen: boolean
  paletteOpen: boolean
  searchOpen: boolean
  exportOpen: boolean
  helpOpen: boolean
  /** The dialog with the installers of the desktop app (web version only). */
  downloadOpen: boolean
  settingsOpen: boolean
  /** Tab id in the settings dialog: `general`, `plugins`, or a plugin id. */
  settingsTab: string
  /** A node to select when a map finishes loading (set when following a link between maps). */
  pendingSelect: { mapId: string; nodeId: string } | null
  /** The compare view: two versions side by side. */
  compare: { a: MapDoc; b: MapDoc; labelA: string; labelB: string } | null
  comparePicker: boolean
  historyOpen: boolean
  /** Tags selected in the tag filter (empty = no filter). Not saved with the map. */
  tagFilter: string[]
  toasts: Toast[]
}

function readTheme(): ThemeMode {
  try {
    const t = localStorage.getItem('mr.theme')
    if (t === 'light' || t === 'dark' || t === 'system') return t
  } catch {
    /* storage unavailable */
  }
  return 'system'
}

function systemDark() {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
}

export function parseRoute(hash: string): Route {
  const m = /^#\/m\/([A-Za-z0-9_-]+)/.exec(hash)
  if (hash.startsWith('#/tasks')) return { name: 'tasks' }
  if (hash.startsWith('#/capture')) return { name: 'capture' }
  return m ? { name: 'editor', id: m[1] } : { name: 'dashboard' }
}

const mode = readTheme()

export const useUi = create<UiState>(() => ({
  route: parseRoute(typeof location !== 'undefined' ? location.hash : ''),
  themeMode: mode,
  dark: mode === 'dark' || (mode === 'system' && systemDark()),
  inspectorOpen: typeof innerWidth === 'undefined' ? true : innerWidth >= 1100,
  outlineOpen: false,
  paletteOpen: false,
  searchOpen: false,
  exportOpen: false,
  helpOpen: false,
  downloadOpen: false,
  settingsOpen: false,
  settingsTab: 'general',
  pendingSelect: null,
  compare: null,
  comparePicker: false,
  historyOpen: false,
  tagFilter: [],
  toasts: [],
  confirm: null,
  prompt: null,
}))

const set = useUi.setState

export function applyTheme(m: ThemeMode) {
  const dark = m === 'dark' || (m === 'system' && systemDark())
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  try {
    localStorage.setItem('mr.theme', m)
  } catch {
    /* ignore */
  }
  set({ themeMode: m, dark })
}

export function cycleTheme() {
  const m = useUi.getState().themeMode
  applyTheme(m === 'light' ? 'dark' : m === 'dark' ? 'system' : 'light')
}

export function goTo(route: Route) {
  const hash = route.name === 'editor' ? `#/m/${route.id}` : route.name === 'tasks' ? '#/tasks' : route.name === 'capture' ? '#/capture' : '#/'
  if (location.hash !== hash) history.pushState(null, '', hash)
  set({ route })
}

let toastId = 1
export function toast(text: string, kind: Toast['kind'] = 'info', action?: Toast['action'], ms = 3500) {
  const id = toastId++
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind, action }] }))
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), action ? Math.max(ms, 6000) : ms)
}
export const dismissToast = (id: number) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))

export const ui = {
  toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),
  setInspector: (inspectorOpen: boolean) => set({ inspectorOpen }),
  setCompare: (compare: UiState['compare']) => set({ compare }),
  setComparePicker: (comparePicker: boolean) => set({ comparePicker }),
  setHistory: (historyOpen: boolean) => set({ historyOpen }),
  toggleOutline: () => set((s) => ({ outlineOpen: !s.outlineOpen })),
  setOutline: (outlineOpen: boolean) => set({ outlineOpen }),
  setPalette: (paletteOpen: boolean) => set({ paletteOpen }),
  setSearch: (searchOpen: boolean) => set({ searchOpen }),
  setExport: (exportOpen: boolean) => set({ exportOpen }),
  setHelp: (helpOpen: boolean) => set({ helpOpen }),
  setDownload: (downloadOpen: boolean) => set({ downloadOpen }),
  setTagFilter: (tagFilter: string[]) => set({ tagFilter }),
  toggleTag: (tag: string) => set((s) => ({ tagFilter: s.tagFilter.includes(tag) ? s.tagFilter.filter((t) => t !== tag) : [...s.tagFilter, tag] })),
  setSettings: (settingsOpen: boolean, settingsTab?: string) => set((s) => ({ settingsOpen, settingsTab: settingsTab ?? s.settingsTab })),
}

/** Ask the user for text. Resolves with the text, or null when the user cancelled. */
export function askPrompt(req: Omit<PromptRequest, 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => {
    useUi.getState().prompt?.resolve(null) // only one at a time: a new request cancels the old one
    set({ prompt: { ...req, resolve: (v) => { set({ prompt: null }); resolve(v) } } })
  })
}

/** In-app replacement for window.confirm (webviews don't all support it). */
export function askConfirm(req: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    set({ confirm: { ...req, resolve: (ok) => { set({ confirm: null }); resolve(ok) } } })
  })
}
