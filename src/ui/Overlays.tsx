import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, CornerDownLeft, Loader2, Search, X } from 'lucide-react'
import { modKey } from '../io/env'
import {
  addChild, addSibling, deleteSelection, duplicateSelection, setConnectFrom, startEdit, toggleCollapse, useDoc,
} from '../state/doc'
import { clearSearch, runSearch, stepSearch, useSearch } from '../state/search'
import { dismissToast, ui, useUi } from '../state/ui'
import { buildCommands, fitCurrent } from './commands'
import { expandToLevel } from '../state/doc'

export function Modal({ onClose, children, width = 520, top = '12vh', label }: { onClose: () => void; children: ReactNode; width?: number; top?: string; label: string }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  // While the dialog is open nothing behind it can be reached (keyboard or screen reader): everything outside
  // the dialog's own branch of the page is made inert. Focus moves into the dialog and returns to what opened it.
  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    const opener = document.activeElement as HTMLElement | null
    const inerted: HTMLElement[] = []
    for (let n: HTMLElement | null = el; n && n !== document.body; n = n.parentElement) {
      for (const s of Array.from(n.parentElement?.children ?? []) as HTMLElement[]) {
        if (s === n || s.inert || s.tagName === 'SCRIPT' || s.hasAttribute('data-keep-live')) continue
        s.inert = true
        inerted.push(s)
      }
    }
    const first = el.querySelector<HTMLElement>('[autofocus], input:not([type=hidden]), select, textarea, button, [href]')
    ;(first ?? el).focus({ preventScroll: true })
    return () => {
      for (const s of inerted) s.inert = false
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true })
    }
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 fade" style={{ background: 'rgba(8,10,16,0.42)', backdropFilter: 'blur(3px)' }} onMouseDown={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-label={label}
        aria-modal="true"
        className="glass rise absolute left-1/2 overflow-hidden rounded-2xl"
        style={{ top, width: `min(${width}px, calc(100vw - 24px))`, transform: 'translateX(-50%)', background: 'var(--panel-solid)', boxShadow: 'var(--shadow-lg)' }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Tab and Shift+Tab go round inside the dialog instead of leaving it
          if (e.key !== 'Tab' || !dialogRef.current) return
          const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled):not([type=hidden]),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')).filter((el) => el.offsetParent !== null)
          if (!items.length) return e.preventDefault()
          const active = document.activeElement
          if (e.shiftKey && (active === items[0] || active === dialogRef.current)) { e.preventDefault(); items[items.length - 1].focus() }
          else if (!e.shiftKey && active === items[items.length - 1]) { e.preventDefault(); items[0].focus() }
        }}
      >
        {children}
      </div>
    </div>
  )
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts)
  return (
    <div data-keep-live className="pointer-events-none fixed bottom-20 left-1/2 z-[70] flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="glass rise pointer-events-auto flex items-center gap-3 rounded-xl py-2 pl-4 pr-2 text-[13px]"
          style={{ background: 'var(--panel-solid)', borderColor: t.kind === 'error' ? 'var(--danger)' : undefined }}
        >
          <span style={{ color: t.kind === 'error' ? 'var(--danger)' : undefined }}>{t.text}</span>
          {t.action && (
            <button className="btn primary" style={{ height: 26 }} onClick={() => { t.action!.run(); dismissToast(t.id) }}>
              {t.action.label}
            </button>
          )}
          <button className="btn icon" style={{ width: 26, height: 26 }} aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

// ---------------- command palette ----------------

export function Palette() {
  const open = useUi((s) => s.paletteOpen)
  if (!open) return null
  return <PaletteInner />
}

function PaletteInner() {
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const commands = useMemo(buildCommands, [])
  const list = useMemo(() => {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean)
    if (!tokens.length) return commands
    return commands.filter((c) => {
      const hay = `${c.group} ${c.title} ${c.keywords ?? ''}`.toLowerCase()
      return tokens.every((t) => hay.includes(t))
    })
  }, [q, commands])
  const listRef = useRef<HTMLDivElement>(null)
  const close = () => ui.setPalette(false)
  const run = (idx: number) => {
    const c = list[idx]
    if (!c) return
    close()
    setTimeout(c.run, 0)
  }
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [i, list])

  return (
    <Modal onClose={close} label="Command palette" width={560}>
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search size={17} className="text-muted" />
        <input
          autoFocus
          className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
          placeholder="Type a command, or ? for the shortcut list"
          value={q}
          onChange={(e) => { setQ(e.target.value); setI(0) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setI((v) => Math.min(list.length - 1, v + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setI((v) => Math.max(0, v - 1)) }
            else if (e.key === 'Enter') { e.preventDefault(); run(i) }
          }}
        />
        <kbd>esc</kbd>
      </div>
      <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
        {list.length === 0 && <div className="px-3 py-8 text-center text-[13px] text-muted">No matching commands</div>}
        {list.map((c, idx) => (
          <button
            key={c.id}
            data-active={idx === i}
            onMouseMove={() => setI(idx)}
            onClick={() => run(idx)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13.5px]"
            style={{ background: idx === i ? 'var(--active)' : 'transparent' }}
          >
            <span className="w-14 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted">{c.group}</span>
            <span className="flex-1">{c.title}</span>
            {c.hint && <kbd>{c.hint}</kbd>}
            {idx === i && <CornerDownLeft size={13} className="text-muted" />}
          </button>
        ))}
      </div>
    </Modal>
  )
}

