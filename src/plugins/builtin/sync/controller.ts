import { connectRemote, syncOnce, type GitOut, type SyncDeps, type SyncResult } from '../../../sync/engine'
import type { PluginContext } from '../../types'
import { DEFAULTS, useSync, type SyncSettings } from './state'

const DEBOUNCE_MS = 30_000
const STARTUP_DELAY_MS = 3_000

export function isValidRemote(url: string): boolean {
  const u = url.trim()
  return /^(https?:\/\/|ssh:\/\/|git@)[^\s]+$/i.test(u) && !/^ext::/i.test(u)
}

export class SyncController {
  private running: Promise<SyncResult | null> | null = null
  private again = false
  private timer: ReturnType<typeof setInterval> | null = null
  private debounce: ReturnType<typeof setTimeout> | null = null

  constructor(private ctx: PluginContext) {}

  private invoke<T>(cmd: string, args?: Record<string, unknown>) {
    return this.ctx.native!.invoke<T>(cmd, args)
  }

  async init() {
    const settings = await this.ctx.settings.get(DEFAULTS)
    const [gitOk, vaultPath] = await Promise.all([this.invoke<boolean>('git_available').catch(() => false), this.invoke<string>('vault_path').catch(() => '')])
    useSync.setState({ settings, gitMissing: !gitOk, vaultPath, loaded: true, phase: settings.enabled && settings.remoteUrl && gitOk ? 'idle' : 'off' })
    this.ctx.events.on('doc:saved', () => this.onSaved())
    this.ctx.events.on('app:before-quit', () => this.onQuit())
    this.ctx.commands.register({ id: 'sync-now', title: 'Sync now', run: () => void this.sync('manual') })
    this.ctx.commands.register({ id: 'settings', title: 'Git sync settings…', run: () => this.ctx.ui.openSettings() })
    if (this.active()) {
      this.reschedule()
      setTimeout(() => void this.sync('startup'), STARTUP_DELAY_MS)
    }
  }

  dispose() {
    if (this.timer) clearInterval(this.timer)
    if (this.debounce) clearTimeout(this.debounce)
  }

  private active() {
    const { settings, gitMissing } = useSync.getState()
    return settings.enabled && !!settings.remoteUrl && !gitMissing
  }

  async saveSettings(patch: Partial<SyncSettings>) {
    const next = { ...useSync.getState().settings, ...patch }
    await this.ctx.settings.set(next)
    useSync.setState({ settings: next })
    this.reschedule()
    if (!this.active() && useSync.getState().phase !== 'syncing') useSync.setState({ phase: 'off' })
  }

  private reschedule() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    const { settings } = useSync.getState()
    if (this.active() && settings.intervalMin > 0) this.timer = setInterval(() => void this.sync('timer'), settings.intervalMin * 60_000)
  }

  private onSaved() {
    const { settings } = useSync.getState()
    if (!this.active() || !settings.onChange) return
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = setTimeout(() => void this.sync('change'), DEBOUNCE_MS)
  }

  private async onQuit() {
    if (!this.active() || !useSync.getState().settings.onQuit) return
    await this.sync('quit')
  }

  /** Set up the repo, point it at `url`, and run the first sync. */
  async connect(url: string, branch: string): Promise<SyncResult | null> {
    const clean = url.trim()
    const br = branch.trim() || 'main'
    if (!isValidRemote(clean)) throw new Error('Enter a Git address like git@github.com:you/vault.git or https://github.com/you/vault.git')
    if (!/^[\w./-]+$/.test(br) || br.startsWith('-')) throw new Error('The branch name has characters Git does not allow.')
    await this.invoke('git_ensure_repo', { branch: br })
    await connectRemote(await this.deps(), clean)
    await this.saveSettings({ remoteUrl: clean, branch: br, enabled: true })
    return this.sync('manual')
  }

  async disconnect() {
    await this.saveSettings({ enabled: false })
    useSync.setState({ phase: 'off', error: null })
  }

  sync(reason: 'manual' | 'startup' | 'timer' | 'change' | 'quit'): Promise<SyncResult | null> {
    const { settings, gitMissing } = useSync.getState()
    if (gitMissing || !settings.remoteUrl) return Promise.resolve(null)
    if (this.running) {
      this.again = reason !== 'quit' // a change made during a sync gets its own run
      return this.running
    }
    this.running = this.run(reason).finally(() => {
      this.running = null
      if (this.again && this.active()) {
        this.again = false
        void this.sync('change')
      }
    })
    return this.running
  }

  private async deps(): Promise<SyncDeps> {
    const device = await this.invoke<string>('device_name').catch(() => 'this device')
    return {
      device,
      git: async (args): Promise<GitOut> => {
        try {
          return await this.invoke<GitOut>('git_run', { args })
        } catch (e) {
          return { code: -1, stdout: '', stderr: e instanceof Error ? e.message : String(e) }
        }
      },
      writeMap: (id, text) => this.invoke('save_map', { id, text }),
      pauseSaves: () => this.ctx.docs.pauseSaves(),
    }
  }

  private async run(reason: string): Promise<SyncResult | null> {
    useSync.setState({ phase: 'syncing', error: null })
    let res: SyncResult
    try {
      await this.ctx.docs.flush() // make sure what you see is what gets committed
      res = await syncOnce(await this.deps(), { branch: useSync.getState().settings.branch })
    } catch (e) {
      res = { ok: false, error: e instanceof Error ? e.message : String(e), committed: false, pulled: false, pushed: false, merged: 0, conflicts: 0, rescued: 0, copies: 0, changedMapIds: [] }
    }
    useSync.setState({ phase: res.ok ? 'idle' : 'error', error: res.ok ? null : (res.error ?? 'Sync failed'), lastResult: res, lastSyncAt: res.ok ? Date.now() : useSync.getState().lastSyncAt })
    await this.afterSync(res, reason)
    return res
  }

  private async afterSync(res: SyncResult, reason: string) {
    const manual = reason === 'manual'
    if (!res.ok) {
      if (manual) this.ctx.ui.toast(res.error ?? 'Sync failed', 'error')
      return
    }
    if (res.changedMapIds.length) {
      await this.ctx.library.refresh()
      const open = this.ctx.docs.openId()
      if (open && res.changedMapIds.includes(open)) await this.ctx.docs.reloadOpen()
    }
    const n = res.changedMapIds.length
    if (res.conflicts > 0) this.ctx.ui.toast(`Merged changes from another device. ${res.conflicts} edit${res.conflicts > 1 ? 's' : ''} overlapped; the newer one was kept.`, 'info')
    if (res.copies > 0) this.ctx.ui.toast(`${res.copies} map${res.copies > 1 ? 's' : ''} could not be merged and were saved as “conflict copy”.`, 'info')
    if (res.rescued > 0) this.ctx.ui.toast(`${res.rescued} idea${res.rescued > 1 ? 's' : ''} moved to the central idea after a conflicting move.`, 'info')
    if (manual) this.ctx.ui.toast(n ? `Synced. ${n} map${n > 1 ? 's' : ''} updated from the repository.` : res.pushed || res.committed ? 'Synced. Your changes are in the repository.' : 'Already up to date.', 'success')
    else if (n) this.ctx.ui.toast(`Synced. ${n} map${n > 1 ? 's' : ''} updated from another device.`, 'success')
  }
}

let current: SyncController | null = null
export const getController = () => current
export const setController = (c: SyncController | null) => (current = c)
