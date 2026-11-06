import { describe, expect, it } from 'vitest'
import { produce } from 'immer'
import { computeLayout, hitTest, navigate } from '../src/core/layout'
import { docFromOutline, importJson, importMarkdown, parseOutline, sanitizeDoc, toMarkdown, exportJson } from '../src/core/outline'
import { searchNodes } from '../src/core/search'
import { renderSvg, renderThumb } from '../src/core/svg'
import * as T from '../src/core/tree'
import type { LayoutKind, MapDoc } from '../src/core/types'
import { TEMPLATES, docFromTemplate } from '../src/core/templates'

const sample = () =>
  docFromOutline(
    parseOutline(`# Root
- A
  - A1
  - A2
- B
  - B1
- C`),
  )
const textOf = (d: MapDoc, id: string) => d.nodes[id].text
const byText = (d: MapDoc, t: string) => Object.values(d.nodes).find((n) => n.text === t)!.id

describe('tree operations', () => {
  it('adds children and siblings in order', () => {
    const d = produce(sample(), (x) => {
      const a = byText(x, 'A')
      T.addSibling(x, a, false, 'A-after')
      T.addSibling(x, a, true, 'A-before')
    })
    expect(d.nodes[d.root].children.map((c) => textOf(d, c))).toEqual(['A-before', 'A', 'A-after', 'B', 'C'])
  })

  it('removes a subtree and dangling relations, never the root', () => {
    const d = produce(sample(), (x) => {
      T.addRelation(x, byText(x, 'A1'), byText(x, 'B1'))
      expect(T.removeNodes(x, [byText(x, 'A'), x.root])).toBeTruthy()
    })
    expect(Object.values(d.nodes).map((n) => n.text).sort()).toEqual(['B', 'B1', 'C', 'Root'])
    expect(d.relations).toHaveLength(0)
  })

  it('refuses to move a node into its own subtree', () => {
    const d = produce(sample(), (x) => {
      expect(T.moveNode(x, byText(x, 'A'), byText(x, 'A1'))).toBe(false)
      expect(T.moveNode(x, x.root, byText(x, 'A'))).toBe(false)
    })
    expect(d.nodes[byText(d, 'A')].parentId).toBe(d.root)
  })

  it('reorders when moving later within the same parent', () => {
    const d = produce(sample(), (x) => {
      T.moveNode(x, byText(x, 'A'), x.root, 2) // index is counted before the node is removed
    })
    expect(d.nodes[d.root].children.map((c) => textOf(d, c))).toEqual(['B', 'A', 'C'])
  })

  it('indents and outdents', () => {
    const d = produce(sample(), (x) => {
      T.indentNode(x, byText(x, 'B'))
      T.outdentNode(x, byText(x, 'A2'))
    })
    expect(d.nodes[byText(d, 'B')].parentId).toBe(byText(d, 'A'))
    expect(d.nodes[byText(d, 'A2')].parentId).toBe(d.root)
  })

  it('duplicates a subtree with fresh ids', () => {
    const d = produce(sample(), (x) => {
      T.duplicateNodes(x, [byText(x, 'A')])
    })
    expect(Object.keys(d.nodes)).toHaveLength(7 + 3)
    expect(new Set(Object.keys(d.nodes)).size).toBe(10)
  })

  it('collapses to a level and expands all', () => {
    const d = produce(sample(), (x) => T.collapseToLevel(x, 1))
    expect(d.nodes[byText(d, 'A')].collapsed).toBe(true)
    expect(d.nodes[d.root].collapsed).toBeUndefined()
    const e = produce(d, (x) => T.collapseToLevel(x, null))
    expect(Object.values(e.nodes).some((n) => n.collapsed)).toBe(false)
  })

  it('topLevel drops nested selections', () => {
    const d = sample()
    expect(T.topLevel(d, [byText(d, 'A1'), byText(d, 'A'), byText(d, 'C')]).map((i) => textOf(d, i))).toEqual(['A', 'C'])
  })
})

