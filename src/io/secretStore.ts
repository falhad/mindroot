import { isTauri } from './env'

/** Where the desktop app keeps secrets (API keys): a private file in the app data folder, or the system keychain. */
export type SecretStore = 'file' | 'keychain'

const invoke = async <T,>(cmd: string, args?: Record<string, unknown>) => (await import('@tauri-apps/api/core')).invoke<T>(cmd, args)

export async function getSecretStore(): Promise<SecretStore | null> {
  if (!isTauri) return null
  return (await invoke<string>('secret_store_get')) === 'keychain' ? 'keychain' : 'file'
}

/** Change the place. The app moves the saved secrets to the new place. */
export async function setSecretStore(mode: SecretStore): Promise<void> {
  await invoke<void>('secret_store_set', { mode })
}
