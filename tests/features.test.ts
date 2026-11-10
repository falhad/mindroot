import { describe, expect, it } from 'vitest'
import { docFromOutline, parseOutline } from '../src/core/outline'
import { allTags, matchesTags, normalizeTag, setNodeTags, tagFilterState } from '../src/core/tags'
import type { MapDoc } from '../src/core/types'

const sample = () => docFromOutline(parseOutline('# Root\n- A\n  - A1\n  - A2\n- B\n  - B1\n- C'))
const id = (d: MapDoc, t: string) => Object.values(d.nodes).find((n) => n.text === t)!.id

describe('tags', () => {
  it('normalizeTag handles hash, case, spaces and Persian', () => {
    expect(normalizeTag('  #Urgent ')).toBe('urgent')
    expect(normalizeTag('کار')).toBe('کار')
    expect(normalizeTag('#Résumé')).toBe('résumé') // NFC
    expect(normalizeTag('#')).toBe('')
    expect(normalizeTag('a b')).toBe('a-b')
  })

  it('setNodeTags normalizes, removes duplicates and empties, and deletes the field when empty', () => {
    const d = sample()
    setNodeTags(d, [id(d, 'A')], ['#One', 'one', ' ', 'Two'])
    expect(d.nodes[id(d, 'A')].tags).toEqual(['one', 'two'])
    setNodeTags(d, [id(d, 'A')], [])
    expect('tags' in d.nodes[id(d, 'A')]).toBe(false)
  })

  it('allTags counts across nodes, most used first, then alphabetical', () => {
    const d = sample()
    setNodeTags(d, [id(d, 'A'), id(d, 'B')], ['x'])
    setNodeTags(d, [id(d, 'A')], ['x', 'b'])
    setNodeTags(d, [id(d, 'C')], ['a'])
    expect(allTags(d)).toEqual([{ tag: 'x', count: 2 }, { tag: 'a', count: 1 }, { tag: 'b', count: 1 }])
  })

  it('matchesTags is true when the node has any selected tag, and an empty filter matches all', () => {
    const d = sample()
    setNodeTags(d, [id(d, 'A')], ['x'])
    expect(matchesTags(d.nodes[id(d, 'A')], ['x', 'y'])).toBe(true)
    expect(matchesTags(d.nodes[id(d, 'B')], ['x'])).toBe(false)
    expect(matchesTags(d.nodes[id(d, 'B')], [])).toBe(true)
  })

  it('tagFilterState: matches full, their ancestors soft, everything else dimmed', () => {
    const d = sample()
    setNodeTags(d, [id(d, 'A1')], ['x'])
    const s = tagFilterState(d, ['x'])!
    expect(s.get(id(d, 'A1'))).toBe('match')
    expect(s.get(id(d, 'A'))).toBe('path')
    expect(s.get(d.root)).toBe('path')
    expect(s.get(id(d, 'B'))).toBe('dim')
    expect(s.get(id(d, 'A2'))).toBe('dim')
    expect(tagFilterState(d, [])).toBeNull()
  })
})

describe('relations: labels, arrows, styles', async () => {
  const { relationPath } = await import('../src/core/edges')
  const { updateRelation, addRelation } = await import('../src/core/tree')
  const { computeLayout } = await import('../src/core/layout')
  const { renderSvg } = await import('../src/core/svg')

  it('relationPath returns a midpoint that lies on the curve and start/end angles', () => {
    const a = { x: 0, y: 0, w: 40, h: 20 }
    const b = { x: 300, y: 0, w: 40, h: 20 }
    const p = relationPath(a, b)
    // the path is  M a Q c b ; the midpoint of a quadratic curve is (a + 2c + b) / 4
    const m = /^M([-\d.]+) ([-\d.]+)Q([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)$/.exec(p.d)!.slice(1).map(Number)
    const [ax, ay, cx, cy, bx, by] = m
    expect(p.mid.x).toBeCloseTo((ax + 2 * cx + bx) / 4, 1)
    expect(p.mid.y).toBeCloseTo((ay + 2 * cy + by) / 4, 1)
    expect(p.start.x).toBeCloseTo(ax, 1)
    expect(Number.isFinite(p.startAngle)).toBe(true)
  })

  it('hitRelation finds the link near a point and nothing far away', async () => {
    const { hitRelation } = await import('../src/core/edges')
    const a = { x: 0, y: 0, w: 40, h: 20 }
    const b = { x: 300, y: 0, w: 40, h: 20 }
    const rels = [{ id: 'r1', from: 'a', to: 'b' }]
    const g = relationPath(a, b)
    expect(hitRelation(rels, { a, b }, g.mid.x + 2, g.mid.y - 2, 10)).toBe('r1')
    expect(hitRelation(rels, { a, b }, g.mid.x, g.mid.y + 200, 10)).toBeNull()
    expect(hitRelation(rels, { a }, g.mid.x, g.mid.y, 10)).toBeNull() // a missing node never throws
  })

  it('updateRelation sets label, arrow and dash; defaults and empty values are removed; unknown ids are ignored', () => {
    const d = sample()
    addRelation(d, id(d, 'A'), id(d, 'B'))
    const rid = d.relations[0].id
    updateRelation(d, rid, { label: ' blocks ', arrow: 'both', dash: 'dotted' })
    expect(d.relations[0]).toMatchObject({ label: 'blocks', arrow: 'both', dash: 'dotted' })
    updateRelation(d, rid, { label: '', arrow: 'end', dash: 'dashed' })
    expect('label' in d.relations[0] || 'arrow' in d.relations[0] || 'dash' in d.relations[0]).toBe(false)
    const before = JSON.stringify(d.relations)
    updateRelation(d, 'nope', { label: 'x' })
    expect(JSON.stringify(d.relations)).toBe(before)
  })

  it('svg export draws the label, both arrowheads, and the dash style', () => {
    const d = sample()
    addRelation(d, id(d, 'A'), id(d, 'B'))
    updateRelation(d, d.relations[0].id, { label: 'blocks <b>', arrow: 'both', dash: 'solid' })
    const { svg } = renderSvg(d, computeLayout(d), { dark: false, background: false })
    expect(svg).toContain('blocks &lt;b&gt;')
    expect(svg.match(/data-arrow="/g)).toHaveLength(2)
    expect(svg).not.toContain('stroke-dasharray="6 5"')
    const none = structuredClone(d)
    updateRelation(none, none.relations[0].id, { arrow: 'none' })
    expect(renderSvg(none, computeLayout(none), { dark: false, background: false }).svg).not.toContain('data-arrow')
  })
})
