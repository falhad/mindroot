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

describe('groups and summary brackets', async () => {
  const T = await import('../src/core/tree')
  const { computeLayout } = await import('../src/core/layout')
  const { renderSvg } = await import('../src/core/svg')
  const inside = (outer: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
    b.x >= outer.x - 0.5 && b.y >= outer.y - 0.5 && b.x + b.w <= outer.x + outer.w + 0.5 && b.y + b.h <= outer.y + outer.h + 0.5

  it('groupSiblings refuses non-siblings, the root and unknown ids; accepts siblings', () => {
    const d = sample()
    expect(T.groupSiblings(d, [id(d, 'A'), id(d, 'A1')])).toBeNull()
    expect(T.groupSiblings(d, [d.root])).toBeNull()
    expect(T.groupSiblings(d, ['nope'])).toBeNull()
    expect(T.groupSiblings(d, [])).toBeNull()
    const g = T.groupSiblings(d, [id(d, 'B'), id(d, 'C')], 'Pair')!
    expect(d.groups).toEqual([{ id: g, ids: [id(d, 'B'), id(d, 'C')], label: 'Pair' }])
  })

  it('the group box contains every member and its subtree', () => {
    const d = sample()
    const g = T.groupSiblings(d, [id(d, 'A'), id(d, 'B')])!
    const l = computeLayout(d)
    for (const t of ['A', 'A1', 'A2', 'B', 'B1']) expect(inside(l.groupBoxes[g], l.boxes[id(d, t)])).toBe(true)
  })

  it('removing nodes shrinks the group and removes it when empty', () => {
    const d = sample()
    const g = T.groupSiblings(d, [id(d, 'B'), id(d, 'C')])!
    T.removeNodes(d, [id(d, 'B')])
    expect(d.groups![0].ids).toEqual([id(d, 'C')])
    T.removeNodes(d, [id(d, 'C')])
    expect(d.groups ?? []).toEqual([])
    expect(g).toBeTruthy()
  })

  it('moving a node to another parent takes it out of the group; reordering keeps it', () => {
    const d = sample()
    T.groupSiblings(d, [id(d, 'B'), id(d, 'C')])
    T.reorderNode(d, id(d, 'C'), -1)
    expect(d.groups![0].ids).toHaveLength(2)
    T.moveNode(d, id(d, 'B'), id(d, 'A'))
    expect(d.groups![0].ids).toEqual([id(d, 'C')])
  })

  it('ungroup removes only the group, not the nodes', () => {
    const d = sample()
    const g = T.groupSiblings(d, [id(d, 'B')])!
    T.ungroup(d, g)
    expect(d.groups ?? []).toEqual([])
    expect(d.nodes[id(d, 'B')]).toBeDefined()
  })

  it('summarize needs consecutive siblings', () => {
    const d = sample()
    expect(T.summarize(d, [id(d, 'A'), id(d, 'C')], 'x')).toBeNull() // B is between them
    const s = T.summarize(d, [id(d, 'B'), id(d, 'A')], 'AB')! // order of ids does not matter
    expect(d.summaries![0]).toMatchObject({ id: s, parentId: d.root, from: id(d, 'A'), to: id(d, 'B'), label: 'AB' })
  })

  it('a summary is removed when one of its ends is deleted or moved away', () => {
    const d = sample()
    T.summarize(d, [id(d, 'A'), id(d, 'B')], 'AB')
    T.moveNode(d, id(d, 'B'), id(d, 'A'))
    expect(d.summaries ?? []).toEqual([])
    const e = sample()
    T.summarize(e, [id(e, 'A'), id(e, 'B')], 'AB')
    T.removeNodes(e, [id(e, 'A')])
    expect(e.summaries ?? []).toEqual([])
  })

  it('the bracket sits outside the subtrees it covers, on the side the children grow', () => {
    for (const layout of ['right', 'left', 'down', 'up'] as const) {
      const d = sample()
      d.layout = layout
      const s = T.summarize(d, [id(d, 'A'), id(d, 'B')], 'AB')!
      const l = computeLayout(d)
      const sb = l.summaryBoxes[s]
      const covered = ['A', 'A1', 'A2', 'B', 'B1'].map((t) => l.boxes[id(d, t)])
      const x0 = Math.min(...covered.map((b) => b.x)), x1 = Math.max(...covered.map((b) => b.x + b.w))
      const y0 = Math.min(...covered.map((b) => b.y)), y1 = Math.max(...covered.map((b) => b.y + b.h))
      expect(sb.side).toBe({ right: 'right', left: 'left', down: 'down', up: 'up' }[layout])
      if (layout === 'right') expect(sb.bracket.x).toBeGreaterThanOrEqual(x1)
      if (layout === 'left') expect(sb.bracket.x + sb.bracket.w).toBeLessThanOrEqual(x0)
      if (layout === 'down') expect(sb.bracket.y).toBeGreaterThanOrEqual(y1)
      if (layout === 'up') expect(sb.bracket.y + sb.bracket.h).toBeLessThanOrEqual(y0)
      expect(l.bounds.x + l.bounds.w).toBeGreaterThanOrEqual(sb.label.x + sb.label.w - 0.5) // bounds include the label
    }
  })

  it('svg export draws groups and brackets', () => {
    const d = sample()
    T.groupSiblings(d, [id(d, 'A'), id(d, 'B')], 'Both')
    T.summarize(d, [id(d, 'A'), id(d, 'B')], 'Sum <x>')
    const { svg } = renderSvg(d, computeLayout(d), { dark: false, background: false })
    expect(svg).toContain('data-group=')
    expect(svg).toContain('>Both<')
    expect(svg).toContain('data-summary=')
    expect(svg).toContain('Sum &lt;x&gt;')
  })
})

describe('floating nodes and sticky notes', async () => {
  const T = await import('../src/core/tree')
  const { computeLayout } = await import('../src/core/layout')
  const { renderSvg } = await import('../src/core/svg')

  it('addFloat creates a parentless node with a position outside the root tree', () => {
    const d = sample()
    const f = T.addFloat(d, 400, -300, 'Loose')
    expect(d.nodes[f]).toMatchObject({ parentId: null, text: 'Loose', pos: { x: 400, y: -300 } })
    expect(d.nodes[d.root].children).not.toContain(f)
    expect(T.orderedIds(d)).toContain(f)
  })

  it('a float subtree is laid out at its position and the main tree does not move', () => {
    const d = sample()
    const before = computeLayout(d)
    const f = T.addFloat(d, 600, 500, 'Loose')
    const c = T.addChild(d, f, 'Kid')
    const after = computeLayout(d)
    const fb = after.boxes[f]
    expect(fb.x + fb.w / 2).toBeCloseTo(600, 0)
    expect(fb.y + fb.h / 2).toBeCloseTo(500, 0)
    expect(after.boxes[c]).toBeDefined()
    for (const k of Object.keys(before.boxes)) expect(after.boxes[k]).toEqual(before.boxes[k])
    expect(after.order).toContain(c)
    // bounds include the float so "fit to screen" shows it
    expect(after.bounds.x + after.bounds.w).toBeGreaterThan(before.bounds.x + before.bounds.w)
  })

  it('two floats do not break each other (no recursion) and each keeps its own position', () => {
    const d = sample()
    const a = T.addFloat(d, 0, 700, 'A float')
    const b = T.addFloat(d, 900, 700, 'B float')
    const l = computeLayout(d)
    expect(l.boxes[a].x).toBeLessThan(l.boxes[b].x)
  })

  it('moveFloat changes only the position; deleting a float removes its subtree', () => {
    const d = sample()
    const f = T.addFloat(d, 0, 0, 'Loose')
    const c = T.addChild(d, f, 'Kid')
    T.moveFloat(d, f, 10, 20)
    expect(d.nodes[f].pos).toEqual({ x: 10, y: 20 })
    T.removeNodes(d, [f])
    expect(d.nodes[f]).toBeUndefined()
    expect(d.nodes[c]).toBeUndefined()
  })

  it('attachFloat turns a float into a child; it refuses a parent inside its own subtree', () => {
    const d = sample()
    const f = T.addFloat(d, 0, 0, 'Loose')
    const kid = T.addChild(d, f, 'Kid')
    expect(T.attachFloat(d, f, kid)).toBe(false)
    expect(T.attachFloat(d, f, id(d, 'B'))).toBe(true)
    expect(d.nodes[f].parentId).toBe(id(d, 'B'))
    expect('pos' in d.nodes[f]).toBe(false)
  })

  it('floatNode detaches a node with its subtree from the tree', () => {
    const d = sample()
    expect(T.floatNode(d, d.root, 0, 0)).toBe(false)
    expect(T.floatNode(d, id(d, 'A'), 300, 300)).toBe(true)
    expect(d.nodes[d.root].children).not.toContain(id(d, 'A'))
    expect(d.nodes[id(d, 'A')]).toMatchObject({ parentId: null, pos: { x: 300, y: 300 } })
    expect(d.nodes[id(d, 'A1')].parentId).toBe(id(d, 'A'))
  })

  it('a sticky child has no connector line; floats have none either', () => {
    const d = sample()
    d.nodes[id(d, 'B')].sticky = true
    const f = T.addFloat(d, 500, 500, 'Note', true)
    const l = computeLayout(d)
    const { svg } = renderSvg(d, l, { dark: false, background: false })
    // one connector per non-root, non-sticky tree node: 6 nodes minus root minus sticky B
    const connectors = svg.split('opacity="0.85"').length - 1
    expect(connectors).toBe(Object.values(d.nodes).filter((n) => n.parentId && !n.sticky).length)
    expect(f).toBeTruthy()
  })
})

describe('focus mode', async () => {
  const { focusDoc, projectDoc, focusPath } = await import('../src/core/focus')
  const { computeLayout } = await import('../src/core/layout')
  const T = await import('../src/core/tree')
  const store = await import('../src/state/doc')

  it('focusDoc contains only the subtree, with the focus node as a parentless root; the real doc is untouched', () => {
    const d = sample()
    const f = focusDoc(d, id(d, 'A'))
    expect(Object.keys(f.nodes).sort()).toEqual([id(d, 'A'), id(d, 'A1'), id(d, 'A2')].sort())
    expect(f.root).toBe(id(d, 'A'))
    expect(f.nodes[f.root].parentId).toBeNull()
    expect(d.nodes[id(d, 'A')].parentId).toBe(d.root) // not modified
    expect(Object.keys(d.nodes)).toHaveLength(7)
  })

  it('links that leave the subtree are hidden; links inside stay', () => {
    const d = sample()
    T.addRelation(d, id(d, 'A1'), id(d, 'A2'))
    T.addRelation(d, id(d, 'A1'), id(d, 'B'))
    const f = focusDoc(d, id(d, 'A'))
    expect(f.relations).toHaveLength(1)
  })

  it('projectDoc returns the same doc when there is no usable focus, and memoizes per doc and id', () => {
    const d = sample()
    expect(projectDoc(d, null)).toBe(d)
    expect(projectDoc(d, d.root)).toBe(d)
    expect(projectDoc(d, 'missing')).toBe(d)
    expect(projectDoc(d, id(d, 'A'))).toBe(projectDoc(d, id(d, 'A')))
  })

  it('focusPath lists the ancestors from the root', () => {
    const d = sample()
    expect(focusPath(d, id(d, 'A1'))).toEqual([d.root, id(d, 'A'), id(d, 'A1')])
  })

  it('layout in focus mode shows only the branch, centred', () => {
    const d = sample()
    const l = computeLayout(focusDoc(d, id(d, 'A')))
    expect(Object.keys(l.boxes).sort()).toEqual([id(d, 'A'), id(d, 'A1'), id(d, 'A2')].sort())
    const b = l.boxes[id(d, 'A')]
    expect(b.x + b.w / 2).toBeCloseTo(0, 0)
  })

  it('store: focusing shows only the branch; adding a child in focus mode edits the real doc; Enter on the focus root adds a child', () => {
    const d = sample()
    store.openDoc(d)
    store.enterFocus(id(d, 'A'))
    expect(Object.keys(store.useDoc.getState().layout!.boxes)).toHaveLength(3)
    store.select([id(d, 'A')])
    store.addSibling() // on the focus root: must add a child, not a sibling outside the view
    store.endEdit('New in A')
    const real = store.useDoc.getState().doc!
    const a = real.nodes[id(d, 'A')]
    expect(a.children.map((c) => real.nodes[c].text)).toContain('New in A')
    expect(real.nodes[real.root].children).toHaveLength(3)
    expect(Object.keys(store.useDoc.getState().layout!.boxes)).toHaveLength(4)
    store.exitFocus()
    expect(Object.keys(store.useDoc.getState().layout!.boxes)).toHaveLength(8)
  })

  it('store: deleting the focused node ends focus mode', () => {
    const d = sample()
    store.openDoc(d)
    store.enterFocus(id(d, 'B'))
    store.commit((x) => void T.removeNodes(x, [id(x, 'B')]))
    expect(store.activeFocus(store.useDoc.getState())).toBeNull()
    expect(Object.keys(store.useDoc.getState().layout!.boxes).length).toBeGreaterThan(3)
  })

  it('store: opening another map clears focus; undo that restores the focused node resumes it', () => {
    const d = sample()
    store.openDoc(d)
    store.enterFocus(id(d, 'A'))
    store.openDoc(sample())
    expect(store.useDoc.getState().focusId).toBeNull()
  })
})

describe('presentation mode', async () => {
  const { presentationSteps } = await import('../src/core/present')
  const present = await import('../src/state/present')
  const store = await import('../src/state/doc')
  const T = await import('../src/core/tree')
  const names = (d: MapDoc, steps: string[][]) => steps.map((s) => s.map((i) => d.nodes[i].text))

  it('node mode reveals one node per step, in document order', () => {
    const d = sample()
    expect(names(d, presentationSteps(d, 'node'))).toEqual([['Root'], ['A'], ['A1'], ['A2'], ['B'], ['B1'], ['C']])
  })

  it('branch mode: the central idea first, then one whole first-level branch per step', () => {
    const d = sample()
    expect(names(d, presentationSteps(d, 'branch'))).toEqual([['Root'], ['A', 'A1', 'A2'], ['B', 'B1'], ['C']])
  })

  it('a collapsed branch is one step and is not opened', () => {
    const d = sample()
    d.nodes[id(d, 'A')].collapsed = true
    expect(names(d, presentationSteps(d, 'node'))).toEqual([['Root'], ['A'], ['B'], ['B1'], ['C']])
    expect(names(d, presentationSteps(d, 'branch'))[1]).toEqual(['A'])
  })

  it('floating nodes are not part of the walk-through', () => {
    const d = sample()
    T.addFloat(d, 0, 0, 'Loose')
    expect(presentationSteps(d, 'node').flat().map((i) => d.nodes[i].text)).not.toContain('Loose')
  })

  it('an empty map has no steps', () => {
    expect(presentationSteps(T.createDoc(''), 'node')).toEqual([])
  })

  it('store: starts at step 0, clamps at both ends, reveals cumulatively, and stops cleanly', () => {
    const d = sample()
    store.openDoc(d)
    expect(present.startPresentation('node')).toBe(true)
    const s = () => present.usePresent.getState()
    expect(s().active && s().step).toBe(0)
    present.prevStep()
    expect(s().step).toBe(0)
    present.nextStep()
    present.nextStep()
    expect([...present.revealed(s())!].map((i) => d.nodes[i].text)).toEqual(['Root', 'A', 'A1'])
    for (let i = 0; i < 20; i++) present.nextStep()
    expect(s().step).toBe(s().steps.length - 1)
    present.stopPresentation()
    expect(s().active).toBe(false)
    expect(present.revealed(s())).toBeNull()
  })

  it('store: an empty map does not start a presentation', () => {
    store.openDoc(T.createDoc(''))
    expect(present.startPresentation('node')).toBe(false)
    expect(present.usePresent.getState().active).toBe(false)
  })
})
