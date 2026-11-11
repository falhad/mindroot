// @vitest-environment node
import { createHmac } from 'node:crypto'
import { mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
// @ts-expect-error the relay is plain JavaScript
import { createRelay } from '../server/relay/src/index.js'

const SECRET = 'test-secret-0123456789'
const room = (n: string) => createHmac('sha256', SECRET).update(`room:${n}`).digest('hex').slice(0, 40)
const token = (r: string, secret = SECRET) => createHmac('sha256', secret).update(`token:${r}`).digest('hex')

let dir: string
let relay: { port: number; close(): Promise<void> }
const providers: WebsocketProvider[] = []

const open = (r: string, tok = token(r), doc = new Y.Doc()) => {
  const p = new WebsocketProvider(`ws://127.0.0.1:${relay.port}`, r, doc, { params: { token: tok }, WebSocketPolyfill: WebSocket as never, disableBc: true })
  providers.push(p)
  return { doc, p }
}
const synced = (p: WebsocketProvider) => new Promise<void>((res) => (p.synced ? res() : p.once('sync', () => res())))
const until = async (fn: () => boolean, ms = 4000) => {
  const t = Date.now()
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 15))
  }
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bm-relay-'))
  relay = await createRelay({ secret: SECRET, dataDir: dir, port: 0, host: '127.0.0.1', saveDelayMs: 50, idleMs: 100 })
})
afterEach(() => {
  while (providers.length) providers.pop()!.destroy()
})
afterAll(async () => {
  await relay.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('relay server', () => {
  it('two clients in the same room see each other’s edits', async () => {
    const r = room('m1')
    const a = open(r)
    const b = open(r)
    await Promise.all([synced(a.p), synced(b.p)])
    a.doc.getMap('nodes').set('x', 'from A')
    await until(() => b.doc.getMap('nodes').get('x') === 'from A')
    b.doc.getMap('nodes').set('y', 'from B')
    await until(() => a.doc.getMap('nodes').get('y') === 'from B')
  })

  it('rooms are separate', async () => {
    const a = open(room('sep1'))
    const b = open(room('sep2'))
    await Promise.all([synced(a.p), synced(b.p)])
    a.doc.getMap('nodes').set('only-a', 1)
    await new Promise((r) => setTimeout(r, 200))
    expect(b.doc.getMap('nodes').get('only-a')).toBeUndefined()
  })

  it('a client that joins later gets the existing content', async () => {
    const r = room('late')
    const a = open(r)
    await synced(a.p)
    a.doc.getMap('nodes').set('k', 'v')
    await new Promise((res) => setTimeout(res, 100))
    const b = open(r)
    await synced(b.p)
    expect(b.doc.getMap('nodes').get('k')).toBe('v')
  })

  it('awareness (who is here, what they selected) is shared', async () => {
    const r = room('aware')
    const a = open(r)
    const b = open(r)
    await Promise.all([synced(a.p), synced(b.p)])
    a.p.awareness.setLocalStateField('user', { name: 'Ann' })
    await until(() => [...b.p.awareness.getStates().values()].some((s) => (s as { user?: { name: string } }).user?.name === 'Ann'))
  })

  it('a wrong token is refused with close code 4401 and no data flows', async () => {
    const r = room('secure')
    const good = open(r)
    await synced(good.p)
    good.doc.getMap('nodes').set('secret', 'data')
    const codes: number[] = []
    const bad = open(r, token(r, 'another-secret-value-123'))
    bad.p.on('connection-close', (e: CloseEvent | null) => e && codes.push(e.code))
    await until(() => codes.length > 0)
    expect(codes[0]).toBe(4401)
    expect(bad.doc.getMap('nodes').get('secret')).toBeUndefined()
    bad.p.destroy()
  })

  it('a room name that is not 40 hex characters is refused', async () => {
    const codes: number[] = []
    const bad = open('not-a-room', token('not-a-room'))
    bad.p.on('connection-close', (e: CloseEvent | null) => e && codes.push(e.code))
    await until(() => codes.length > 0)
    expect([4400, 4401]).toContain(codes[0])
  })

  it('an update bigger than the limit closes that connection and does not reach other clients', async () => {
    const r = room('big')
    const a = open(r)
    const b = open(r)
    await Promise.all([synced(a.p), synced(b.p)])
    a.doc.getMap('nodes').set('huge', 'x'.repeat(11 * 1024 * 1024))
    await new Promise((res) => setTimeout(res, 400))
    expect(b.doc.getMap('nodes').get('huge')).toBeUndefined()
    // the room still works for the others
    b.doc.getMap('nodes').set('after', 1)
    const c = open(r)
    await synced(c.p)
    expect(c.doc.getMap('nodes').get('after')).toBe(1)
  })

  it('content survives a relay restart (saved to disk)', async () => {
    const r = room('persist')
    const a = open(r)
    await synced(a.p)
    a.doc.getMap('nodes').set('keep', 'me')
    await new Promise((res) => setTimeout(res, 400)) // saved after 50 ms
    a.p.destroy()
    await relay.close()
    expect(readdirSync(dir).some((f) => f.startsWith(r))).toBe(true)
    relay = await createRelay({ secret: SECRET, dataDir: dir, port: 0, host: '127.0.0.1', saveDelayMs: 50, idleMs: 100 })
    const b = open(r)
    await synced(b.p)
    expect(b.doc.getMap('nodes').get('keep')).toBe('me')
  })
})

describe('relay limits', () => {
  it('refuses the 21st client in one room and the 51st room (close code 4429)', async () => {
    const lim = await createRelay({ secret: SECRET, dataDir: mkdtempSync(join(tmpdir(), 'bm-lim-')), port: 0, host: '127.0.0.1', maxRooms: 3, maxClientsPerRoom: 2, saveDelayMs: 50, idleMs: 100 })
    const connect = (r: string) =>
      new Promise<number>((res) => {
        const ws = new WebSocket(`ws://127.0.0.1:${lim.port}/${r}?token=${token(r)}`)
        const timer = setTimeout(() => res(0), 600) // still open: accepted
        ws.on('close', (c) => { clearTimeout(timer); res(c) })
        ws.on('open', () => void 0)
        socks.push(ws)
      })
    const socks: WebSocket[] = []
    expect(await connect(room('l1'))).toBe(0)
    expect(await connect(room('l1'))).toBe(0)
    expect(await connect(room('l1'))).toBe(4429) // 3rd client in a room that allows 2
    expect(await connect(room('l2'))).toBe(0)
    expect(await connect(room('l3'))).toBe(0)
    expect(await connect(room('l4'))).toBe(4429) // 4th room where 3 are allowed
    socks.forEach((s) => s.terminate())
    await lim.close()
  })

  it('answers /healthz and refuses a missing secret at start', async () => {
    const res = await fetch(`http://127.0.0.1:${relay.port}/healthz`)
    expect(res.status).toBe(200)
    await expect(createRelay({ secret: 'short', dataDir: dir, port: 0 })).rejects.toThrow(/SECRET/)
  })
})
