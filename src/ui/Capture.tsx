import { useEffect, useRef, useState } from 'react'
import { Inbox } from 'lucide-react'
import { getInboxName } from '../state/capture'

/** The small always-on-top window opened by the global shortcut: type a thought, press Enter. */
export function Capture() {
  const [text, setText] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  const inbox = getInboxName()

  const hide = async () => {
    setText('')
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().hide()
  }
  const send = async () => {
    const t = text.trim()
    if (t) {
      const { emit } = await import('@tauri-apps/api/event')
      await emit('capture:add', { text: t }) // the main window writes it, so there is one writer
    }
    await hide()
  }

  // every time the window is shown it gets focus: put the cursor in the box
  useEffect(() => {
    let off: (() => void) | undefined
    void (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      off = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        if (focused) ref.current?.focus()
      })
    })().catch(() => {})
    ref.current?.focus()
    return () => off?.()
  }, [])

  return (
    <div className="grid h-screen place-items-center p-2" style={{ background: 'var(--panel-solid, var(--canvas))' }}>
      <label className="flex w-full items-center gap-3 rounded-xl border border-line bg-solid px-4 py-3">
        <Inbox size={18} className="shrink-0 text-accent" aria-hidden />
        <input
          ref={ref}
          autoFocus
          dir="auto"
          aria-label={`Add to ${inbox}`}
          placeholder={`Add to ${inbox}…  Enter to save, Esc to cancel`}
          className="min-w-0 flex-1 bg-transparent text-[16px] outline-none"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter') { e.preventDefault(); void send() }
            else if (e.key === 'Escape') { e.preventDefault(); void hide() }
          }}
        />
      </label>
    </div>
  )
}
