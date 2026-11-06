import { AlertTriangle, Check, CloudOff, Loader2 } from 'lucide-react'
import { ui } from '../../../state/ui'
import { ago } from '../../../ui/time'
import { useSync } from './state'

/** Small chip in the header. Click to open the sync settings. */
export function SyncStatus() {
  const { phase, lastSyncAt, error, settings } = useSync()
  if (phase === 'off' && !settings.remoteUrl) return null
  const base = 'btn gap-1.5 text-[12px]'
  const open = () => ui.setSettings(true, 'branchmint.sync')
  if (phase === 'syncing')
    return <button className={base} onClick={open} title="Syncing with Git"><Loader2 size={14} className="animate-spin" /> <span className="hidden md:inline">Syncing…</span></button>
  if (phase === 'error')
    return <button className={`${base} text-danger`} onClick={open} title={error ?? 'Sync failed'}><AlertTriangle size={14} /> <span className="hidden md:inline">Sync problem</span></button>
  if (phase === 'off')
    return <button className={`${base} text-muted`} onClick={open} title="Git sync is off"><CloudOff size={14} /> <span className="hidden md:inline">Sync off</span></button>
  return <button className={`${base} text-muted`} onClick={open} title="Synced with Git"><Check size={14} /> <span className="hidden md:inline">{lastSyncAt ? `Synced ${ago(lastSyncAt)}` : 'Connected'}</span></button>
}
