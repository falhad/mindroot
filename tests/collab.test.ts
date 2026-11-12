import * as Y from 'yjs'
import { describe, expect, it } from 'vitest'
import { docFromOutline, parseOutline } from '../src/core/outline'
import * as T from '../src/core/tree'
import type { MapDoc } from '../src/core/types'
import { applyDocToY, docToY, yToDoc, LOCAL } from '../src/plugins/builtin/collab/bind'
import { between } from '../src/plugins/builtin/collab/order'

const sample = () => docFromOutline(parseOutline('# Root\n- A\n  - A1\n  - A2\n- B\n- C'))
const id = (d: MapDoc, t: string) => Object.values(d.nodes).find((n) => n.text === t)!.id
const texts = (d: MapDoc) => T.orderedIds(d).map((i) => d.nodes[i].text)
/** Send everything one doc knows to another (as the relay would). */
const sync = (a: Y.Doc, b: Y.Doc) => {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)), 'remote')
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)), 'remote')
}
/** Two peers that start from the same map. */
const pair = () => {
  const d = sample()
  const a = new Y.Doc()
  docToY(a, d)
  const b = new Y.Doc()
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a), 'remote')
  return { d, a, b }
}
const read = (y: Y.Doc, base: MapDoc) => yToDoc(y, base.meta)

describe('fractional order keys', () => {
  it('between() gives a key strictly between its neighbours, many times over', () => {
    const keys: string[] = []
    let k: string | null = null
    for (let i = 0; i < 200; i++) {
      k = between(k, null) // append
      keys.push(k)
    }
    expect([...keys].sort()).toEqual(keys)
    // insert in the middle repeatedly (the worst case for key growth)
    let lo = keys[10]
    const hi = keys[11]
    for (let i = 0; i < 100; i++) {
      const m = between(lo, hi)
      expect(m > lo && m < hi).toBe(true)
      lo = m
    }
    expect(between(null, keys[0]) < keys[0]).toBe(true)
    expect(() => between('b', 'a')).toThrow()
  })

  it('random insertions keep a total order', () => {
    const list: string[] = []
    let seed = 7
    const rnd = (n: number) => (seed = (seed * 16807) % 2147483647) % n
    for (let i = 0; i < 400; i++) {
      const at = rnd(list.length + 1)
      list.splice(at, 0, between(list[at - 1] ?? null, list[at] ?? null))
    }
    expect([...list].sort()).toEqual(list)
    expect(new Set(list).size).toBe(list.length)
  })
})

