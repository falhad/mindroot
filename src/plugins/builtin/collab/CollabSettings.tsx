import { useEffect, useState } from 'react'
import type { PluginContext } from '../../types'
import { COLLAB_DEFAULTS, joinFromInvite, type CollabSettingsData } from './index'
import { validServerUrl } from './invite'

const randomSecret = () => {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

export function CollabSettings({ ctx }: { ctx: PluginContext }) {
  const [cfg, setCfg] = useState<CollabSettingsData>(COLLAB_DEFAULTS)
  const [hasSecret, setHasSecret] = useState(false)
  const [secretInput, setSecretInput] = useState('')
  const [invite, setInvite] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void ctx.settings.get(COLLAB_DEFAULTS).then(setCfg)
    void ctx.secrets!.get('secret').then((s) => setHasSecret(!!s))
  }, [ctx])

  const save = (next: CollabSettingsData) => {
    setCfg(next)
    void ctx.settings.set(next)
  }
  const saveSecret = async (value: string) => {
    const v = value.trim()
    if (v.length < 16) return setMsg({ ok: false, text: 'The secret must be at least 16 characters.' })
    await ctx.secrets!.set('secret', v)
    setHasSecret(true)
    setSecretInput('')
    setMsg({ ok: true, text: 'Secret saved.' })
  }
  const urlBad = cfg.serverUrl !== '' && !validServerUrl(cfg.serverUrl)

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted">
        Work on a map together at the same time. You run a small relay server (see <code>server/relay</code>) and everyone uses the same secret. Edits made offline are merged when you reconnect. Undo only undoes your own changes.
      </p>
      <label className="block text-[12.5px]">
        <span className="mb-1 block text-muted">Relay server address</span>
        <input className="field" aria-label="Relay server address" placeholder="wss://relay.example.com" spellCheck={false} value={cfg.serverUrl} onChange={(e) => save({ ...cfg, serverUrl: e.target.value.trim() })} />
        {urlBad && <span className="mt-1 block text-[12px]" style={{ color: 'var(--danger)' }}>It must start with wss:// (ws:// is only allowed for localhost).</span>}
      </label>
      <label className="block text-[12.5px]">
        <span className="mb-1 block text-muted">Your name (shown to others)</span>
        <input className="field" aria-label="Your name" dir="auto" value={cfg.name} onChange={(e) => save({ ...cfg, name: e.target.value })} />
      </label>
      <div className="text-[12.5px]">
        <span className="mb-1 block text-muted">Relay secret (only needed to share your own maps) {hasSecret && <b className="text-ink">· saved</b>}</span>
        <div className="flex gap-2">
          <input className="field" type="password" aria-label="Shared secret" autoComplete="off" placeholder={hasSecret ? '•••••••• (saved, type a new one to replace)' : 'At least 16 characters'} value={secretInput} onChange={(e) => setSecretInput(e.target.value)} />
          <button className="btn bordered" disabled={!secretInput.trim()} onClick={() => void saveSecret(secretInput)}>Save</button>
          <button className="btn" title="Make a long random secret" onClick={() => void saveSecret(randomSecret())}>Generate</button>
        </div>
      </div>

      <div className="rounded-xl border border-line p-3.5">
        <div className="mb-1.5 text-[13px] font-semibold">Join a shared map</div>
        <p className="mb-2 text-[12.5px] text-muted">Paste the invite someone sent you. It sets the server and secret and opens the map.</p>
        <textarea className="field" rows={2} aria-label="Invite" placeholder="mindroot-invite:…" spellCheck={false} style={{ resize: 'vertical' }} value={invite} onChange={(e) => setInvite(e.target.value)} />
        <button className="btn primary mt-2" disabled={busy || !invite.trim()} onClick={async () => {
          setBusy(true)
          setMsg(null)
          try {
            const r = await joinFromInvite(ctx, invite)
            setMsg({ ok: r.ok, text: r.message })
            if (r.ok) setInvite('')
          } finally {
            setBusy(false)
          }
        }}>{busy ? 'Joining…' : 'Join'}</button>
      </div>
      {msg && <p className="text-[12.5px]" role="status" style={{ color: msg.ok ? undefined : 'var(--danger)' }}>{msg.text}</p>}
      <p className="text-[12px] text-muted">Shared maps on this computer: {Object.keys(cfg.connections).length}. An invite opens one map only and never contains your secret. Use “Stop sharing this map” in the command palette (⌘K) to stop.</p>
    </div>
  )
}
