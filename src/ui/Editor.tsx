import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowLeft, Check, CloudOff, Download, Loader2, Maximize, Minus, Moon, PanelLeft, PanelRight, Plus, Redo2, Search, Sun, Monitor,
  Command, Undo2, CornerDownRight, ListTree, Link2, X,
} from 'lucide-react'
import { resetMeasureCache } from '../core/measure'
import { plainTitle } from '../core/tree'
import * as T from '../core/tree'
import { isMac } from '../io/env'
import { readImage } from '../io/files'
import { store } from '../io/storage'
import {
  addChild, addSibling, closeDoc, commit, layoutNow, openDoc, redo, setConnectFrom, undo, useDoc, useRenderDoc,
} from '../state/doc'
import { emit } from '../plugins/host'
import { flushSave } from '../state/persist'
import { refreshLibrary, useLibrary } from '../state/library'
import { focusNode } from '../state/search'
import { cycleTheme, toast, ui, useUi } from '../state/ui'
import { animateTo, revealBox, setInsetLeft, setInsetRight, setView, useView, zoomBy } from '../state/view'
import { Canvas } from './Canvas'
import { fitCurrent, goHome, setLayout, resetZoom, LAYOUTS } from './commands'
import { ExportDialog } from './ExportDialog'
import { useEditorHotkeys } from './hotkeys'
import { Inspector } from './Inspector'
import { usePresent } from '../state/present'
import { FocusBar } from './FocusBar'
import { Outline } from './Outline'
import { Presentation } from './Presentation'
import { Minimap } from './Minimap'
import { StatusSlot } from './StatusSlot'
import { TagFilter } from './TagFilter'
import { ContextMenu, Palette, SearchBar, type ContextState } from './Overlays'

type Phase = 'loading' | 'ready' | 'missing' | 'error'

export function Editor({ id }: { id: string }) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState('')
  const restore = useRef<{ x: number; y: number; k: number } | null>(null)

  useEffect(() => {
    let alive = true
    let opened = false
    setPhase('loading')
    ui.setTagFilter([])
    store
      .load(id)
      .then(async (doc) => {
        if (!alive) return
        if (!doc) return setPhase('missing')
        openDoc(doc)
        const pend = useUi.getState().pendingSelect
        if (pend && pend.mapId === id) {
          useUi.setState({ pendingSelect: null })
          if (doc.nodes[pend.nodeId]) setTimeout(() => focusNode(pend.nodeId), 60)
        }
        if (!useLibrary.getState().loaded) void refreshLibrary() // for the map picker and link checks
        try {
          const saved = JSON.parse(localStorage.getItem(`bm.view.${id}`) ?? 'null')
          restore.current = saved && Number.isFinite(saved.k) ? saved : null
        } catch {
          restore.current = null
        }
        if (document.fonts?.ready) {
          void document.fonts.ready.then(() => {
            // text widths measured before the web font loaded are stale
            resetMeasureCache()
            layoutNow()
          })
        }
        opened = true
        setPhase('ready')
        emit('doc:opened', { id })
      })
      .catch((e) => {
        if (!alive) return
        setError(e instanceof Error ? e.message : String(e))
        setPhase('error')
      })
    // A script's font (e.g. Persian) loads on first use; re-measure once it arrives.
    const onFont = () => {
      resetMeasureCache()
      const s = useDoc.getState()
      if (s.doc) layoutNow()
    }
    document.fonts?.addEventListener('loadingdone', onFont)
    return () => {
      document.fonts?.removeEventListener('loadingdone', onFont)
      alive = false
      if (!opened) return
      const v = useView.getState()
      try {
        localStorage.setItem(`bm.view.${id}`, JSON.stringify({ x: v.x, y: v.y, k: v.k }))
      } catch { /* ignore */ }
      emit('doc:closed', { id })
      void flushSave().finally(closeDoc)
    }
  }, [id])

  if (phase === 'loading') return <div className="grid h-full place-items-center"><Loader2 className="animate-spin text-muted" /></div>
  if (phase !== 'ready')
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div>
          <h1 className="text-lg font-semibold">{phase === 'missing' ? 'This map no longer exists' : 'Could not open this map'}</h1>
          {error && <p className="mt-1 text-[13px] text-muted">{error}</p>}
          <button className="btn primary mt-4" onClick={() => void goHome()}><ArrowLeft size={15} /> Back to all maps</button>
        </div>
      </div>
    )
  return <Workspace restore={restore.current} />
}

