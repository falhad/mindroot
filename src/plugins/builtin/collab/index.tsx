import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { prepareForSave, store } from '../../../io/storage'
import { refreshLibrary } from '../../../state/library'
import { goTo } from '../../../state/ui'
import type { Plugin, PluginContext } from '../../types'
import { isEmptyY, yToDoc } from './bind'
import { CollabSettings } from './CollabSettings'
import { roomName, roomToken } from './crypto'
import { decodeInvite, encodeInvite, validServerUrl, type Invite } from './invite'
import { Session, useCollab } from './session'

/** Where and how one map is shared. The token is kept in the keychain, under `token:<mapId>`. */
export interface Connection {
  serverUrl: string
  room: string
}

export interface CollabSettingsData {
  /** Server used when YOU share a map. */
  serverUrl: string
  name: string
  /** One entry per shared map (maps you shared and maps you joined). They reconnect when opened. */
  connections: Record<string, Connection>
}

export const COLLAB_DEFAULTS: CollabSettingsData = { serverUrl: '', name: '', connections: {} }
/** The master secret. Only needed to share your own maps; invitees never get it. */
const SECRET_KEY = 'secret'
const tokenKey = (mapId: string) => `token:${mapId}`

let session: Session | null = null

async function connect(ctx: PluginContext, mapId: string) {
  session?.dispose()
  session = null
  const cfg = await ctx.settings.get(COLLAB_DEFAULTS)
  const conn = cfg.connections[mapId]
  const token = (await ctx.secrets!.get(tokenKey(mapId))) ?? ''
  if (!conn || !token || !validServerUrl(conn.serverUrl)) return
  if (ctx.docs.openId() !== mapId) return // the map changed while we read the settings
  session = Session.open({ ctx, serverUrl: conn.serverUrl, room: conn.room, token, name: cfg.name, mapId })
}

function stop() {
  session?.dispose()
  session = null
}

async function share(ctx: PluginContext) {
  const doc = ctx.docs.current()
  const mapId = ctx.docs.openId()
  if (!doc || !mapId) return ctx.ui.toast('Open a map first', 'info')
  const cfg = await ctx.settings.get(COLLAB_DEFAULTS)
  const secret = (await ctx.secrets!.get(SECRET_KEY)) ?? ''
  const existing = cfg.connections[mapId]
  if (existing && (await ctx.secrets!.get(tokenKey(mapId)))) {
    // already shared (or joined): just make sure it is connected and hand out the invite
    await connect(ctx, mapId)
    return copyInvite(ctx)
  }
  if (!cfg.serverUrl || !secret) {
    ctx.ui.toast('Set the server address and the secret first (Settings → Live collaboration)', 'error')
    return ctx.ui.openSettings()
  }
  if (!validServerUrl(cfg.serverUrl)) {
    ctx.ui.toast('The server address must start with wss:// (ws:// only for this computer)', 'error')
    return ctx.ui.openSettings()
  }
  // a fresh random part in every share: stopping and sharing again makes a NEW room, so old invites lead nowhere
  const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')
  const room = await roomName(secret, `${mapId}:${nonce}`)
  await ctx.secrets!.set(tokenKey(mapId), await roomToken(secret, room))
  await ctx.settings.set({ ...cfg, connections: { ...cfg.connections, [mapId]: { serverUrl: cfg.serverUrl, room } } })
  await connect(ctx, mapId)
  await copyInvite(ctx)
}

async function copyInvite(ctx: PluginContext) {
  const doc = ctx.docs.current()
  if (!doc) return
  const cfg = await ctx.settings.get(COLLAB_DEFAULTS)
  const conn = cfg.connections[doc.meta.id]
  const token = (await ctx.secrets!.get(tokenKey(doc.meta.id))) ?? ''
  if (!conn || !token) return ctx.ui.toast('This map is not shared yet. Use “Share this map live…” first.', 'info')
  const text = encodeInvite({ serverUrl: conn.serverUrl, room: conn.room, token, mapId: doc.meta.id, title: doc.meta.title })
  try {
    await navigator.clipboard.writeText(text)
    ctx.ui.toast('Invite copied. It opens this one map only. Send it privately: anyone who has it can read and edit the map.', 'success')
  } catch {
    ctx.ui.toast('Could not copy the invite to the clipboard.', 'error')
  }
}

async function unshare(ctx: PluginContext) {
  const mapId = ctx.docs.openId()
  if (!mapId) return
  const cfg = await ctx.settings.get(COLLAB_DEFAULTS)
  const { [mapId]: _gone, ...rest } = cfg.connections
  await ctx.settings.set({ ...cfg, connections: rest })
  await ctx.secrets!.remove(tokenKey(mapId))
  stop()
  ctx.ui.toast('Stopped sharing this map. Everyone keeps their own copy.', 'info')
}

/** Try the credentials of an invite: connect, wait for the first sync, and report. Never stores anything. */
async function fetchSharedMap(invite: Invite): Promise<{ ok: true; ydoc: Y.Doc; close(): void } | { ok: false; message: string }> {
  const ydoc = new Y.Doc()
  const provider = new WebsocketProvider(invite.serverUrl, invite.room, ydoc, { params: { token: invite.token }, disableBc: true })
  const close = () => {
    provider.destroy()
    ydoc.destroy()
  }
  const got = await new Promise<'ok' | 'denied' | 'timeout'>((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), 15_000)
    provider.on('sync', (s: boolean) => s && (clearTimeout(timer), resolve('ok')))
    provider.on('connection-close', (e: CloseEvent | null) => e?.code === 4401 && (clearTimeout(timer), resolve('denied')))
  })
  if (got === 'denied') return close(), { ok: false, message: 'The server did not accept this invite.' }
  if (got === 'timeout') return close(), { ok: false, message: 'Could not reach the server. Check the invite and your connection.' }
  return { ok: true, ydoc, close }
}

