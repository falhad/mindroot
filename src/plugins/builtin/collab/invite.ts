/**
 * An invite is one line of text that gives someone the server, the secret and the map to join.
 * It contains the secret, so treat it like a password: anyone who has it can read and edit that group's maps.
 */
export interface Invite {
  serverUrl: string
  secret: string
  mapId: string
  title: string
}

const PREFIX = 'branchmint-invite:'
const MAP_ID = /^[A-Za-z0-9_-]{1,64}$/

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
  return PREFIX + b64(JSON.stringify({ s: i.serverUrl, k: i.secret, m: i.mapId, t: i.title }))
}

/** Null when the text is not a valid invite. */
export function decodeInvite(text: string): Invite | null {
  const t = text.trim()
  if (!t.startsWith(PREFIX) || t.length > 2000) return null
  try {
    const o = JSON.parse(unb64(t.slice(PREFIX.length)))
    if (typeof o?.s !== 'string' || typeof o.k !== 'string' || typeof o.m !== 'string') return null
    if (!validServerUrl(o.s) || o.k.length < 16 || !MAP_ID.test(o.m)) return null
    return { serverUrl: o.s.replace(/\/+$/, ''), secret: o.k, mapId: o.m, title: typeof o.t === 'string' ? o.t.slice(0, 200) : '' }
  } catch {
    return null
  }
}
