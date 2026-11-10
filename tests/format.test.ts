import { describe, expect, it } from 'vitest'
import { produce } from 'immer'
import { parseDocText, serializeDoc } from '../src/core/format'
import { docFromOutline, parseOutline, sanitizeDoc } from '../src/core/outline'
import { addChecklistItem } from '../src/core/tree'
import { bytesToDataUrl, collectAssets, dataUrlToBytes, hydrateImages, type AssetIO } from '../src/io/assets'

const sample = () => docFromOutline(parseOutline('# Root\n- A\n  - A1\n- B\n- C'))
const byText = (d: ReturnType<typeof sample>, t: string) => Object.values(d.nodes).find((n) => n.text === t)!.id
const noImages = () => undefined

function memoryAssets(): AssetIO & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>()
  return {
    files,
    exists: async (n) => files.has(n),
    save: async (n, b) => void files.set(n, b),
    load: async (n) => {
      const f = files.get(n)
      if (!f) throw new Error('missing')
      return f
    },
  }
}

describe('format (JSON Lines)', () => {
  it('writes one record per line, sorted by id, with a header first', () => {
    const d = sample()
    const lines = serializeDoc(d, noImages).trim().split('\n')
    expect(lines).toHaveLength(1 + Object.keys(d.nodes).length)
    expect(JSON.parse(lines[0])).toMatchObject({ t: 'map', v: 3, root: d.root })
    const ids = lines.slice(1).map((l) => JSON.parse(l).id as string)
    expect(ids).toEqual([...ids].sort())
    expect(lines.every((l) => !l.includes('\n'))).toBe(true)
  })

  it('round-trips a document through text', () => {
    const d = produce(sample(), (x) => {
      x.nodes[byText(x, 'A1')].notes = 'line one\nline two'
      x.nodes[byText(x, 'B')].collapsed = true
      x.nodes[byText(x, 'C')].color = '3'
      addChecklistItem(x, byText(x, 'C'), 'task', true)
      x.relations.push({ id: 'r1', from: byText(x, 'B'), to: byText(x, 'C'), label: 'see' })
      x.layout = 'radial'
      x.bg = 'grid'
    })
    const back = sanitizeDoc(parseDocText(serializeDoc(d, noImages)))
    expect(back.nodes).toEqual(d.nodes)
    expect(back.relations).toEqual(d.relations)
    expect([back.layout, back.bg, back.root]).toEqual(['radial', 'grid', d.root])
    expect(back.meta.id).toBe(d.meta.id)
  })

  it('does not store thumbnail or search text, and output is stable', () => {
    const d = produce(sample(), (x) => {
      x.meta.thumb = '<svg>big</svg>'
      x.meta.search = 'a b c'
    })
    const text = serializeDoc(d, noImages)
    expect(text).not.toContain('<svg>')
    expect(text).not.toContain('"search"')
    expect(serializeDoc(d, noImages)).toBe(text)
  })

  it('an edit changes only the line of the edited node (plus the header timestamp)', () => {
    const d = sample()
    const edited = produce(d, (x) => void (x.nodes[byText(x, 'B')].text = 'B changed'))
    const a = serializeDoc(d, noImages).split('\n')
    const b = serializeDoc(edited, noImages).split('\n')
    expect(b.filter((l, i) => l !== a[i])).toHaveLength(1)
  })

  it('reads version 1 single-document files', () => {
    const d = sample()
    const v1 = JSON.stringify(d)
    const back = sanitizeDoc(parseDocText(v1))
    expect(Object.keys(back.nodes)).toHaveLength(Object.keys(d.nodes).length)
  })

  it('ignores unknown record types and rejects broken lines', () => {
    const text = serializeDoc(sample(), noImages) + '{"t":"future-thing","x":1}\n'
    expect(Object.keys(sanitizeDoc(parseDocText(text)).nodes)).toHaveLength(5)
    expect(() => parseDocText(serializeDoc(sample(), noImages) + '{ broken\n')).toThrow(/line/)
    expect(() => parseDocText('')).toThrow()
  })
})

