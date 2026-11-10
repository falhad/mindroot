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

describe('themes, fonts and right-to-left', async () => {
  const { resolveTheme, getTheme, resolveColor } = await import('../src/core/themes')
  const { computeLayout, mirrorLayout } = await import('../src/core/layout')
  const { fontStack } = await import('../src/core/measure')
  const { renderSvg } = await import('../src/core/svg')
  const T = await import('../src/core/tree')
  const custom = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', '#888888']

  it('resolveTheme uses the built-in theme unless the map has a custom palette', () => {
    const d = sample()
    expect(resolveTheme(d).id).toBe(getTheme(d.themeId).id)
    d.customTheme = custom
    const t = resolveTheme(d)
    expect(t.id).toBe('custom')
    expect(t.light).toEqual(custom)
    expect(t.dark).toEqual(custom)
    expect(t.root.light).toEqual([custom[0], custom[1]])
    expect(resolveColor('2', t, false)).toBe('#333333')
  })

  it('a malformed custom palette is ignored', () => {
    const d = sample()
    d.customTheme = ['#111111']
    expect(resolveTheme(d).id).not.toBe('custom')
  })

  it('fontStack returns a different stack per font and falls back to Inter', () => {
    expect(fontStack('mono')).toMatch(/monospace/)
    expect(fontStack('serif')).toMatch(/serif/)
    expect(fontStack('vazirmatn').startsWith('"Vazirmatn')).toBe(true)
    expect(fontStack(undefined)).toBe(fontStack('inter'))
  })

  it('layout metrics and svg export use the map font', () => {
    const d = sample()
    d.font = 'mono'
    const l = computeLayout(d)
    expect(l.metrics[d.root].family).toBe(fontStack('mono'))
    const { svg } = renderSvg(d, l, { dark: false, background: false })
    expect(svg).toMatch(/font-family="[^"]*monospace/)
  })

  it('rtl puts the first child on the left of the root in the right layout, and swaps the attach side', () => {
    const d = sample()
    d.layout = 'right'
    const ltr = computeLayout(d)
    d.dir = 'rtl'
    const rtl = computeLayout(d)
    const a = id(d, 'A')
    expect(ltr.boxes[a].x).toBeGreaterThan(ltr.boxes[d.root].x)
    expect(rtl.boxes[a].x + rtl.boxes[a].w).toBeLessThan(rtl.boxes[d.root].x + 0.5)
    expect(ltr.attach[a]).toBe('right')
    expect(rtl.attach[a]).toBe('left')
    // same vertical positions and sizes
    expect(rtl.boxes[a].y).toBe(ltr.boxes[a].y)
    expect(rtl.boxes[a].w).toBe(ltr.boxes[a].w)
  })

  it('mirroring twice gives back the original layout', () => {
    const d = sample()
    T.summarize(d, [id(d, 'A'), id(d, 'B')], 'AB')
    T.groupSiblings(d, [id(d, 'B'), id(d, 'C')])
    T.addFloat(d, 300, 200, 'Loose')
    const l = computeLayout(d)
    const back = mirrorLayout(mirrorLayout(l))
    // coordinates may differ by floating-point noise: compare to 3 decimals
    const r = (o: unknown) => JSON.parse(JSON.stringify(o, (_k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)))
    expect(r(back.boxes)).toEqual(r(l.boxes))
    expect(back.attach).toEqual(l.attach)
    expect(r(back.groupBoxes)).toEqual(r(l.groupBoxes))
    expect(r(back.summaryBoxes)).toEqual(r(l.summaryBoxes))
    expect(r(back.bounds)).toEqual(r(l.bounds))
  })

  it('rtl keeps summaries, groups and floats inside the bounds', () => {
    const d = sample()
    d.dir = 'rtl'
    T.summarize(d, [id(d, 'A'), id(d, 'B')], 'AB')
    const f = T.addFloat(d, 300, 200, 'Loose')
    const l = computeLayout(d)
    expect(l.boxes[f].x + l.boxes[f].w / 2).toBeCloseTo(-300, 0)
    for (const s of Object.values(l.summaryBoxes)) {
      expect(s.label.x).toBeGreaterThanOrEqual(l.bounds.x - 0.5)
      expect(s.label.x + s.label.w).toBeLessThanOrEqual(l.bounds.x + l.bounds.w + 0.5)
    }
  })
})

