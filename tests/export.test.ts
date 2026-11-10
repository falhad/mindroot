import { describe, expect, it } from 'vitest'
import { fromOpml } from '../src/core/import/opml'
import { toHtml } from '../src/core/export/html'
import { toOpml } from '../src/core/export/opml'
import { computeLayout } from '../src/core/layout'
import { docFromOutline, parseOutline } from '../src/core/outline'
import { renderSvg } from '../src/core/svg'
import * as T from '../src/core/tree'
import type { MapDoc } from '../src/core/types'

const sample = () => docFromOutline(parseOutline('# Root\n- A\n  - A1\n- B\n- C'))
const id = (d: MapDoc, t: string) => Object.values(d.nodes).find((n) => n.text === t)!.id
const texts = (d: MapDoc) => T.orderedIds(d).map((i) => d.nodes[i].text)

describe('OPML export', () => {
  it('is valid XML and roundtrips through the OPML importer (text, notes, links, Persian)', () => {
    const d = sample()
    d.nodes[id(d, 'A')].notes = 'line one\nline "two" & <three>'
    d.nodes[id(d, 'B')].link = 'https://example.com/?a=1&b=2'
    T.addChild(d, id(d, 'C'), 'سیب')
    const xml = toOpml(d)
    expect(new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagName('parsererror')).toHaveLength(0)
    const back = fromOpml(xml)
    expect(texts(back)).toEqual(texts(d))
    expect(Object.keys(back.nodes).filter((k) => k in d.nodes)).toEqual([]) // an import makes new ids
    const a = Object.values(back.nodes).find((n) => n.text === 'A')!
    expect(a.notes).toBe('line one\nline "two" & <three>')
    expect(Object.values(back.nodes).find((n) => n.text === 'B')!.link).toBe('https://example.com/?a=1&b=2')
  })

  it('writes the map title in the head, and floating nodes after the main outline', () => {
    const d = sample()
    T.addFloat(d, 0, 0, 'Loose')
    const xml = toOpml(d)
    expect(xml).toContain('<title>Root</title>')
    expect(xml.indexOf('text="Root"')).toBeLessThan(xml.indexOf('text="Loose"'))
  })

  it('removes characters that are not allowed in XML', () => {
    const d = sample()
    d.nodes[id(d, 'A')].text = 'bad\u0000char\u0008here'
    const xml = toOpml(d)
    expect(new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagName('parsererror')).toHaveLength(0)
    expect(xml).toContain('badcharhere')
  })
})

describe('HTML export', () => {
  const page = (d: MapDoc, fontCss = '') => {
    const l = computeLayout(d)
    const light = renderSvg(d, l, { dark: false, background: false, interactive: true })
    const dark = renderSvg(d, l, { dark: true, background: false, interactive: true })
    return toHtml(d, { light: light.svg, dark: dark.svg, width: light.width, height: light.height, fontCss })
  }
  const data = (html: string) => {
    const m = /<script type="application\/json" id="map-data">([\s\S]*?)<\/script>/.exec(html)!
    return JSON.parse(m[1])
  }

  it('is one self-contained file with no outside requests', () => {
    const d = sample()
    const html = page(d)
    const withoutNs = html.replace(/http:\/\/www\.w3\.org\/\d+\/(svg|xlink)/g, '')
    expect(withoutNs).not.toMatch(/https?:\/\//)
    expect(html).not.toMatch(/<link[^>]+href=|<script[^>]+src=|@import|url\(\s*['"]?https?:/i)
    expect(html.startsWith('<!doctype html>')).toBe(true)
  })

  it('carries the notes and links of every node as data, with the closing script tag escaped', () => {
    const d = sample()
    d.nodes[id(d, 'A')].notes = 'danger </script><script>alert(1)</script> & more'
    d.nodes[id(d, 'B')].link = 'https://example.com/x'
    const html = page(d)
    expect(html.match(/<\/script>/g)!.length).toBe(2) // the data block and the app script, nothing from the notes
    const map = data(html)
    expect(map.nodes[id(d, 'A')].notes).toBe('danger </script><script>alert(1)</script> & more')
    expect(map.nodes[id(d, 'B')].link).toBe('https://example.com/x')
    expect(map.nodes[d.root].children).toContain(id(d, 'A'))
  })

  it('escapes the title and marks interactive nodes and edges in the drawing', () => {
    const d = sample()
    d.nodes[d.root].text = '<b>Root & co</b>'
    d.meta.title = '<b>Root & co</b>'
    const html = page(d)
    expect(html).toContain('<title>&lt;b&gt;Root &amp; co&lt;/b&gt;</title>')
    expect(html).toContain(`data-node="${id(d, 'A')}"`)
    expect(html).toContain(`data-edge="${id(d, 'A1')}"`)
  })

  it('has a light and a dark drawing and follows the system setting', () => {
    const html = page(sample())
    expect(html).toContain('prefers-color-scheme: dark')
    expect((html.match(/<svg /g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('stays small: a 200-idea map with the Persian font is under 600 KB', () => {
    const lines = ['# Big']
    for (let i = 0; i < 20; i++) {
      lines.push(`- Branch ${i}`)
      for (let j = 0; j < 9; j++) lines.push(`  - Leaf ${i}-${j} some words to make it wider`)
    }
    const d = docFromOutline(parseOutline(lines.join('\n')))
    const fakeFont = '@font-face{font-family:X;src:url(data:font/woff2;base64,' + 'A'.repeat(200_000) + ')}'
    const html = page(d, fakeFont)
    expect(Object.keys(d.nodes).length).toBe(201)
    expect(new TextEncoder().encode(html).length).toBeLessThan(600_000)
  })
})
