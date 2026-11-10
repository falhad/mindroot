import { prepareForSave, store } from '../io/storage'
import { updateDigest } from './digest'
import { markSaved, setSaveState, useDoc } from './doc'

const DEBOUNCE_MS = 600
let timer: ReturnType<typeof setTimeout> | null = null
let inflight: Promise<void> | null = null
let pauseCount = 0

/** Called after a map was written (plugins listen through the host). */
export const saveListeners = new Set<(mapId: string) => void>()

/**
 * Hold autosave while something else changes the files on disk (a sync merge).
 * Returns the function that resumes it. Edits made meanwhile stay in memory and are saved after.
 */
export function pauseSaves(): () => void {
  pauseCount++
  let done = false
  return () => {
    if (done) return
    done = true
    pauseCount--
    if (pauseCount === 0) scheduleSave()
  }
}

/** Write the open map now (no-op when nothing changed). */
export async function flushSave(): Promise<void> {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (inflight) await inflight
  if (pauseCount > 0) return scheduleSave()
  const { doc, saveState } = useDoc.getState()
  if (!doc || saveState !== 'dirty') return
  setSaveState('saving')
  inflight = (async () => {
    try {
      const copy = structuredClone(doc)
      prepareForSave(copy)
      await store.save(copy)
      updateDigest(copy)
      // If the user kept typing while we wrote, stay dirty and save again.
      markSaved(doc)
      for (const fn of saveListeners) {
        try {
          fn(doc.meta.id)
        } catch (e) {
          console.error('save listener failed', e)
        }
      }
      if (useDoc.getState().doc === doc) setSaveState('saved')
      else {
        setSaveState('dirty')
        scheduleSave()
      }
    } catch (e) {
      console.error('save failed', e)
      setSaveState('error', e instanceof Error ? e.message : String(e))
    } finally {
      inflight = null
    }
  })()
  await inflight
}

export function scheduleSave() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void flushSave(), DEBOUNCE_MS)
}

export function startAutosave() {
  useDoc.subscribe((s, prev) => {
    if (s.doc !== prev.doc && s.saveState === 'dirty') scheduleSave()
  })
  const flushNow = () => void flushSave()
  addEventListener('beforeunload', flushNow)
  addEventListener('pagehide', flushNow)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow()
  })
  // Retry after a failed save when the user edits again or on a timer.
  setInterval(() => {
    if (useDoc.getState().saveState === 'error') {
      useDoc.setState({ saveState: 'dirty' })
      scheduleSave()
    }
  }, 15000)
}
