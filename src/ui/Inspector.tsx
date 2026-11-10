import { Fragment, useState, type ReactNode } from 'react'
import { ExternalLink, ImagePlus, Link2, Plus, Trash2, X, Check, Smile } from 'lucide-react'
import { THEMES, resolveTheme } from '../core/themes'
import * as T from '../core/tree'
import { normalizeTag, setNodeTags } from '../core/tags'
import type { MindNode, Relation, ShapeKind } from '../core/types'
import { openExternal, pickFile, readImage } from '../io/files'
import { commit, floatSelection, groupSelection, primary, setConnectFrom, summarizeSelection, useDoc } from '../state/doc'
import { toast, useUi } from '../state/ui'
import { BGS, EDGES, LAYOUTS, setBg, setDirection, setEdge, setFont, setLayout, setMapTheme } from './commands'
import { FONT_CHOICES } from '../core/measure'
import type { FontId } from '../core/types'
import { AttachmentList } from './AttachmentList'
import { EMOJIS, NodeIcon, lucideIcons } from './icons'
import { NotesView } from './NotesView'

const Section = ({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) => (
  <section className="border-b border-line px-4 py-3.5">
    <div className="mb-2.5 flex items-center justify-between">
      <div className="label">{title}</div>
      {right}
    </div>
    {children}
  </section>
)

export function Inspector({ onClose }: { onClose: () => void }) {
  const doc = useDoc((s) => s.doc)
  const selection = useDoc((s) => s.selection)
  const [tab, setTab] = useState<'node' | 'map'>('node')
  if (!doc) return null
  const id = primary()
  const node = id ? doc.nodes[id] : null
  const active = tab === 'node' && node ? 'node' : 'map'

  return (
    <aside className="glass rise absolute bottom-3 right-3 top-14 z-20 flex w-[min(328px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl" aria-label="Inspector" style={{ background: 'var(--panel)' }}>
      <div className="flex items-center gap-2 border-b border-line p-2">
        <div className="seg flex-1">
          <button className={active === 'node' ? 'on' : ''} style={{ flex: 1 }} disabled={!node} onClick={() => setTab('node')}>
            {selection.length > 1 ? `${selection.length} nodes` : 'Node'}
          </button>
          <button className={active === 'map' ? 'on' : ''} style={{ flex: 1 }} onClick={() => setTab('map')}>Map</button>
        </div>
        <button className="btn icon" aria-label="Close panel" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{active === 'node' && node ? <NodePanel node={node} /> : <MapPanel />}</div>
    </aside>
  )
}

// ---------------- groups and brackets of the selected node ----------------

function ArrangeLists({ nodeId }: { nodeId: string }) {
  const doc = useDoc((s) => s.doc)!
  const groups = (doc.groups ?? []).filter((g) => g.ids.includes(nodeId))
  const sums = (doc.summaries ?? []).filter((s) => {
    const kids = doc.nodes[s.parentId]?.children ?? []
    const i = kids.indexOf(nodeId)
    return i >= kids.indexOf(s.from) && i <= kids.indexOf(s.to) && i >= 0
  })
  if (!groups.length && !sums.length) return null
  return (
    <ul className="mt-3 space-y-1.5">
      {groups.map((g) => (
        <li key={g.id} className="flex items-center gap-1.5">
          <span className="text-[12px] text-muted">Group</span>
          <input className="field" style={{ height: 28, flex: 1, minWidth: 0 }} dir="auto" placeholder="Label" aria-label="Group label" value={g.label ?? ''}
            onChange={(e) => commit((d) => T.setGroupLabel(d, g.id, e.target.value), { coalesce: `grp:${g.id}` })} />
          <button className="btn icon" style={{ width: 24, height: 24 }} aria-label="Remove group" onClick={() => commit((d) => T.ungroup(d, g.id))}><X size={13} /></button>
        </li>
      ))}
      {sums.map((s) => (
        <li key={s.id} className="flex items-center gap-1.5">
          <span className="text-[12px] text-muted">Bracket</span>
          <input className="field" style={{ height: 28, flex: 1, minWidth: 0 }} dir="auto" placeholder="Label" aria-label="Bracket label" value={s.label}
            onChange={(e) => commit((d) => T.setSummaryLabel(d, s.id, e.target.value), { coalesce: `sum:${s.id}` })} />
          <button className="btn icon" style={{ width: 24, height: 24 }} aria-label="Remove bracket" onClick={() => commit((d) => T.removeSummary(d, s.id))}><X size={13} /></button>
        </li>
      ))}
    </ul>
  )
}

// ---------------- tags ----------------

/** Chips plus an input. Enter or comma adds; Backspace on an empty input removes the last tag. */
function TagEditor({ ids, tags }: { ids: string[]; tags: string[] }) {
  const [v, setV] = useState('')
  const add = (raw: string) => {
    const parts = raw.split(/[,،]/).map(normalizeTag).filter(Boolean)
    if (!parts.length) return
    commit((d) => setNodeTags(d, ids, [...new Set([...tags, ...parts])]))
    setV('')
  }
  return (
    <div>
      <div className="flex flex-wrap gap-1.5" aria-label="Tags">
        {tags.map((t) => (
          <span key={t} data-tag={t} className="inline-flex items-center gap-1 rounded-full bg-hover px-2 py-0.5 text-[12px]" dir="auto">
            #{t}
            <button className="grid h-4 w-4 place-items-center rounded-full hover:bg-line" aria-label={`Remove tag ${t}`} onClick={() => commit((d) => setNodeTags(d, ids, tags.filter((x) => x !== t)))}>
              <X size={11} />
            </button>
          </span>
        ))}
      </div>
      <input
        className="field mt-2"
        dir="auto"
        placeholder="Add a tag, press Enter"
        aria-label="Add tag"
        value={v}
        spellCheck={false}
        onChange={(e) => (/[,،]$/.test(e.target.value) ? add(e.target.value) : setV(e.target.value))}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') { e.preventDefault(); add(v) }
          else if (e.key === 'Backspace' && !v && tags.length) commit((d) => setNodeTags(d, ids, tags.slice(0, -1)))
        }}
        onBlur={() => add(v)}
      />
    </div>
  )
}

