import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MapDoc, MapMeta } from '../src/core/types'

// an in-memory map store, so the test needs no browser database
const mem = new Map<string, MapDoc>()
vi.mock('../src/io/storage', async (orig) => {
  const real = await orig<typeof import('../src/io/storage')>()
  return {
    ...real,
    store: {
      list: async () => [...mem.values()].map((d) => ({ ...d.meta }) as MapMeta),
      load: async (id: string) => (mem.has(id) ? structuredClone(mem.get(id)!) : null),
      save: async (d: MapDoc) => void mem.set(d.meta.id, structuredClone(d)),
      saveCache: async () => {},
      remove: async (id: string) => void mem.delete(id),
    },
  }
})

describe('AI: "New map" in the app', async () => {
  const { startPlugins, useRegistry } = await import('../src/plugins/host')
  const { aiPlugin } = await import('../src/plugins/builtin/ai')
  const { useUi } = await import('../src/state/ui')
  const { store: disk } = await import('../src/io/storage')

  const MAP = '{"title":"Trip to Japan","children":[{"text":"Tokyo","children":[{"text":"Shibuya"},{"text":"Museums"}]},{"text":"Kyoto"}]}'
  const reply = (content: string, status = 200) => vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status }))
  const setup = async (fetchMock: unknown, key = 'sk-test-key') => {
    vi.stubGlobal('fetch', fetchMock)
    useRegistry.setState({ plugins: [], commands: [], status: [], panels: [], importers: [], exporters: [], newMap: [], ready: false })
    useUi.setState({ prompt: null, route: { name: 'home' } as never })
    await startPlugins([{ builtin: true, plugin: aiPlugin }])
    localStorage.setItem('mr.plugin.mindroot.ai', JSON.stringify({ kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'm', timeoutMs: 5000 }))
    if (key) sessionStorage.setItem('mr.secret.mindroot.ai.apikey', key)
  }
  const settle = () => new Promise((r) => setTimeout(r, 40))
  const ids = async () => (await disk.list()).map((m) => m.id)

  beforeEach(() => { mem.clear(); localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals() })

  it('the plugin adds a dashboard button and a command', async () => {
    await setup(reply(MAP))
    expect(useRegistry.getState().newMap.map((a) => [a.id, a.title])).toEqual([['mindroot.ai:generate', 'Generate with AI']])
    expect(useRegistry.getState().commands.some((c) => c.id === 'mindroot.ai:generate')).toBe(true)
  })

  it('a topic becomes a new map that is saved and opened; only the topic is sent', async () => {
    const f = reply('Sure!\n```json\n' + MAP + '\n```')
    await setup(f)
    const before = await ids()
    useRegistry.getState().newMap[0].run()
    await settle()
    const req = useUi.getState().prompt!
    expect(req.title).toBe('New map with AI')
    const steps: string[] = []
    const problem = await req.submit!('Plan a trip to Japan', { cancelled: () => false, status: (t) => void steps.push(t) })
    expect(problem).toBeUndefined()
    // the dialog is told what happens: the model is asked, the answer is read, the map is built
    expect(steps).toEqual(['Asking m for the map…', 'Reading the answer…', 'Building the map (5 ideas)…'])

    const made = (await ids()).filter((id) => !before.includes(id))
    expect(made).toHaveLength(1)
    const doc = (await disk.load(made[0]))!
    const text = (id: string) => doc.nodes[id].text
    expect(text(doc.root)).toBe('Trip to Japan')
    expect(doc.nodes[doc.root].children.map(text)).toEqual(['Tokyo', 'Kyoto'])
    expect(doc.nodes[doc.nodes[doc.root].children[0]].children.map(text)).toEqual(['Shibuya', 'Museums'])
    expect(useUi.getState().route).toEqual({ name: 'editor', id: made[0] })

    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    const sent = JSON.parse(init.body as string)
    expect(sent.messages[1].content).toBe('Plan a trip to Japan')
    expect(String(init.body)).not.toContain('sk-test-key')
  })

  it('a bad answer, an HTTP error or a network failure makes no map and gives a message for the dialog', async () => {
    for (const f of [reply('I cannot do that.'), reply('{"title":"Only a title"}'), reply('{"error":"bad"}', 500), vi.fn(async () => { throw new Error('offline') })]) {
      await setup(f)
      const before = await ids()
      useRegistry.getState().newMap[0].run()
      await settle()
      const problem = await useUi.getState().prompt!.submit!('Topic', { cancelled: () => false, status: () => {} })
      expect(typeof problem).toBe('string')
      expect(problem).not.toContain('sk-test-key')
      expect(await ids()).toEqual(before)
      useUi.getState().prompt!.resolve(null)
    }
  })

  it('when the user cancels while the model is thinking, no map is made', async () => {
    await setup(reply(MAP))
    const before = await ids()
    useRegistry.getState().newMap[0].run()
    await settle()
    expect(await useUi.getState().prompt!.submit!('Topic', { cancelled: () => true, status: () => {} })).toBeUndefined()
    expect(await ids()).toEqual(before)
  })

  it('without an API key nothing is asked and nothing is sent', async () => {
    const f = reply(MAP)
    await setup(f, '')
    useRegistry.getState().newMap[0].run()
    await settle()
    expect(useUi.getState().prompt).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
})