// ---------------- in-map search ----------------

export function SearchBar() {
  const open = useUi((s) => s.searchOpen)
  const { query, hits, index } = useSearch()
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (open) {
      ref.current?.focus()
      ref.current?.select()
    }
  }, [open])
  if (!open) return null
  const close = () => {
    ui.setSearch(false)
    clearSearch()
  }
  return (
    <div className="glass rise absolute left-1/2 top-16 z-30 flex w-[min(460px,calc(100vw-24px))] -translate-x-1/2 items-center gap-1 rounded-xl p-1.5 pl-3">
      <Search size={15} className="text-muted" />
      <input
        ref={ref}
        className="h-8 flex-1 bg-transparent px-2 text-[14px] outline-none placeholder:text-muted"
        placeholder="Find in this map…"
        value={query}
        onChange={(e) => runSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); stepSearch(e.shiftKey ? -1 : 1) }
          else if (e.key === 'Escape') { e.preventDefault(); close() }
        }}
      />
      <span className="min-w-14 text-right text-[12px] tabular-nums text-muted">
        {query.trim() ? (hits.length ? `${index + 1} / ${hits.length}` : 'No results') : ''}
      </span>
      <button className="btn icon" aria-label="Previous result" disabled={!hits.length} onClick={() => stepSearch(-1)}><ChevronUp size={16} /></button>
      <button className="btn icon" aria-label="Next result" disabled={!hits.length} onClick={() => stepSearch(1)}><ChevronDown size={16} /></button>
      <button className="btn icon" aria-label="Close search" onClick={close}><X size={16} /></button>
    </div>
  )
}

// ---------------- context menu ----------------

export interface ContextState {
  x: number
  y: number
  nodeId: string | null
}

