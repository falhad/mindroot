import { describe, expect, it } from 'vitest'
import { produce } from 'immer'
import { serializeDoc, parseDocText } from '../src/core/format'
import { docFromOutline, parseOutline, sanitizeDoc } from '../src/core/outline'
import * as T from '../src/core/tree'
import type { MapDoc } from '../src/core/types'
import { mergeDocs, mergeMapTexts } from '../src/sync/merge'

const base = (): MapDoc => {
  const d = docFromOutline(parseOutline('# Root\n- A\n  - A1\n  - A2\n- B\n  - B1\n- C'))
  d.meta.updatedAt = 1000
  return d
}
const id = (d: MapDoc, t: string) => Object.values(d.nodes).find((n) => n.text === t)!.id
const text = (d: MapDoc) => serializeDoc(d, () => undefined)
const edit = (d: MapDoc, at: number, fn: (x: MapDoc) => void) =>
  produce(d, (x) => {
    fn(x)
    x.meta.updatedAt = at
  })
const merge = (b: MapDoc | null, o: MapDoc, t: MapDoc) => mergeMapTexts(b ? text(b) : null, text(o), text(t))
const load = (s: string) => sanitizeDoc(parseDocText(s))
const kidsOf = (d: MapDoc, t: string) => d.nodes[id(d, t)].children.map((c) => d.nodes[c].text)

describe('merge: independent edits combine', () => {
  it('different nodes edited on each side: both edits survive, no conflicts', () => {
    const b = base()
    const o = edit(b, 2000, (x) => void (x.nodes[id(x, 'A1')].text = 'A1 ours'))
    const t = edit(b, 3000, (x) => void (x.nodes[id(x, 'B1')].notes = 'note from theirs'))
    const r = merge(b, o, t)
    const d = load(r.text)
    expect(d.nodes[id(b, 'A1')].text).toBe('A1 ours')
    expect(d.nodes[id(b, 'B1')].notes).toBe('note from theirs')
    expect(r.conflicts).toBe(0)
    expect(d.meta.updatedAt).toBe(3000)
  })

  it('different fields of the same node merge field by field', () => {
    const b = base()
    const o = edit(b, 2000, (x) => void (x.nodes[id(x, 'A')].color = '4'))
    const t = edit(b, 3000, (x) => void (x.nodes[id(x, 'A')].icon = 'emoji:🚀'))
    const r = merge(b, o, t)
    const n = load(r.text).nodes[id(b, 'A')]
    expect([n.color, n.icon, r.conflicts]).toEqual(['4', 'emoji:🚀', 0])
  })

  it('both sides add a child under the same parent: both children are kept', () => {
    const b = base()
    const o = edit(b, 2000, (x) => void T.addChild(x, id(x, 'B'), 'from ours'))
    const t = edit(b, 3000, (x) => void T.addChild(x, id(x, 'B'), 'from theirs'))
    const r = merge(b, o, t)
    expect(kidsOf(load(r.text), 'B').sort()).toEqual(['B1', 'from ours', 'from theirs'])
    expect(r.conflicts).toBe(0)
  })

  it('adds, removals and reorders in children lists combine', () => {
    const b = base()
    const o = edit(b, 2000, (x) => void T.removeNodes(x, [id(x, 'A1')]))
    const t = edit(b, 3000, (x) => void T.addChild(x, id(x, 'A'), 'A3'))
    expect(kidsOf(load(merge(b, o, t).text), 'A')).toEqual(['A2', 'A3'])
  })

  it('a relation added on one side and a node added on the other both survive', () => {
    const b = base()
    const o = edit(b, 2000, (x) => void T.addRelation(x, id(x, 'A1'), id(x, 'C')))
    const t = edit(b, 3000, (x) => void T.addChild(x, x.root, 'D'))
    const d = load(merge(b, o, t).text)
    expect(d.relations).toHaveLength(1)
    expect(kidsOf(d, 'Root')).toContain('D')
  })

  it('merging is symmetric for independent edits', () => {
    const b = base()
    const o = edit(b, 2000, (x) => void (x.nodes[id(x, 'A')].text = 'AA'))
    const t = edit(b, 3000, (x) => void T.addChild(x, id(x, 'C'), 'C1'))
    expect(load(merge(b, o, t).text).nodes).toEqual(load(merge(b, t, o).text).nodes)
  })
})