function Workspace({ restore }: { restore: { x: number; y: number; k: number } | null }) {
  useEditorHotkeys()
  const presenting = usePresent((s) => s.active)
  const outlineOpen = useUi((s) => s.outlineOpen) && !presenting
  const panelOpen = useUi((s) => s.inspectorOpen) && !presenting
  const firstOutline = useRef(true)
  useLayoutEffect(() => {
    const next = outlineOpen && innerWidth >= 900 ? 336 : 0
    const before = useView.getState().insetLeft
    setInsetLeft(next)
    // the visible centre moves by half the panel width: slide the map so it stays in view
    if (!firstOutline.current && next !== before) {
      const v = useView.getState()
      animateTo({ x: v.x + (next - before) / 2, y: v.y, k: v.k }, 220)
    }
    firstOutline.current = false
  }, [outlineOpen])
  useEffect(() => () => setInsetLeft(0), [])
  // The floating inspector covers the right edge on wide screens; fits should avoid it.
  useLayoutEffect(() => {
    setInsetRight(panelOpen && innerWidth >= 900 ? 340 : 0)
    return () => setInsetRight(0)
  }, [panelOpen])
  // Canvas (a child) has measured the viewport by the time this effect runs.
  useEffect(() => {
    if (restore) setView(restore)
    else fitCurrent(false)
  }, [restore])
  const doc = useRenderDoc()!
  const layout = useDoc((s) => s.layout)!
  const inspectorOpen = useUi((s) => s.inspectorOpen)
  const connectFrom = useDoc((s) => s.connectFrom)
  const editingId = useDoc((s) => s.editingId)
  const [menu, setMenu] = useState<ContextState | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const wrapRef = useRef<HTMLDivElement>(null)

  // keep the node being edited on screen
  useEffect(() => {
    if (!editingId) return
    const t = setTimeout(() => {
      const b = useDoc.getState().layout?.boxes[editingId]
      if (b) revealBox(b)
    }, 60)
    return () => clearTimeout(t)
  }, [editingId])

  const onDrop = async (e: React.DragEvent) => {
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'))
    if (!file) return
    e.preventDefault()
    const target = (e.target as HTMLElement).closest('[data-node-id]') as HTMLElement | null
    const nodeId = target?.dataset.nodeId ?? useDoc.getState().selection[0]
    if (!nodeId) return toast('Select a node first, then drop the image', 'info')
    try {
      const img = await readImage(file)
      commit((d) => T.setNodeImage(d, nodeId, img))
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not add the image', 'error')
    }
  }

  return (
    <div ref={wrapRef} className="relative h-full overflow-hidden" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <Canvas doc={doc} layout={layout} onContext={setMenu} />
      {!presenting && (
        <>
          <TopBar />
          <FocusBar />
          <Minimap doc={doc} layout={layout} />
          <Dock />
          <SearchBar />
        </>
      )}
      <Presentation />
      {connectFrom && (
        <div className="glass rise absolute left-1/2 top-16 z-30 flex -translate-x-1/2 items-center gap-3 rounded-xl py-2 pl-4 pr-2 text-[13px]">
          <Link2 size={15} className="text-accent" />
          Click another idea to link it to “{doc.nodes[connectFrom]?.text || 'New idea'}”
          <button className="btn" style={{ height: 26 }} onClick={() => setConnectFrom(null)}><X size={14} /> Cancel</button>
        </div>
      )}
      {outlineOpen && <Outline />}
      {inspectorOpen && !presenting && <Inspector onClose={() => ui.setInspector(false)} />}
      <ContextMenu state={menu} onClose={closeMenu} />
      <Palette />
      <ExportDialog />
    </div>
  )
}

function SaveStatus() {
  const s = useDoc((x) => x.saveState)
  const err = useDoc((x) => x.saveError)
  const base = 'flex items-center gap-1.5 text-[12px] text-muted'
  if (s === 'saving' || s === 'dirty') return <span className={base} aria-live="polite"><Loader2 size={13} className="animate-spin" /> Saving…</span>
  if (s === 'error') return <span className={base} style={{ color: 'var(--danger)' }} title={err ?? ''}><CloudOff size={13} /> Not saved — retrying</span>
  if (s === 'saved') return <span className={base} aria-live="polite"><Check size={13} /> Saved</span>
  return <span className={base} />
}

