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

const { appendToInbox, getInboxName, setInboxName } = await import('../src/state/capture')
const { closeDoc, commit, openDoc, undo, useDoc } = await import('../src/state/doc')
const T = await import('../src/core/tree')

const texts = (d: MapDoc) => d.nodes[d.root].children.map((c) => d.nodes[c].text)
const inbox = () => [...mem.values()].find((d) => d.meta.title === getInboxName())

beforeEach(() => {
  mem.clear()
  closeDoc()
  localStorage.clear()
})

describe('quick capture', () => {
  it('creates the Inbox map on first use', async () => {
    await appendToInbox('Call the bank')
    expect(inbox()).toBeDefined()
    expect(texts(inbox()!)).toEqual(['Call the bank'])
  })

  it('appends to the existing Inbox in order', async () => {
    await appendToInbox('one')
    await appendToInbox('two')
    expect(mem.size).toBe(1)
    expect(texts(inbox()!)).toEqual(['one', 'two'])
  })

  it('two quick captures at the same time both land, and only one Inbox is made', async () => {
    await Promise.all([appendToInbox('a'), appendToInbox('b'), appendToInbox('c')])
    expect(mem.size).toBe(1)
    expect(texts(inbox()!).sort()).toEqual(['a', 'b', 'c'])
  })

  it('a map in the trash is not used as the Inbox', async () => {
    await appendToInbox('first')
    const d = inbox()!
    d.meta.trashedAt = Date.now()
    mem.set(d.meta.id, d)
    await appendToInbox('second')
    expect(mem.size).toBe(2)
  })

  it('blank text is ignored', async () => {
    await appendToInbox('   \n ')
    expect(mem.size).toBe(0)
  })

  it('uses the Inbox name from the settings', async () => {
    setInboxName('Ideas to sort')
    await appendToInbox('x')
    expect(inbox()!.meta.title).toBe('Ideas to sort')
    expect(getInboxName()).toBe('Ideas to sort')
    setInboxName('   ')
    expect(getInboxName()).toBe('Inbox') // an empty name falls back to the default
  })

  it('adds to the Inbox while it is open as one undo step', async () => {
    await appendToInbox('first')
    const open = structuredClone(inbox()!)
    openDoc(open)
    const before = useDoc.getState().past.length
    await appendToInbox('second')
    const s = useDoc.getState()
    expect(texts(s.doc!)).toEqual(['first', 'second'])
    expect(s.past.length).toBe(before + 1)
    expect(s.saveState).toBe('dirty') // autosave will write it
    undo()
    expect(texts(useDoc.getState().doc!)).toEqual(['first'])
    expect(mem.get(open.meta.id)).toBeDefined()
  })

  it('does not disturb another open map', async () => {
    const other = T.createDoc('Other')
    other.meta.id = 'other-map'
    mem.set(other.meta.id, other)
    openDoc(structuredClone(other))
    commit((d) => void T.addChild(d, d.root, 'mine'))
    await appendToInbox('note')
    expect(texts(useDoc.getState().doc!)).toEqual(['mine'])
    expect(texts(inbox()!)).toEqual(['note'])
  })
})
