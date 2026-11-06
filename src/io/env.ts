export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const modKey = isMac ? '⌘' : 'Ctrl'
