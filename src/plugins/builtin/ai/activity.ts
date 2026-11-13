import { useEffect, useState } from 'react'
import { create } from 'zustand'

/** What the AI is doing now, for the status chip in the header. */
export interface Activity {
  id: number
  /** The task, for example "Expanding “Launch”". */
  title: string
  /** The step inside the task, for example "Asking gpt-4o-mini". */
  step: string
  startedAt: number
}

export const useActivity = create<{ current: Activity | null }>(() => ({ current: null }))

let seq = 0

/** Show a task in the header. The newest task wins; `step` and `end` of an older task do nothing. */
export function beginActivity(title: string, step: string) {
  const id = ++seq
  useActivity.setState({ current: { id, title, step, startedAt: Date.now() } })
  const mine = () => useActivity.getState().current?.id === id
  return {
    step: (next: string) => { if (mine()) useActivity.setState((s) => ({ current: { ...s.current!, step: next } })) },
    end: () => { if (mine()) useActivity.setState({ current: null }) },
  }
}

/** Whole seconds since `startedAt`, updated each second. 0 when there is no start time. */
export function useElapsed(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (startedAt === null) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [startedAt])
  return startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000))
}

/** `openai/gpt-4o-mini` → `gpt-4o-mini`: the provider part is noise in a status line. */
export const shortModel = (model: string) => model.trim().split('/').pop() || 'the model'
