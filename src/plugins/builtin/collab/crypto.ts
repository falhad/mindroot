/** HMAC-SHA256 as lower-case hex. The relay computes the same values with Node's crypto. */
async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)))
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** The room of a map: only people who know the secret can work out its name. */
export async function roomName(secret: string, mapId: string): Promise<string> {
  return (await hmacHex(secret, `room:${mapId}`)).slice(0, 40)
}

/** What a client sends to prove it knows the secret. */
export function roomToken(secret: string, room: string): Promise<string> {
  return hmacHex(secret, `token:${room}`)
}
