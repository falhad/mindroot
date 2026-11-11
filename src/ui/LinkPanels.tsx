import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, CalendarClock, Search, X } from 'lucide-react'
import { backlinksTo, linkStatus } from '../core/links'
import { orderedIds } from '../core/tree'
import type { MindNode } from '../core/types'
import { store } from '../io/storage'
import { commit, useDoc } from '../state/doc'
import { useDigest } from '../state/digest'
import { openMap, followMapLink } from '../state/links'
import { useLibrary } from '../state/library'

/** Due date and done state of a node. A node with either is listed in the Tasks view. */
export function TaskFields({ node, ids }: { node: MindNode; ids: string[] }) {
  const tracked = node.done !== undefined || !!node.due
  const set = (fn: (n: MindNode) => void) => commit((d) => { for (const id of ids) if (d.nodes[id]) fn(d.nodes[id]) })
  return (
    <div className="space-y-2.5">
      <label className="flex cursor-pointer items-center gap-2 text-[13px]">
        <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={tracked}
          onChange={(e) => set((n) => { if (e.target.checked) n.done = n.done ?? false; else { delete n.done; delete n.due } })} />
        Track as task
      </label>
      {tracked && (
        <>
          <label className="flex cursor-pointer items-center gap-2 text-[13px]">
            <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={node.done === true} onChange={(e) => set((n) => void (n.done = e.target.checked))} />
            Done
          </label>
          <div className="relative">
            <CalendarClock size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input type="date" aria-label="Due date" className="field" style={{ paddingLeft: 30 }} value={node.due ?? ''}
              onChange={(e) => set((n) => { if (e.target.value) n.due = e.target.value; else delete n.due })} />
          </div>
        </>
      )}
    </div>
  )
}

/** Link a node to another map of the vault, or to one idea inside it. */
export function MapLinkFields({ node }: { node: MindNode }) {
  const here = useDoc((s) => s.doc!.meta.id)
  const items = useLibrary((s) => s.items)
  const maps = useMemo(() => items.filter((m) => !m.trashedAt && m.id !== here).sort((a, b) => a.title.localeCompare(b.title)), [items, here])
  const link = node.mapLink
  const status = link ? linkStatus(link, items) : 'ok'
  const [picking, setPicking] = useState(false)
  return (
    <div className="space-y-2">
      <select className="field" aria-label="Linked map" value={link?.mapId ?? ''}
        onChange={(e) => { setPicking(false); commit((d) => { if (e.target.value) d.nodes[node.id].mapLink = { mapId: e.target.value }; else delete d.nodes[node.id].mapLink }) }}>
        <option value="">No linked map</option>
        {link && !maps.some((m) => m.id === link.mapId) && <option value={link.mapId}>{status === 'trashed' ? '(map in trash)' : '(map not found)'}</option>}
        {maps.map((m) => <option key={m.id} value={m.id}>{m.title || 'Untitled map'}</option>)}
      </select>
      {link && status !== 'ok' && <p className="text-[12px]" style={{ color: 'var(--danger)' }}>{status === 'trashed' ? 'This map is in the trash.' : 'This map is not in your library.'}</p>}
      {link && status === 'ok' && (
        <div className="flex items-center gap-1.5">
          <button className="btn outline flex-1" onClick={() => followMapLink(link)}><ArrowUpRight size={14} /> Open</button>
          <button className="btn outline flex-1" aria-expanded={picking} onClick={() => setPicking((v) => !v)}>{link.nodeId ? 'Change idea' : 'Pick an idea'}</button>
          {link.nodeId && <button className="btn icon" aria-label="Link to the whole map" title="Link to the whole map" onClick={() => commit((d) => void (d.nodes[node.id].mapLink = { mapId: link.mapId }))}><X size={14} /></button>}
        </div>
      )}
      {link && picking && <NodePicker mapId={link.mapId} onPick={(nodeId) => { setPicking(false); commit((d) => void (d.nodes[node.id].mapLink = { mapId: link.mapId, nodeId })) }} />}
    </div>
  )
}

function NodePicker({ mapId, onPick }: { mapId: string; onPick: (nodeId: string) => void }) {
  const [rows, setRows] = useState<{ id: string; text: string }[] | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    let alive = true
    void store.load(mapId).then((d) => {
      if (alive) setRows(d ? orderedIds(d).map((id) => ({ id, text: d.nodes[id].text.replace(/\s+/g, ' ').trim() || 'New idea' })) : [])
    })
    return () => { alive = false }
  }, [mapId])
  const shown = (rows ?? []).filter((r) => r.text.toLowerCase().includes(q.toLowerCase())).slice(0, 80)
  return (
    <div className="rounded-xl border border-line p-2">
      <div className="relative mb-1.5">
        <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
        <input className="field" style={{ height: 30, paddingLeft: 26 }} dir="auto" placeholder="Find an idea" aria-label="Find an idea in the linked map" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ul className="max-h-44 overflow-y-auto" role="listbox" aria-label="Ideas in the linked map">
        {rows === null && <li className="px-2 py-1.5 text-[12px] text-muted">Loading…</li>}
        {shown.map((r) => (
          <li key={r.id}><button role="option" aria-selected={false} className="w-full truncate rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-hover" dir="auto" onClick={() => onPick(r.id)}>{r.text}</button></li>
        ))}
        {rows && !shown.length && <li className="px-2 py-1.5 text-[12px] text-muted">No ideas match.</li>}
      </ul>
    </div>
  )
}

/** Nodes in other maps that link here (to this map, or to this idea). */
export function Backlinks({ nodeId }: { nodeId?: string }) {
  const here = useDoc((s) => s.doc!.meta.id)
  const byMap = useDigest((s) => s.byMap)
  const list = useMemo(() => backlinksTo(byMap, here, nodeId), [byMap, here, nodeId])
  if (!list.length) return <p className="text-[12px] text-muted">No other map links here yet.</p>
  return (
    <ul className="space-y-1" aria-label="Linked from">
      {list.map((b) => (
        <li key={`${b.fromMapId}:${b.from}`}>
          <button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-hover" onClick={() => openMap(b.fromMapId, b.from)}>
            <ArrowUpRight size={13} className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1"><span className="block truncate" dir="auto">{b.fromText || 'New idea'}</span><span className="block truncate text-[11.5px] text-muted" dir="auto">{b.fromMapTitle}</span></span>
          </button>
        </li>
      ))}
    </ul>
  )
}
