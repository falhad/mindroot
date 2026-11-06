import type { MapDoc } from '../core/types'
import type { RawDoc } from '../core/format'

const MIME_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }
const EXT_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }

export function dataUrlToBytes(src: string): { bytes: Uint8Array; ext: string } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(src)
  const ext = m && MIME_EXT[m[1]]
  if (!m || !ext) return null
  const bin = atob(m[2])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { bytes, ext }
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${mime};base64,${btoa(bin)}`
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Hashing a multi-megabyte image on every autosave would be wasteful: remember by content.
const nameBySrc = new Map<string, string>()
const srcByName = new Map<string, string>()

export interface AssetIO {
  exists(name: string): Promise<boolean>
  save(name: string, bytes: Uint8Array): Promise<void>
  load(name: string): Promise<Uint8Array>
}

/** Make sure every inline image of `doc` is stored as an asset file. Returns data URL -> asset name. */
export async function collectAssets(doc: MapDoc, io: AssetIO): Promise<Map<string, string>> {
  const refs = new Map<string, string>()
  for (const n of Object.values(doc.nodes)) {
    const src = n.image?.src
    if (!src || refs.has(src)) continue
    let name = nameBySrc.get(src)
    const parsed = name && (await io.exists(name)) ? null : dataUrlToBytes(src)
    if (!name || parsed) {
      // new image, or its file vanished (vault cleaned or replaced): hash if needed, then write it
      if (!parsed) continue
      name ??= `${await sha256Hex(parsed.bytes)}.${parsed.ext}`
      if (!(await io.exists(name))) await io.save(name, parsed.bytes)
      if (nameBySrc.size > 200) nameBySrc.clear()
      nameBySrc.set(src, name)
      srcByName.set(name, src)
    }
    refs.set(src, name)
  }
  return refs
}

/** Replace `{asset,w,h}` images in a raw doc with inline data URLs. Missing files drop the image. */
export async function hydrateImages(raw: RawDoc, io: AssetIO): Promise<string[]> {
  const missing: string[] = []
  for (const n of Object.values<RawDoc>(raw.nodes ?? {})) {
    const img = n.image
    if (!img || typeof img.asset !== 'string') continue
    try {
      let src = srcByName.get(img.asset)
      if (!src) {
        const ext = img.asset.split('.').pop() ?? ''
        src = bytesToDataUrl(await io.load(img.asset), EXT_MIME[ext] ?? 'image/png')
        if (srcByName.size > 200) srcByName.clear()
        srcByName.set(img.asset, src)
        nameBySrc.set(src, img.asset)
      }
      n.image = { src, w: img.w, h: img.h }
    } catch {
      missing.push(img.asset)
      delete n.image
    }
  }
  return missing
}
