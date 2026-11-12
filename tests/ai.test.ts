import { beforeEach, describe, expect, it, vi } from 'vitest'
import { branchOutline, expandMessages } from '../src/plugins/builtin/ai/prompts'
import { buildRequest, chat, parseAiJson, parseItems, parseResponse, type AiConfig } from '../src/plugins/builtin/ai/client'
import { docFromOutline, parseOutline } from '../src/core/outline'
import type { MapDoc } from '../src/core/types'

const openai: AiConfig = { kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1/', model: 'some/model', timeoutMs: 30000 }
const anthropic: AiConfig = { kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-x', timeoutMs: 30000 }
const msgs = [{ role: 'system' as const, content: 'sys' }, { role: 'user' as const, content: 'hi' }]

describe('AI client: requests', () => {
  it('openai-compatible: bearer key, chat path (trailing slash removed), model and messages in the body', () => {
    const r = buildRequest(openai, 'sk-secret', msgs)
    expect(r.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(r.method).toBe('POST')
    expect(r.headers).toMatchObject({ Authorization: 'Bearer sk-secret', 'Content-Type': 'application/json' })
    expect(JSON.parse(r.body!)).toMatchObject({ model: 'some/model', messages: msgs })
    expect(r.timeoutMs).toBe(30000)
  })

  it('anthropic-compatible: x-api-key and version header, system prompt separate, max_tokens set', () => {
    const r = buildRequest(anthropic, 'ak-secret', msgs)
    expect(r.url).toBe('https://api.anthropic.com/v1/messages')
    expect(r.headers).toMatchObject({ 'x-api-key': 'ak-secret', 'anthropic-version': '2023-06-01' })
    expect(r.headers).not.toHaveProperty('Authorization')
    const body = JSON.parse(r.body!)
    expect(body).toMatchObject({ model: 'claude-x', system: 'sys', messages: [{ role: 'user', content: 'hi' }] })
    expect(body.max_tokens).toBeGreaterThan(100)
  })

  it('a base address that already ends in /v1 is not doubled', () => {
    expect(buildRequest({ ...anthropic, baseUrl: 'https://proxy.example/v1' }, 'k', msgs).url).toBe('https://proxy.example/v1/messages')
    expect(buildRequest({ ...openai, baseUrl: 'https://api.openai.com/v1' }, 'k', msgs).url).toBe('https://api.openai.com/v1/chat/completions')
  })

  it('rejects a base address that is not http(s)', () => {
    expect(() => buildRequest({ ...openai, baseUrl: 'ftp://x' }, 'k', msgs)).toThrow(/address/i)
    expect(() => buildRequest({ ...openai, baseUrl: '' }, 'k', msgs)).toThrow(/address/i)
  })
})

describe('AI client: responses', () => {
  it('reads openai-style text, including content given as parts', () => {
    expect(parseResponse('openai', JSON.stringify({ choices: [{ message: { content: 'hello' } }] }))).toBe('hello')
    expect(parseResponse('openai', JSON.stringify({ choices: [{ message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } }] }))).toBe('ab')
  })

  it('reads anthropic-style text blocks and skips other block types', () => {
    expect(parseResponse('anthropic', JSON.stringify({ content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'hi ' }, { type: 'text', text: 'there' }] }))).toBe('hi there')
  })

  it('reads a streamed reply (server-sent events) from either format', () => {
    const oa = ['data: {"choices":[{"delta":{"role":"assistant","content":"{\\"te"}}]}', '', 'data: {"choices":[{"delta":{"content":"xt\\":\\"ok\\"}"}}]}', '', 'data: [DONE]', ''].join('\n')
    expect(parseResponse('openai', oa)).toBe('{"text":"ok"}')
    const an = ['event: content_block_delta', 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hel"}}', '', 'event: content_block_delta', 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}', ''].join('\n')
    expect(parseResponse('anthropic', an)).toBe('hello')
    expect(() => parseResponse('openai', 'data: [DONE]\n')).toThrow(/nothing/)
  })

  it('asks for a normal (not streamed) reply', () => {
    expect(JSON.parse(buildRequest(openai, 'k', msgs).body!).stream).toBe(false)
    expect(JSON.parse(buildRequest(anthropic, 'k', msgs).body!).stream).toBe(false)
  })

  it('an unreadable reply shows its first words (without the key) so the cause can be seen', async () => {
    const html = { request: async () => ({ status: 200, body: '<html><body>Open the dashboard: sk-secret </body></html>' }) }
    const err = (await chat(openai, 'sk-secret', msgs, html).catch((e: unknown) => e)) as Error
    expect(err.message).toMatch(/understand/)
    expect(err.message).toContain('<html>')
    expect(err.message).not.toContain('sk-secret')
    expect(err.message.length).toBeLessThan(260)
  })

  it('an empty or malformed reply is an error, not an empty string', () => {
    expect(() => parseResponse('openai', JSON.stringify({ choices: [] }))).toThrow(/nothing|empty/i)
    expect(() => parseResponse('anthropic', '{"content":[]}')).toThrow(/nothing|empty/i)
    expect(() => parseResponse('openai', 'not json')).toThrow(/understand|reply/i)
  })

  it('chat() returns the text, turns HTTP errors into readable messages, and never puts the key in them', async () => {
    const ok = { request: vi.fn(async () => ({ status: 200, body: JSON.stringify({ choices: [{ message: { content: 'yes' } }] }) })) }
    expect(await chat(openai, 'sk-secret', msgs, ok)).toBe('yes')
    const bad = { request: async () => ({ status: 401, body: JSON.stringify({ error: { message: 'Invalid key sk-secret' } }) }) }
    const err = (await chat(openai, 'sk-secret', msgs, bad).catch((e: unknown) => e)) as Error
    expect(err.message).toMatch(/401/)
    expect(err.message).not.toContain('sk-secret')
    const limited = { request: async () => ({ status: 429, body: 'slow down' }) }
    await expect(chat(openai, 'k', msgs, limited)).rejects.toThrow(/429/)
    await expect(chat(openai, '', msgs, ok)).rejects.toThrow(/key/i)
  })
})

describe('parseAiJson and parseItems', () => {
  it('reads fenced JSON, JSON with prose around it, and nested braces', () => {
    expect(parseAiJson('```json\n{"items":["a","b"]}\n```')).toEqual({ items: ['a', 'b'] })
    expect(parseAiJson('Sure! Here you go: {"text":"a {b} c"} Hope it helps.')).toEqual({ text: 'a {b} c' })
  })

  it('returns null for prose, empty text and broken JSON', () => {
    expect(parseAiJson('I cannot do that.')).toBeNull()
    expect(parseAiJson('')).toBeNull()
    expect(parseAiJson('{"items": [')).toBeNull()
  })

  it('parseItems keeps short non-empty strings, removes duplicates, and caps the list', () => {
    expect(parseItems({ items: [' one ', 'one', '', 5, 'two', 'x'.repeat(400)] })).toEqual(['one', 'two', 'x'.repeat(200)])
    expect(parseItems({ items: Array.from({ length: 30 }, (_, i) => `i${i}`) })).toHaveLength(12)
    expect(parseItems({ text: 'x' })).toBeNull()
    expect(parseItems(null)).toBeNull()
    expect(parseItems({ items: [] })).toBeNull()
  })
})

describe('AI prompts', () => {
  const doc = (): MapDoc => docFromOutline(parseOutline('# Root\n- Secret branch\n  - Hidden leaf\n- Topic\n  - Sub one\n  - Sub two'))
  const id = (d: MapDoc, t: string) => Object.values(d.nodes).find((n) => n.text === t)!.id

  it('sends only the selected branch, not the rest of the map', () => {
    const d = doc()
    const text = JSON.stringify(expandMessages(d, id(d, 'Topic')))
    expect(text).toContain('Topic')
    expect(text).toContain('Sub one')
    expect(text).not.toContain('Secret branch')
    expect(text).not.toContain('Hidden leaf')
  })

  it('includes the path to the node as context (ancestor titles), without sibling branches', () => {
    const d = doc()
    const text = JSON.stringify(expandMessages(d, id(d, 'Sub one')))
    expect(text).toContain('Root')
    expect(text).toContain('Topic')
    expect(text).not.toContain('Sub two')
  })

  it('caps the branch at 200 ideas and says that it was cut', () => {
    const lines = ['# Big', '- Branch']
    for (let i = 0; i < 300; i++) lines.push(`  - leaf ${i}`)
    const d = docFromOutline(parseOutline(lines.join('\n')))
    const out = branchOutline(d, id(d, 'Branch'), 200)
    expect(out.split('\n').filter((l) => l.trim()).length).toBeLessThanOrEqual(201)
    expect(out).toMatch(/more ideas not shown/)
  })

  it('asks for JSON only and for the same language as the map', () => {
    const d = doc()
    const sys = expandMessages(d, id(d, 'Topic'))[0].content
    expect(sys).toMatch(/JSON/)
    expect(sys).toMatch(/same language/i)
  })
})

describe('AI plugin in the app', async () => {
  const { startPlugins, useRegistry } = await import('../src/plugins/host')
  const { aiPlugin } = await import('../src/plugins/builtin/ai')
  const store = await import('../src/state/doc')
  const T = await import('../src/core/tree')

  const reply = (content: string, status = 200) => vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status }))
  const setup = async (fetchMock: ReturnType<typeof reply>, key = 'sk-test-key') => {
    vi.stubGlobal('fetch', fetchMock)
    useRegistry.setState({ plugins: [], commands: [], status: [], panels: [], importers: [], exporters: [], ready: false })
    await startPlugins([{ builtin: true, plugin: aiPlugin }])
    const d = docFromOutline(parseOutline('# Root\n- Topic\n- Other'))
    store.openDoc(d)
    const topic = Object.values(d.nodes).find((n) => n.text === 'Topic')!.id
    store.select([topic])
    // settings: an OpenRouter-style endpoint; the key goes to the secrets store, never to the settings
    localStorage.setItem('bm.plugin.mindroot.ai', JSON.stringify({ kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'm', timeoutMs: 5000 }))
    sessionStorage.setItem('bm.secret.mindroot.ai.apikey', key)
    const run = (cmd: string) => useRegistry.getState().commands.find((c) => c.id === `mindroot.ai:${cmd}`)!.run()
    return { d, topic, run }
  }
  const settle = () => new Promise((r) => setTimeout(r, 30))

  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals() })

  it('Expand adds the ideas under the selected node as ONE undo step', async () => {
    const { topic, run } = await setup(reply('```json\n{"items":["Idea A","Idea B","Idea C"]}\n```'))
    const before = store.useDoc.getState().past.length
    run('expand')
    await settle()
    const s = store.useDoc.getState()
    expect(s.doc!.nodes[topic].children.map((c) => s.doc!.nodes[c].text)).toEqual(['Idea A', 'Idea B', 'Idea C'])
    expect(s.past.length).toBe(before + 1)
    store.undo()
    expect(store.useDoc.getState().doc!.nodes[topic].children).toHaveLength(0)
  })

  it('a reply that is not JSON, an HTTP error, or a network failure changes nothing and tells the user', async () => {
    for (const f of [reply('I am sorry, I cannot do that.'), reply('{"error":"bad"}', 500), vi.fn(async () => { throw new Error('offline') })]) {
      const { d, run } = await setup(f as never)
      const before = store.useDoc.getState().past.length
      run('expand')
      await settle()
      expect(store.useDoc.getState().past.length).toBe(before)
      expect(Object.keys(store.useDoc.getState().doc!.nodes)).toHaveLength(Object.keys(d.nodes).length)
    }
  })

  it('without an API key nothing is sent', async () => {
    const f = reply('{"items":["x"]}')
    const { run } = await setup(f, '')
    sessionStorage.removeItem('bm.secret.mindroot.ai.apikey')
    run('expand')
    await settle()
    expect(f).not.toHaveBeenCalled()
  })

  it('the request carries only the selected branch and the key in the header', async () => {
    const f = reply('{"items":["x"]}')
    const { run } = await setup(f)
    run('expand')
    await settle()
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-key')
    expect(String(init.body)).toContain('Topic')
    expect(String(init.body)).not.toContain('Other')
  })

  it('the API key is never written into the plugin settings', async () => {
    const { run } = await setup(reply('{"items":["x"]}'))
    run('expand')
    await settle()
    for (let i = 0; i < localStorage.length; i++) expect(localStorage.getItem(localStorage.key(i)!)).not.toContain('sk-test-key')
  })

  it('Summarize writes Markdown notes on the node; Rewrite changes the text; Find gaps adds tagged ideas', async () => {
    const a = await setup(reply('{"text":"A short summary."}'))
    a.run('summarize')
    await settle()
    const n = store.useDoc.getState().doc!.nodes[a.topic]
    expect(n.notes).toBe('A short summary.')
    expect(n.notesFmt).toBe('md')

    const b = await setup(reply('{"text":"Topic, clearer"}'))
    b.run('rewrite')
    await settle()
    expect(store.useDoc.getState().doc!.nodes[b.topic].text).toBe('Topic, clearer')

    const c = await setup(reply('{"items":["Missing 1","Missing 2"]}'))
    c.run('gaps')
    await settle()
    const doc = store.useDoc.getState().doc!
    const kids = doc.nodes[c.topic].children.map((k) => doc.nodes[k])
    expect(kids.map((k) => k.text)).toEqual(['Missing 1', 'Missing 2'])
    expect(kids.every((k) => k.tags?.includes('ai-gap'))).toBe(true)
    expect(T.orderedIds(doc)).toHaveLength(5)
  })

  it('if the map is closed or the node is deleted while the model is thinking, the answer is dropped', async () => {
    let release!: () => void
    const slow = vi.fn(() => new Promise<Response>((res) => { release = () => res(new Response(JSON.stringify({ choices: [{ message: { content: '{"items":["late"]}' } }] }))) }))
    const { topic, run } = await setup(slow as never)
    run('expand')
    await settle() // the request is now waiting for the model
    store.commit((d) => void T.removeNodes(d, [topic]))
    release()
    await settle()
    expect(Object.values(store.useDoc.getState().doc!.nodes).map((x) => x.text)).not.toContain('late')
  })
})
