import { beforeEach, describe, expect, it, vi } from 'vitest'
import { discoverPlugins, validateManifest, type PluginFiles } from '../src/plugins/external'
import { emit, emitAndWait, setPluginEnabled, startPlugins, useRegistry } from '../src/plugins/host'
import type { Plugin, PluginContext } from '../src/plugins/types'
import { buildCommands } from '../src/ui/commands'

const manifest = (id: string, extra = {}) => ({ id, name: id.toUpperCase(), version: '1.0.0', ...extra })

function plugin(id: string, activate: (ctx: PluginContext) => void | Promise<void>, deactivate?: () => void): Plugin {
  return { manifest: manifest(id), activate, deactivate }
}

beforeEach(() => {
  localStorage.clear()
  useRegistry.setState({ plugins: [], commands: [], status: [], panels: [], importers: [], exporters: [], ready: false })
})

describe('plugin host', () => {
  it('activates plugins and collects their commands, status chips and panels', async () => {
    const run = vi.fn()
    await startPlugins([
      {
        builtin: true,
        plugin: plugin('t.one', (ctx) => {
          ctx.commands.register({ id: 'hello', title: 'Say hello', run })
          ctx.status.register({ id: 's', order: 5, render: () => null })
          ctx.settingsPanel.register({ title: 'One', render: () => null })
        }),
      },
    ])
    const r = useRegistry.getState()
    expect(r.ready).toBe(true)
    expect(r.plugins[0]).toMatchObject({ state: 'active', builtin: true })
    expect(r.commands.map((c) => c.id)).toEqual(['t.one:hello'])
    expect(r.status.map((s) => s.id)).toEqual(['t.one:s'])
    expect(r.panels.map((p) => p.pluginId)).toEqual(['t.one'])
    // plugin commands show up in the palette, under the plugin's name
    const cmd = buildCommands().find((c) => c.id === 't.one:hello')!
    expect(cmd.group).toBe('T.ONE')
    cmd.run()
    expect(run).toHaveBeenCalled()
  })

  it('turning a plugin off removes everything it added and calls deactivate', async () => {
    const off = vi.fn()
    const handler = vi.fn()
    await startPlugins([
      {
        builtin: true,
        plugin: plugin('t.two', (ctx) => {
          ctx.commands.register({ id: 'c', title: 'C', run() {} })
          ctx.events.on('doc:saved', handler)
        }, off),
      },
    ])
    emit('doc:saved', { id: 'a' })
    expect(handler).toHaveBeenCalledTimes(1)

    await setPluginEnabled('t.two', false)
    expect(off).toHaveBeenCalled()
    const r = useRegistry.getState()
    expect(r.plugins[0].state).toBe('disabled')
    expect(r.commands).toHaveLength(0)
    emit('doc:saved', { id: 'b' })
    expect(handler).toHaveBeenCalledTimes(1) // listener is gone

    await setPluginEnabled('t.two', true)
    expect(useRegistry.getState().commands).toHaveLength(1)
    expect(useRegistry.getState().plugins[0].state).toBe('active')
  })

  it('the on/off choice is remembered for the next start', async () => {
    const mk = () => [{ builtin: true, plugin: plugin('t.three', (ctx) => void ctx.commands.register({ id: 'c', title: 'C', run() {} })) }]
    await startPlugins(mk())
    await setPluginEnabled('t.three', false)
    useRegistry.setState({ plugins: [], commands: [], status: [], panels: [] })
    await startPlugins(mk())
    expect(useRegistry.getState().plugins[0].state).toBe('disabled')
    expect(useRegistry.getState().commands).toHaveLength(0)
  })

  it('a plugin that throws while starting is marked as failed and leaves nothing behind', async () => {
    await startPlugins([
      {
        builtin: true,
        plugin: plugin('t.bad', (ctx) => {
          ctx.commands.register({ id: 'c', title: 'C', run() {} })
          throw new Error('boom')
        }),
      },
      { builtin: true, plugin: plugin('t.good', (ctx) => void ctx.commands.register({ id: 'ok', title: 'OK', run() {} })) },
    ])
    const r = useRegistry.getState()
    expect(r.plugins.map((p) => [p.manifest.id, p.state])).toEqual([['t.bad', 'error'], ['t.good', 'active']])
    expect(r.plugins[0].error).toBe('boom')
    expect(r.commands.map((c) => c.id)).toEqual(['t.good:ok']) // the bad plugin's command was cleaned up
  })

  it('one failing event handler does not stop the others', async () => {
    const ok = vi.fn()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await startPlugins([
      { builtin: true, plugin: plugin('t.e1', (ctx) => void ctx.events.on('doc:opened', () => { throw new Error('x') })) },
      { builtin: true, plugin: plugin('t.e2', (ctx) => void ctx.events.on('doc:opened', ok)) },
    ])
    emit('doc:opened', { id: '1' })
    await Promise.resolve()
    expect(ok).toHaveBeenCalledWith({ id: '1' })
    spy.mockRestore()
  })

  it('emitAndWait waits for async handlers but gives up after the timeout', async () => {
    let finished = false
    await startPlugins([
      {
        builtin: true,
        plugin: plugin('t.q', (ctx) => void ctx.events.on('app:before-quit', async () => { await new Promise((r) => setTimeout(r, 30)); finished = true })),
      },
    ])
    await emitAndWait('app:before-quit', undefined, 1000)
    expect(finished).toBe(true)

    finished = false
    const t0 = Date.now()
    await emitAndWait('app:before-quit', undefined, 5) // handler needs 30 ms: we stop waiting
    expect(Date.now() - t0).toBeLessThan(25)
  })

  it('stores plugin settings with defaults', async () => {
    let ctx!: PluginContext
    await startPlugins([{ builtin: true, plugin: plugin('t.s', (c) => void (ctx = c)) }])
    expect(await ctx.settings.get({ a: 1, b: 'x' })).toEqual({ a: 1, b: 'x' })
    await ctx.settings.set({ a: 2 })
    expect(await ctx.settings.get({ a: 1, b: 'x' })).toEqual({ a: 2, b: 'x' })
  })

  it('native access is only given on the desktop (never in the browser)', async () => {
    let ctx!: PluginContext
    await startPlugins([{ builtin: true, plugin: plugin('t.n', (c) => void (ctx = c)) }])
    expect(ctx.isDesktop).toBe(false)
    expect(ctx.native).toBeUndefined()
  })

  it('installed plugins start switched off until the user enables them', async () => {
    const act = vi.fn()
    await startPlugins([{ builtin: false, plugin: plugin('t.ext', act) }])
    expect(useRegistry.getState().plugins[0].state).toBe('disabled')
    expect(act).not.toHaveBeenCalled()
    await setPluginEnabled('t.ext', true)
    expect(act).toHaveBeenCalledTimes(1)
    expect(useRegistry.getState().plugins[0].state).toBe('active')
  })
})