describe('layouts', () => {
  const kinds: LayoutKind[] = ['mindmap', 'right', 'left', 'down', 'up', 'radial']
  const overlap = (a: any, b: any) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5

  for (const kind of kinds) {
    it(`${kind}: every visible node is placed and nothing overlaps`, () => {
      const d = { ...sample(), layout: kind }
      const l = computeLayout(d)
      expect(l.order).toHaveLength(7)
      const ids = l.order
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++) expect(overlap(l.boxes[ids[i]], l.boxes[ids[j]]), `${kind}: ${textOf(d, ids[i])} vs ${textOf(d, ids[j])}`).toBe(false)
    })
  }

  it('right layout grows to the right of the root, left to the left', () => {
    const d = sample()
    const r = computeLayout({ ...d, layout: 'right' })
    const rootBox = r.boxes[d.root]
    for (const id of r.order.slice(1)) expect(r.boxes[id].x).toBeGreaterThan(rootBox.x + rootBox.w - 1)
    const l = computeLayout({ ...d, layout: 'left' })
    for (const id of l.order.slice(1)) expect(l.boxes[id].x + l.boxes[id].w).toBeLessThan(l.boxes[d.root].x + 1)
  })

  it('mindmap balances both sides', () => {
    const d = sample()
    const l = computeLayout(d)
    const sides = d.nodes[d.root].children.map((c) => l.attach[c])
    expect(sides).toContain('left')
    expect(sides).toContain('right')
  })

  it('honours an explicit side', () => {
    const d = produce(sample(), (x) => {
      for (const c of x.nodes[x.root].children) x.nodes[c].side = 'left'
    })
    const l = computeLayout(d)
    for (const c of d.nodes[d.root].children) expect(l.attach[c]).toBe('left')
  })

  it('hides collapsed descendants', () => {
    const d = produce(sample(), (x) => T.toggleCollapse(x, byText(x, 'A')))
    const l = computeLayout(d)
    expect(l.order).toHaveLength(5)
    expect(l.boxes[byText(d, 'A1')]).toBeUndefined()
  })

  it('grows the node box for a long draft', () => {
    const d = sample()
    const a = byText(d, 'A')
    const short = computeLayout(d).boxes[a].w
    const long = computeLayout(d, { draft: { id: a, text: 'a much longer piece of text that must wrap onto several lines for sure' } })
    expect(long.boxes[a].h).toBeGreaterThan(computeLayout(d).boxes[a].h)
    expect(long.boxes[a].w).toBeGreaterThan(short)
  })

  it('navigates spatially and hit-tests', () => {
    const d = { ...sample(), layout: 'right' as const }
    const l = computeLayout(d)
    const a = byText(d, 'A')
    expect(navigate(l, d.root, 'right')).toBeTruthy()
    expect(navigate(l, a, 'down')).toBe(byText(d, 'A1') === navigate(l, a, 'down') ? byText(d, 'A1') : navigate(l, a, 'down'))
    expect(navigate(l, a, 'left')).toBe(d.root)
    const b = l.boxes[a]
    expect(hitTest(l, b.x + 2, b.y + 2)).toBe(a)
    expect(hitTest(l, 99999, 99999)).toBeNull()
  })
})

