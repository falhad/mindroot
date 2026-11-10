import type { Attachment } from '../core/types'
import { uid } from '../core/ids'
import { sha256Hex, type AssetIO } from './assets'
import { isTauri } from './env'
import { assetIO } from './storage'

export const MAX_ATTACHMENT = 25 * 1024 * 1024

/** Extensions an attachment is never opened with (they can run code). The file can still be stored. */
const RISKY = new Set([
  'exe', 'bat', 'cmd', 'com', 'scr', 'msi', 'sh', 'command', 'app', 'jar', 'js', 'vbs', 'ps1', 'dmg', 'pkg', 'lnk', 'desktop', 'appimage', 'deb', 'rpm',
])

/** Lower-case alphanumeric extension of up to 8 characters, else `bin`. `tmp` is reserved by the vault. */
export function attachmentExt(name: string): string {
  const ext = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : ''
  return /^[a-z0-9]{1,8}$/.test(ext) && ext !== 'tmp' ? ext : 'bin'
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export const isRiskyAttachment = (a: Pick<Attachment, 'asset'>) => RISKY.has(a.asset.split('.').pop() ?? '')

/** Store a file in the vault (named by its SHA-256, so the same file is kept once) and describe it. */
export async function addAttachment(file: File, io: AssetIO = assetIO): Promise<Attachment> {
  if (file.size === 0) throw new Error(`"${file.name}" is empty`)
  if (file.size > MAX_ATTACHMENT) throw new Error(`"${file.name}" is larger than 25 MB`)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const asset = `${await sha256Hex(bytes)}.${attachmentExt(file.name)}`
  if (!(await io.exists(asset))) await io.save(asset, bytes)
  return { id: uid(8), name: file.name.slice(0, 200), asset, mime: file.type || 'application/octet-stream', size: bytes.length }
}

/** Open an attachment with the system's default app (desktop) or download it (browser). */
export async function openAttachment(a: Attachment, io: AssetIO = assetIO): Promise<void> {
  if (isRiskyAttachment(a)) throw new Error('Program files are not opened from Branchmint. Find the file in the vault folder if you really want it.')
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('open_attachment', { name: a.asset, display: a.name })
    return
  }
  const bytes = await io.load(a.asset)
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: a.mime }))
  const link = document.createElement('a')
  link.href = url
  link.download = a.name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
