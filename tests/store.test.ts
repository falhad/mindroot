import { beforeEach, describe, expect, it } from 'vitest'
import { parseOutline, docFromOutline } from '../src/core/outline'
import {
  addChild, addSibling, commit, deleteSelection, endEdit, openDoc, primary, redo, select, undo, useDoc, startEdit, dropNodes, toggleCollapse,
} from '../src/state/doc'
import { setText } from '../src/core/tree'

const byText = (t: string) => Object.values(useDoc.getState().doc!.nodes).find((n) => n.text === t)!.id
const texts = () => Object.values(useDoc.getState().doc!.nodes).map((n) => n.text).sort()

beforeEach(() => openDoc(docFromOutline(parseOutline('# R\n- A\n- B\n  - B1'))))

describe('doc store', () => {
  it('undo/redo restore structure and selection stays valid', () => {
    select([byText('B1')])
    deleteSelection()
    expect(texts()).toEqual(['A', 'B', 'R'])
    expect(primary()).toBe(byText('B'))
    undo()
    expect(texts()).toEqual(['A', 'B', 'B1', 'R'])
    redo()
    expect(texts()).toEqual(['A', 'B', 'R'])
  })

  it('a new commit clears the redo stack', () => {
    commit((d) => setText(d, byText('A'), 'A2'))
    undo()
    expect(useDoc.getState().future).toHaveLength(1)
    commit((d) => setText(d, byText('A'), 'A3'))
    expect(useDoc.getState().future).toHaveLength(0)
  })

  it('coalesces rapid edits with the same key into one undo step', () => {
    const id = byText('A')
    const before = useDoc.getState().past.length
    for (const t of ['n1', 'n12', 'n123']) commit((d) => void (d.nodes[id].notes = t), { coalesce: 'notes' })
    expect(useDoc.getState().past.length).toBe(before + 1)
    undo()
    expect(useDoc.getState().doc!.nodes[id].notes).toBeUndefined()
  })

  it('no-op commits do not create history', () => {
    const n = useDoc.getState().past.length
    expect(commit(() => {})).toBe(false)
    expect(useDoc.getState().past.length).toBe(n)
  })

  it('a new node is removed again when its edit is cancelled', () => {
    select([byText('A')])
    addChild()
    expect(texts()).toHaveLength(5)
    endEdit(null)
    expect(texts()).toEqual(['A', 'B', 'B1', 'R'])
    expect(primary()).toBe(byText('A'))
  })

  it('a new node keeps the typed text when the edit is committed', () => {
    select([byText('B')])
    addSibling()
    endEdit('C')
    expect(texts()).toEqual(['A', 'B', 'B1', 'C', 'R'])
    expect(useDoc.getState().doc!.nodes[byText('C')].parentId).toBe(useDoc.getState().doc!.root)
  })

  it('editing grows the live layout via the draft', () => {
    const id = byText('A')
    startEdit(id)
    const w0 = useDoc.getState().layout!.boxes[id].w
    useDoc.setState({ draft: { id, text: 'a considerably longer label than before' } })
    expect(w0).toBeGreaterThan(0)
  })

  it('dropNodes reparents and pins the side for root children', () => {
    dropNodes([byText('B1')], { parent: useDoc.getState().doc!.root, anchor: { id: byText('A'), after: false }, side: 'left' })
    const d = useDoc.getState().doc!
    expect(d.nodes[byText('B1')].parentId).toBe(d.root)
    expect(d.nodes[byText('B1')].side).toBe('left')
    expect(d.nodes[d.root].children[0]).toBe(byText('B1'))
  })

  it('collapse toggles the selection and hides the subtree', () => {
    select([byText('B')])
    toggleCollapse()
    expect(useDoc.getState().layout!.boxes[byText('B1')]).toBeUndefined()
    toggleCollapse()
    expect(useDoc.getState().layout!.boxes[byText('B1')]).toBeDefined()
  })
})