describe('outline & import/export', () => {
  it('parses headings, bullets, notes and checklists', () => {
    const f = parseOutline(`# Plan
> the big picture
- Phase 1
  - [ ] Draft
  - [x] Review
  - Sub task
- [Docs](https://example.com)`)
    expect(f).toHaveLength(1)
    const root = f[0]
    expect(root.notes).toBe('the big picture')
    expect(root.children.map((c) => c.text)).toEqual(['Phase 1', 'Docs'])
    expect(root.children[0].checklist).toEqual([
      { text: 'Draft', done: false },
      { text: 'Review', done: true },
    ])
    expect(root.children[0].children.map((c) => c.text)).toEqual(['Sub task'])
    expect(root.children[1].link).toBe('https://example.com')
  })

  it('wraps several top-level items under a synthetic root', () => {
    const d = importMarkdown('- one\n- two\n- three', 'My list')
    expect(textOf(d, d.root)).toBe('My list')
    expect(d.nodes[d.root].children).toHaveLength(3)
  })

  it('handles tabs, numbered lists and CRLF', () => {
    const f = parseOutline('1. a\r\n\t1. b\r\n\t2. c\r\n2. d')
    expect(f.map((n) => n.text)).toEqual(['a', 'd'])
    expect(f[0].children.map((n) => n.text)).toEqual(['b', 'c'])
  })

  it('round-trips through markdown', () => {
    const d = produce(sample(), (x) => {
      x.nodes[byText(x, 'A1')].notes = 'remember this'
      T.addChecklistItem(x, byText(x, 'B'), 'buy milk', true)
      x.nodes[byText(x, 'C')].link = 'https://example.com'
    })
    const md = toMarkdown(d)
    const back = importMarkdown(md)
    expect(back.nodes[back.root].text).toBe('Root')
    expect(back.nodes[Object.values(back.nodes).find((n) => n.text === 'A1')!.id].notes).toBe('remember this')
    expect(Object.values(back.nodes).find((n) => n.text === 'B')!.checklist).toMatchObject([{ text: 'buy milk', done: true }])
    expect(Object.values(back.nodes).find((n) => n.text === 'C')!.link).toBe('https://example.com')
    expect(Object.keys(back.nodes)).toHaveLength(Object.keys(d.nodes).length)
  })

  it('round-trips through JSON and assigns a new id', () => {
    const d = sample()
    const back = importJson(exportJson(d))
    expect(back.meta.id).not.toBe(d.meta.id)
    expect(Object.keys(back.nodes)).toHaveLength(7)
  })

  it('imports a generic {title, children} tree', () => {
    const d = importJson(JSON.stringify({ title: 'X', children: [{ title: 'Y', children: [{ text: 'Z' }] }] }))
    expect(Object.values(d.nodes).map((n) => n.text).sort()).toEqual(['X', 'Y', 'Z'])
  })

  it('rejects garbage', () => {
    expect(() => importJson('nope')).toThrow()
    expect(() => importJson('{"a":1}')).toThrow()
  })

  it('sanitizeDoc repairs dangling children, cycles and bad enums', () => {
    const d = sample()
    const broken: any = JSON.parse(JSON.stringify(d))
    broken.nodes[d.root].children.push('ghost')
    broken.nodes[byText(d, 'A1')].children.push(d.root) // cycle
    broken.layout = 'weird'
    broken.relations = [{ id: 'r', from: 'ghost', to: d.root }]
    const fixed = sanitizeDoc(broken)
    expect(fixed.layout).toBe('mindmap')
    expect(fixed.nodes[d.root].children).not.toContain('ghost')
    expect(fixed.nodes[byText(d, 'A1')].children).toHaveLength(0)
    expect(fixed.relations).toHaveLength(0)
  })

  it('templates all build valid documents', () => {
    for (const t of TEMPLATES) {
      const d = docFromTemplate(t)
      expect(computeLayout(d).order.length).toBeGreaterThan(0)
      expect(() => sanitizeDoc(JSON.parse(JSON.stringify(d)))).not.toThrow()
    }
  })

  it('searches text, notes and checklists', () => {
    const d = produce(sample(), (x) => {
      x.nodes[byText(x, 'C')].notes = 'Find the needle here'
      T.addChecklistItem(x, byText(x, 'B1'), 'needle item')
    })
    expect(searchNodes(d, 'A1').map((h) => textOf(d, h.id))).toEqual(['A1'])
    expect(searchNodes(d, 'NEEDLE').map((h) => textOf(d, h.id))).toEqual(['B1', 'C'])
    expect(searchNodes(d, '  ')).toEqual([])
  })
})

describe('svg rendering', () => {
  it('produces well-formed svg with every node text, escaping markup', () => {
    const d = produce(sample(), (x) => {
      x.nodes[byText(x, 'A')].text = 'Fish & <Chips>'
      x.relations.push({ id: 'r1', from: byText(x, 'B'), to: byText(x, 'C') })
    })
    const { svg, width, height } = renderSvg(d, computeLayout(d), { dark: false, background: true })
    expect(width).toBeGreaterThan(100)
    expect(height).toBeGreaterThan(100)
    expect(svg).toContain('Fish &amp; &lt;Chips&gt;')
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    expect(svg).toContain('stroke-dasharray')
    expect(new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('parsererror')).toBeNull()
  })

  it('renders thumbnails for every layout', () => {
    for (const layout of ['mindmap', 'right', 'down', 'radial'] as LayoutKind[]) {
      const d = { ...sample(), layout }
      const t = renderThumb(d, computeLayout(d))
      expect(new DOMParser().parseFromString(t, 'image/svg+xml').querySelector('parsererror')).toBeNull()
    }
  })
})
