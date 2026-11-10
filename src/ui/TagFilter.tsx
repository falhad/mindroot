import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Hash } from 'lucide-react'
import { allTags } from '../core/tags'
import { useDoc } from '../state/doc'
import { ui, useUi } from '../state/ui'

/** Header button: pick tags to focus on. Everything without them fades. Hidden when the map has no tags. */
export function TagFilter() {
  const doc = useDoc((s) => s.doc)
  const filter = useUi((s) => s.tagFilter)
  const tags = useMemo(() => (doc ? allTags(doc) : []), [doc])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', away)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  // forget tags that no longer exist in the map
  useEffect(() => {
    const valid = filter.filter((t) => tags.some((x) => x.tag === t))
    if (valid.length !== filter.length) ui.setTagFilter(valid)
  }, [tags, filter])

  if (!tags.length) return null
  return (
    <div ref={ref} className="relative">
      <button className={`btn ${filter.length ? 'on' : ''}`} aria-haspopup="menu" aria-expanded={open} aria-label="Filter by tag" title="Filter by tag" onClick={() => setOpen((v) => !v)}>
        <Hash size={16} />
        {filter.length > 0 && <span className="text-[12px] tabular-nums">{filter.length}</span>}
      </button>
      {open && (
        <div role="menu" aria-label="Tags" className="glass rise absolute right-0 top-10 z-30 max-h-72 w-56 overflow-y-auto rounded-xl p-1.5" style={{ background: 'var(--panel-solid)' }}>
          {tags.map(({ tag, count }) => {
            const on = filter.includes(tag)
            return (
              <button key={tag} role="menuitemcheckbox" aria-checked={on} className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-hover" onClick={() => ui.toggleTag(tag)}>
                <span dir="auto" className="truncate">#{tag}</span>
                <span className="flex items-center gap-1.5 text-muted">
                  <span className="text-[12px] tabular-nums">{count}</span>
                  {on && <Check size={14} className="text-accent" />}
                </span>
              </button>
            )
          })}
          {filter.length > 0 && (
            <button className="mt-1 w-full rounded-md border-t border-line px-2.5 py-1.5 pt-2 text-left text-[12px] text-muted hover:text-ink" onClick={() => ui.setTagFilter([])}>
              Clear filter
            </button>
          )}
        </div>
      )}
    </div>
  )
}