describe('image assets', () => {
  const png = bytesToDataUrl(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]), 'image/png')

  it('stores images as content-addressed files and brings them back', async () => {
    const io = memoryAssets()
    const d = produce(sample(), (x) => void (x.nodes[byText(x, 'A')].image = { src: png, w: 10, h: 20 }))
    const refs = await collectAssets(d, io)
    const name = refs.get(png)!
    expect(name).toMatch(/^[0-9a-f]{64}\.png$/)
    expect(io.files.size).toBe(1)

    const text = serializeDoc(d, (s) => refs.get(s))
    expect(text).not.toContain('data:image')
    expect(text).toContain(name)

    const raw = parseDocText(text)
    expect(await hydrateImages(raw, io)).toEqual([])
    const back = sanitizeDoc(raw)
    expect(back.nodes[byText(d, 'A')].image).toEqual({ src: png, w: 10, h: 20 })
  })

  it('the same image used twice is stored once', async () => {
    const io = memoryAssets()
    const d = produce(sample(), (x) => {
      x.nodes[byText(x, 'A')].image = { src: png, w: 1, h: 1 }
      x.nodes[byText(x, 'B')].image = { src: png, w: 1, h: 1 }
    })
    await collectAssets(d, io)
    expect(io.files.size).toBe(1)
  })

  it('a missing asset file drops the image instead of breaking the map', async () => {
    // unique bytes, so the in-memory image cache from other tests cannot answer for it
    const lonely = bytesToDataUrl(new Uint8Array([137, 80, 78, 71, 9, 9, 9, 42]), 'image/png')
    const io = memoryAssets()
    const d = produce(sample(), (x) => void (x.nodes[byText(x, 'A')].image = { src: lonely, w: 1, h: 1 }))
    const refs = await collectAssets(d, io)
    const raw = parseDocText(serializeDoc(d, (s) => refs.get(s)))
    const name = refs.get(lonely)!
    // simulate another device that has the map file but not the image yet
    const cacheBust = raw.nodes[byText(d, 'A')].image
    cacheBust.asset = name.replace(/^./, name[0] === '0' ? '1' : '0')
    const missing = await hydrateImages(raw, io)
    expect(missing).toEqual([cacheBust.asset])
    expect(sanitizeDoc(raw).nodes[byText(d, 'A')].image).toBeUndefined()
  })

  it('rejects data URLs that are not supported images', () => {
    expect(dataUrlToBytes('data:text/html;base64,AAAA')).toBeNull()
    expect(dataUrlToBytes('not a url')).toBeNull()
    expect(dataUrlToBytes(png)?.ext).toBe('png')
  })
})