describe('installed plugin loader', () => {
  it('validates manifests', () => {
    expect(validateManifest({ id: 'acme.word-count', name: 'Word count', version: '1.0.0' })).toMatchObject({ id: 'acme.word-count', main: 'index.js', permissions: [] })
    expect(validateManifest({ id: 'a', name: 'x', version: '1' })).toMatch(/id/)
    expect(validateManifest({ id: 'Acme', name: 'x', version: '1' })).toMatch(/id/)
    expect(validateManifest({ id: 'ok.id', name: '', version: '1' })).toMatch(/name/)
    expect(validateManifest({ id: 'ok.id', name: 'x', version: '1', main: '../evil.js' })).toMatch(/main/)
    expect(validateManifest({ id: 'ok.id', name: 'x', version: '1', main: 'sub/dir.js' })).toMatch(/main/)
    expect(validateManifest({ id: 'ok.id', name: 'x', version: '1', api: 99 })).toMatch(/API/)
    expect(validateManifest({ id: 'ok.id', name: 'x', version: '1', permissions: ['native', 'root'] })).toMatchObject({ permissions: ['native'] })
    expect(validateManifest(null)).toMatch(/object/)
  })

  const files = (entries: Record<string, { manifest: unknown; code?: string }>): PluginFiles => ({
    list: async () => Object.entries(entries).map(([dir, e]) => ({ dir, manifest: e.manifest })),
    read: async (dir) => {
      const c = entries[dir].code
      if (c === undefined) throw new Error('index.js not found')
      return c
    },
  })
  const importer = async (code: string) => (code === 'GOOD' ? { default: { activate: vi.fn() } } : code === 'NOACT' ? { default: {} } : (() => { throw new Error('syntax error') })())

  it('loads good plugins and reports broken ones without throwing', async () => {
    const found = await discoverPlugins(
      files({
        good: { manifest: manifest('ok.plugin'), code: 'GOOD' },
        noact: { manifest: manifest('no.activate'), code: 'NOACT' },
        syntax: { manifest: manifest('bad.syntax'), code: 'SYNTAX' },
        nofile: { manifest: manifest('no.file') },
        badmanifest: { manifest: { id: 'X' } },
        dup: { manifest: manifest('mindroot.sync'), code: 'GOOD' },
      }),
      importer,
      new Set(['mindroot.sync']),
    )
    const by = Object.fromEntries(found.map((f) => [f.plugin.manifest.id, f.error]))
    expect(by['ok.plugin']).toBeUndefined()
    expect(by['no.activate']).toMatch(/default/)
    expect(by['bad.syntax']).toMatch(/syntax/)
    expect(by['no.file']).toMatch(/not found/)
    expect(by['mindroot.sync']).toMatch(/already used/)
    expect(found.find((f) => f.error?.includes('badmanifest'))).toBeTruthy()
    expect(found.every((f) => f.builtin === false)).toBe(true)
  })

  it('a loaded plugin gets the same context as a built-in one (react included)', async () => {
    let got!: PluginContext
    const found = await discoverPlugins(
      files({ p: { manifest: manifest('ext.ctx'), code: 'X' } }),
      async () => ({ default: { activate: (ctx: PluginContext) => void (got = ctx) } }),
      new Set(),
    )
    await startPlugins([{ plugin: found[0].plugin, builtin: false, error: found[0].error }])
    await setPluginEnabled('ext.ctx', true)
    expect(typeof got.react.createElement).toBe('function')
    expect(got.native).toBeUndefined() // not on desktop, and no permission asked
  })

  it('a missing plugins folder yields no plugins', async () => {
    const none = await discoverPlugins({ list: async () => { throw new Error('no dir') }, read: async () => '' }, importer, new Set())
    expect(none).toEqual([])
  })
})