/**
 * Join a map from an invite.
 *  - A map you do not have yet is downloaded first; the invite is remembered only after that worked.
 *  - A map you already have is merged with the shared one, after you confirm.
 *  - If that map is already shared through another server or room, replacing it needs your confirmation too.
 * Joining never changes the connections of other maps and never touches your own secret.
 */
export async function joinFromInvite(ctx: PluginContext, text: string): Promise<{ ok: boolean; message: string }> {
  const invite = decodeInvite(text)
  if (!invite) return { ok: false, message: 'That is not a valid invite.' }
  const cfg = await ctx.settings.get(COLLAB_DEFAULTS)
  const existing = cfg.connections[invite.mapId]
  const local = await store.load(invite.mapId)
  const host = new URL(invite.serverUrl).host

  if (existing && (existing.serverUrl !== invite.serverUrl || existing.room !== invite.room)) {
    const yes = await ctx.ui.confirm({
      title: 'Replace how this map is shared?',
      body: `This map is already shared through ${new URL(existing.serverUrl).host}. The invite is for ${host}. Only continue if you trust whoever sent it.`,
      confirmLabel: 'Replace',
      danger: true,
    })
    if (!yes) return { ok: false, message: 'Cancelled. Nothing was changed.' }
  } else if (local && !existing) {
    const yes = await ctx.ui.confirm({
      title: 'Merge with the shared map?',
      body: `You already have a map with this id. Joining merges it with the shared map on ${host}, and what you changed here becomes visible to the others. Only continue if you trust whoever sent the invite.`,
      confirmLabel: 'Join and merge',
    })
    if (!yes) return { ok: false, message: 'Cancelled. Nothing was changed.' }
  }

  if (!local) {
    const r = await fetchSharedMap(invite)
    if (!r.ok) return r
    try {
      if (isEmptyY(r.ydoc)) return { ok: false, message: 'That shared map is empty or no longer shared.' }
      const now = Date.now()
      const doc = yToDoc(r.ydoc, { id: invite.mapId, title: invite.title || 'Shared map', createdAt: now, updatedAt: now, nodeCount: 0, tags: [] })
      prepareForSave(doc)
      await store.save(doc)
      await refreshLibrary()
    } finally {
      r.close()
    }
  }
  // it worked (or you confirmed): remember this map's credentials, and only this map's
  await ctx.secrets!.set(tokenKey(invite.mapId), invite.token)
  await ctx.settings.set({ ...cfg, connections: { ...cfg.connections, [invite.mapId]: { serverUrl: invite.serverUrl, room: invite.room } } })
  goTo({ name: 'editor', id: invite.mapId })
  return { ok: true, message: 'Joined. The map is open.' }
}

export const collabPlugin: Plugin = {
  manifest: {
    id: 'mindroot.collab',
    name: 'Live collaboration',
    version: '1.0.0',
    description: 'Edit a map together with other people at the same time, through a small relay server you run. Offline edits merge when you reconnect.',
    permissions: ['secrets'],
  },
  activate(ctx) {
    const cmd = (id: string, title: string, run: () => void | Promise<void>) => ctx.commands.register({ id, title, group: 'Collaboration', run })
    cmd('share', 'Share this map live…', () => share(ctx))
    cmd('invite', 'Copy the invite for this shared map', () => copyInvite(ctx))
    cmd('stop', 'Stop sharing this map', () => unshare(ctx))
    cmd('join', 'Join a shared map…', () => ctx.ui.openSettings())
    ctx.settingsPanel.register({ title: 'Live collaboration', render: () => <CollabSettings ctx={ctx} /> })
    ctx.status.register({ id: 'live', order: 20, render: () => <LiveChip /> })
    ctx.events.on('doc:opened', (p) => void connect(ctx, (p as { id: string }).id).catch((e) => console.error('live session failed', e)))
    ctx.events.on('doc:closed', stop)
    ctx.events.on('app:before-quit', stop)
    // the plugin was switched on while a map is open
    const open = ctx.docs.openId()
    if (open) void connect(ctx, open).catch(() => {})
  },
  deactivate() {
    stop()
  },
}

function LiveChip() {
  const { status, others, message } = useCollab()
  if (status === 'off') return null
  const text = {
    connecting: 'Connecting…',
    live: others > 0 ? `Live · ${others} ${others === 1 ? 'other' : 'others'} here` : 'Live · just you',
    offline: 'Offline · edits kept',
    denied: 'Not allowed',
    error: 'Sharing problem',
  }[status]
  const color = status === 'live' ? '#16a34a' : status === 'connecting' ? '#d97706' : '#dc2626'
  return (
    <span className="no-drag flex items-center gap-1.5 text-[12px] text-muted" role="status" aria-live="polite" title={message || undefined} data-collab-status={status}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: color }} />
      {text}
    </span>
  )
}
