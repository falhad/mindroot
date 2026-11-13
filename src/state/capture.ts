import { createDoc, addChild } from '../core/tree'
import { prepareForSave, store } from '../io/storage'
import { commit, useDoc } from './doc'
import { mutate } from './library'

const NAME_KEY = 'mr.capture.inbox'
const SHORTCUT_KEY = 'mr.capture.shortcut'
export const DEFAULT_INBOX = 'Inbox'
export const DEFAULT_SHORTCUT = 'Alt+Shift+Space'

export function getInboxName(): string {
  try {
    return localStorage.getItem(NAME_KEY)?.trim() || DEFAULT_INBOX
  } catch {
    return DEFAULT_INBOX
  }
}

export function setInboxName(name: string) {
  try {
    if (name.trim()) localStorage.setItem(NAME_KEY, name.trim())
    else localStorage.removeItem(NAME_KEY)
  } catch {
    /* storage blocked: the default name is used */
  }
}

export function getShortcut(): string {
  try {
    return localStorage.getItem(SHORTCUT_KEY)?.trim() || DEFAULT_SHORTCUT
  } catch {
    return DEFAULT_SHORTCUT
  }
}

export function setShortcut(s: string) {
  try {
    if (s.trim()) localStorage.setItem(SHORTCUT_KEY, s.trim())
    else localStorage.removeItem(SHORTCUT_KEY)
  } catch {
    /* ignore */
  }
}

// One writer at a time: two fast captures must not both create the Inbox, or overwrite each other.
let queue: Promise<unknown> = Promise.resolve()

/**
 * Add a line to the Inbox map (made on first use). If the Inbox is open in the editor the change is
 * one undo step and autosave writes it; otherwise the map is changed on disk.
 */
export function appendToInbox(text: string): Promise<void> {
  const clean = text.trim()
  if (!clean) return Promise.resolve()
  const run = async () => {
    const name = getInboxName()
    const metas = await store.list()
    const meta = metas.find((m) => !m.trashedAt && m.title === name)
    if (!meta) {
      const doc = createDoc(name)
      addChild(doc, doc.root, clean)
      prepareForSave(doc)
      await store.save(doc)
      return
    }
    const open = useDoc.getState().doc
    if (open && open.meta.id === meta.id) {
      commit((d) => void addChild(d, d.root, clean))
      return
    }
    await mutate(meta.id, (d) => void addChild(d, d.root, clean))
  }
  const result = queue.then(run, run)
  queue = result.catch(() => {})
  return result
}
