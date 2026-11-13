import { useState } from 'react'
import { AlertTriangle, Check, CloudOff, GitBranch, Loader2, RefreshCw, Unplug } from 'lucide-react'
import { ago } from '../../../ui/time'
import { getController, isValidRemote } from './controller'
import { useSync } from './state'

const field = 'flex flex-col gap-1.5'
const hint = 'text-[12px] leading-snug text-muted'

export function SyncPanel({ desktop }: { desktop: boolean }) {
  const s = useSync()
  const c = getController()
  const [url, setUrl] = useState(s.settings.remoteUrl)
  const [branch, setBranch] = useState(s.settings.branch)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  if (!desktop)
    return <p className="text-[13px] text-muted">Git sync runs in the desktop app. Your maps in this browser are not synced.</p>
  if (!c) return <Loader2 className="animate-spin text-muted" />
  if (s.gitMissing)
    return (
      <div className="flex gap-3 rounded-xl border border-[var(--danger)] p-3 text-[13px]">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" />
        <div>
          <div className="font-medium">Git is not installed</div>
          <p className={hint}>Install Git (for example with <code>brew install git</code> or from git-scm.com), then restart Mindroot.</p>
        </div>
      </div>
    )

  const connected = s.settings.enabled && !!s.settings.remoteUrl
  const dirty = url.trim() !== s.settings.remoteUrl || branch.trim() !== s.settings.branch

  const connect = async () => {
    setFormError(null)
    setBusy(true)
    try {
      await c.connect(url, branch)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <StatusCard />

      <section className="space-y-3">
        <div className="label">Repository</div>
        <label className={field}>
          <span className="text-[13px] font-medium">Git address</span>
          <input className="field" value={url} spellCheck={false} placeholder="git@github.com:you/your-vault.git" onChange={(e) => setUrl(e.target.value)} />
          <span className={hint}>Use a private repository. Mindroot uses the Git login you already have (an SSH key, or <code>gh auth setup-git</code> for https).</span>
        </label>
        <label className={field}>
          <span className="text-[13px] font-medium">Branch</span>
          <input className="field" style={{ maxWidth: 200 }} value={branch} spellCheck={false} onChange={(e) => setBranch(e.target.value)} />
        </label>
        {formError && <p className="text-[12.5px] text-danger" role="alert">{formError}</p>}
        <div className="flex flex-wrap gap-2">
          <button className="btn primary" disabled={busy || !url.trim() || !isValidRemote(url) || (connected && !dirty)} onClick={connect}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <GitBranch size={15} />} {connected ? 'Save and sync' : 'Connect and sync'}
          </button>
          {connected && (
            <>
              <button className="btn bordered" disabled={s.phase === 'syncing'} onClick={() => void c.sync('manual')}>
                <RefreshCw size={15} className={s.phase === 'syncing' ? 'animate-spin' : ''} /> Sync now
              </button>
              <button className="btn" onClick={() => void c.disconnect()}><Unplug size={15} /> Turn off</button>
            </>
          )}
        </div>
        {s.vaultPath && <p className={hint}>Your maps live in <code className="break-all">{s.vaultPath}</code></p>}
      </section>

      <section className="space-y-3">
        <div className="label">Automatic sync</div>
        <label className="flex items-center justify-between gap-4 text-[13px]">
          <span>Sync on a timer</span>
          <select className="field" style={{ width: 'auto', padding: '4px 8px' }} value={s.settings.intervalMin} disabled={!connected} onChange={(e) => void c.saveSettings({ intervalMin: Number(e.target.value) })}>
            <option value={0}>Never</option>
            <option value={1}>Every minute</option>
            <option value={5}>Every 5 minutes</option>
            <option value={15}>Every 15 minutes</option>
            <option value={30}>Every 30 minutes</option>
          </select>
        </label>
        <Check_ label="Sync about 30 seconds after I stop editing" checked={s.settings.onChange} disabled={!connected} onChange={(v) => void c.saveSettings({ onChange: v })} />
        <Check_ label="Sync when I close Mindroot" checked={s.settings.onQuit} disabled={!connected} onChange={(v) => void c.saveSettings({ onQuit: v })} />
        <p className={hint}>Two devices can edit the same map. Mindroot merges their changes idea by idea. If both change the same text, the newer edit wins and you see a message. Nothing is deleted without a trace: every sync is a Git commit you can go back to.</p>
      </section>
    </div>
  )
}

function Check_({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange(v: boolean): void }) {
  return (
    <label className={`flex cursor-pointer items-center gap-2.5 text-[13px] ${disabled ? 'opacity-50' : ''}`}>
      <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

function StatusCard() {
  const s = useSync()
  const r = s.lastResult
  let icon = <CloudOff size={18} className="text-muted" />
  let title = 'Not connected'
  let body = 'Connect a private Git repository to back up your maps and use them on more than one computer.'
  if (s.phase === 'syncing') {
    icon = <Loader2 size={18} className="animate-spin text-accent" />
    title = 'Syncing…'
    body = 'Talking to the repository.'
  } else if (s.phase === 'error') {
    icon = <AlertTriangle size={18} className="text-danger" />
    title = 'Last sync failed'
    body = s.error ?? 'Unknown error'
  } else if (s.phase === 'idle') {
    icon = <Check size={18} className="text-accent" />
    title = s.lastSyncAt ? `Synced ${ago(s.lastSyncAt)}` : 'Connected'
    body = r
      ? [r.pulled ? 'Received changes' : null, r.pushed ? 'sent changes' : null, r.merged ? `merged ${r.merged} map${r.merged > 1 ? 's' : ''}` : null].filter(Boolean).join(', ').replace(/^./, (c) => c.toUpperCase()) || 'Everything is up to date.'
      : 'Waiting for the first sync.'
  }
  return (
    <div className="flex gap-3 rounded-xl border border-line bg-hover p-3.5" style={s.phase === 'error' ? { borderColor: 'var(--danger)' } : undefined} aria-live="polite">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-[13.5px] font-semibold">{title}</div>
        <p className="text-[12.5px] leading-snug text-muted">{body}</p>
      </div>
    </div>
  )
}
