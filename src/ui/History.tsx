import { useEffect, useMemo, useState } from 'react'
import { GitCompare, History as HistoryIcon, Loader2, RotateCcw, X } from 'lucide-react'
import { diffDocs, restoreSubtree } from '../core/diff'
import type { MapDoc } from '../core/types'
import { commit, select, useDoc } from '../state/doc'
import { loadHistory, loadVersionDoc, restoreWholeMap, type HistoryResult } from '../state/history'
import { askConfirm, toast, ui, useUi } from '../state/ui'
import { Modal } from './Overlays'
import { ago } from './time'

/** Older versions of the open map, from the vault's Git history. */
export function HistoryPanel() {
  const open = useUi((s) => s.historyOpen)
  if (!open) return null
  return <Inner />
}

function Inner() {
  const current = useDoc((s) => s.doc)!
  const [result, setResult] = useState<HistoryResult | null>(null)
  const [error, setError] = useState('')
  const [sha, setSha] = useState<string | null>(null)
  const [old, setOld] = useState<MapDoc | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let alive = true
    loadHistory(current.meta.id).then((r) => alive && setResult(r)).catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => { alive = false }
  }, [current.meta.id])

  useEffect(() => {
    if (!sha) return setOld(null)
    let alive = true
    setLoading(true)
    loadVersionDoc(current.meta.id, sha)
      .then((d) => alive && setOld(d))
      .catch((e) => alive && toast(`Could not read that version: ${e instanceof Error ? e.message : e}`, 'error'))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [sha, current.meta.id])

  const diff = useMemo(() => (old ? diffDocs(old, current) : null), [old, current])
  const close = () => ui.setHistory(false)

  const restoreAll = async () => {
    if (!old) return
    if (!(await askConfirm({ title: 'Restore this version?', body: 'The map goes back to how it was. You can undo this with Undo, and the next sync saves it as a new version.', confirmLabel: 'Restore' }))) return
    if (restoreWholeMap(old)) { toast('Version restored', 'success'); close() } else toast('That version could not be restored', 'error')
  }
  const restoreIdea = (id: string) => {
    if (!old) return
    let back: string | null = null
    commit((d) => { back = restoreSubtree(d, old, id) })
    if (back) { select([back]); toast('Idea restored', 'success') }
  }

  return (
    <Modal onClose={close} label="Map history" width={900} top="7vh">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold"><HistoryIcon size={17} className="text-accent" /> History of “{current.meta.title}”</h2>
        <button className="btn icon" aria-label="Close" onClick={close}><X size={16} /></button>
      </div>
      {error ? (
        <p className="p-6 text-[13px]" style={{ color: 'var(--danger)' }} role="alert">{error}</p>
      ) : !result ? (
        <div className="grid h-48 place-items-center"><Loader2 className="animate-spin text-muted" /></div>
      ) : !result.available ? (
        <p className="p-6 text-[13px] text-muted">History comes from Git, so it is only in the desktop app, and only after you turn on Git sync in Settings.</p>
      ) : result.versions.length === 0 ? (
        <p className="p-6 text-[13px] text-muted">There are no saved versions of this map yet. Every Git sync saves one. Turn on Git sync in Settings and sync once.</p>
      ) : (
        <div className="grid min-h-[360px] sm:grid-cols-[300px_1fr]">
          <ul className="max-h-[62vh] overflow-y-auto border-line p-2 sm:border-r" aria-label="Versions">
            {result.versions.map((v) => (
              <li key={v.sha}>
                <button className={`w-full rounded-lg px-3 py-2 text-left hover:bg-hover ${sha === v.sha ? 'bg-active' : ''}`} aria-pressed={sha === v.sha} onClick={() => setSha(v.sha)}>
                  <span className="block text-[13px] font-medium">{ago(v.at)}</span>
                  <span className="block truncate text-[12px] text-muted" dir="auto">{v.subject}</span>
                  <span className="block truncate text-[11.5px] text-muted">{v.author}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="p-5">
            {!sha ? (
              <p className="text-[13px] text-muted">Pick a version on the left to see what changed since then.</p>
            ) : loading || !old || !diff ? (
              <Loader2 className="animate-spin text-muted" />
            ) : (
              <div className="space-y-4">
                <p className="text-[13px]" data-testid="history-summary">
                  Since this version: <b>{diff.added.length}</b> ideas added, <b>{diff.removed.length}</b> removed, <b>{diff.changed.length}</b> changed.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button className="btn outline" onClick={() => { close(); ui.setCompare({ a: old, b: current, labelA: `Version from ${ago(result.versions.find((v) => v.sha === sha)!.at)}`, labelB: 'Now' }) }}><GitCompare size={15} /> Compare side by side</button>
                  <button className="btn primary" onClick={() => void restoreAll()}><RotateCcw size={15} /> Restore this version</button>
                </div>
                {diff.removed.length > 0 && (
                  <div>
                    <div className="label mb-1.5">Ideas that are gone now</div>
                    <ul className="max-h-48 space-y-1 overflow-y-auto" aria-label="Removed ideas">
                      {diff.removed.slice(0, 100).map((id) => (
                        <li key={id} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-[13px]">
                          <span className="min-w-0 flex-1 truncate" dir="auto">{old.nodes[id].text || 'New idea'}</span>
                          <button className="btn" style={{ height: 26 }} onClick={() => restoreIdea(id)}>Bring back</button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