describe('read access to the open map', () => {
  it('current() and subscribe() follow the document; the example plugin counts words', async () => {
    const { openDoc, commit } = await import('../src/state/doc')
    const { docFromOutline, parseOutline } = await import('../src/core/outline')
    const { setText } = await import('../src/core/tree')
    // @ts-expect-error the example is plain JavaScript on purpose
    const example = (await import('../examples/plugins/word-count/index.js')).default as { activate(ctx: PluginContext): void }
    let ctx!: PluginContext
    await startPlugins([{ builtin: true, plugin: plugin('t.docs', (c) => void (ctx = c)) }])
    expect(ctx.docs.current()).toBeNull()

    const seen: (string | null)[] = []
    const sub = ctx.docs.subscribe((d) => seen.push(d?.nodes[d.root].text ?? null))
    const doc = docFromOutline(parseOutline('# Alpha beta\n- gamma'))
    openDoc(doc)
    commit((d) => setText(d, d.root, 'Alpha beta delta'))
    expect(seen).toEqual(['Alpha beta', 'Alpha beta delta'])
    sub.dispose()
    commit((d) => setText(d, d.root, 'ignored'))
    expect(seen).toHaveLength(2)

    // the shipped example runs against the same API
    await startPlugins([{ builtin: true, plugin: { manifest: manifest('example.word-count'), activate: (c) => example.activate(c) } }])
    const chip = useRegistry.getState().status.find((s) => s.id === 'example.word-count:chip')
    expect(chip).toBeTruthy()
    expect(useRegistry.getState().commands.some((c) => c.id === 'example.word-count:copy')).toBe(true)
  })
})

