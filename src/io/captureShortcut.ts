import { isTauri } from './env'

let current: string | null = null

/** Show the small capture window (desktop). It lives in the second window, `capture`. */
export async function showCapture() {
  if (!isTauri) return
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
  const w = await WebviewWindow.getByLabel('capture')
  if (!w) return
  await w.center()
  await w.show()
  await w.setFocus()
}

/**
 * Register the system-wide shortcut that opens the capture window. Replaces the old one.
 * Returns false (and keeps nothing registered) when the shortcut is invalid or taken by another app.
 */
export async function registerCaptureShortcut(shortcut: string): Promise<boolean> {
  if (!isTauri) return false
  const gs = await import('@tauri-apps/plugin-global-shortcut')
  if (current) await gs.unregister(current).catch(() => {})
  current = null
  try {
    await gs.register(shortcut, (e) => {
      if (e.state === 'Pressed') void showCapture()
    })
    current = shortcut
    return true
  } catch (e) {
    console.warn('could not register the capture shortcut', e)
    return false
  }
}
