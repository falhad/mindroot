import { useEffect, useState } from 'react'
import { FileCode2, FileImage, FileJson, FileText, FileType2, Globe, List, Loader2, Shapes, X } from 'lucide-react'
import { useRegistry } from '../plugins/host'
import { buildSvg, exportMap, type ExportFormat } from '../io/exporters'
import { useDoc } from '../state/doc'
import { toast, ui, useUi } from '../state/ui'
import { Modal } from './Overlays'

const FORMATS: { id: ExportFormat; name: string; ext: string; blurb: string; icon: typeof FileImage; visual: boolean }[] = [
  { id: 'png', name: 'PNG image', ext: '.png', blurb: 'Sharp raster image, great for slides and chat.', icon: FileImage, visual: true },
  { id: 'svg', name: 'SVG vector', ext: '.svg', blurb: 'Scales forever. Opens in Figma, Illustrator, browsers.', icon: Shapes, visual: true },
  { id: 'pdf', name: 'PDF document', ext: '.pdf', blurb: 'One page sized to your map, ready to print or send.', icon: FileType2, visual: true },
  { id: 'md', name: 'Markdown outline', ext: '.md', blurb: 'Nested list with notes and checklists.', icon: FileText, visual: false },
  { id: 'opml', name: 'OPML outline', ext: '.opml', blurb: 'Nested outline for outliners and feed readers.', icon: List, visual: false },
  { id: 'html', name: 'Web page', ext: '.html', blurb: 'One file you can open anywhere: pan, zoom, collapse, read notes.', icon: Globe, visual: false },
  { id: 'json', name: 'Branchmint file', ext: '.json', blurb: 'Full-fidelity backup you can re-import.', icon: FileJson, visual: false },
]

export function ExportDialog() {
  const open = useUi((s) => s.exportOpen)
  if (!open) return null
  return <Inner />
}

function Inner() {
  const doc = useDoc((s) => s.doc)!
  const appDark = useUi((s) => s.dark)
  const [format, setFormat] = useState<ExportFormat>('png')
  const [dark, setDark] = useState(appDark)
  const [transparent, setTransparent] = useState(false)
  const [scale, setScale] = useState<1 | 2 | 3>(2)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const pluginFormats = useRegistry((s) => s.exporters)
  const formats = [
    ...FORMATS,
    ...pluginFormats.map((p) => ({ id: `plugin:${p.id}` as ExportFormat, name: p.title, ext: p.extension, blurb: 'Added by a plugin.', icon: FileCode2, visual: false })),
  ]
  const f = formats.find((x) => x.id === format) ?? formats[0]

  useEffect(() => {
    if (!f.visual) return setPreview(null)
    let url: string | null = null
    let alive = true
    const t = setTimeout(async () => {
      try {
        const { svg } = await buildSvg(doc, { dark, transparent, scale })
        if (!alive) return
        url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
        setPreview(url)
      } catch {
        setPreview(null)
      }
    }, 60)
    return () => {
      alive = false
      clearTimeout(t)
      if (url) URL.revokeObjectURL(url)
    }
  }, [doc, dark, transparent, scale, f.visual])

  const run = async () => {
    setBusy(true)
    try {
      const ok = await exportMap(doc, format, { dark, transparent, scale })
      if (ok) {
        toast(`Exported ${f.name}`, 'success')
        ui.setExport(false)
      }
    } catch (e) {
      toast(`Export failed: ${e instanceof Error ? e.message : e}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={() => ui.setExport(false)} label="Export" width={780} top="8vh">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="text-[15px] font-semibold">Export “{doc.meta.title}”</h2>
        <button className="btn icon" aria-label="Close" onClick={() => ui.setExport(false)}><X size={16} /></button>
      </div>
      <div className="grid gap-0 sm:grid-cols-[250px_1fr]">
        <div className="space-y-1 border-line p-3 sm:border-r">
          {formats.map((x) => (
            <button key={x.id} onClick={() => setFormat(x.id)} aria-pressed={format === x.id}
              className={`flex w-full items-start gap-3 rounded-xl border p-2.5 text-left transition-colors ${format === x.id ? 'border-accent bg-active' : 'border-transparent hover:bg-hover'}`}>
              <x.icon size={18} className={format === x.id ? 'text-accent' : 'text-muted'} />
              <span>
                <span className="block text-[13.5px] font-medium">{x.name} <span className="text-muted">{x.ext}</span></span>
                <span className="block text-[11.5px] leading-snug text-muted">{x.blurb}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="flex min-h-[340px] flex-col p-4">
          {f.visual ? (
            <>
              <div className="relative flex min-h-[220px] flex-1 items-center justify-center overflow-hidden rounded-xl border border-line"
                style={{ background: transparent ? 'repeating-conic-gradient(var(--hover) 0% 25%, transparent 0% 50%) 50% / 16px 16px' : undefined }}>
                {preview ? <img src={preview} alt="Export preview" className="max-h-[300px] max-w-full object-contain" /> : <Loader2 className="animate-spin text-muted" />}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
                <label className="flex items-center gap-2 text-[13px]">
                  <span className="text-muted">Appearance</span>
                  <span className="seg">
                    <button className={!dark ? 'on' : ''} onClick={() => setDark(false)}>Light</button>
                    <button className={dark ? 'on' : ''} onClick={() => setDark(true)}>Dark</button>
                  </span>
                </label>
                {(format === 'png' || format === 'svg') && (
                  <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />
                    Transparent background
                  </label>
                )}
                {format !== 'svg' && (
                  <label className="flex items-center gap-2 text-[13px]">
                    <span className="text-muted">Quality</span>
                    <span className="seg">
                      {([1, 2, 3] as const).map((s) => (
                        <button key={s} className={scale === s ? 'on' : ''} onClick={() => setScale(s)}>{s}×</button>
                      ))}
                    </span>
                  </label>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[var(--line-strong)] p-6 text-center">
              <f.icon size={32} className="text-muted" />
              <p className="max-w-xs text-[13px] text-muted">{f.blurb}</p>
            </div>
          )}
          <div className="mt-4 flex items-center justify-between">
            <span className="text-[12px] text-muted">{Object.keys(doc.nodes).length} ideas</span>
            <button className="btn primary" style={{ height: 36, paddingInline: 18 }} onClick={run} disabled={busy}>
              {busy && <Loader2 size={15} className="animate-spin" />} Export {f.ext}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
