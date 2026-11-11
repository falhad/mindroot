import { useEffect, useState } from 'react'
import { renderNotes } from '../core/mdnotes'
import { openExternal } from '../io/files'

/** Rendered Markdown notes (headings, lists, code, math). The HTML is sanitized by `renderNotes`. */
export function NotesView({ md }: { md: string }) {
  const [html, setHtml] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setFailed(false)
    if (md.includes('$')) void import('katex/dist/katex.min.css') // fonts and styles only when there is math
    renderNotes(md)
      .then((h) => alive && setHtml(h))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [md])

  if (failed) return <pre className="notes-md whitespace-pre-wrap text-[13px]" dir="auto">{md}</pre>
  if (!md.trim()) return <p className="text-[12px] text-muted">Nothing to preview yet.</p>
  return (
    <div
      className="notes-md"
      data-testid="notes-preview"
      // eslint-disable-next-line react/no-danger -- sanitized by DOMPurify inside renderNotes
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a')
        if (a?.href) {
          e.preventDefault()
          void openExternal(a.href)
        }
      }}
    />
  )
}
