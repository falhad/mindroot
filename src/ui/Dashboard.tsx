import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarDays, Copy, Download, FolderOpen, GraduationCap, Lightbulb, ListChecks, Target, Inbox, Layers, Loader2, MoreHorizontal, Monitor, Settings, Moon, Pencil, Plus, RotateCcw, Search, Star, Sun, Tag, Trash2, Upload, X,
} from 'lucide-react'
import { TEMPLATES } from '../core/templates'
import type { MapMeta } from '../core/types'
import { isMac, isTauri } from '../io/env'
import { visitorOs } from '../io/release'
import { pickFile } from '../io/files'
import { importAccept } from '../io/importers'
import { useRegistry } from '../plugins/host'
import {
  createMap, deleteForever, duplicateMap, emptyTrash, importFile, libraryActions, refreshLibrary, renameMap, restoreMap, setTags, toggleStar,
  trashMap, useLibrary, visibleItems, type Sort,
} from '../state/library'
import { createMapFromUserTemplate, deleteTemplate, refreshTemplates, useTemplates } from '../state/templates'
import { askConfirm, cycleTheme, goTo, toast, ui, useUi } from '../state/ui'
import { Modal, Toasts } from './Overlays'
import { StatusSlot } from './StatusSlot'
import { ago } from './time'

const TEMPLATE_ICONS: Record<string, typeof Plus> = { blank: Plus, brainstorm: Lightbulb, project: ListChecks, weekly: CalendarDays, swot: Target, study: GraduationCap }
const thumbUrl = (svg?: string) => (svg ? `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` : null)

