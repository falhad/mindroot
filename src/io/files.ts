import { isTauri } from './env'

export interface SaveOptions {
  defaultName: string
  extensions: string[]
  label: string
}

/** Save bytes/text to a user-chosen location. Resolves false if the user cancelled. */
export async function saveFile(data: string | Uint8Array | Blob, opts: SaveOptions): Promise<boolean> {
  const bytes =
    typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data

  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { invoke } = await import('@tauri-apps/api/core')
    const path = await save({
      defaultPath: opts.defaultName,
      filters: [{ name: opts.label, extensions: opts.extensions }],
    })
    if (!path) return false
    await invoke('save_bytes', bytes, { headers: { path: encodeURIComponent(path) } })
    return true
  }

  const blob = new Blob([bytes as BlobPart])
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = opts.defaultName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return true
}

/** Open the native file picker (works in the Tauri webview and browsers). */
export function pickFile(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.style.display = 'none'
    input.onchange = () => {
      resolve(Array.from(input.files ?? []))
      input.remove()
    }
    input.oncancel = () => {
      resolve([])
      input.remove()
    }
    document.body.appendChild(input)
    input.click()
  })
}

export function safeFileName(s: string): string {
  return (s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim() || 'Mindroot map').slice(0, 80)
}

/** Open a URL in the system browser (Tauri) or a new tab. Only http(s)/mailto are allowed. */
export async function openExternal(url: string) {
  const u = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`
  if (!/^(https?:|mailto:)/i.test(u)) return
  if (isTauri) {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(u)
  } else window.open(u, '_blank', 'noopener,noreferrer')
}

/** Read an image file, downscale to fit `max` px, return a data URL + size. */
export async function readImage(file: Blob, max = 1024): Promise<{ src: string; w: number; h: number }> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error('Could not read this image'))
      i.src = url
    })
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * k))
    const h = Math.max(1, Math.round(img.naturalHeight * k))
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    c.getContext('2d')!.drawImage(img, 0, 0, w, h)
    const keepPng = file.type === 'image/png' || file.type === 'image/svg+xml' || file.type === 'image/gif'
    return { src: c.toDataURL(keepPng ? 'image/png' : 'image/jpeg', 0.86), w, h }
  } finally {
    URL.revokeObjectURL(url)
  }
}
