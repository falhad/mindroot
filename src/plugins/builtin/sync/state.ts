import { create } from 'zustand'
import type { SyncResult } from '../../../sync/engine'

export interface SyncSettings {
  /** Master switch for automatic sync. */
  enabled: boolean
  remoteUrl: string
  branch: string
  /** Minutes between automatic syncs. 0 = never on a timer. */
  intervalMin: number
  /** Sync shortly after you stop editing. */
  onChange: boolean
  /** Sync when the app closes. */
  onQuit: boolean
}

export const DEFAULTS: SyncSettings = { enabled: false, remoteUrl: '', branch: 'main', intervalMin: 5, onChange: true, onQuit: true }

export type Phase = 'off' | 'idle' | 'syncing' | 'error'

interface SyncState {
  settings: SyncSettings
  phase: Phase
  lastSyncAt: number | null
  lastResult: SyncResult | null
  error: string | null
  gitMissing: boolean
  vaultPath: string
  loaded: boolean
}

export const useSync = create<SyncState>(() => ({
  settings: DEFAULTS,
  phase: 'off',
  lastSyncAt: null,
  lastResult: null,
  error: null,
  gitMissing: false,
  vaultPath: '',
  loaded: false,
}))
