import { describe, expect, it, vi } from 'vitest'
import { autoCheckEnabled, createUpdater, setAutoCheck, type DownloadEvent, type UpdateHandle } from '../src/io/updater'

const handle = (over: Partial<UpdateHandle> = {}): UpdateHandle => ({
  version: '0.3.0',
  currentVersion: '0.2.0',
  body: 'Fixes and new things',
  date: '2026-11-01T00:00:00Z',
  downloadAndInstall: vi.fn(async (on?: (e: DownloadEvent) => void) => {
    on?.({ event: 'Started', data: { contentLength: 100 } })
    on?.({ event: 'Progress', data: { chunkLength: 40 } })
    on?.({ event: 'Progress', data: { chunkLength: 60 } })
    on?.({ event: 'Finished' })
  }),
  ...over,
})

const make = (check: () => Promise<UpdateHandle | null>, relaunch = vi.fn(async () => {})) =>
  createUpdater({ check, relaunch, currentVersion: async () => '0.2.0' })

describe('updater', () => {
  it('no update: says up to date', async () => {
    const u = make(async () => null)
    await u.check()
    expect(u.store.getState().state).toEqual({ kind: 'uptodate' })
  })

  it('an update shows its version, notes and date, and nothing is installed yet', async () => {
    const h = handle()
    const u = make(async () => h)
    await u.check()
    expect(u.store.getState().state).toMatchObject({ kind: 'available', version: '0.3.0', notes: 'Fixes and new things' })
    expect(h.downloadAndInstall).not.toHaveBeenCalled()
  })

  it('install reports progress, ends ready, and only restarts when asked', async () => {
    const relaunch = vi.fn(async () => {})
    const u = make(async () => handle(), relaunch)
    await u.check()
    const seen: number[] = []
    u.store.subscribe((s) => s.state.kind === 'downloading' && seen.push(s.state.percent))
    await u.install()
    expect(seen).toContain(40)
    expect(seen).toContain(100)
    expect(u.store.getState().state).toEqual({ kind: 'ready', version: '0.3.0' })
    expect(relaunch).not.toHaveBeenCalled()
    await u.restart()
    expect(relaunch).toHaveBeenCalledTimes(1)
  })

  it('a failed check shows a plain message, does not throw, and the next check works', async () => {
    let fail = true
    const u = make(async () => {
      if (fail) throw new Error('error sending request for url (https://github.com/...): dns error')
      return null
    })
    await expect(u.check()).resolves.toBeUndefined()
    const s = u.store.getState().state
    expect(s.kind).toBe('error')
    if (s.kind === 'error') {
      expect(s.message).toMatch(/connect|reach|internet/i)
      expect(s.message).not.toMatch(/https?:\/\//) // no raw addresses or stack text
    }
    fail = false
    await u.check()
    expect(u.store.getState().state).toEqual({ kind: 'uptodate' })
  })

  it('a bad signature or a missing release file get their own messages', async () => {
    const sig = make(async () => { throw new Error('the signature could not be verified') })
    await sig.check()
    expect(JSON.stringify(sig.store.getState().state)).toMatch(/verified|signature/i)
    const nf = make(async () => { throw new Error('Could not fetch a valid release JSON from the remote') })
    await nf.check()
    expect(JSON.stringify(nf.store.getState().state)).toMatch(/could not find|not available|no update information/i)
  })

  it('a failed install keeps the update available so the user can try again', async () => {
    const h = handle({ downloadAndInstall: vi.fn(async () => { throw new Error('signature verification failed') }) })
    const u = make(async () => h)
    await u.check()
    await u.install()
    expect(u.store.getState().state.kind).toBe('error')
    await u.check()
    expect(u.store.getState().state.kind).toBe('available')
  })

  it('install does nothing when no update was found, and two checks at once make one request', async () => {
    const check = vi.fn(async () => null)
    const u = make(check)
    await u.install()
    expect(u.store.getState().state.kind).toBe('idle')
    await Promise.all([u.check(), u.check()])
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('the version of the running app is available', async () => {
    const u = make(async () => null)
    await u.load()
    expect(u.store.getState().current).toBe('0.2.0')
  })
})

describe('automatic check setting', () => {
  it('is on by default and remembered', () => {
    localStorage.clear()
    expect(autoCheckEnabled()).toBe(true)
    setAutoCheck(false)
    expect(autoCheckEnabled()).toBe(false)
    setAutoCheck(true)
    expect(autoCheckEnabled()).toBe(true)
  })
})