describe('format v3 (additive fields)', () => {
  const rich = () =>
    produce(sample(), (x) => {
      const a = byText(x, 'A')
      const b = byText(x, 'B')
      const c = byText(x, 'C')
      Object.assign(x.nodes[a], {
        tags: ['urgent', 'کار'],
        due: '2026-12-01',
        done: false,
        mapLink: { mapId: 'map12345', nodeId: 'n1' },
        attachments: [{ id: 'f1', name: 'a.pdf', asset: 'abc.pdf', mime: 'application/pdf', size: 10 }],
        notesFmt: 'md',
      })
      x.nodes[b].sticky = true
      x.relations.push({ id: 'r1', from: b, to: c, label: 'blocks', arrow: 'both', dash: 'dotted' })
      x.groups = [{ id: 'g1', ids: [b, c], label: 'Pair', color: '2' }]
      x.summaries = [{ id: 's1', parentId: x.root, from: a, to: b, label: 'Both' }]
      x.font = 'serif'
      x.dir = 'rtl'
      x.customTheme = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', '#888888']
      x.nodes['fl1'] = { id: 'fl1', parentId: null, children: [], text: 'Loose', pos: { x: 10, y: -20 } }
    })

  it('round-trips every new field', () => {
    const d = rich()
    const back = sanitizeDoc(parseDocText(serializeDoc(d, noImages)))
    expect(back.nodes).toEqual(d.nodes)
    expect(back.relations).toEqual(d.relations)
    expect(back.groups).toEqual(d.groups)
    expect(back.summaries).toEqual(d.summaries)
    expect([back.font, back.dir, back.customTheme]).toEqual([d.font, d.dir, d.customTheme])
  })

  it('keeps floating nodes and still finds the single root', () => {
    const back = sanitizeDoc(parseDocText(serializeDoc(rich(), noImages)))
    expect(back.nodes['fl1'].pos).toEqual({ x: 10, y: -20 })
    expect(back.nodes[back.root].parentId).toBeNull()
  })

  it('a document without new fields writes no new keys and header v3', () => {
    const lines = serializeDoc(sample(), noImages).trim().split('\n')
    expect(JSON.parse(lines[0]).v).toBe(3)
    const keys = new Set(lines.slice(1).flatMap((l) => Object.keys(JSON.parse(l))))
    for (const k of ['tags', 'due', 'done', 'mapLink', 'attachments', 'pos', 'sticky', 'notesFmt']) expect(keys.has(k)).toBe(false)
    expect(lines.some((l) => l.startsWith('{"t":"group"') || l.startsWith('{"t":"sum"'))).toBe(false)
  })

  it('keeps unknown record types and unknown fields byte for byte', () => {
    const text = serializeDoc(sample(), noImages)
    const lines = text.trim().split('\n')
    const withExtra = [
      lines[0].replace('"bg":"dots"}', '"bg":"dots","future":{"a":1}}'),
      ...lines.slice(1).map((l, i) => (i === 0 ? l.replace('}', ',"zzz":[1,2]}') : l)),
      '{"t":"widget","id":"w1","x":5}',
    ].join('\n') + '\n'
    const back = sanitizeDoc(parseDocText(withExtra))
    const out = serializeDoc(back, noImages)
    expect(out).toContain('"zzz":[1,2]')
    expect(out).toContain('{"t":"widget","id":"w1","x":5}')
    expect(out).toContain('"future":{"a":1}')
    expect(serializeDoc(sanitizeDoc(parseDocText(out)), noImages)).toBe(out)
  })

  it('drops groups whose ids are not siblings and summaries with dangling ids', () => {
    const d = rich()
    const a1 = byText(d, 'A1')
    const bad = produce(d, (x) => {
      x.groups!.push({ id: 'g2', ids: [byText(x, 'A'), a1] })
      x.groups!.push({ id: 'g3', ids: ['nope'] })
      x.summaries!.push({ id: 's2', parentId: x.root, from: 'nope', to: byText(x, 'A'), label: 'x' })
    })
    const back = sanitizeDoc(parseDocText(serializeDoc(bad, noImages)))
    expect(back.groups!.map((g) => g.id)).toEqual(['g1'])
    expect(back.summaries!.map((s) => s.id)).toEqual(['s1'])
  })

  it('drops invalid due dates and bad tags', () => {
    const d = produce(sample(), (x) => {
      const a = x.nodes[byText(x, 'A')] as any
      a.due = 'tomorrow'
      a.tags = ['ok', 5, null]
    })
    const back = sanitizeDoc(parseDocText(serializeDoc(d, noImages)))
    const a = back.nodes[byText(back, 'A')]
    expect(a.due).toBeUndefined()
    expect(a.tags).toEqual(['ok'])
  })

  it('loads a v2 file', () => {
    const v2 = serializeDoc(sample(), noImages).replace('"v":3', '"v":2')
    const back = sanitizeDoc(parseDocText(v2))
    expect(Object.keys(back.nodes)).toHaveLength(5)
  })
})
