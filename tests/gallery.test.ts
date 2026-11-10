import { describe, expect, it } from 'vitest'
import { compareVersions, entryState, parseIndex } from '../src/plugins/gallery'

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'acme.hello', name: 'Hello', version: '1.2.0', description: 'Says hello', author: 'Acme', permissions: ['net'],
  url: 'https://example.com/hello-1.2.0.zip', sha256: 'a'.repeat(64), ...over,
})

describe('gallery index', () => {
  it('reads valid entries and keeps their fields', () => {
    const r = parseIndex(JSON.stringify({ version: 1, plugins: [entry()] }))
    expect(r.entries).toEqual([{ id: 'acme.hello', name: 'Hello', version: '1.2.0', description: 'Says hello', author: 'Acme', permissions: ['net'], url: 'https://example.com/hello-1.2.0.zip', sha256: 'a'.repeat(64) }])
    expect(r.skipped).toBe(0)
  })

  it('skips entries with an invalid id, address or checksum, and counts them', () => {
    const r = parseIndex(JSON.stringify({ plugins: [
      entry(), entry({ id: 'Bad Id' }), entry({ id: '../x' }), entry({ url: 'http://example.com/x.zip' }), entry({ url: 'javascript:alert(1)' }),
      entry({ sha256: 'xyz' }), entry({ id: 'acme.upper', sha256: 'A'.repeat(64) }), entry({ name: '' }), entry({ version: 5 }), null, 'text',
    ] }))
    expect(r.entries.map((e) => e.id)).toEqual(['acme.hello', 'acme.upper'])
    expect(r.entries[1].sha256).toBe('a'.repeat(64)) // upper-case checksums are lower-cased
    expect(r.skipped).toBe(9)
  })

  it('keeps only known permissions and removes duplicate ids (first wins)', () => {
    const r = parseIndex(JSON.stringify({ plugins: [entry({ permissions: ['net', 'root', 'native', 'secrets'] }), entry({ name: 'Second' })] }))
    expect(r.entries).toHaveLength(1)
    expect(r.entries[0].permissions).toEqual(['net', 'native', 'secrets'])
    expect(r.entries[0].name).toBe('Hello')
  })

  it('a broken or foreign document is an error the user can read', () => {
    expect(() => parseIndex('not json')).toThrow(/gallery/i)
    expect(() => parseIndex('{"nope":1}')).toThrow(/gallery/i)
    expect(() => parseIndex('[]')).toThrow(/gallery/i)
  })
})

describe('versions', () => {
  it('compares dotted numbers, not text', () => {
    expect(compareVersions('1.10.0', '1.2.0')).toBe(1)
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0)
    expect(compareVersions('1.2', '1.2.1')).toBe(-1)
    expect(compareVersions('2', '1.99.99')).toBe(1)
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(-1)
  })

  it('entryState: new, installed, or update', () => {
    const e = parseIndex(JSON.stringify({ plugins: [entry()] })).entries[0]
    expect(entryState(e, [])).toBe('new')
    expect(entryState(e, [{ id: 'other', version: '9.9.9' }])).toBe('new')
    expect(entryState(e, [{ id: 'acme.hello', version: '1.2.0' }])).toBe('installed')
    expect(entryState(e, [{ id: 'acme.hello', version: '1.3.0' }])).toBe('installed') // never "downgrade"
    expect(entryState(e, [{ id: 'acme.hello', version: '1.1.0' }])).toBe('update')
  })
})