describe('plugin API v2', () => {
  const start = async (id: string, builtin = true, permissions: string[] = []) => {
    let ctx!: PluginContext
    const p: Plugin = { manifest: manifest(id, { permissions }), activate: (c) => void (ctx = c) }
    await startPlugins([{ builtin, plugin: p }])
    if (!builtin) await setPluginEnabled(id, true)
    return ctx
  }

  it('docs.edit makes one undo step', async () => {
    const { openDoc, undo, useDoc } = await import('../src/state/doc')
    const { createDoc } = await import('../src/core/tree')
    openDoc(createDoc('Root'))
    const ctx = await start('t.edit')
    const before = useDoc.getState().past.length
    const ok = ctx.docs.edit('Add two', (d) => {
      d.nodes[d.root].text = 'Changed'
      d.nodes[d.root].notes = 'n'
    })
    expect(ok).toBe(true)
    expect(useDoc.getState().past.length).toBe(before + 1)
    undo()
    expect(useDoc.getState().doc!.nodes[useDoc.getState().doc!.root].text).toBe('Root')
  })

  it('docs.edit returns false when no map is open and when nothing changed', async () => {
    const { closeDoc, openDoc } = await import('../src/state/doc')
    const { createDoc } = await import('../src/core/tree')
    closeDoc()
    const ctx = await start('t.edit2')
    expect(ctx.docs.edit('x', (d) => void (d.layout = 'right'))).toBe(false)
    openDoc(createDoc('Root'))
    expect(ctx.docs.edit('noop', () => {})).toBe(false)
  })

  it('docs.selection returns the selected ids', async () => {
    const { openDoc, select } = await import('../src/state/doc')
    const { createDoc } = await import('../src/core/tree')
    const d = createDoc('Root')
    openDoc(d)
    select([d.root])
    const ctx = await start('t.sel')
    expect(ctx.docs.selection()).toEqual([d.root])
  })

  it('manifest accepts api 1, 2 and 3, refuses others, and keeps net and secrets permissions', () => {
    for (const api of [1, 2, 3]) expect(validateManifest({ id: 'a.b', name: 'x', version: '1', api })).toMatchObject({ id: 'a.b' })
    expect(validateManifest({ id: 'a.b', name: 'x', version: '1', api: 4 })).toMatch(/API/)
    expect(validateManifest({ id: 'a.b', name: 'x', version: '1', permissions: ['native', 'net', 'secrets', 'root'] })).toMatchObject({
      permissions: ['native', 'net', 'secrets'],
    })
  })

  it('an installed plugin without the net or secrets permission gets neither', async () => {
    const ctx = await start('t.noperm', false, [])
    expect(ctx.net).toBeUndefined()
    expect(ctx.secrets).toBeUndefined()
    const ctx2 = await start('t.perm', false, ['net', 'secrets'])
    expect(ctx2.net).toBeDefined()
    expect(ctx2.secrets).toBeDefined()
  })

  it('net.request uses fetch in the browser and returns status and body', async () => {
    const f = vi.fn(async () => new Response('{"ok":true}', { status: 201 }))
    vi.stubGlobal('fetch', f)
    const ctx = await start('t.net')
    const res = await ctx.net!.request({ url: 'https://example.test/x', method: 'POST', headers: { a: 'b' }, body: '{}' })
    expect(res).toEqual({ status: 201, body: '{"ok":true}' })
    expect(f).toHaveBeenCalledWith('https://example.test/x', expect.objectContaining({ method: 'POST', body: '{}' }))
    vi.unstubAllGlobals()
  })

  it('net.request refuses plain http to a non-local host', async () => {
    const ctx = await start('t.net2')
    await expect(ctx.net!.request({ url: 'http://example.test/x', method: 'GET' })).rejects.toThrow(/https/)
  })

  it('secrets keep values per plugin and can be removed', async () => {
    const a = await start('t.sec1')
    await a.secrets!.set('key', 'S1')
    expect(await a.secrets!.get('key')).toBe('S1')
    const b = await start('t.sec2')
    expect(await b.secrets!.get('key')).toBeNull()
    await a.secrets!.remove('key')
    expect(await a.secrets!.get('key')).toBeNull()
  })

  it('registered importers and exporters are listed and removed when the plugin is turned off', async () => {
    await start('t.fmt')
    const ctxFmt = await (async () => {
      let c!: PluginContext
      await startPlugins([{ builtin: true, plugin: { manifest: manifest('t.fmt2'), activate: (x) => {
        c = x
        x.formats.registerImporter({ id: 'imp', title: 'Imp', extensions: ['.foo'], parse: async () => { throw new Error('n/a') } })
        x.formats.registerExporter({ id: 'exp', title: 'Exp', extension: '.bar', mime: 'text/plain', build: async () => 'x' })
      } } }])
      return c
    })()
    expect(ctxFmt).toBeDefined()
    expect(useRegistry.getState().importers.map((i) => i.id)).toEqual(['t.fmt2:imp'])
    expect(useRegistry.getState().exporters.map((i) => i.id)).toEqual(['t.fmt2:exp'])
    await setPluginEnabled('t.fmt2', false)
    expect(useRegistry.getState().importers).toHaveLength(0)
    expect(useRegistry.getState().exporters).toHaveLength(0)
  })
})

describe('forgetting a plugin’s enabled state', () => {
  it('after forgetPluginEnabled an installed plugin starts switched off again, other plugins are not touched', async () => {
    const { forgetPluginEnabled } = await import('../src/plugins/host')
    const mk = () => [
      { builtin: false, plugin: { manifest: manifest('t.keep'), activate() {} } as Plugin },
      { builtin: false, plugin: { manifest: manifest('t.forget'), activate() {} } as Plugin },
    ]
    await startPlugins(mk())
    await setPluginEnabled('t.keep', true)
    await setPluginEnabled('t.forget', true)
    await forgetPluginEnabled('t.forget')
    useRegistry.setState({ plugins: [], commands: [], status: [], panels: [], importers: [], exporters: [], ready: false })
    await startPlugins(mk())
    const state = (id: string) => useRegistry.getState().plugins.find((p) => p.manifest.id === id)!.state
    expect(state('t.forget')).toBe('disabled')
    expect(state('t.keep')).toBe('active')
    await expect(forgetPluginEnabled('t.never-seen')).resolves.toBeUndefined() // unknown ids are fine
  })
})
