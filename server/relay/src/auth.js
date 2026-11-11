import { createHmac, timingSafeEqual } from 'node:crypto'

/** A room name is the first 40 hex characters of HMAC(secret, "room:" + mapId), made by the app. */
export const ROOM_RE = /^[0-9a-f]{40}$/

/** What a client must send to join a room: HMAC(secret, "token:" + room). Only someone who knows the secret can make it. */
export function tokenFor(secret, room) {
  return createHmac('sha256', secret).update(`token:${room}`).digest('hex')
}

/** Constant-time check of a token. */
export function checkToken(secret, room, token) {
  if (typeof token !== 'string' || token.length !== 64) return false
  const want = Buffer.from(tokenFor(secret, room))
  const got = Buffer.from(token)
  return want.length === got.length && timingSafeEqual(want, got)
}