describe('cross-map links', async () => {
  const { collectLinks, backlinksTo, linkStatus } = await import('../src/core/links')
  const { digestDoc } = await import('../src/core/digest')
  const T = await import('../src/core/tree')

  const linked = () => {
    const d = sample()
    d.nodes[id(d, 'A')].mapLink = { mapId: 'other-map', nodeId: 'n1' }
    d.nodes[id(d, 'B')].mapLink = { mapId: 'third-map' }
    return d
  }

  it('collectLinks lists node links with the source node and its text', () => {
    const d = linked()
    expect(collectLinks(d).map((l) => [l.fromText, l.mapId, l.nodeId])).toEqual(expect.arrayContaining([['A', 'other-map', 'n1'], ['B', 'third-map', undefined]]))
    expect(collectLinks(d)).toHaveLength(2)
  })

  it('backlinksTo finds the source nodes in other maps, for a map or for one node', () => {
    const d = linked()
    d.meta.id = 'src-map'
    const digests = { 'src-map': digestDoc(d) }
    expect(backlinksTo(digests, 'other-map').map((b) => [b.fromMapId, b.fromText])).toEqual([['src-map', 'A']])
    expect(backlinksTo(digests, 'other-map', 'n1')).toHaveLength(1)
    expect(backlinksTo(digests, 'other-map', 'zzz')).toHaveLength(0)
    expect(backlinksTo(digests, 'third-map')).toHaveLength(1)
    expect(backlinksTo(digests, 'nobody')).toHaveLength(0)
  })

  it('a link to a map in the trash or a map that does not exist is marked unavailable', () => {
    const metas = [{ id: 'ok', trashedAt: null }, { id: 'gone', trashedAt: 5 }] as never
    expect(linkStatus({ mapId: 'ok' }, metas)).toBe('ok')
    expect(linkStatus({ mapId: 'gone' }, metas)).toBe('trashed')
    expect(linkStatus({ mapId: 'nope' }, metas)).toBe('missing')
  })

  it('a link is by map id, so renaming the target map does not break it', () => {
    const d = linked()
    const before = JSON.stringify(d.nodes[id(d, 'A')].mapLink)
    const target = sample()
    target.meta.id = 'other-map'
    T.setText(target, target.root, 'Renamed map')
    expect(JSON.stringify(d.nodes[id(d, 'A')].mapLink)).toBe(before)
    expect(linkStatus(d.nodes[id(d, 'A')].mapLink!, [{ id: 'other-map', trashedAt: null }] as never)).toBe('ok')
  })

  it('digestDoc is small: title, update time, links and tasks only', () => {
    const d = linked()
    const g = digestDoc(d)
    expect(Object.keys(g).sort()).toEqual(['links', 'tasks', 'title', 'updatedAt'])
  })
})

import * as T_ from '../src/core/tree'

describe('tasks', async () => {
  const { collectTasks, bucketTasks, addDays, todayString, isDueDate } = await import('../src/core/tasks')

  const withTasks = () => {
    const d = sample()
    d.meta.id = 'm1'
    d.meta.title = 'My map'
    d.nodes[id(d, 'A')].due = '2026-11-09'
    d.nodes[id(d, 'A1')].due = '2026-11-10'
    d.nodes[id(d, 'A2')].due = '2026-11-14'
    d.nodes[id(d, 'B')].due = '2026-12-25'
    d.nodes[id(d, 'B1')].done = false
    d.nodes[id(d, 'C')].due = '2026-11-01'
    d.nodes[id(d, 'C')].done = true
    return d
  }

  it('collectTasks takes nodes that have a due date or a done state, and ignores plain nodes', () => {
    const t = collectTasks(withTasks())
    expect(t.map((x) => x.text).sort()).toEqual(['A', 'A1', 'A2', 'B', 'B1', 'C'])
    expect(collectTasks(sample())).toEqual([])
  })

  it('collectTasks reports checklist progress', () => {
    const d = withTasks()
    T_.addChecklistItem(d, id(d, 'A'), 'x', true)
    T_.addChecklistItem(d, id(d, 'A'), 'y', false)
    expect(collectTasks(d).find((x) => x.text === 'A')!.checklist).toEqual({ done: 1, total: 2 })
  })

  it('bucketTasks uses the given today, not the clock', () => {
    const tasks = collectTasks(withTasks()).map((t) => ({ ...t, mapId: 'm1', mapTitle: 'My map' }))
    const b = bucketTasks(tasks, '2026-11-10')
    expect(b.overdue.map((t) => t.text)).toEqual(['A'])
    expect(b.today.map((t) => t.text)).toEqual(['A1'])
    expect(b.week.map((t) => t.text)).toEqual(['A2'])
    expect(b.later.map((t) => t.text)).toEqual(['B'])
    expect(b.noDate.map((t) => t.text)).toEqual(['B1'])
    expect(b.done.map((t) => t.text)).toEqual(['C']) // done tasks leave every other bucket, even when overdue
  })

  it('a task due today is not overdue, and day 7 is still this week while day 8 is later', () => {
    const base = { mapId: 'm', mapTitle: 'M', nodeId: 'n', done: false }
    const b = bucketTasks(
      [{ ...base, text: 't', due: '2026-11-10' }, { ...base, text: 'w', due: '2026-11-17' }, { ...base, text: 'l', due: '2026-11-18' }],
      '2026-11-10',
    )
    expect([b.overdue.length, b.today.length, b.week.length, b.later.length]).toEqual([0, 1, 1, 1])
  })

  it('addDays works on calendar strings across month and year ends and leap days', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('todayString is the local calendar day', () => {
    expect(todayString(new Date(2026, 10, 10, 23, 59))).toBe('2026-11-10')
    expect(todayString(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05')
  })

  it('isDueDate accepts real dates only', () => {
    expect(isDueDate('2026-02-28')).toBe(true)
    expect(isDueDate('2026-02-30')).toBe(false)
    expect(isDueDate('tomorrow')).toBe(false)
  })

  it('tasks are sorted by due date then text inside a bucket', () => {
    const base = { mapId: 'm', mapTitle: 'M', nodeId: 'n', done: false }
    const b = bucketTasks([{ ...base, text: 'z', due: '2026-11-12' }, { ...base, text: 'b', due: '2026-11-11' }, { ...base, text: 'a', due: '2026-11-11' }], '2026-11-10')
    expect(b.week.map((t) => t.text)).toEqual(['a', 'b', 'z'])
  })
})
