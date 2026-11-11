/**
 * An invite is one line of text that lets someone join ONE shared map: the server, the room, and that
 * room's token (an HMAC the relay accepts for that room only). It never contains the master secret, so
 * a person you invite cannot open your other rooms or make rooms of their own. Still, treat it like a
 * password for that map: anyone who has it can read and edit it. Changing the relay's secret stops all invites.
 */
export interface Invite {
  serverUrl: string
  /** 40 hex characters, made by the sharer from the secret and the map id. */
  room: string
  /** 64 hex characters, valid for this room only. */
  token: string
  mapId: string
  title: string
}

const PREFIX = 'branchmint-invite:'
const MAP_ID = /^[A-Za-z0-9_-]{1,64}$/
const ROOM = /^[0-9a-f]{40}$/
const TOKEN = /^[0-9a-f]{64}$/

const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const unb64 = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

/** `wss://` always; plain `ws://` only for a server on this computer (development). */
export function validServerUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol === 'wss:') return true
    return u.protocol === 'ws:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  } catch {
    return false
  }
}

export function encodeInvite(i: Invite): string {
  return PREFIX + b64(JSON.stringify({ s: i.serverUrl, r: i.room, k: i.token, m: i.mapId, t: i.title }))
}

/** Null when the text is not a valid invite. */
export function decodeInvite(text: string): Invite | null {
  const t = text.trim()
  if (!t.startsWith(PREFIX) || t.length > 2000) return null
  try {
    const o = JSON.parse(unb64(t.slice(PREFIX.length)))
    if (typeof o?.s !== 'string' || typeof o.r !== 'string' || typeof o.k !== 'string' || typeof o.m !== 'string') return null
    if (!validServerUrl(o.s) || !ROOM.test(o.r) || !TOKEN.test(o.k) || !MAP_ID.test(o.m)) return null
    return { serverUrl: o.s.replace(/\/+$/, ''), room: o.r, token: o.k, mapId: o.m, title: typeof o.t === 'string' ? o.t.slice(0, 200) : '' }
  } catch {
    return null
  }
}
