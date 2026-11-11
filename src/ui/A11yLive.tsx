import { useEffect, useState } from 'react'
import { useDoc } from '../state/doc'

/** What a screen reader hears when the selection moves or a branch folds: "Child, level 3, expanded, 2 children". */
function describe(s = useDoc.getState()): string {
  const id = s.selection[s.selection.length - 1]
  const n = id && s.doc?.nodes[id]
  if (!n) return ''
  const level = (s.layout?.depth[id] ?? 0) + 1
  const kids = n.children.length
  const state = kids ? (n.collapsed ? `, collapsed, ${kids} hidden` : `, expanded, ${kids} ${kids === 1 ? 'child' : 'children'}`) : ''
  return `${n.text.replace(/\s+/g, ' ').trim() || 'New idea'}, level ${level}${state}`
}

export function A11yLive() {
  const [msg, setMsg] = useState('')
  useEffect(() => {
    setMsg(describe())
    return useDoc.subscribe((s, prev) => {
      const id = s.selection[s.selection.length - 1]
      const pid = prev.selection[prev.selection.length - 1]
      // only when the selected idea changes or it folds or unfolds: typing in it does not repeat the message
      if (id !== pid || (id && s.doc?.nodes[id]?.collapsed !== prev.doc?.nodes[id]?.collapsed)) setMsg(describe(s))
    })
  }, [])
  return <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="a11y-live">{msg}</div>
}