// ---------------- node ----------------

function NodePanel({ node }: { node: MindNode }) {
  const doc = useDoc((s) => s.doc)!
  const selection = useDoc((s) => s.selection)
  const dark = useUi((s) => s.dark)
  const theme = resolveTheme(doc)
  const palette = dark ? theme.dark : theme.light
  const depth = T.depthOf(doc, node.id)
  const SHAPES: { id: ShapeKind | undefined; label: string }[] = [
    { id: undefined, label: 'Auto' }, { id: 'pill', label: 'Pill' }, { id: 'rounded', label: 'Round' }, { id: 'rect', label: 'Box' }, { id: 'plain', label: 'Text' },
  ]
  const [iconOpen, setIconOpen] = useState(false)
  const [preview, setPreview] = useState(false)
  const [newItem, setNewItem] = useState('')

  const attachImage = async (file?: File) => {
    if (!file) return
    try {
      const img = await readImage(file)
      commit((d) => T.setNodeImage(d, node.id, img))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add the image', 'error')
    }
  }
  const done = node.checklist?.filter((c) => c.done).length ?? 0
  const total = node.checklist?.length ?? 0
  const related = doc.relations.filter((r) => r.from === node.id || r.to === node.id)

  return (
    <>
      <Section title="Colour">
        <div className="flex flex-wrap items-center gap-2">
          <button
            title="Automatic"
            aria-label="Automatic colour"
            onClick={() => commit((d) => T.setNodeColor(d, selection, undefined))}
            className="grid h-6 w-6 place-items-center rounded-full border border-dashed border-[var(--line-strong)] text-muted"
            style={{ outline: !node.color ? '2px solid var(--accent)' : undefined, outlineOffset: 2 }}
          >
            {!node.color && <Check size={12} />}
          </button>
          {palette.map((c, i) => (
            <button
              key={i}
              aria-label={`Colour ${i + 1}`}
              onClick={() => commit((d) => T.setNodeColor(d, selection, String(i)))}
              className="h-6 w-6 rounded-full"
              style={{ background: c, outline: node.color === String(i) ? `2px solid ${c}` : undefined, outlineOffset: 2, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.12)' }}
            />
          ))}
          <label className="relative grid h-6 w-6 cursor-pointer place-items-center overflow-hidden rounded-full" title="Custom colour"
            style={{ background: 'conic-gradient(#f43f5e,#f59e0b,#22c55e,#06b6d4,#6366f1,#d946ef,#f43f5e)', outline: node.color?.startsWith('#') ? '2px solid var(--ink)' : undefined, outlineOffset: 2 }}>
            <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={node.color?.startsWith('#') ? node.color : '#0d9488'}
              onChange={(e) => commit((d) => T.setNodeColor(d, selection, e.target.value), { coalesce: 'color' })} />
          </label>
        </div>
        {depth > 0 && <p className="mt-2 text-[11.5px] text-muted">Applies to this branch. Children inherit it unless they set their own.</p>}
      </Section>

      <Section title="Shape">
        <div className="seg w-full">
          {SHAPES.map((s) => (
            <button key={s.label} style={{ flex: 1, padding: 0 }} className={node.shape === s.id ? 'on' : ''} onClick={() => commit((d) => T.setNodeShape(d, selection, s.id))}>
              {s.label}
            </button>
          ))}
        </div>
      </Section>

      <Section
        title="Icon"
        right={node.icon ? <button className="text-[12px] text-muted hover:text-ink" onClick={() => commit((d) => T.setNodeIcon(d, selection, undefined))}>Remove</button> : null}
      >
        <button className="btn outline w-full justify-between" onClick={() => setIconOpen((v) => !v)} aria-expanded={iconOpen}>
          <span className="flex items-center gap-2">
            {node.icon ? <NodeIcon icon={node.icon} size={16} /> : <Smile size={16} className="text-muted" />}
            {node.icon ? 'Change icon' : 'Add an icon'}
          </span>
        </button>
        {iconOpen && (
          <div className="rise mt-2 rounded-xl border border-line bg-solid p-2">
            <div className="grid grid-cols-8 gap-1">
              {Object.keys(lucideIcons).map((k) => (
                <button key={k} title={k} className={`btn icon ${node.icon === `lucide:${k}` ? 'on' : ''}`} style={{ width: '100%' }}
                  onClick={() => commit((d) => T.setNodeIcon(d, selection, `lucide:${k}`))}>
                  <NodeIcon icon={`lucide:${k}`} size={16} />
                </button>
              ))}
            </div>
            <div className="my-2 h-px bg-line" />
            <div className="grid grid-cols-8 gap-1">
              {EMOJIS.map((em) => (
                <button key={em} className={`btn icon ${node.icon === `emoji:${em}` ? 'on' : ''}`} style={{ width: '100%', fontSize: 16 }}
                  onClick={() => commit((d) => T.setNodeIcon(d, selection, `emoji:${em}`))}>
                  {em}
                </button>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section title="Arrange">
        <div className="flex flex-wrap gap-1.5">
          <button className="btn outline" onClick={() => groupSelection() || toast('Select nodes that share the same parent to group them')}>Group</button>
          <button className="btn outline" onClick={() => summarizeSelection() || toast('Select two or more neighbouring siblings for a bracket')}>Bracket</button>
          <button className="btn outline" disabled={node.id === doc.root || !node.parentId} onClick={() => floatSelection()}>Float</button>
        </div>
        <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-[13px]">
          <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={!!node.sticky}
            onChange={(e) => commit((d) => { for (const id of selection) { if (e.target.checked) d.nodes[id].sticky = true; else delete d.nodes[id].sticky } })} />
          Sticky note (no connector line)
        </label>
        <ArrangeLists nodeId={node.id} />
      </Section>

      <Section title="Tags">
        <TagEditor ids={selection} tags={node.tags ?? []} />
      </Section>

      <Section
        title="Notes"
        right={
          <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-muted" title="Headings, lists, **bold**, `code`, links and $math$">
            <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--accent)]" checked={node.notesFmt === 'md'}
              onChange={(e) => { setPreview(false); commit((d) => { if (e.target.checked) d.nodes[node.id].notesFmt = 'md'; else delete d.nodes[node.id].notesFmt }) }} />
            Markdown
          </label>
        }
      >
        {node.notesFmt === 'md' && (
          <div className="seg mb-2">
            <button className={!preview ? 'on' : ''} style={{ flex: 1 }} onClick={() => setPreview(false)}>Write</button>
            <button className={preview ? 'on' : ''} style={{ flex: 1 }} onClick={() => setPreview(true)}>Preview</button>
          </div>
        )}
        {node.notesFmt === 'md' && preview ? (
          <NotesView md={node.notes ?? ''} />
        ) : (
          <textarea
            className="field"
            rows={4}
            dir="auto"
            style={{ resize: 'vertical', minHeight: 84 }}
            placeholder={node.notesFmt === 'md' ? '## Heading, - list, `code`, $x^2$ …' : 'Write details, context, links…'}
            value={node.notes ?? ''}
            onChange={(e) => commit((d) => void (d.nodes[node.id].notes = e.target.value || undefined), { coalesce: `notes:${node.id}` })}
          />
        )}
      </Section>

      <Section title="Files" right={node.attachments?.length ? <span className="text-[12px] tabular-nums text-muted">{node.attachments.length}</span> : null}>
        <AttachmentList nodeId={node.id} items={node.attachments ?? []} />
      </Section>

      <Section title="Link" right={node.link ? <button className="btn icon" style={{ width: 24, height: 24 }} aria-label="Open link" onClick={() => void openExternal(node.link!)}><ExternalLink size={14} /></button> : null}>
        <div className="relative">
          <Link2 size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input className="field" style={{ paddingLeft: 30 }} placeholder="https://…" value={node.link ?? ''} spellCheck={false}
            onChange={(e) => commit((d) => void (d.nodes[node.id].link = e.target.value.trim() || undefined), { coalesce: `link:${node.id}` })} />
        </div>
      </Section>

      <Section title="Image" right={node.image ? <button className="text-[12px] text-muted hover:text-ink" onClick={() => commit((d) => T.setNodeImage(d, node.id, undefined))}>Remove</button> : null}>
        {node.image ? (
          <img src={node.image.src} alt="" className="max-h-40 w-full rounded-lg border border-line object-contain" />
        ) : (
          <button className="btn outline w-full"
            onClick={async () => attachImage((await pickFile('image/*'))[0])}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); void attachImage(e.dataTransfer.files[0]) }}>
            <ImagePlus size={15} /> Add image
          </button>
        )}
        <p className="mt-1.5 text-[11.5px] text-muted">You can also paste an image or drop one onto the map.</p>
      </Section>

      <Section title="Checklist" right={total ? <span className="text-[12px] tabular-nums text-muted">{done}/{total}</span> : null}>
        {total > 0 && (
          <div className="mb-2.5 h-1.5 overflow-hidden rounded-full bg-hover">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(done / total) * 100}%` }} />
          </div>
        )}
        <ul className="space-y-1">
          {node.checklist?.map((c) => (
            <li key={c.id} className="group flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={c.done}
                onChange={() => commit((d) => { const it = d.nodes[node.id].checklist?.find((x) => x.id === c.id); if (it) it.done = !it.done })} />
              <input className="flex-1 bg-transparent py-1 text-[13px] outline-none" style={{ textDecoration: c.done ? 'line-through' : undefined, opacity: c.done ? 0.55 : 1 }}
                value={c.text}
                onChange={(e) => commit((d) => { const it = d.nodes[node.id].checklist?.find((x) => x.id === c.id); if (it) it.text = e.target.value }, { coalesce: `check:${c.id}` })} />
              <button className="btn icon opacity-0 group-hover:opacity-100 focus-visible:opacity-100" style={{ width: 24, height: 24 }} aria-label="Remove item"
                onClick={() => commit((d) => { const n = d.nodes[node.id]; n.checklist = n.checklist?.filter((x) => x.id !== c.id); if (!n.checklist?.length) delete n.checklist })}>
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
        <form className="mt-2 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (newItem.trim()) { commit((d) => void T.addChecklistItem(d, node.id, newItem.trim())); setNewItem('') } }}>
          <input className="field" placeholder="Add an item…" value={newItem} onChange={(e) => setNewItem(e.target.value)} />
          <button className="btn icon outline" type="submit" aria-label="Add item" disabled={!newItem.trim()}><Plus size={15} /></button>
        </form>
      </Section>

      <Section title="Links between nodes" right={<button className="text-[12px] text-accent hover:underline" onClick={() => { setConnectFrom(node.id); toast('Click the node to link to · Esc to cancel') }}>Link to…</button>}>
        {related.length === 0 ? (
          <p className="text-[12px] text-muted">Draw a dashed line between ideas that are related but not parent and child.</p>
        ) : (
          <ul className="space-y-1">
            {related.map((r) => {
              const other = doc.nodes[r.from === node.id ? r.to : r.from]
              return (
                <Fragment key={r.id}>
                <li className="flex items-center gap-2 text-[13px]">
                  <span className="flex-1 truncate">{r.from === node.id ? '→' : '←'} {other?.text || 'New idea'}</span>
                  <button className="btn icon" style={{ width: 24, height: 24 }} aria-label="Remove link" onClick={() => commit((d) => T.removeRelation(d, r.id))}><X size={13} /></button>
                </li>
                <li className="-mt-0.5 mb-2 flex items-center gap-1.5 pl-5">
                  <input className="field" style={{ height: 28, flex: 1, minWidth: 0 }} dir="auto" placeholder="Label" aria-label="Link label" value={r.label ?? ''}
                    onChange={(e) => commit((d) => T.updateRelation(d, r.id, { label: e.target.value }), { coalesce: `rel:${r.id}` })} />
                  <select className="field" style={{ height: 28, width: 62, padding: '0 4px' }} aria-label="Arrow" value={r.arrow ?? 'end'}
                    onChange={(e) => commit((d) => T.updateRelation(d, r.id, { arrow: e.target.value as Relation['arrow'] }))}>
                    <option value="end">→</option><option value="both">↔</option><option value="none">—</option>
                  </select>
                  <select className="field" style={{ height: 28, width: 62, padding: '0 4px' }} aria-label="Line style" value={r.dash ?? 'dashed'}
                    onChange={(e) => commit((d) => T.updateRelation(d, r.id, { dash: e.target.value as Relation['dash'] }))}>
                    <option value="dashed">- -</option><option value="solid">——</option><option value="dotted">···</option>
                  </select>
                </li>
                </Fragment>
              )
            })}
          </ul>
        )}
      </Section>
    </>
  )
}

// ---------------- map ----------------

const layoutGlyph: Record<string, string> = {
  mindmap: 'M4 12h6m4 0h6M10 12c2 0 2-5 5-5M10 12c2 0 2 5 5 5M14 12c-2 0-2-5-5-5M14 12c-2 0-2 5-5 5',
  right: 'M5 12h4c3 0 3-6 6-6h4M9 12c3 0 3 6 6 6h4M9 12h10',
  left: 'M19 12h-4c-3 0-3-6-6-6H5M15 12c-3 0-3 6-6 6H5M15 12H5',
  down: 'M12 5v4c0 3-6 3-6 6v4M12 9c0 3 6 3 6 6v4M12 9v10',
  up: 'M12 19v-4c0-3-6-3-6-6V5M12 15c0-3 6-3 6-6V5M12 15V5',
  radial: 'M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M12 10V4M13.7 13l5 3M10.3 13l-5 3',
}

function MapPanel() {
  const doc = useDoc((s) => s.doc)!
  const dark = useUi((s) => s.dark)
  return (
    <>
      <Section title="Layout">
        <div className="grid grid-cols-3 gap-1.5">
          {LAYOUTS.map((l) => (
            <button key={l.id} onClick={() => setLayout(l.id)} title={l.name}
              className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-[11px] transition-colors ${doc.layout === l.id ? 'border-accent bg-active text-accent' : 'border-line hover:bg-hover'}`}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={layoutGlyph[l.id]} /></svg>
              {l.name.replace(/ \(.*\)/, '')}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Lines">
        <div className="seg w-full">
          {EDGES.map((e) => (
            <button key={e.id} style={{ flex: 1 }} className={doc.edge === e.id ? 'on' : ''} onClick={() => setEdge(e.id)}>{e.name}</button>
          ))}
        </div>
      </Section>
      <Section title="Colour theme">
        <div className="grid grid-cols-2 gap-1.5">
          {THEMES.map((t) => (
            <button key={t.id} onClick={() => setMapTheme(t.id)}
              className={`flex items-center gap-2 rounded-xl border p-2 text-left text-[12.5px] transition-colors ${doc.themeId === t.id ? 'border-accent bg-active' : 'border-line hover:bg-hover'}`}>
              <span className="flex -space-x-1">
                {(dark ? t.dark : t.light).slice(0, 4).map((c, i) => (
                  <span key={i} className="h-4 w-4 rounded-full ring-2 ring-[var(--panel-solid)]" style={{ background: c }} />
                ))}
              </span>
              {t.name}
            </button>
          ))}
        </div>
      </Section>
      <Section
        title="Custom colours"
        right={doc.customTheme ? <button className="text-[12px] text-muted hover:text-ink" onClick={() => commit((d) => void delete d.customTheme)}>Reset</button> : null}
      >
        {doc.customTheme ? (
          <div className="grid grid-cols-8 gap-1.5" role="group" aria-label="Custom palette">
            {doc.customTheme.map((c, i) => (
              <input key={i} type="color" aria-label={`Colour ${i + 1}`} value={c} className="h-7 w-full cursor-pointer rounded-md border border-line bg-transparent p-0"
                onChange={(e) => commit((d) => void (d.customTheme && (d.customTheme[i] = e.target.value)), { coalesce: `palette:${i}` })} />
            ))}
          </div>
        ) : (
          <button className="btn outline w-full" onClick={() => commit((d) => void (d.customTheme = [...resolveTheme(d).light]))}>Edit the eight colours</button>
        )}
        <p className="mt-1.5 text-[11.5px] text-muted">The first two colours colour the central idea.</p>
      </Section>
      <Section title="Font">
        <select className="field" aria-label="Map font" value={doc.font ?? 'inter'} onChange={(e) => setFont(e.target.value as FontId)}>
          {FONT_CHOICES.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </Section>
      <Section title="Direction">
        <div className="seg w-full" role="group" aria-label="Map direction">
          <button style={{ flex: 1 }} className={doc.dir !== 'rtl' ? 'on' : ''} onClick={() => setDirection('ltr')}>Left to right</button>
          <button style={{ flex: 1 }} className={doc.dir === 'rtl' ? 'on' : ''} onClick={() => setDirection('rtl')}>Right to left</button>
        </div>
        <p className="mt-1.5 text-[11.5px] text-muted">Right to left mirrors the whole map, for Persian, Arabic and Hebrew.</p>
      </Section>
      <Section title="Background">
        <div className="seg w-full">
          {BGS.map((b) => (
            <button key={b.id} style={{ flex: 1 }} className={doc.bg === b.id ? 'on' : ''} onClick={() => setBg(b.id)}>{b.name}</button>
          ))}
        </div>
      </Section>
      <Section title="About this map">
        <dl className="grid grid-cols-2 gap-y-1 text-[12.5px]">
          <dt className="text-muted">Ideas</dt><dd className="text-right tabular-nums">{Object.keys(doc.nodes).length}</dd>
          <dt className="text-muted">Links</dt><dd className="text-right tabular-nums">{doc.relations.length}</dd>
          <dt className="text-muted">Created</dt><dd className="text-right">{new Date(doc.meta.createdAt).toLocaleDateString()}</dd>
          <dt className="text-muted">Edited</dt><dd className="text-right">{new Date(doc.meta.updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</dd>
        </dl>
      </Section>
    </>
  )
}
