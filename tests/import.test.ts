import { zipSync, strToU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import { fromFreeMind } from '../src/core/import/freemind'
import { fromObsidianCanvas } from '../src/core/import/obsidian'
import { fromOpml } from '../src/core/import/opml'
import { fromXmind } from '../src/core/import/xmind'
import { sanitizeDoc } from '../src/core/outline'
import { orderedIds } from '../src/core/tree'
import type { MapDoc } from '../src/core/types'

const texts = (d: MapDoc) => orderedIds(d).map((i) => d.nodes[i].text)
const byText = (d: MapDoc, t: string) => Object.values(d.nodes).find((n) => n.text === t)!
/** An importer must give back a document that `sanitizeDoc` would not change. */
const clean = (d: MapDoc) => {
  const again = sanitizeDoc(JSON.parse(JSON.stringify(d)))
  expect(Object.keys(again.nodes).sort()).toEqual(Object.keys(d.nodes).sort())
  expect(again.root).toBe(d.root)
  expect(again.relations).toEqual(d.relations)
  expect(again.groups).toEqual(d.groups)
}

const MM = `<map version="1.0.1"><node TEXT="Plan" COLOR="#3366ff">
  <node TEXT="Phase 1" POSITION="right" FOLDED="true"><node TEXT="Task a"/><node TEXT="Task b" LINK="https://example.com/x"/></node>
  <node TEXT="Phase 2" POSITION="left"><richcontent TYPE="NOTE"><html><head/><body><p>Remember the budget</p></body></html></richcontent></node>
  <node><richcontent TYPE="NODE"><html><body><p>Rich title</p></body></html></richcontent></node>
</node></map>`

describe('FreeMind (.mm)', () => {
  it('keeps nested nodes, colours, folded state, links and notes', () => {
    const d = fromFreeMind(MM)
    expect(texts(d)).toEqual(['Plan', 'Phase 1', 'Task a', 'Task b', 'Phase 2', 'Rich title'])
    expect(d.nodes[d.root].color).toBe('#3366ff')
    expect(byText(d, 'Phase 1').collapsed).toBe(true)
    expect(byText(d, 'Task b').link).toBe('https://example.com/x')
    expect(byText(d, 'Phase 2').notes).toBe('Remember the budget')
    expect(byText(d, 'Phase 1').side).toBe('right')
    expect(byText(d, 'Phase 2').side).toBe('left')
    clean(d)
  })

  it('a link that is not http(s) is dropped', () => {
    const d = fromFreeMind('<map><node TEXT="a"><node TEXT="b" LINK="javascript:alert(1)"/></node></map>')
    expect(byText(d, 'b').link).toBeUndefined()
  })

  it('rejects files that are not FreeMind maps', () => {
    expect(() => fromFreeMind('<html></html>')).toThrow(/FreeMind/)
    expect(() => fromFreeMind('not xml at all <<<')).toThrow(/FreeMind|XML/)
    expect(() => fromFreeMind('<map></map>')).toThrow(/FreeMind/)
  })
})

describe('OPML', () => {
  const OPML = `<?xml version="1.0"?><opml version="2.0"><head><title>My outline</title></head><body>
    <outline text="Groceries &amp; more" _note="Weekly"><outline text="Milk"/><outline text="سیب"/></outline>
    <outline text="Errands"><outline text="Post office" url="https://post.example"/></outline>
  </body></opml>`

  it('reads nested outlines, entities, notes and Persian text; several top-level items get the head title as root', () => {
    const d = fromOpml(OPML)
    expect(texts(d)).toEqual(['My outline', 'Groceries & more', 'Milk', 'سیب', 'Errands', 'Post office'])
    expect(byText(d, 'Groceries & more').notes).toBe('Weekly')
    expect(byText(d, 'Post office').link).toBe('https://post.example')
    clean(d)
  })

  it('one top-level outline becomes the root', () => {
    const d = fromOpml('<opml><body><outline text="Only"><outline text="Child"/></outline></body></opml>')
    expect(texts(d)).toEqual(['Only', 'Child'])
  })

  it('rejects other XML and empty outlines', () => {
    expect(() => fromOpml('<map></map>')).toThrow(/OPML/)
    expect(() => fromOpml('<opml><body></body></opml>')).toThrow(/OPML|empty/i)
  })
})

describe('XMind', () => {
  const content = [
    {
      title: 'Sheet 1',
      rootTopic: {
        title: 'Launch',
        labels: ['q4'],
        children: {
          attached: [
            { title: 'Marketing', notes: { plain: { content: 'Budget first' } }, children: { attached: [{ title: 'Ads' }, { title: 'Email', href: 'https://mail.example' }] } },
            { title: 'Product' },
          ],
        },
      },
    },
  ]
  const zip = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])))

  it('reads the topic tree from content.json, with notes, links and labels as tags', async () => {
    const d = await fromXmind(zip({ 'content.json': JSON.stringify(content) }))
    expect(texts(d)).toEqual(['Launch', 'Marketing', 'Ads', 'Email', 'Product'])
    expect(byText(d, 'Marketing').notes).toBe('Budget first')
    expect(byText(d, 'Email').link).toBe('https://mail.example')
    expect(d.nodes[d.root].tags).toEqual(['q4'])
    clean(d)
  })

  it('reads the older content.xml format', async () => {
    const xml = `<xmap-content><sheet><topic><title>Old root</title><children><topics type="attached"><topic><title>Old child</title></topic></topics></children></topic></sheet></xmap-content>`
    const d = await fromXmind(zip({ 'content.xml': xml }))
    expect(texts(d)).toEqual(['Old root', 'Old child'])
  })

  it('rejects a zip with no map and bytes that are not a zip', async () => {
    await expect(fromXmind(zip({ 'readme.txt': 'x' }))).rejects.toThrow(/XMind/)
    await expect(fromXmind(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/XMind|zip/i)
  })
})

