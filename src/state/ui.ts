import { create } from 'zustand'

export type ThemeMode = 'light' | 'dark' | 'system'
export type Route = { name: 'dashboard' } | { name: 'editor'; id: string }

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

interface UiState {
  confirm: ConfirmRequest | null
  route: Route
  themeMode: ThemeMode
  dark: boolean
  inspectorOpen: boolean
  paletteOpen: boolean
  searchOpen: boolean
  exportOpen: boolean
  helpOpen: boolean
  settingsOpen: boolean
  /** Tab id in the settings dialog: `general`, `plugins`, or a plugin id. */
  settingsTab: string
  toasts: Toast[]
}

function readTheme(): ThemeMode {
  try {
    const t = localStorage.getItem('bm.theme')
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
  return m ? { name: 'editor', id: m[1] } : { name: 'dashboard' }
}

const mode = readTheme()

export const useUi = create<UiState>(() => ({
  route: parseRoute(typeof location !== 'undefined' ? location.hash : ''),
  themeMode: mode,
  dark: mode === 'dark' || (mode === 'system' && systemDark()),
  inspectorOpen: typeof innerWidth === 'undefined' ? true : innerWidth >= 1100,
  paletteOpen: false,
  searchOpen: false,
  exportOpen: false,
  helpOpen: false,
  settingsOpen: false,
  settingsTab: 'general',
  toasts: [],
  confirm: null,
}))

const set = useUi.setState

export function applyTheme(m: ThemeMode) {
  const dark = m === 'dark' || (m === 'system' && systemDark())
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  try {
    localStorage.setItem('bm.theme', m)
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
  const hash = route.name === 'editor' ? `#/m/${route.id}` : '#/'
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
  setPalette: (paletteOpen: boolean) => set({ paletteOpen }),
  setSearch: (searchOpen: boolean) => set({ searchOpen }),
  setExport: (exportOpen: boolean) => set({ exportOpen }),
  setHelp: (helpOpen: boolean) => set({ helpOpen }),
  setSettings: (settingsOpen: boolean, settingsTab?: string) => set((s) => ({ settingsOpen, settingsTab: settingsTab ?? s.settingsTab })),
}

/** In-app replacement for window.confirm (webviews don't all support it). */
export function askConfirm(req: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    set({ confirm: { ...req, resolve: (ok) => { set({ confirm: null }); resolve(ok) } } })
  })
}
