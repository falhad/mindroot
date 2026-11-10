import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { create } from 'zustand'
import type { MapDoc } from '../../../core/types'
import { useDoc } from '../../../state/doc'
import { usePresence, type Peer } from '../../../state/presence'
import { mergeDocs } from '../../../sync/merge'
import type { PluginContext } from '../../types'
import { applyDocToY, docToY, isEmptyY, LOCAL, yToDoc } from './bind'

export type CollabStatus = 'off' | 'connecting' | 'live' | 'offline' | 'denied' | 'error'

interface CollabState {
  status: CollabStatus
  mapId: string | null
  /** Other people in the map (not counting you). */
  others: number
  message: string
}

/** What the header chip shows. */
export const useCollab = create<CollabState>(() => ({ status: 'off', mapId: null, others: 0, message: '' }))
const setState = useCollab.setState

const COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#db2777', '#4d7c0f']

export interface SessionOptions {
  ctx: PluginContext
  serverUrl: string
  /** The room of this map and its token (never the master secret). */
  room: string
  token: string
  name: string
  mapId: string
}

/**
 * One live session for the open map: a Yjs document kept in step with the app's map, a connection to the
 * relay, who else is here, and undo that only undoes your own edits.
 *
 *   you edit  -> `applyDocToY` writes only what changed, as origin LOCAL (undoable)
 *   others edit -> the Yjs document changes -> `yToDoc` -> `ctx.docs.applyRemote` (not an undo step)
 * The first time a device joins a room that already has content, its map and the room's are merged with the
 * same three-way merge Git sync uses, so nothing typed offline is lost.
 */
export class Session {
  readonly ydoc = new Y.Doc()
  readonly provider: WebsocketProvider
  private um: Y.UndoManager
  private mirror: MapDoc | null = null
  private ready = false
  private applyingRemote = false
  private disposed = false
  private cleanups: (() => void)[] = []
  private remoteTimer: ReturnType<typeof setTimeout> | null = null

  private constructor(private o: SessionOptions, room: string, token: string) {
    this.provider = new WebsocketProvider(o.serverUrl, room, this.ydoc, { params: { token }, disableBc: true })
    this.um = new Y.UndoManager([this.ydoc.getMap('meta'), this.ydoc.getMap('nodes'), this.ydoc.getMap('rels'), this.ydoc.getMap('groups'), this.ydoc.getMap('sums')], {
      trackedOrigins: new Set([LOCAL]),
      captureTimeout: 500,
    })
    setState({ status: 'connecting', mapId: o.mapId, others: 0, message: '' })

    this.provider.on('status', ({ status }: { status: string }) => {
      if (this.disposed) return
      if (status === 'connected') setState({ status: this.ready ? 'live' : 'connecting', message: '' })
      else if (useCollab.getState().status !== 'denied') setState({ status: 'offline', message: 'You are offline. Your edits are kept and will be shared when the connection returns.' })
    })
    this.provider.on('connection-close', (e: CloseEvent | null) => {
      if (this.disposed || !e) return
      if (e.code === 4401) {
        this.provider.shouldConnect = false // do not keep retrying with a wrong secret
        setState({ status: 'denied', message: 'The server did not accept the secret. Check it in Settings → Live collaboration.' })
      } else if (e.code === 4429) {
        this.provider.shouldConnect = false
        setState({ status: 'error', message: 'The server is full (too many people or maps). Try again later.' })
      } else if (e.code === 1009) {
        setState({ status: 'error', message: 'A change was too large for the server and was not shared.' })
      }
    })
    this.provider.on('sync', (synced: boolean) => {
      if (synced && !this.disposed) this.start()
    })
  }

  static open(o: SessionOptions): Session {
    return new Session(o, o.room, o.token)
  }

  /** The first sync with the room finished: write our map into an empty room, or merge with what is there. */
  private start() {
    if (this.ready) {
      setState({ status: 'live', message: '' })
      return
    }
    const { ctx, mapId } = this.o
    const local = ctx.docs.current()
    if (!local || local.meta.id !== mapId) return
    if (isEmptyY(this.ydoc)) {
      docToY(this.ydoc, local, 'init')
      this.mirror = local
    } else {
      const remote = yToDoc(this.ydoc, local.meta)
      const merged = mergeDocs(null, local as never, remote as never).doc
      this.applyingRemote = true
      ctx.docs.applyRemote(merged)
      this.applyingRemote = false
      applyDocToY(this.ydoc, remote, merged, 'init') // also sends what only we had
      this.mirror = merged
    }
    this.ready = true
    setState({ status: 'live', message: '' })
    this.attach()
  }

  private attach() {
    const { ctx, name } = this.o

    // your edits -> the shared document
    const sub = ctx.docs.subscribe((doc) => {
      if (!doc || this.applyingRemote || doc.meta.id !== this.o.mapId) return
      applyDocToY(this.ydoc, this.mirror, doc, LOCAL)
      this.mirror = doc
    })
    this.cleanups.push(() => sub.dispose())

    // other people's edits -> your map (several updates in one moment are applied together)
    const onUpdate = (_u: Uint8Array, origin: unknown) => {
      if (origin === LOCAL || origin === 'init') return
      if (this.remoteTimer) return
      this.remoteTimer = setTimeout(() => {
        this.remoteTimer = null
        this.pullRemote()
      }, 0)
    }
    this.ydoc.on('update', onUpdate)
    this.cleanups.push(() => this.ydoc.off('update', onUpdate))

    // undo and redo only touch your own edits
    ctx.docs.setUndoHandlers({
      undo: () => (this.um.undo(), true),
      redo: () => (this.um.redo(), true),
    })
    this.cleanups.push(() => ctx.docs.setUndoHandlers(null))

    // who is here, and what they have selected
    const aw = this.provider.awareness
    const color = COLORS[this.ydoc.clientID % COLORS.length]
    aw.setLocalStateField('user', { name: name || 'Guest', color })
    aw.setLocalStateField('selection', [...useDoc.getState().selection])
    const unsubSel = useDoc.subscribe((s, prev) => {
      if (s.selection !== prev.selection) aw.setLocalStateField('selection', [...s.selection])
    })
    this.cleanups.push(unsubSel)
    const onAwareness = () => {
      const peers: Peer[] = []
      aw.getStates().forEach((st, id) => {
        const u = (st as { user?: { name?: string; color?: string }; selection?: string[] })
        if (id === this.ydoc.clientID || !u.user) return
        peers.push({ id, name: u.user.name ?? 'Guest', color: u.user.color ?? '#64748b', selection: Array.isArray(u.selection) ? u.selection.filter((x) => typeof x === 'string') : [] })
      })
      usePresence.setState({ peers })
      setState({ others: peers.length })
    }
    aw.on('change', onAwareness)
    this.cleanups.push(() => aw.off('change', onAwareness))
    onAwareness()
  }

  private pullRemote() {
    if (this.disposed || !this.ready) return
    const { ctx } = this.o
    const current = ctx.docs.current()
    if (!current || current.meta.id !== this.o.mapId) return
    const next = yToDoc(this.ydoc, current.meta)
    this.applyingRemote = true
    try {
      ctx.docs.applyRemote(next)
    } finally {
      this.applyingRemote = false
    }
    this.mirror = next
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    if (this.remoteTimer) clearTimeout(this.remoteTimer)
    for (const c of this.cleanups.splice(0)) c()
    this.provider.awareness.setLocalState(null)
    this.provider.destroy()
    this.um.destroy()
    this.ydoc.destroy()
    usePresence.setState({ peers: [] })
    setState({ status: 'off', mapId: null, others: 0, message: '' })
  }
}
