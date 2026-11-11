import { useEffect, useState } from 'react'
import { autoCheckEnabled, setAutoCheck, updater, useUpdater } from '../io/updater'
import { askConfirm, toast } from '../state/ui'
import { PluginGallery } from './PluginGallery'
import { registerCaptureShortcut } from '../io/captureShortcut'
import { DEFAULT_SHORTCUT, getInboxName, getShortcut, setInboxName, setShortcut } from '../state/capture'
import { Blocks, FolderOpen, Moon, Puzzle, Settings2, Sun, Monitor, X } from 'lucide-react'
import { isTauri } from '../io/env'
import { forgetPluginEnabled, setPluginEnabled, useRegistry, type PluginRecord } from '../plugins/host'
import { applyTheme, ui, useUi } from '../state/ui'
import { Modal } from './Overlays'

export function SettingsDialog() {
  const open = useUi((s) => s.settingsOpen)
  if (!open) return null
  return <Inner />
}

function Inner() {
  const tab = useUi((s) => s.settingsTab)
  const panels = useRegistry((s) => s.panels)
  const active = tab === 'general' || tab === 'plugins' || panels.some((p) => p.pluginId === tab) ? tab : 'general'
  const nav = (id: string, label: string, icon: React.ReactNode) => (
    <button key={id} onClick={() => ui.setSettings(true, id)} aria-current={active === id ? 'page' : undefined}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] ${active === id ? 'bg-active text-accent' : 'hover:bg-hover'}`}>
      {icon} <span className="truncate">{label}</span>
    </button>
  )
  const panel = panels.find((p) => p.pluginId === active)

  return (
    <Modal onClose={() => ui.setSettings(false)} label="Settings" width={860} top="7vh">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="text-[15px] font-semibold">Settings</h2>
        <button className="btn icon" aria-label="Close" onClick={() => ui.setSettings(false)}><X size={16} /></button>
      </div>
      <div className="grid min-h-[420px] max-h-[74vh] sm:grid-cols-[210px_1fr]">
        <nav className="space-y-0.5 overflow-y-auto border-line p-2.5 sm:border-r" aria-label="Settings sections">
          {nav('general', 'General', <Settings2 size={15} />)}
          {nav('plugins', 'Plugins', <Blocks size={15} />)}
          {panels.length > 0 && <div className="label px-2.5 pb-1 pt-3">Plugin settings</div>}
          {panels.map((p) => nav(p.pluginId, p.title, <Puzzle size={15} />))}
        </nav>
        <div className="overflow-y-auto p-5">
          {active === 'general' && <General />}
          {active === 'plugins' && <Plugins />}
          {panel && (
            <div>
              <h3 className="mb-4 text-[15px] font-semibold">{panel.title}</h3>
              {panel.render()}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

function General() {
  const mode = useUi((s) => s.themeMode)
  const opts = [['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'System', Monitor]] as const
  return (
    <div className="space-y-6">
      <section>
        <div className="label mb-2">Appearance</div>
        <div className="seg">
          {opts.map(([id, label, Icon]) => (
            <button key={id} className={mode === id ? 'on' : ''} onClick={() => applyTheme(id)}><Icon size={13} className="mr-1 inline" /> {label}</button>
          ))}
        </div>
      </section>
      <section>
        <div className="label mb-2">Keyboard</div>
        <button className="btn outline" onClick={() => { ui.setSettings(false); ui.setHelp(true) }}>Show all shortcuts</button>
      </section>
      {isTauri && <UpdateSettings />}
      {isTauri && <CaptureSettings />}
    </div>
  )
}

/** Check for a new version, install it, and restart. Updates are signed; anything else is refused. */
function UpdateSettings() {
  const { state, current } = useUpdater()
  const [auto, setAuto] = useState(autoCheckEnabled())
  useEffect(() => {
    void updater.load()
  }, [])
  const busy = state.kind === 'checking' || state.kind === 'downloading'
  return (
    <section>
      <div className="label mb-2">Updates</div>
      <p className="mb-2.5 text-[12.5px] text-muted">You have Branchmint {current || '…'}.</p>
      <div className="flex flex-wrap items-center gap-2.5">
        {state.kind === 'available' ? (
          <button className="btn primary" onClick={() => void updater.install()}>Install version {state.version}</button>
        ) : state.kind === 'ready' ? (
          <button className="btn primary" onClick={() => void updater.restart()}>Restart to finish the update</button>
        ) : (
          <button className="btn outline" disabled={busy} onClick={() => void updater.check()}>{state.kind === 'checking' ? 'Checking…' : 'Check for updates'}</button>
        )}
        <label className="flex cursor-pointer items-center gap-2 text-[12.5px]">
          <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={auto} onChange={(e) => { setAuto(e.target.checked); setAutoCheck(e.target.checked) }} />
          Check when Branchmint starts
        </label>
      </div>
      <div className="mt-2.5 text-[12.5px]" role="status" aria-live="polite" data-testid="update-status">
        {state.kind === 'uptodate' && 'You have the latest version.'}
        {state.kind === 'available' && (
          <div>
            <b>Version {state.version} is available.</b>
            {state.notes && <p className="mt-1 whitespace-pre-wrap text-muted" dir="auto">{state.notes}</p>}
          </div>
        )}
        {state.kind === 'downloading' && `Downloading… ${state.percent}%`}
        {state.kind === 'ready' && `Version ${state.version} is installed. Restart to use it.`}
        {state.kind === 'error' && <span style={{ color: 'var(--danger)' }}>{state.message}</span>}
      </div>
    </section>
  )
}

/** Quick capture: the system-wide shortcut and the name of the map that collects the notes. */
function CaptureSettings() {
  const [shortcut, setShortcutText] = useState(getShortcut())
  const [inbox, setInbox] = useState(getInboxName())
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const apply = async () => {
    const ok = await registerCaptureShortcut(shortcut.trim() || DEFAULT_SHORTCUT)
    if (ok) {
      setShortcut(shortcut)
      setMsg({ ok: true, text: `Press ${shortcut.trim() || DEFAULT_SHORTCUT} anywhere to capture a thought.` })
    } else {
      await registerCaptureShortcut(getShortcut()) // put the old one back
      setMsg({ ok: false, text: 'That shortcut is not valid or another app uses it. The old one still works.' })
    }
  }
  return (
    <section>
      <div className="label mb-2">Quick capture</div>
      <p className="mb-2.5 text-[12.5px] text-muted">A small window opens from anywhere on your computer. Type a thought, press Enter, and it is added to one map.</p>
      <div className="grid gap-2.5 sm:grid-cols-[1fr_auto]">
        <label className="text-[12.5px]">
          <span className="mb-1 block text-muted">Shortcut, for example Alt+Shift+Space or CommandOrControl+Shift+N</span>
          <input className="field" aria-label="Capture shortcut" value={shortcut} spellCheck={false} onChange={(e) => setShortcutText(e.target.value)} />
        </label>
        <button className="btn outline self-end" onClick={() => void apply()}>Apply</button>
      </div>
      <label className="mt-2.5 block text-[12.5px]">
        <span className="mb-1 block text-muted">Map that collects the notes</span>
        <input className="field" aria-label="Inbox map name" dir="auto" value={inbox} onChange={(e) => { setInbox(e.target.value); setInboxName(e.target.value) }} />
      </label>
      {msg && <p className="mt-2 text-[12.5px]" role="status" style={{ color: msg.ok ? undefined : 'var(--danger)' }}>{msg.text}</p>}
    </section>
  )
}

function Plugins() {
  const plugins = useRegistry((s) => s.plugins)
  const [path, setPath] = useState('')
  useEffect(() => {
    if (!isTauri) return
    void import('@tauri-apps/api/core').then(({ invoke }) => invoke<string>('plugins_path').then(setPath).catch(() => {}))
  }, [])
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted">Plugins add commands, status chips and settings. Built-in plugins use the same plugin API as the ones you install.</p>
      <ul className="space-y-2">
        {plugins.map((p) => <PluginRow key={p.manifest.id} p={p} />)}
      </ul>
      <PluginGallery />
      {isTauri && (
        <div className="rounded-xl border border-dashed border-[var(--line-strong)] p-3.5 text-[12.5px] text-muted">
          <div className="mb-1 flex items-center gap-1.5 font-medium text-ink"><FolderOpen size={14} /> Install a plugin</div>
          Put its folder (with <code>manifest.json</code> and <code>index.js</code>) here, then restart Branchmint:
          <code className="mt-1 block break-all text-ink">{path || '…'}</code>
          Installed plugins start switched off. They run with full access to the app, so only enable code you trust.
        </div>
      )}
    </div>
  )
}

function PluginRow({ p }: { p: PluginRecord }) {
  const on = p.state === 'active'
  const hasNative = p.manifest.permissions?.includes('native')
  return (
    <li className="flex items-start gap-3 rounded-xl border border-line p-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13.5px] font-semibold">{p.manifest.name}</span>
          <span className="text-[11.5px] text-muted">v{p.manifest.version}</span>
          {p.builtin ? <Tag>built-in</Tag> : <Tag>installed</Tag>}
          {hasNative && <Tag title="Can call the app's native commands (files, Git)">native access</Tag>}
        </div>
        {p.manifest.description && <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{p.manifest.description}</p>}
        {p.state === 'error' && <p className="mt-1 text-[12.5px] text-danger" role="alert">Could not start: {p.error}</p>}
        {!p.builtin && isTauri && (
          <button className="mt-1.5 text-[12px] text-muted hover:text-ink" onClick={async () => {
            if (!(await askConfirm({ title: `Remove ${p.manifest.name}?`, body: 'Its folder is deleted. Restart Branchmint to finish.', confirmLabel: 'Remove', danger: true }))) return
            try {
              const { invoke } = await import('@tauri-apps/api/core')
              await invoke('plugin_uninstall', { id: p.manifest.id })
              await forgetPluginEnabled(p.manifest.id) // a plugin installed again later starts switched off
              toast(`${p.manifest.name} removed. Restart Branchmint to finish.`, 'success')
            } catch (e) {
              toast(`Could not remove it: ${e instanceof Error ? e.message : e}`, 'error')
            }
          }}>Remove</button>
        )}
      </div>
      <label className="relative mt-0.5 inline-flex shrink-0 cursor-pointer items-center" title={on ? 'Turn off' : 'Turn on'}>
        <input type="checkbox" role="switch" className="peer sr-only" checked={on} disabled={p.state === 'error' && !p.builtin} onChange={(e) => void setPluginEnabled(p.manifest.id, e.target.checked)} aria-label={`${p.manifest.name} enabled`} />
        <span className="h-5 w-9 rounded-full bg-[var(--line-strong)] transition-colors peer-checked:bg-[var(--accent)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--accent)]" />
        <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
      </label>
    </li>
  )
}

const Tag = ({ children, title }: { children: React.ReactNode; title?: string }) => (
  <span title={title} className="rounded-md bg-hover px-1.5 py-0.5 text-[11px] text-muted">{children}</span>
)
