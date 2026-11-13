import { Loader2 } from 'lucide-react'
import { useActivity, useElapsed } from './activity'

/** Chip in the header while the AI works on the open map: what it does, and for how long. */
export function AiStatus() {
  const a = useActivity((s) => s.current)
  const seconds = useElapsed(a ? a.startedAt : null)
  if (!a) return null
  return (
    <span className="btn gap-1.5 text-[12px] text-accent" style={{ cursor: 'default' }} role="status" aria-live="polite" title={`${a.title}: ${a.step}`}>
      <Loader2 size={14} className="shrink-0 animate-spin" />
      <span className="hidden max-w-[260px] truncate md:inline">AI: {a.step}</span>
      <span className="tabular-nums text-muted">{seconds} s</span>
    </span>
  )
}
