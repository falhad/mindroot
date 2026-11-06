const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/** Short random id (safe for file names: [a-z0-9]). */
export function uid(len = 10): string {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
  return out
}