describe('Yjs binding', () => {
  it('docToY / yToDoc roundtrip the map content', () => {
    const d = sample()
    d.nodes[id(d, 'A')].notes = 'note'
    d.nodes[id(d, 'A')].tags = ['x']
    d.nodes[id(d, 'B')].due = '2026-12-01'
    T.addRelation(d, id(d, 'A1'), id(d, 'C'))
    d.relations[0].label = 'link'
    T.groupSiblings(d, [id(d, 'B'), id(d, 'C')], 'Pair')
    T.summarize(d, [id(d, 'A'), id(d, 'B')], 'AB')
    T.addFloat(d, 5, 6, 'Loose')
    d.layout = 'right'
    d.font = 'serif'
    d.customTheme = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', '#888888']
    const y = new Y.Doc()
    docToY(y, d)
    const back = read(y, d)
    expect(back.nodes).toEqual(d.nodes)
    expect(back.relations).toEqual(d.relations)
    expect(back.groups).toEqual(d.groups)
    expect(back.summaries).toEqual(d.summaries)
    expect([back.layout, back.font, back.customTheme, back.root]).toEqual([d.layout, d.font, d.customTheme, d.root])
  })

  it('a local edit reaches the other peer, and only the changed field travels', () => {
    const { d, a, b } = pair()
    const next = structuredClone(d)
    next.nodes[id(d, 'B')].text = 'B edited'
    const sizeBefore = Y.encodeStateAsUpdate(a).length
    applyDocToY(a, d, next, LOCAL)
    sync(a, b)
    expect(read(b, d).nodes[id(d, 'B')].text).toBe('B edited')
    expect(read(b, d).nodes[id(d, 'C')].text).toBe('C')
    expect(Y.encodeStateAsUpdate(a).length - sizeBefore).toBeLessThan(80)
  })

  it('concurrent child adds under the same parent converge to the same order on both peers', () => {
    const { d, a, b } = pair()
    const na = structuredClone(d)
    T.addChild(na, id(d, 'B'), 'from A')
    const nb = structuredClone(d)
    T.addChild(nb, id(d, 'B'), 'from B')
    applyDocToY(a, d, na, LOCAL)
    applyDocToY(b, d, nb, LOCAL)
    sync(a, b)
    const ra = read(a, d)
    const rb = read(b, d)
    expect(texts(ra)).toEqual(texts(rb))
    expect(ra.nodes[id(d, 'B')].children.map((c) => ra.nodes[c].text).sort()).toEqual(['from A', 'from B'])
  })

  it('reordering and moving survive the round trip; siblings keep their order', () => {
    const { d, a, b } = pair()
    const next = structuredClone(d)
    T.reorderNode(next, id(d, 'C'), -1)
    T.moveNode(next, id(d, 'A2'), id(d, 'B'))
    applyDocToY(a, d, next, LOCAL)
    sync(a, b)
    expect(texts(read(b, d))).toEqual(texts(next))
  })

  it('concurrent moves that would form a loop never produce a loop (the result is a valid tree)', () => {
    const { d, a, b } = pair()
    const na = structuredClone(d)
    T.moveNode(na, id(d, 'A'), id(d, 'B')) // A under B
    const nb = structuredClone(d)
    T.moveNode(nb, id(d, 'B'), id(d, 'A')) // B under A
    applyDocToY(a, d, na, LOCAL)
    applyDocToY(b, d, nb, LOCAL)
    sync(a, b)
    const ra = read(a, d)
    const rb = read(b, d)
    for (const r of [ra, rb]) {
      expect(Object.keys(r.nodes).sort()).toEqual(Object.keys(d.nodes).sort()) // nothing lost
      expect(T.orderedIds(r).length).toBe(Object.keys(d.nodes).length) // everything reachable from the root
    }
    expect(texts(ra)).toEqual(texts(rb))
  })

  it('deleting on one peer and editing the deleted node on another does not crash and both converge', () => {
    const { d, a, b } = pair()
    const na = structuredClone(d)
    T.removeNodes(na, [id(d, 'A')])
    const nb = structuredClone(d)
    nb.nodes[id(d, 'A1')].text = 'A1 edited'
    applyDocToY(a, d, na, LOCAL)
    applyDocToY(b, d, nb, LOCAL)
    sync(a, b)
    expect(texts(read(a, d))).toEqual(texts(read(b, d)))
  })

  it('offline edits on both sides merge after the updates are exchanged', () => {
    const { d, a, b } = pair()
    const na = structuredClone(d)
    na.nodes[id(d, 'A')].text = 'A offline'
    T.addChild(na, id(d, 'C'), 'c1')
    const nb = structuredClone(d)
    nb.nodes[id(d, 'B')].notes = 'b note'
    nb.layout = 'down'
    applyDocToY(a, d, na, LOCAL)
    applyDocToY(b, d, nb, LOCAL)
    sync(a, b)
    const r = read(a, d)
    expect(r.nodes[id(d, 'A')].text).toBe('A offline')
    expect(r.nodes[id(d, 'B')].notes).toBe('b note')
    expect(r.layout).toBe('down')
    expect(texts(r)).toContain('c1')
    expect(texts(r)).toEqual(texts(read(b, d)))
  })

  it('a removed field is removed on the other peer too', () => {
    const { d, a, b } = pair()
    const n1 = structuredClone(d)
    n1.nodes[id(d, 'A')].notes = 'x'
    applyDocToY(a, d, n1, LOCAL)
    sync(a, b)
    const n2 = structuredClone(n1)
    delete n2.nodes[id(d, 'A')].notes
    applyDocToY(a, n1, n2, LOCAL)
    sync(a, b)
    expect(read(b, d).nodes[id(d, 'A')].notes).toBeUndefined()
  })

  it('undo undoes only the local edits, not a remote peer’s', () => {
    const { d, a, b } = pair()
    const um = new Y.UndoManager([a.getMap('nodes'), a.getMap('meta')], { trackedOrigins: new Set([LOCAL]), captureTimeout: 0 })
    const mine = structuredClone(d)
    mine.nodes[id(d, 'B')].text = 'B mine'
    applyDocToY(a, d, mine, LOCAL)
    // a remote peer adds a node AFTER my edit
    const theirs = structuredClone(d)
    T.addChild(theirs, id(d, 'C'), 'theirs')
    applyDocToY(b, d, theirs, LOCAL)
    sync(a, b)
    expect(texts(read(a, d))).toContain('theirs')
    um.undo()
    const r = read(a, d)
    expect(r.nodes[id(d, 'B')].text).toBe('B') // my edit is undone
    expect(texts(r)).toContain('theirs') // theirs stays
  })

  it('a doc with no content is detected as empty', async () => {
    const { isEmptyY } = await import('../src/plugins/builtin/collab/bind')
    expect(isEmptyY(new Y.Doc())).toBe(true)
    const y = new Y.Doc()
    docToY(y, sample())
    expect(isEmptyY(y)).toBe(false)
  })
})

