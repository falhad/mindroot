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
