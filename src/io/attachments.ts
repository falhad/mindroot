import type { Attachment } from '../core/types'
import { uid } from '../core/ids'
import { sha256Hex, type AssetIO } from './assets'
import { isTauri } from './env'
import { assetIO } from './storage'

export const MAX_ATTACHMENT = 25 * 1024 * 1024

/** Types opened with the default app (desktop). Must match `OPENABLE` in `src-tauri/src/attachments.rs`. Everything else is only shown in the file manager. */
export const OPENABLE = new Set([
  'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'txt', 'md', 'csv', 'rtf', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'mp3', 'm4a', 'wav', 'mp4', 'mov', 'webm',
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

export const isOpenable = (a: Pick<Attachment, 'asset'>) => OPENABLE.has(a.asset.split('.').pop() ?? '')

/** The file name used for a download: no folders or control characters, no leading dot, at most 100 characters, and the asset's own extension (never the stored name's). */
export function downloadName(a: Pick<Attachment, 'name' | 'asset'>): string {
  const ext = a.asset.split('.').pop() ?? 'bin'
  // eslint-disable-next-line no-control-regex
  const base = a.name.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_').trim().replace(/^\.+/, '').slice(0, 100) || 'attachment'
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`
}

/** Store a file in the vault (named by its SHA-256, so the same file is kept once) and describe it. */
export async function addAttachment(file: File, io: AssetIO = assetIO): Promise<Attachment> {
  if (file.size === 0) throw new Error(`"${file.name}" is empty`)
  if (file.size > MAX_ATTACHMENT) throw new Error(`"${file.name}" is larger than 25 MB`)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const asset = `${await sha256Hex(bytes)}.${attachmentExt(file.name)}`
  if (!(await io.exists(asset))) await io.save(asset, bytes)
  return { id: uid(8), name: file.name.slice(0, 200), asset, mime: file.type || 'application/octet-stream', size: bytes.length }
}

/** Open an attachment (desktop: safe types open, others are shown in the file manager; browser: download). Returns what happened. */
export async function openAttachment(a: Attachment, io: AssetIO = assetIO): Promise<'opened' | 'revealed' | 'downloaded'> {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core')
    return (await invoke<'opened' | 'revealed'>('open_attachment', { name: a.asset, display: a.name }))
  }
  const bytes = await io.load(a.asset)
  // never trust the stored MIME type: a download is plain bytes
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }))
  const link = document.createElement('a')
  link.href = url
  link.download = downloadName(a)
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'downloaded'
}
