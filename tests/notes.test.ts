import { describe, expect, it } from 'vitest'
import { renderNotes } from '../src/core/mdnotes'
import { MAX_ATTACHMENT, addAttachment, attachmentExt, downloadName, formatSize, isOpenable } from '../src/io/attachments'
import type { AssetIO } from '../src/io/assets'

describe('renderNotes (Markdown, code, math)', () => {
  it('renders headings, lists and emphasis', async () => {
    const html = await renderNotes('## Title\n\n- one\n- **two**\n\n*x*')
    expect(html).toContain('<h2')
    expect(html).toContain('<li')
    expect(html).toContain('<strong>two</strong>')
  })

  it('removes scripts, event handlers and javascript: links', async () => {
    const html = await renderNotes('<script>alert(1)</script><img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1)) [ok](https://example.com)')
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/onerror/i)
    expect(html).not.toMatch(/javascript:/i)
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('renders inline and display math with KaTeX', async () => {
    const html = await renderNotes('Energy $E=mc^2$ and\n\n$$\\int_0^1 x\\,dx$$')
    expect(html).toContain('class="katex"')
    expect(html).toContain('katex-display')
  })

  it('a lone dollar sign or a price is not math', async () => {
    const html = await renderNotes('It costs $5 and then $10 more.')
    expect(html).not.toContain('katex')
    expect(html).toContain('$5')
  })

  it('bad math does not throw and shows the source', async () => {
    const html = await renderNotes('$\\frac{1$')
    expect(typeof html).toBe('string')
  })

  it('highlights fenced code in a known language and keeps unknown languages as plain code', async () => {
    const ts = await renderNotes('```ts\nconst a: number = 1\n```')
    expect(ts).toContain('hljs-keyword')
    const unknown = await renderNotes('```zzz\n<b>not html</b>\n```')
    expect(unknown).toContain('&lt;b&gt;')
    expect(unknown).not.toContain('<b>not')
  })

  it('keeps Persian paragraphs direction-neutral (dir=auto)', async () => {
    const html = await renderNotes('این یک یادداشت است\n\n- مورد اول')
    expect(html).toMatch(/<p[^>]*dir="auto"/)
    expect(html).toMatch(/<li[^>]*dir="auto"/)
  })

  it('empty text renders an empty string', async () => {
    expect(await renderNotes('')).toBe('')
  })
})

function memoryAssets(): AssetIO & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>()
  return { files, exists: async (n) => files.has(n), save: async (n, b) => void files.set(n, b), load: async (n) => files.get(n)! }
}
const file = (name: string, bytes: number[] | number, type = 'application/pdf') =>
  new File([typeof bytes === 'number' ? new Uint8Array(bytes) : new Uint8Array(bytes)], name, { type })

describe('attachments', () => {
  it('attachmentExt keeps a short alphanumeric extension and falls back to bin', () => {
    expect(attachmentExt('My File.PDF')).toBe('pdf')
    expect(attachmentExt('archive.tar.gz')).toBe('gz')
    expect(attachmentExt('noext')).toBe('bin')
    expect(attachmentExt('weird.a/../b')).toBe('bin')
    expect(attachmentExt('x.waytoolongextension')).toBe('bin')
    expect(attachmentExt('x.tmp')).toBe('bin')
  })

  it('stores the file by its hash and records name, mime and size', async () => {
    const io = memoryAssets()
    const a = await addAttachment(file('Plan.pdf', [1, 2, 3]), io)
    expect(a).toMatchObject({ name: 'Plan.pdf', mime: 'application/pdf', size: 3 })
    expect(a.asset).toMatch(/^[0-9a-f]{64}\.pdf$/)
    expect(io.files.get(a.asset)).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('the same file twice stores one asset', async () => {
    const io = memoryAssets()
    const a = await addAttachment(file('a.pdf', [9, 9]), io)
    const b = await addAttachment(file('copy of a.pdf', [9, 9]), io)
    expect(a.asset).toBe(b.asset)
    expect(io.files.size).toBe(1)
    expect(a.id).not.toBe(b.id)
  })

  it('rejects files over 25 MB and empty files', async () => {
    const io = memoryAssets()
    await expect(addAttachment(file('big.bin', MAX_ATTACHMENT + 1), io)).rejects.toThrow(/25 MB/)
    await expect(addAttachment(file('empty.txt', 0), io)).rejects.toThrow(/empty/i)
    expect(io.files.size).toBe(0)
  })

  it('only document, image, audio and video types are opened; programs and scripts are not', () => {
    const h = 'a'.repeat(64)
    for (const e of ['pdf', 'png', 'docx', 'txt']) expect(isOpenable({ asset: `${h}.${e}` })).toBe(true)
    for (const e of ['sh', 'exe', 'app', 'command', 'zip', 'html', 'svg', 'bin', 'docm']) expect(isOpenable({ asset: `${h}.${e}` })).toBe(false)
  })

  it('the download name is cleaned and always carries the asset extension, whatever the stored name says', () => {
    const h = 'a'.repeat(64)
    expect(downloadName({ name: '../../etc/passwd', asset: `${h}.txt` })).toBe('_.._etc_passwd.txt')
    expect(downloadName({ name: 'run.sh', asset: `${h}.pdf` })).toBe('run.sh.pdf')
    expect(downloadName({ name: 'Plan.PDF', asset: `${h}.pdf` })).toBe('Plan.PDF')
    expect(downloadName({ name: '', asset: `${h}.pdf` })).toBe('attachment.pdf')
    expect(downloadName({ name: '.hidden', asset: `${h}.pdf` })).toBe('hidden.pdf')
  })

  it('formatSize is short and readable', () => {
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(2048)).toBe('2.0 KB')
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})