describe('merge: overlapping edits', () => {
  it('same field changed on both sides: the newer edit wins and it is reported', () => {
    const b = base()
    const o = edit(b, 2000, (x) => void (x.nodes[id(x, 'A')].text = 'older'))
    const t = edit(b, 3000, (x) => void (x.nodes[id(x, 'A')].text = 'newer'))
    const r = merge(b, o, t)
    expect(load(r.text).nodes[id(b, 'A')].text).toBe('newer')
    expect(r.conflicts).toBe(1)
    expect(load(merge(b, t, o).text).nodes[id(b, 'A')].text).toBe('newer')
  })

  it('edited on one side, deleted on the other: the edit is kept', () => {
    const b = base()
    const o = edit(b, 2000, (x) => void T.removeNodes(x, [id(x, 'B1')]))
    const t = edit(b, 3000, (x) => void (x.nodes[id(x, 'B1')].text = 'B1 edited'))
    const d = load(merge(b, o, t).text)
    expect(kidsOf(d, 'B')).toEqual(['B1 edited'])
  })

  it('deleted on one side, untouched on the other: it stays deleted', () => {
    const b = base()
    const o = edit(b, 2000, (x) => void T.removeNodes(x, [id(x, 'A')]))
    const d = load(merge(b, o, b).text)
    expect(Object.values(d.nodes).map((n) => n.text).sort()).toEqual(['B', 'B1', 'C', 'Root'])
  })

  it('moved on both sides to different parents: one parent wins and the tree stays valid', () => {
    const b = base()
    const o = edit(b, 2000, (x) => void T.moveNode(x, id(x, 'A1'), id(x, 'B')))
    const t = edit(b, 3000, (x) => void T.moveNode(x, id(x, 'A1'), id(x, 'C')))
    const d = load(merge(b, o, t).text)
    expect(d.nodes[id(b, 'A1')].parentId).toBe(id(b, 'C'))
    expect(kidsOf(d, 'B')).not.toContain('A1')
    expect(Object.keys(d.nodes)).toHaveLength(7)
  })

  it('concurrent moves that would form a cycle lose no nodes', () => {
    const b = base()
    const o = edit(b, 2000, (x) => void T.moveNode(x, id(x, 'A'), id(x, 'B'))) // A under B
    const t = edit(b, 3000, (x) => void T.moveNode(x, id(x, 'B'), id(x, 'A'))) // B under A
    const r = merge(b, o, t)
    const d = load(r.text)
    expect(Object.keys(d.nodes)).toHaveLength(7)
    expect(r.rescued).toBeGreaterThan(0)
    // every node is reachable from the root
    const seen = new Set<string>()
    const walk = (i: string) => { seen.add(i); d.nodes[i].children.forEach(walk) }
    walk(d.root)
    expect(seen.size).toBe(7)
  })

  it('layout changed on both sides: the newer one wins', () => {
    const b = base()
    const o = edit(b, 2000, (x) => void (x.layout = 'right'))
    const t = edit(b, 3000, (x) => void (x.layout = 'radial'))
    expect(load(merge(b, o, t).text).layout).toBe('radial')
  })
})

describe('merge: edge cases', () => {
  it('no common ancestor: nodes from both sides are kept; on a differing field the newer file wins', () => {
    const b = base()
    const o = edit(b, 2000, (x) => void (x.nodes[id(x, 'A')].text = 'ours'))
    const t = edit(b, 3000, (x) => void T.addChild(x, x.root, 'extra'))
    const r = merge(null, o, t)
    const d = load(r.text)
    expect(kidsOf(d, 'Root')).toContain('extra')
    expect(d.nodes[id(b, 'A')].text).toBe('A') // without a base we cannot tell who edited it; the newer file decides
    expect(r.conflicts).toBeGreaterThan(0)
  })

  it('identical sides merge to the same map', () => {
    const b = base()
    const r = merge(b, b, b)
    expect(load(r.text).nodes).toEqual(b.nodes)
    expect(r.conflicts).toBe(0)
  })

  it('never changes the map id and recomputes the title and count', () => {
    const b = base()
    const o = edit(b, 2000, (x) => void T.setText(x, x.root, 'New title'))
    const t = edit(b, 3000, (x) => void T.addChild(x, x.root, 'D'))
    const d = load(merge(b, o, t).text)
    expect(d.meta.id).toBe(b.meta.id)
    expect(d.meta.title).toBe('New title')
    expect(d.meta.nodeCount).toBe(8)
  })

  it('images match by file, so an unchanged image is not a conflict', () => {
    const b = produce(base(), (x) => {
      ;(x.nodes[id(x, 'A')] as any).image = { asset: 'a'.repeat(64) + '.png', w: 1, h: 1 }
    })
    const o = edit(b, 2000, (x) => void (x.nodes[id(x, 'A')].text = 'A!'))
    const t = edit(b, 3000, (x) => void (x.nodes[id(x, 'B')].text = 'B!'))
    const r = mergeDocs(parseDocText(text(b)), parseDocText(text(o)), parseDocText(text(t)))
    expect(r.conflicts).toBe(0)
    expect((r.doc.nodes[id(b, 'A')] as any).image.asset).toMatch(/^a{64}\.png$/)
  })

  it('merged output is valid, stable and has one record per line', () => {
    const b = base()
    const o = edit(b, 2000, (x) => void T.addChild(x, id(x, 'A'), 'x'))
    const t = edit(b, 3000, (x) => void T.addChild(x, id(x, 'A'), 'y'))
    const r = merge(b, o, t)
    expect(r.text.trim().split('\n').length).toBe(1 + 9)
    expect(mergeMapTexts(r.text, r.text, r.text).text).toBe(r.text)
  })
})
