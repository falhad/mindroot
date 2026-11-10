import { create } from 'zustand'
import { isTauri } from './env'

/**
 * Updates through GitHub Releases (Tauri updater). Every update is signed; the app checks the
 * signature with the public key in `tauri.conf.json` and refuses anything else.
 */
export type DownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' }

export interface UpdateHandle {
  version: string
  currentVersion: string
  date?: string
  body?: string
  downloadAndInstall(onEvent?: (e: DownloadEvent) => void): Promise<void>
}

export interface UpdaterDeps {
  check(): Promise<UpdateHandle | null>
  relaunch(): Promise<void>
  currentVersion(): Promise<string>
}

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'uptodate' }
  | { kind: 'available'; version: string; notes?: string; date?: string }
  | { kind: 'downloading'; percent: number }
  | { kind: 'ready'; version: string }
  | { kind: 'error'; message: string }

interface Store {
  state: UpdateState
  /** Version of the running app. */
  current: string
}

/** A short message a person can act on. Never raw addresses or stack text. */
export function describeUpdateError(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  if (/signature|verif/i.test(text)) return 'The update could not be verified, so it was not installed. Try again later.'
  if (/valid release json|404|not found|status code/i.test(text)) return 'Could not find update information. The release may not be published yet, or it is not public.'
  if (/dns|network|connect|timed? ?out|sending request|offline|resolve/i.test(text)) return 'Could not reach the update server. Check your internet connection and try again.'
  return 'Could not check for updates. Try again later.'
}

export function createUpdater(deps: UpdaterDeps) {
  const store = create<Store>(() => ({ state: { kind: 'idle' }, current: '' }))
  const set = (state: UpdateState) => store.setState({ state })
  let handle: UpdateHandle | null = null
  let checking: Promise<void> | null = null

  const load = async () => {
    try {
      store.setState({ current: await deps.currentVersion() })
    } catch {
      /* the version is only shown, not needed */
    }
  }

  const check = (): Promise<void> => {
    if (checking) return checking
    set({ kind: 'checking' })
    checking = (async () => {
      try {
        handle = await deps.check()
        if (!handle) set({ kind: 'uptodate' })
        else set({ kind: 'available', version: handle.version, notes: handle.body?.trim() || undefined, date: handle.date })
      } catch (e) {
        handle = null
        set({ kind: 'error', message: describeUpdateError(e) })
      } finally {
        checking = null
      }
    })()
    return checking
  }

  const install = async () => {
    if (!handle) return
    const h = handle
    let total = 0
    let got = 0
    set({ kind: 'downloading', percent: 0 })
    try {
      await h.downloadAndInstall((e) => {
        if (e.event === 'Started') total = e.data.contentLength ?? 0
        else if (e.event === 'Progress') {
          got += e.data.chunkLength
          set({ kind: 'downloading', percent: total ? Math.min(100, Math.round((got / total) * 100)) : 0 })
        } else set({ kind: 'downloading', percent: 100 })
      })
      set({ kind: 'ready', version: h.version })
    } catch (e) {
      set({ kind: 'error', message: describeUpdateError(e) })
    }
  }

  const restart = () => deps.relaunch()

  return { store, check, install, restart, load }
}

const tauriDeps: UpdaterDeps = {
  async check() {
    const { check } = await import('@tauri-apps/plugin-updater')
    const u = await check()
    if (!u) return null
    return {
      version: u.version,
      currentVersion: u.currentVersion,
      date: u.date,
      body: u.body,
      downloadAndInstall: (on) => u.downloadAndInstall(on as never),
    }
  },
  async relaunch() {
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  },
  async currentVersion() {
    const { getVersion } = await import('@tauri-apps/api/app')
    return getVersion()
  },
}

/** The app's updater (desktop only; in the browser every call reports that updates are not available). */
export const updater = createUpdater(
  isTauri
    ? tauriDeps
    : {
        check: async () => null,
        relaunch: async () => {},
        currentVersion: async () => '',
      },
)
export const useUpdater = updater.store

const AUTO_KEY = 'bm.updates.auto'

export function autoCheckEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setAutoCheck(on: boolean) {
  try {
    if (on) localStorage.removeItem(AUTO_KEY)
    else localStorage.setItem(AUTO_KEY, 'off')
  } catch {
    /* ignore */
  }
}