describe('Obsidian canvas', () => {
  const node = (id: string, text: string, x: number, y: number) => ({ id, type: 'text', text, x, y, width: 200, height: 60 })
  const canvas = (nodes: unknown[], edges: unknown[]) => JSON.stringify({ nodes, edges })

  it('turns a graph into a tree; edges that would close a loop become links', () => {
    const d = fromObsidianCanvas(
      canvas(
        [node('a', 'Start', 0, 0), node('b', 'Left', -300, 200), node('c', 'Right', 300, 200), node('d', 'Leaf', 300, 400)],
        [
          { id: 'e1', fromNode: 'a', toNode: 'b' },
          { id: 'e2', fromNode: 'a', toNode: 'c' },
          { id: 'e3', fromNode: 'c', toNode: 'd' },
          { id: 'e4', fromNode: 'd', toNode: 'a', label: 'back' },
          { id: 'e5', fromNode: 'b', toNode: 'd', label: 'also' },
        ],
      ),
    )
    expect(texts(d)).toEqual(['Start', 'Left', 'Right', 'Leaf'])
    expect(d.relations.map((r) => [d.nodes[r.from].text, d.nodes[r.to].text, r.label]).sort()).toEqual([['Leaf', 'Start', 'back'], ['Left', 'Leaf', 'also']].sort())
    clean(d)
  })

  it('a pure cycle still imports (the top-left node becomes the root)', () => {
    const d = fromObsidianCanvas(canvas([node('a', 'A', 0, 0), node('b', 'B', 300, 0)], [{ id: 'e1', fromNode: 'a', toNode: 'b' }, { id: 'e2', fromNode: 'b', toNode: 'a' }]))
    expect(d.nodes[d.root].text).toBe('A')
    expect(Object.keys(d.nodes)).toHaveLength(2)
    expect(d.relations).toHaveLength(1)
  })

  it('several separate roots get a central idea; isolated nodes are kept', () => {
    const d = fromObsidianCanvas(canvas([node('a', 'One', 0, 0), node('b', 'Two', 500, 0), node('c', 'Lonely', 0, 400)], [{ id: 'e1', fromNode: 'a', toNode: 'c' }]), 'My canvas')
    expect(d.nodes[d.root].text).toBe('My canvas')
    expect(d.nodes[d.root].children.map((c) => d.nodes[c].text)).toEqual(['One', 'Two'])
    expect(texts(d)).toContain('Lonely')
  })

  it('file and link cards use their file name or address; colours and groups are kept', () => {
    const d = fromObsidianCanvas(
      canvas(
        [
          node('a', 'Hub', 0, 0),
          { id: 'f', type: 'file', file: 'Notes/Plan.md', x: 0, y: 200, width: 100, height: 50 },
          { id: 'l', type: 'link', url: 'https://example.com', x: 200, y: 200, width: 100, height: 50, color: '#ff0000' },
          { id: 'g', type: 'group', label: 'Both', x: -20, y: 180, width: 400, height: 100 },
        ],
        [{ id: 'e1', fromNode: 'a', toNode: 'f' }, { id: 'e2', fromNode: 'a', toNode: 'l' }],
      ),
    )
    expect(texts(d)).toEqual(['Hub', 'Plan', 'https://example.com'])
    expect(byText(d, 'https://example.com').color).toBe('#ff0000')
    expect(d.groups).toHaveLength(1)
    expect(d.groups![0].label).toBe('Both')
    expect(d.groups![0].ids.map((i) => d.nodes[i].text).sort()).toEqual(['Plan', 'https://example.com'])
    clean(d)
  })

  it('a group whose members are not siblings is ignored, and a canvas with no cards is rejected', () => {
    const d = fromObsidianCanvas(canvas([node('a', 'R', 0, 0), node('b', 'K', 0, 200), node('c', 'KK', 0, 400), { id: 'g', type: 'group', x: -10, y: 190, width: 300, height: 400 }], [{ id: 'e1', fromNode: 'a', toNode: 'b' }, { id: 'e2', fromNode: 'b', toNode: 'c' }]))
    expect(d.groups).toBeUndefined()
    expect(() => fromObsidianCanvas('{"nodes":[],"edges":[]}')).toThrow(/canvas|empty/i)
    expect(() => fromObsidianCanvas('nope')).toThrow(/canvas/i)
  })
})