export function Dashboard() {
  const lib = useLibrary()
  const mode = useUi((s) => s.themeMode)
  const items = useMemo(() => visibleItems(lib), [lib])
  const searchRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [tagsFor, setTagsFor] = useState<MapMeta | null>(null)
  const userTemplates = useTemplates((s) => s.items)
  const newMapActions = useRegistry((s) => s.newMap)

  useEffect(() => {
    void refreshLibrary()
    void refreshTemplates()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)
      if (e.key === '/' && !typing) { e.preventDefault(); searchRef.current?.focus() }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); void open('blank') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const open = async (templateId: string) => {
    setBusy(true)
    try {
      goTo({ name: 'editor', id: await createMap(templateId) })
    } catch (e) {
      toast(`Could not create the map: ${e instanceof Error ? e.message : e}`, 'error')
    } finally {
      setBusy(false)
    }
  }
  const openUserTemplate = async (id: string) => {
    setBusy(true)
    try {
      goTo({ name: 'editor', id: await createMapFromUserTemplate(id) })
    } catch (e) {
      toast(`Could not create the map: ${e instanceof Error ? e.message : e}`, 'error')
    } finally {
      setBusy(false)
    }
  }
  const importFiles = async (files: File[]) => {
    let first: string | null = null
    for (const f of files) {
      const id = await importFile(f)
      first ??= id
    }
    if (first) {
      toast(files.length > 1 ? `Imported ${files.length} files` : 'Imported', 'success')
      if (files.length === 1) goTo({ name: 'editor', id: first })
    }
  }

  const counts = useMemo(() => {
    const live = lib.items.filter((m) => !m.trashedAt)
    return { all: live.length, starred: live.filter((m) => m.starred).length, trash: lib.items.length - live.length }
  }, [lib.items])
  const tags = useMemo(() => {
    const c = new Map<string, number>()
    for (const m of lib.items) if (!m.trashedAt) for (const t of m.tags) c.set(t, (c.get(t) ?? 0) + 1)
    return [...c.entries()].sort((a, b) => b[1] - a[1])
  }, [lib.items])

  const ThemeIcon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor
  const showTemplates = lib.filter === 'all' && !lib.query && !lib.tag

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(e) => { e.preventDefault(); setDropping(true) }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDropping(false) }}
      onDrop={(e) => { e.preventDefault(); setDropping(false); void importFiles(Array.from(e.dataTransfer.files)) }}
    >
      <header data-tauri-drag-region className={`drag-region flex h-14 shrink-0 items-center gap-2 border-b border-line px-3 sm:gap-3 sm:px-4 ${isMac && isTauri ? 'mac-inset' : ''}`}>
        <div className="no-drag flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" width={26} height={26} />
          <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">Mindroot</span>
        </div>
        <div className="no-drag relative mx-auto min-w-0 w-full max-w-md flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            ref={searchRef}
            className="field"
            style={{ paddingLeft: 34, paddingRight: 34, height: 36 }}
            placeholder="Search maps and ideas…"
            aria-label="Search maps"
            value={lib.query}
            onChange={(e) => libraryActions.setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (libraryActions.setQuery(''), e.currentTarget.blur())}
          />
          {lib.query ? (
            <button className="btn icon absolute right-1 top-1/2 -translate-y-1/2" style={{ width: 26, height: 26 }} aria-label="Clear search" onClick={() => libraryActions.setQuery('')}><X size={14} /></button>
          ) : (
            <kbd className="absolute right-2.5 top-1/2 hidden -translate-y-1/2 sm:block">/</kbd>
          )}
        </div>
        <div className="no-drag flex shrink-0 items-center gap-1.5">
          <StatusSlot />
          <button className="btn icon" aria-label="Settings" title="Settings and plugins (⌘,)" onClick={() => ui.setSettings(true, 'general')}><Settings size={16} /></button>
          <button className="btn icon" aria-label={`Theme: ${mode}`} title={`Appearance: ${mode}`} onClick={cycleTheme}><ThemeIcon size={16} /></button>
          {!isTauri && visitorOs !== 'mobile' && (
            <button className="btn bordered ml-1" aria-label="Download the desktop app" title="Download the desktop app" onClick={() => ui.setDownload(true)}>
              <Download size={15} /> <span className="hidden lg:inline">Download</span>
            </button>
          )}
          <button className="btn bordered ml-1" aria-label="Import" onClick={async () => void importFiles(await pickFile(importAccept(useRegistry.getState().importers), true))}>
            <Upload size={15} /> <span className="hidden sm:inline">Import</span>
          </button>
          <button className="btn primary" aria-label="New map" disabled={busy} onClick={() => void open('blank')}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={16} />} <span className="hidden sm:inline">New map</span>
          </button>
        </div>
      </header>

      {!isTauri && <WebNotice />}
      <div className="flex min-h-0 flex-1">
        <nav className="hidden w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-line p-3 md:flex" aria-label="Library">
          {([['all', 'All maps', Layers, counts.all], ['starred', 'Starred', Star, counts.starred], ['trash', 'Trash', Trash2, counts.trash]] as const).map(([id, label, Icon, n]) => (
            <button key={id} className={`btn justify-start ${lib.filter === id && !lib.tag ? 'on' : ''}`} style={{ height: 36 }} onClick={() => libraryActions.setFilter(id)}>
              <Icon size={16} /> <span className="flex-1 text-left">{label}</span> <span className="text-[12px] tabular-nums text-muted">{n}</span>
            </button>
          ))}
          <button className="btn justify-start" style={{ height: 36 }} onClick={() => goTo({ name: 'tasks' })}>
            <ListChecks size={16} /> <span className="flex-1 text-left">Tasks</span>
          </button>
          {tags.length > 0 && <div className="label mb-1 mt-4 px-2">Tags</div>}
          {tags.map(([t, n]) => (
            <button key={t} className={`btn justify-start ${lib.tag === t ? 'on' : ''}`} onClick={() => libraryActions.setTag(lib.tag === t ? null : t)}>
              <Tag size={14} /> <span className="flex-1 truncate text-left">{t}</span> <span className="text-[12px] tabular-nums text-muted">{n}</span>
            </button>
          ))}
        </nav>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1180px] px-5 py-6">
            <div className="seg mb-5 md:hidden">
              {(['all', 'starred', 'trash'] as const).map((f) => (
                <button key={f} className={lib.filter === f ? 'on' : ''} onClick={() => libraryActions.setFilter(f)}>{f === 'all' ? 'All' : f === 'starred' ? 'Starred' : 'Trash'}</button>
              ))}
            </div>

            {showTemplates && (
              <section className="mb-9" aria-label="Start a new map">
                <div className="mb-3 flex min-h-8 items-center justify-between gap-3">
                  <h2 className="text-[13px] font-semibold text-muted">Start with a template</h2>
                  {newMapActions.length > 0 && (
                    <div className="flex flex-wrap justify-end gap-2">
                      {newMapActions.map((a) => (
                        <button key={a.id} className="btn bordered" title={a.hint} onClick={a.run}>{a.icon} {a.title}</button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                  {userTemplates.map((t) => (
                    <div key={t.id} className="group relative" data-user-template={t.id}>
                      <button onClick={() => void openUserTemplate(t.id)} disabled={busy} aria-label={`New map from template ${t.name}`}
                        className="flex h-full w-full flex-col gap-1 rounded-2xl border border-line bg-solid p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-[var(--line-strong)] hover:shadow-[var(--shadow-md)]">
                        <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-xl bg-active text-accent">
                          {t.thumb ? <img src={thumbUrl(t.thumb) ?? ''} alt="" className="h-full w-full object-cover" /> : <Layers size={18} />}
                        </span>
                        <span className="mt-1 truncate text-[13.5px] font-semibold" dir="auto">{t.name}</span>
                        <span className="text-[12px] leading-snug text-muted">Your template</span>
                      </button>
                      <button className="btn icon absolute right-1.5 top-1.5 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100" style={{ width: 26, height: 26 }} aria-label={`Delete template ${t.name}`}
                        onClick={async () => { if (await askConfirm({ title: `Delete the template “${t.name}”?`, body: 'Maps already made from it are not changed.', confirmLabel: 'Delete', danger: true })) void deleteTemplate(t.id) }}>
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  {TEMPLATES.map((t) => (
                    <button key={t.id} onClick={() => void open(t.id)} disabled={busy}
                      className="group flex flex-col gap-1 rounded-2xl border border-line bg-solid p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-[var(--line-strong)] hover:shadow-[var(--shadow-md)]">
                      <span className="grid h-9 w-9 place-items-center rounded-xl bg-active text-accent transition-transform group-hover:scale-105">
                        {(() => { const I = TEMPLATE_ICONS[t.id] ?? Layers; return <I size={18} /> })()}
                      </span>
                      <span className="mt-1 text-[13.5px] font-semibold">{t.name}</span>
                      <span className="text-[12px] leading-snug text-muted">{t.blurb}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-[13px] font-semibold text-muted">
                {lib.filter === 'trash' ? 'Trash' : lib.filter === 'starred' ? 'Starred' : lib.tag ? `Tagged “${lib.tag}”` : lib.query ? 'Results' : 'Your maps'}
                <span className="ml-2 font-normal tabular-nums">{items.length}</span>
              </h2>
              <div className="flex items-center gap-2">
                {lib.filter === 'trash' && counts.trash > 0 && (
                  <button className="btn danger" onClick={async () => { if (await askConfirm({ title: `Delete ${counts.trash} map${counts.trash > 1 ? 's' : ''} forever?`, body: "This can't be undone.", confirmLabel: 'Delete forever', danger: true })) void emptyTrash() }}>Empty trash</button>
                )}
                <label className="flex items-center gap-2 text-[12.5px] text-muted">
                  Sort
                  <select className="field" style={{ width: 'auto', padding: '4px 8px' }} value={lib.sort} onChange={(e) => libraryActions.setSort(e.target.value as Sort)}>
                    <option value="updated">Recently edited</option>
                    <option value="created">Recently created</option>
                    <option value="title">Title</option>
                  </select>
                </label>
              </div>
            </div>

            {!lib.loaded ? (
              <div className="grid place-items-center py-24"><Loader2 className="animate-spin text-muted" /></div>
            ) : items.length === 0 ? (
              <Empty filter={lib.filter} query={lib.query} onNew={() => void open('blank')} />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" role="list">
                {items.map((m) => (
                  <MapCard key={m.id} m={m} onTags={() => setTagsFor(m)} />
                ))}
              </div>
            )}
          </div>
        </main>
      </div>

      {dropping && (
        <div className="fade pointer-events-none fixed inset-3 z-40 grid place-items-center rounded-3xl border-2 border-dashed border-accent text-[15px] font-medium text-accent" style={{ background: 'color-mix(in srgb, var(--accent) 8%, var(--bg))' }}>
          <span className="flex items-center gap-2"><FolderOpen size={20} /> Drop JSON or Markdown files to import</span>
        </div>
      )}
      {tagsFor && <TagsDialog m={lib.items.find((x) => x.id === tagsFor.id) ?? tagsFor} onClose={() => setTagsFor(null)} />}
      <Toasts />
    </div>
  )
}

function Empty({ filter, query, onNew }: { filter: string; query: string; onNew: () => void }) {
  const msg = query ? ['Nothing matches your search', 'Try a different word, or clear the search.'] : filter === 'trash' ? ['Trash is empty', 'Maps you delete wait here until you empty the trash.'] : filter === 'starred' ? ['No starred maps yet', 'Star the maps you come back to most.'] : ['No maps yet', 'Pick a template above or start from a blank map.']
  return (
    <div className="grid place-items-center rounded-3xl border border-dashed border-[var(--line-strong)] px-6 py-16 text-center">
      <Inbox size={34} className="mb-3 text-muted" />
      <div className="text-[15px] font-semibold">{msg[0]}</div>
      <p className="mt-1 text-[13px] text-muted">{msg[1]}</p>
      {filter === 'all' && !query && <button className="btn primary mt-4" onClick={onNew}><Plus size={16} /> New map</button>}
    </div>
  )
}

function MapCard({ m, onTags }: { m: MapMeta; onTags: () => void }) {
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(m.title)
  const ref = useRef<HTMLDivElement>(null)
  const trashed = !!m.trashedAt
  const img = thumbUrl(m.thumb)

  useEffect(() => {
    if (!menu) return
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setMenu(false)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false)
    window.addEventListener('pointerdown', away)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', key)
    }
  }, [menu])

  const openMap = () => !trashed && !renaming && goTo({ name: 'editor', id: m.id })
  const act = (fn: () => void) => () => { setMenu(false); fn() }
  const mi = 'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-hover'

  return (
    <div
      ref={ref}
      role="listitem"
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-solid transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]"
      onContextMenu={(e) => { e.preventDefault(); setMenu(true) }}
    >
      <button className="relative block aspect-[16/10] w-full overflow-hidden bg-[var(--canvas)] text-left disabled:cursor-default" onClick={openMap} disabled={trashed} aria-label={`Open ${m.title}`}
        style={{ backgroundImage: 'radial-gradient(circle, var(--dot) 1px, transparent 1.2px)', backgroundSize: '18px 18px' }}>
        {img ? <img src={img} alt="" draggable={false} className="absolute inset-0 h-full w-full object-contain p-3 transition-transform duration-300 group-hover:scale-[1.03]" style={{ opacity: trashed ? 0.45 : 1 }} /> : null}
      </button>
      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              autoFocus
              className="field"
              style={{ padding: '3px 8px' }}
              value={name}
              aria-label="Map name"
              onChange={(e) => setName(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={() => { setRenaming(false); if (name.trim() && name !== m.title) void renameMap(m.id, name) }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setName(m.title); setRenaming(false) } }}
            />
          ) : (
            <button className="block max-w-full truncate text-left text-[14px] font-semibold" onClick={openMap} disabled={trashed}>{m.title || 'Untitled map'}</button>
          )}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
            <span>{m.nodeCount} {m.nodeCount === 1 ? 'idea' : 'ideas'}</span>
            <span aria-hidden>·</span>
            <span title={new Date(m.updatedAt).toLocaleString()}>{trashed ? `deleted ${ago(m.trashedAt!)}` : ago(m.updatedAt)}</span>
          </div>
          {m.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {m.tags.slice(0, 3).map((t) => <span key={t} className="rounded-md bg-hover px-1.5 py-0.5 text-[11px] text-muted">{t}</span>)}
            </div>
          )}
        </div>
        {!trashed && (
          <button className="btn icon" style={{ width: 28, height: 28, color: m.starred ? '#f59e0b' : undefined }} aria-label={m.starred ? 'Unstar' : 'Star'} aria-pressed={!!m.starred}
            onClick={() => void toggleStar(m.id, !m.starred)}>
            <Star size={15} fill={m.starred ? 'currentColor' : 'none'} />
          </button>
        )}
        <button className="btn icon" style={{ width: 28, height: 28 }} aria-label="More actions" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}><MoreHorizontal size={16} /></button>
      </div>
      {menu && (
        <div role="menu" className="glass rise absolute bottom-12 right-2 z-10 w-48 rounded-xl p-1.5" style={{ background: 'var(--panel-solid)' }}>
          {trashed ? (
            <>
              <button className={mi} role="menuitem" onClick={act(() => void restoreMap(m.id))}><RotateCcw size={14} /> Restore</button>
              <button className={`${mi} text-danger`} role="menuitem" onClick={act(async () => { if (await askConfirm({ title: `Delete “${m.title}” forever?`, body: "This can't be undone.", confirmLabel: 'Delete forever', danger: true })) void deleteForever(m.id) })}><Trash2 size={14} /> Delete forever</button>
            </>
          ) : (
            <>
              <button className={mi} role="menuitem" onClick={act(() => { setName(m.title); setRenaming(true) })}><Pencil size={14} /> Rename</button>
              <button className={mi} role="menuitem" onClick={act(() => void duplicateMap(m.id))}><Copy size={14} /> Duplicate</button>
              <button className={mi} role="menuitem" onClick={act(onTags)}><Tag size={14} /> Tags…</button>
              <div className="my-1 h-px bg-line" />
              <button className={`${mi} text-danger`} role="menuitem" onClick={act(() => void trashMap(m.id))}><Trash2 size={14} /> Move to trash</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function TagsDialog({ m, onClose }: { m: MapMeta; onClose: () => void }) {
  const [v, setV] = useState('')
  const add = () => {
    const t = v.trim().toLowerCase().slice(0, 24)
    if (t && !m.tags.includes(t)) void setTags(m.id, [...m.tags, t])
    setV('')
  }
  return (
    <Modal onClose={onClose} label="Edit tags" width={420}>
      <div className="p-5">
        <h2 className="mb-1 text-[15px] font-semibold">Tags for “{m.title}”</h2>
        <p className="mb-3 text-[12.5px] text-muted">Use tags to group related maps. Press Enter to add.</p>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {m.tags.length === 0 && <span className="text-[13px] text-muted">No tags yet</span>}
          {m.tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-lg bg-active py-1 pl-2.5 pr-1 text-[12.5px] text-accent">
              {t}
              <button className="grid h-5 w-5 place-items-center rounded-md hover:bg-hover" aria-label={`Remove ${t}`} onClick={() => void setTags(m.id, m.tags.filter((x) => x !== t))}><X size={12} /></button>
            </span>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); add() }} className="flex gap-2">
          <input autoFocus className="field" placeholder="e.g. work, ideas, 2026" value={v} onChange={(e) => setV(e.target.value)} />
          <button className="btn primary" type="submit" disabled={!v.trim()}>Add</button>
        </form>
        <div className="mt-4 flex justify-end"><button className="btn bordered" onClick={onClose}>Done</button></div>
      </div>
    </Modal>
  )
}

const WEB_NOTICE_KEY = 'mr.web.notice'

/** Browser version only: says where the maps are kept. Shown until the user closes it. */
function WebNotice() {
  const [show, setShow] = useState(() => {
    try { return localStorage.getItem(WEB_NOTICE_KEY) !== 'off' } catch { return true }
  })
  if (!show) return null
  const close = () => {
    setShow(false)
    try { localStorage.setItem(WEB_NOTICE_KEY, 'off') } catch { /* private window: the notice comes back */ }
  }
  return (
    <div role="note" className="flex shrink-0 items-center gap-3 border-b border-line bg-hover px-4 py-2 text-[12.5px] text-muted">
      <p className="min-w-0 flex-1">
        Your maps are saved in this browser only. Export a map to keep a backup. Git sync and quick capture are in the{' '}
        <button className="font-medium text-accent hover:underline" onClick={() => ui.setDownload(true)}>desktop app</button>.
      </p>
      <button className="btn icon shrink-0" style={{ width: 26, height: 26 }} aria-label="Close notice" onClick={close}><X size={14} /></button>
    </div>
  )
}
