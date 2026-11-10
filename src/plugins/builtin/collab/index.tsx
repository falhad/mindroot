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

export interface CollabSettingsData {
  serverUrl: string
  name: string
  /** Ids of maps this device shares live. They reconnect when opened. */
  shared: string[]
}

export const COLLAB_DEFAULTS: CollabSettingsData = { serverUrl: '', name: '', shared: [] }
const SECRET_KEY = 'secret'

let session: Session | null = null

async function connect(ctx: PluginContext, mapId: string) {
  session?.dispose()
  session = null
  const cfg = await ctx.settings.get(COLLAB_DEFAULTS)
  const secret = (await ctx.secrets!.get(SECRET_KEY)) ?? ''
  if (!cfg.shared.includes(mapId) || !cfg.serverUrl || !secret || !validServerUrl(cfg.serverUrl)) return
  // the map may have changed while we read the settings
  if (ctx.docs.openId() !== mapId) return
  session = await Session.open({ ctx, serverUrl: cfg.serverUrl, secret, name: cfg.name, mapId })
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
  if (!cfg.serverUrl || !secret) {
    ctx.ui.toast('Set the server address and the secret first (Settings → Live collaboration)', 'error')
    return ctx.ui.openSettings()
  }
  if (!validServerUrl(cfg.serverUrl)) {
    ctx.ui.toast('The server address must start with wss:// (ws:// only for this computer)', 'error')
    return ctx.ui.openSettings()
  }
  if (!cfg.shared.includes(mapId)) await ctx.settings.set({ ...cfg, shared: [...cfg.shared, mapId] })
  await connect(ctx, mapId)
  await copyInvite(ctx)
}

async function copyInvite(ctx: PluginContext) {
  const doc = ctx.docs.current()
  const cfg = await ctx.settings.get(COLLAB_DEFAULTS)
  const secret = (await ctx.secrets!.get(SECRET_KEY)) ?? ''
  if (!doc || !cfg.serverUrl || !secret) return
  const text = encodeInvite({ serverUrl: cfg.serverUrl, secret, mapId: doc.meta.id, title: doc.meta.title })
  try {
    await navigator.clipboard.writeText(text)
    ctx.ui.toast('Invite copied. Send it privately: anyone who has it can read and edit this map.', 'success')
  } catch {
    ctx.ui.toast('Could not copy the invite. Copy it from Settings → Live collaboration.', 'error')
  }
}

async function unshare(ctx: PluginContext) {
  const mapId = ctx.docs.openId()
  if (!mapId) return
  const cfg = await ctx.settings.get(COLLAB_DEFAULTS)
  await ctx.settings.set({ ...cfg, shared: cfg.shared.filter((x) => x !== mapId) })
  stop()
  ctx.ui.toast('Stopped sharing this map. Everyone keeps their own copy.', 'info')
}

/**
 * Join a map from an invite. If you already have it, it opens. If not, it is downloaded from the room into a
 * new map in your library first.
 */
export async function joinFromInvite(ctx: PluginContext, text: string): Promise<{ ok: boolean; message: string }> {
  const invite: Invite | null = decodeInvite(text)
  if (!invite) return { ok: false, message: 'That is not a valid invite.' }
  const cfg = await ctx.settings.get(COLLAB_DEFAULTS)
  await ctx.secrets!.set(SECRET_KEY, invite.secret)
  await ctx.settings.set({ ...cfg, serverUrl: invite.serverUrl, shared: [...new Set([...cfg.shared, invite.mapId])] })

  if (!(await store.load(invite.mapId))) {
    const ydoc = new Y.Doc()
    const room = await roomName(invite.secret, invite.mapId)
    const provider = new WebsocketProvider(invite.serverUrl, room, ydoc, { params: { token: await roomToken(invite.secret, room) }, disableBc: true })
    try {
      const got = await new Promise<'ok' | 'denied' | 'timeout'>((resolve) => {
        const timer = setTimeout(() => resolve('timeout'), 15_000)
        provider.on('sync', (s: boolean) => s && (clearTimeout(timer), resolve('ok')))
        provider.on('connection-close', (e: CloseEvent | null) => e?.code === 4401 && (clearTimeout(timer), resolve('denied')))
      })
      if (got === 'denied') return { ok: false, message: 'The server did not accept the secret in this invite.' }
      if (got === 'timeout') return { ok: false, message: 'Could not reach the server. Check the invite and your connection.' }
      if (isEmptyY(ydoc)) return { ok: false, message: 'That shared map is empty or no longer shared.' }
      const now = Date.now()
      const doc = yToDoc(ydoc, { id: invite.mapId, title: invite.title || 'Shared map', createdAt: now, updatedAt: now, nodeCount: 0, tags: [] })
      prepareForSave(doc)
      await store.save(doc)
      await refreshLibrary()
    } finally {
      provider.destroy()
      ydoc.destroy()
    }
  }
  goTo({ name: 'editor', id: invite.mapId })
  return { ok: true, message: 'Joined. The map is open.' }
}

export const collabPlugin: Plugin = {
  manifest: {
    id: 'branchmint.collab',
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
    ctx.status.register({
      id: 'live',
      order: 20,
      render: () => <LiveChip />,
    })
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

