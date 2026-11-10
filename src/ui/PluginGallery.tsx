import { useCallback, useEffect, useState } from 'react'
import { Download, Loader2, RefreshCw } from 'lucide-react'
import { isTauri } from '../io/env'
import { DEFAULT_INDEX_URL, entryState, parseIndex, type GalleryEntry } from '../plugins/gallery'
import { netRequest, useRegistry } from '../plugins/host'
import { toast } from '../state/ui'

const URL_KEY = 'bm.gallery.url'
const PERMISSION_HELP: Record<string, string> = {
  native: "Can call the app's native commands (files, Git)",
  net: 'Can make network requests',
  secrets: 'Can store secrets such as API keys in your keychain',
}

const readUrl = () => {
  try {
    return localStorage.getItem(URL_KEY)?.trim() || DEFAULT_INDEX_URL
  } catch {
    return DEFAULT_INDEX_URL
  }
}

/** Browse the published plugins and install them (desktop app). Every download is checked against the SHA-256 in the list. */
export function PluginGallery() {
  const installed = useRegistry((s) => s.plugins)
  const [url, setUrl] = useState(readUrl())
  const [entries, setEntries] = useState<GalleryEntry[] | null>(null)
  const [skipped, setSkipped] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [restart, setRestart] = useState(false)

  const load = useCallback(async (from: string) => {
    setLoading(true)
    setError('')
    try {
      const res = await netRequest({ url: from, method: 'GET', timeoutMs: 20_000 })
      if (res.status !== 200) throw new Error(`The list could not be loaded (the server answered ${res.status})`)
      const r = parseIndex(res.body)
      setEntries(r.entries)
      setSkipped(r.skipped)
    } catch (e) {
      setEntries(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(url)
    // load once when the tab opens; the refresh button reloads on demand
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const install = async (e: GalleryEntry) => {
    setBusy(e.id)
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke<string>('plugin_install', { url: e.url, sha256: e.sha256 })
      setRestart(true)
      toast(`${e.name} installed. Restart Branchmint, then switch it on.`, 'success')
    } catch (err) {
      toast(`Could not install ${e.name}: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-label="Plugin gallery" className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold">Browse plugins</h3>
        <button className="btn icon" aria-label="Reload the list" title="Reload the list" onClick={() => void load(url)} disabled={loading}>
          {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
        </button>
      </div>
      {error && <p className="text-[12.5px]" style={{ color: 'var(--danger)' }} role="alert">{error}</p>}
      {entries && entries.length === 0 && !error && <p className="text-[12.5px] text-muted">The list has no plugins yet.</p>}
      {restart && <p className="rounded-lg bg-hover px-3 py-2 text-[12.5px]" role="status">Restart Branchmint to use what you installed. New plugins start switched off.</p>}
      <ul className="space-y-2">
        {(entries ?? []).map((e) => {
          const state = entryState(e, installed.map((p) => ({ id: p.manifest.id, version: p.manifest.version })))
          return (
            <li key={e.id} data-gallery-entry={e.id} className="flex items-start gap-3 rounded-xl border border-line p-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13.5px] font-semibold">{e.name}</span>
                  <span className="text-[11.5px] text-muted">v{e.version}{e.author ? ` · ${e.author}` : ''}</span>
                  {e.permissions.map((p) => <span key={p} title={PERMISSION_HELP[p]} data-permission={p} className="rounded-md bg-hover px-1.5 py-0.5 text-[11px] text-muted">{p}</span>)}
                </div>
                {e.description && <p className="mt-0.5 text-[12.5px] leading-snug text-muted" dir="auto">{e.description}</p>}
              </div>
              {state === 'installed' ? (
                <span className="mt-1 shrink-0 text-[12.5px] text-muted">Installed</span>
              ) : (
                <button className="btn outline shrink-0" disabled={!isTauri || busy !== null} title={isTauri ? undefined : 'Installing plugins needs the desktop app'} onClick={() => void install(e)}>
                  {busy === e.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} {state === 'update' ? 'Update' : 'Install'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {skipped > 0 && <p className="text-[12px] text-muted">{skipped} {skipped === 1 ? 'entry was' : 'entries were'} skipped because {skipped === 1 ? 'it is' : 'they are'} not valid.</p>}
      <label className="block text-[12px] text-muted">
        <span className="mb-1 block">List address</span>
        <input className="field" aria-label="Gallery list address" value={url} spellCheck={false}
          onChange={(e) => { setUrl(e.target.value); try { localStorage.setItem(URL_KEY, e.target.value.trim()) } catch { /* ignore */ } }}
          onBlur={() => void load(url)} />
      </label>
      <p className="text-[11.5px] text-muted">Plugins run with full access to the app. Install only ones you trust. Every download is checked against the checksum in the list.</p>
    </section>
  )
}