export function ContextMenu({ state, onClose }: { state: ContextState | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const doc = useDoc((s) => s.doc)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  useEffect(() => {
    if (!state) return
    const el = ref.current
    const w = el?.offsetWidth ?? 220
    const h = el?.offsetHeight ?? 300
    setPos({ x: Math.min(state.x, innerWidth - w - 8), y: Math.min(state.y, innerHeight - h - 8) })
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', onClose)
    }
  }, [state, onClose])
  if (!state || !doc) return null
  const node = state.nodeId ? doc.nodes[state.nodeId] : null
  const item = (label: string, run: () => void, opts: { hint?: string; danger?: boolean; disabled?: boolean } = {}) => (
    <button
      key={label}
      className="flex w-full items-center justify-between gap-6 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-hover disabled:opacity-40"
      style={{ color: opts.danger ? 'var(--danger)' : undefined }}
      disabled={opts.disabled}
      onClick={() => { onClose(); run() }}
    >
      {label}
      {opts.hint && <kbd>{opts.hint}</kbd>}
    </button>
  )
  const sep = (k: string) => <div key={k} className="my-1 h-px bg-line" />
  return (
    <div
      ref={ref}
      role="menu"
      className="glass rise fixed z-[60] min-w-[210px] rounded-xl p-1.5"
      style={{ left: pos.x, top: pos.y, background: 'var(--panel-solid)' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {node ? (
        <>
          {item('Edit text', () => startEdit(node.id), { hint: 'F2' })}
          {item('Add child', () => addChild(node.id), { hint: 'Tab' })}
          {item('Add sibling', () => addSibling(), { hint: '↵' })}
          {sep('a')}
          {item(node.collapsed ? 'Expand' : 'Collapse', () => toggleCollapse([node.id]), { hint: 'Space', disabled: !node.children.length })}
          {item('Duplicate', duplicateSelection, { hint: `${modKey} D` })}
          {item('Link to another node…', () => setConnectFrom(node.id))}
          {sep('b')}
          {item('Delete', deleteSelection, { hint: 'Del', danger: true, disabled: node.id === doc.root })}
        </>
      ) : (
        <>
          {item('Fit map to screen', () => fitCurrent(), { hint: `${modKey} 0` })}
          {item('Expand all', () => expandToLevel(null))}
          {item('Collapse to level 1', () => expandToLevel(1))}
          {sep('c')}
          {item('Export…', () => ui.setExport(true), { hint: `${modKey} E` })}
        </>
      )}
    </div>
  )
}

// ---------------- shortcuts ----------------

const SHORTCUTS: [string, [string, string][]][] = [
  ['Build', [
    ['Add child', 'Tab'], ['Add sibling', '↵'], ['Add sibling above', '⇧ ↵'], ['Edit text', 'F2 / double-click'],
    ['While typing: new sibling', '↵'], ['While typing: new child', 'Tab'], ['While typing: newline', '⇧ ↵'], ['Finish typing', 'Esc'],
    ['Delete', 'Del'], ['Duplicate', `${modKey} D`], ['Collapse / expand', 'Space or the ⊖ button'],
  ]],
  ['Move around', [
    ['Select neighbour', '← ↑ → ↓'], ['Extend selection', '⇧ + arrows'], ['Select all', `${modKey} A`], ['Move among siblings', '⌥ ↑ ↓'],
    ['Indent / outdent', '⌥ → ←'], ['Go to central idea', 'Home'],
  ]],
  ['Canvas', [
    ['Pan', 'Drag background / two-finger scroll'], ['Zoom', `Scroll wheel / pinch / ${modKey} + −`], ['Fit to screen', `${modKey} 0`],
    ['Actual size', `${modKey} 1`], ['Select several', 'Shift-drag / ⇧-click'], ['Re-parent', 'Drag a node onto another'],
  ]],
  ['Everywhere', [
    ['Command palette', `${modKey} K`], ['Find', `${modKey} F`], ['Undo / redo', `${modKey} Z / ${modKey} ⇧ Z`], ['Copy / cut / paste', `${modKey} C X V`],
    ['Export', `${modKey} E`], ['Side panel', `${modKey} I`], ['Save now', `${modKey} S`], ['This sheet', '?'],
  ]],
]

export function HelpDialog() {
  const open = useUi((s) => s.helpOpen)
  if (!open) return null
  return (
    <Modal onClose={() => ui.setHelp(false)} label="Keyboard shortcuts" width={760} top="7vh">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="text-[15px] font-semibold">Keyboard shortcuts</h2>
        <button className="btn icon" aria-label="Close" onClick={() => ui.setHelp(false)}><X size={16} /></button>
      </div>
      <div className="grid max-h-[72vh] gap-x-8 gap-y-5 overflow-y-auto p-5 sm:grid-cols-2">
        {SHORTCUTS.map(([title, rows]) => (
          <section key={title}>
            <div className="label mb-2">{title}</div>
            <div className="space-y-1.5">
              {rows.map(([a, b]) => (
                <div key={a} className="flex items-center justify-between gap-3 text-[13px]">
                  <span>{a}</span>
                  <kbd>{b}</kbd>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="border-t border-line px-5 py-2.5 text-[12.5px] text-muted">
        To open this list again, press <kbd>?</kbd> on the map, or press <kbd>{modKey} K</kbd> and type <b>help</b>.
      </div>
    </Modal>
  )
}

/** Asks for text (`askPrompt`). With a `submit` function it stays open and busy until the work is done. */
export function PromptDialog() {
  const req = useUi((s) => s.prompt)
  if (!req) return null
  return <PromptForm key={req.title} req={req} />
}

function PromptForm({ req }: { req: NonNullable<ReturnType<typeof useUi.getState>['prompt']> }) {
  const [value, setValue] = useState(req.initial ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [seconds, setSeconds] = useState(0)
  const cancelled = useRef(false)
  useEffect(() => {
    if (startedAt === null) return
    setSeconds(0)
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(t)
  }, [startedAt])
  // the dialog can go away while the work runs (cancel, or another prompt): never set state after that
  useEffect(() => {
    cancelled.current = false // React runs effects twice in development: the first cleanup must not count as a cancel
    return () => { cancelled.current = true }
  }, [])

  const cancel = () => {
    cancelled.current = true
    req.resolve(null)
  }
  const send = async () => {
    const text = value.trim()
    if (!text || busy) return
    if (!req.submit) return req.resolve(text)
    setBusy(true)
    setError('')
    setStatus('')
    setStartedAt(Date.now())
    let problem: string | void
    try {
      problem = await req.submit(text, { cancelled: () => cancelled.current, status: (s) => { if (!cancelled.current) setStatus(s) } })
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e)
    }
    if (cancelled.current) return
    setStartedAt(null)
    if (problem) {
      setBusy(false)
      setError(problem)
    } else req.resolve(text)
  }
  const field = { className: 'field w-full', 'aria-label': req.title, placeholder: req.placeholder, value, disabled: busy, autoFocus: true, dir: 'auto' as const }
  return (
    <Modal onClose={cancel} label={req.title} width={req.multiline ? 560 : 420} top="18vh">
      <form className="p-5" onSubmit={(e) => { e.preventDefault(); void send() }}>
        <h2 className="text-[15px] font-semibold">{req.title}</h2>
        {req.body && <p className="mb-3 mt-1.5 text-[13px] text-muted">{req.body}</p>}
        {req.multiline ? (
          <textarea {...field} data-prose rows={7} style={{ resize: 'vertical', minHeight: 120, paddingTop: 8, paddingBottom: 8, height: 'auto' }}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send() } }} />
        ) : (
          <input {...field} onChange={(e) => setValue(e.target.value)} />
        )}
        {error && <p role="alert" className="mt-2.5 text-[12.5px]" style={{ color: 'var(--danger)' }}>{error}</p>}
        <div className="mt-4 flex items-center justify-end gap-2">
          {req.multiline && !busy && <span className="mr-auto text-[12px] text-muted"><kbd>{modKey}</kbd> <kbd>Enter</kbd> to send</span>}
          {busy && (
            <span className="mr-auto flex min-w-0 items-center gap-2 text-[12.5px] text-muted" role="status" aria-live="polite">
              <Loader2 size={14} className="shrink-0 animate-spin text-accent" />
              <span className="truncate">{status || 'Working…'}</span>
              <span className="shrink-0 tabular-nums">{seconds} s</span>
            </span>
          )}
          <button type="button" className="btn bordered" onClick={cancel}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy || !value.trim()}>
            {req.confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function ConfirmDialog() {
  const req = useUi((s) => s.confirm)
  if (!req) return null
  return (
    <Modal onClose={() => req.resolve(false)} label={req.title} width={420} top="26vh">
      <form className="p-5" onSubmit={(e) => { e.preventDefault(); req.resolve(true) }}>
        <h2 className="text-[15px] font-semibold">{req.title}</h2>
        {req.body && <p className="mt-1.5 text-[13px] text-muted">{req.body}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn bordered" onClick={() => req.resolve(false)}>Cancel</button>
          <button autoFocus type="submit" className={`btn ${req.danger ? '' : 'primary'}`} style={req.danger ? { background: 'var(--danger)', color: '#fff' } : undefined}>{req.confirmLabel}</button>
        </div>
      </form>
    </Modal>
  )
}
