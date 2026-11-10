import { ChevronRight, Focus, X } from 'lucide-react'
import { focusPath } from '../core/focus'
import { activeFocus, enterFocus, exitFocus, useDoc } from '../state/doc'
import { fitCurrent } from './commands'

/** Breadcrumb shown in focus mode: click an ancestor to widen the view, or leave focus mode. */
export function FocusBar() {
  const doc = useDoc((s) => s.doc)
  const focus = useDoc(activeFocus)
  if (!doc || !focus) return null
  const path = focusPath(doc, focus)
  const label = (id: string) => doc.nodes[id].text.replace(/\s+/g, ' ').trim() || 'New idea'
  const go = (id: string) => {
    if (id === doc.root) exitFocus()
    else enterFocus(id)
    setTimeout(() => fitCurrent(), 30)
  }
  return (
    <nav aria-label="Focus path" className="glass rise absolute left-1/2 top-16 z-20 flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-1 rounded-xl py-1.5 pl-3 pr-1.5 text-[13px]">
      <Focus size={14} className="shrink-0 text-accent" aria-hidden />
      <ol className="flex min-w-0 items-center gap-0.5 overflow-hidden">
        {path.map((id, i) => (
          <li key={id} className="flex min-w-0 items-center gap-0.5">
            {i > 0 && <ChevronRight size={13} className="shrink-0 text-muted" aria-hidden />}
            {i === path.length - 1 ? (
              <span className="truncate font-semibold" dir="auto" aria-current="page" style={{ maxWidth: 200 }}>{label(id)}</span>
            ) : (
              <button className="truncate rounded-md px-1.5 py-0.5 text-muted hover:bg-hover hover:text-ink" dir="auto" style={{ maxWidth: 140 }} onClick={() => go(id)}>
                {label(id)}
              </button>
            )}
          </li>
        ))}
      </ol>
      <button className="btn icon ml-1" style={{ width: 26, height: 26 }} aria-label="Leave focus mode" title="Leave focus mode (Esc)" onClick={() => go(doc.root)}>
        <X size={14} />
      </button>
    </nav>
  )
}