describe('invites and room names', async () => {
  const { encodeInvite, decodeInvite } = await import('../src/plugins/builtin/collab/invite')
  const { roomName, roomToken } = await import('../src/plugins/builtin/collab/crypto')
  const { createHmac } = await import('node:crypto')
  const secret = 'abcdefghijklmnop0123456789'
  const room = 'a'.repeat(40)
  const token = 'b'.repeat(64)
  const make = (o: object) => 'mindroot-invite:' + btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const ok = { s: 'wss://relay.example.com', r: room, k: token, m: 'map1', t: 'x' }

  it('an invite survives encode and decode, including a Persian title', () => {
    const text = encodeInvite({ serverUrl: 'wss://relay.example.com', room, token, mapId: 'map_1-x', title: 'نقشه من' })
    expect(text.startsWith('mindroot-invite:')).toBe(true)
    expect(decodeInvite(`  ${text}\n`)).toEqual({ serverUrl: 'wss://relay.example.com', room, token, mapId: 'map_1-x', title: 'نقشه من' })
  })

  it('an invite never contains the master secret: only one room and that room’s token', () => {
    const r = await_room()
    function await_room() {
      return encodeInvite({ serverUrl: 'wss://relay.example.com', room, token, mapId: 'm', title: '' })
    }
    const body = atob(r.slice('mindroot-invite:'.length).replace(/-/g, '+').replace(/_/g, '/'))
    expect(Object.keys(JSON.parse(body)).sort()).toEqual(['k', 'm', 'r', 's', 't'])
    expect(body).not.toContain(secret)
  })

  it('rejects text that is not an invite or has unsafe or invalid parts', () => {
    expect(decodeInvite(make(ok))).not.toBeNull()
    expect(decodeInvite('hello')).toBeNull()
    expect(decodeInvite('mindroot-invite:%%%')).toBeNull()
    expect(decodeInvite(make({ ...ok, s: 'ws://relay.example.com' }))).toBeNull() // plain ws only for this computer
    expect(decodeInvite(make({ ...ok, s: 'ws://localhost:8787' }))).not.toBeNull()
    expect(decodeInvite(make({ ...ok, s: 'https://relay.example.com' }))).toBeNull()
    expect(decodeInvite(make({ ...ok, r: 'short' }))).toBeNull()
    expect(decodeInvite(make({ ...ok, r: 'A'.repeat(40) }))).toBeNull()
    expect(decodeInvite(make({ ...ok, k: 'short' }))).toBeNull()
    expect(decodeInvite(make({ ...ok, k: 'g'.repeat(64) }))).toBeNull()
    expect(decodeInvite(make({ ...ok, m: '../x' }))).toBeNull()
    expect(decodeInvite(make({ ...ok, m: '' }))).toBeNull()
    expect(decodeInvite('mindroot-invite:' + 'A'.repeat(5000))).toBeNull()
  })

  it('room names and tokens match what the relay computes with Node’s HMAC', async () => {
    const r = await roomName(secret, 'map-42')
    expect(r).toBe(createHmac('sha256', secret).update('room:map-42').digest('hex').slice(0, 40))
    expect(r).toMatch(/^[0-9a-f]{40}$/)
    expect(await roomToken(secret, r)).toBe(createHmac('sha256', secret).update(`token:${r}`).digest('hex'))
    expect(await roomName(secret, 'other')).not.toBe(r)
    expect(await roomName('different-secret-0123456789', 'map-42')).not.toBe(r)
  })
})