function TopBar() {
  const doc = useDoc((s) => s.doc)!
  const outlineOpen = useUi((s) => s.outlineOpen)
  const mode = useUi((s) => s.themeMode)
  const inspectorOpen = useUi((s) => s.inspectorOpen)
  const canUndo = useDoc((s) => s.past.length > 0)
  const canRedo = useDoc((s) => s.future.length > 0)
  const [title, setTitle] = useState(plainTitle(doc))
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setTitle(plainTitle(doc))
  }, [doc, focused])
  const ThemeIcon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor

  return (
    <header data-tauri-drag-region className={`drag-region glass absolute left-3 right-3 top-3 z-20 flex h-11 items-center gap-1 rounded-2xl px-2 ${isMac && '__TAURI_INTERNALS__' in window ? 'mac-inset' : ''}`}>
      <button className="btn icon no-drag" aria-label="All maps" title="All maps" onClick={() => void goHome()}><ArrowLeft size={17} /></button>
      <input
        className="no-drag h-8 min-w-0 max-w-[320px] flex-1 rounded-lg bg-transparent px-2 text-[14px] font-semibold outline-none hover:bg-hover focus:bg-hover"
        aria-label="Map title"
        value={title}
        spellCheck={false}
        onFocus={() => setFocused(true)}
        onChange={(e) => { setTitle(e.target.value); commit((d) => T.setText(d, d.root, e.target.value), { coalesce: 'title' }) }}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur() }}
      />
      <span className="no-drag hidden sm:block"><SaveStatus /></span>
      <StatusSlot />
      <div className="flex-1" />
      <div className="no-drag flex items-center gap-0.5">
        <button className="btn icon" aria-label="Undo" title="Undo (⌘Z)" disabled={!canUndo} onClick={undo}><Undo2 size={16} /></button>
        <button className="btn icon" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={redo}><Redo2 size={16} /></button>
        <span className="mx-1 h-5 w-px bg-line" />
        <button className={`btn icon ${outlineOpen ? 'on' : ''}`} aria-label="Toggle outline" aria-pressed={outlineOpen} title="Outline (⌘⇧O)" onClick={ui.toggleOutline}><PanelLeft size={16} /></button>
        <LayoutMenu />
        <TagFilter />
        <button className="btn icon" aria-label="Find" title="Find (⌘F)" onClick={() => ui.setSearch(true)}><Search size={16} /></button>
        <button className="btn icon" aria-label="Command palette" title="Commands (⌘K)" onClick={() => ui.setPalette(true)}><Command size={16} /></button>
        <button className="btn icon" aria-label={`Theme: ${mode}`} title={`Appearance: ${mode}`} onClick={cycleTheme}><ThemeIcon size={16} /></button>
        <button className="btn outline hidden sm:inline-flex" onClick={() => ui.setExport(true)}><Download size={15} /> Export</button>
        <button className="btn icon sm:hidden" aria-label="Export" onClick={() => ui.setExport(true)}><Download size={16} /></button>
        <button className={`btn icon ${inspectorOpen ? 'on' : ''}`} aria-label="Toggle side panel" aria-pressed={inspectorOpen} title="Side panel (⌘I)" onClick={ui.toggleInspector}><PanelRight size={16} /></button>
      </div>
    </header>
  )
}

function LayoutMenu() {
  const layout = useDoc((s) => s.doc!.layout)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', away)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', key)
    }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button className={`btn ${open ? 'on' : ''}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} title="Layout">
        <ListTree size={16} />
        <span className="hidden md:inline">{LAYOUTS.find((l) => l.id === layout)?.name.replace(/ \(.*\)/, '')}</span>
      </button>
      {open && (
        <div role="menu" className="glass rise absolute right-0 top-10 w-52 rounded-xl p-1.5" style={{ background: 'var(--panel-solid)' }}>
          {LAYOUTS.map((l) => (
            <button key={l.id} role="menuitemradio" aria-checked={layout === l.id} className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-hover"
              onClick={() => { setOpen(false); setLayout(l.id) }}>
              {l.name}
              {layout === l.id && <Check size={14} className="text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Dock() {
  const k = useView((s) => s.k)
  return (
    <div className="glass absolute bottom-3 left-1/2 z-20 flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-0.5 overflow-x-auto rounded-2xl p-1.5">
      <button className="btn" onClick={() => addChild()} title="Add child (Tab)"><CornerDownRight size={16} /> <span className="hidden sm:inline">Child</span></button>
      <button className="btn" onClick={() => addSibling()} title="Add sibling (Enter)"><Plus size={16} /> <span className="hidden sm:inline">Sibling</span></button>
      <span className="mx-1 h-5 w-px shrink-0 bg-line" />
      <button className="btn icon" aria-label="Zoom out" onClick={() => zoomBy(0.8)}><Minus size={16} /></button>
      <button className="btn tabular-nums" style={{ minWidth: 54 }} title="Actual size (⌘1)" onClick={resetZoom}>{Math.round(k * 100)}%</button>
      <button className="btn icon" aria-label="Zoom in" onClick={() => zoomBy(1.25)}><Plus size={16} /></button>
      <button className="btn icon" aria-label="Fit to screen" title="Fit to screen (⌘0)" onClick={() => fitCurrent()}><Maximize size={16} /></button>
    </div>
  )
}
