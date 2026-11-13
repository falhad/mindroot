import { useState } from 'react'
import { FileText, Loader2, Paperclip, X } from 'lucide-react'
import type { Attachment } from '../core/types'
import { addAttachment, formatSize, openAttachment } from '../io/attachments'
import { pickFile } from '../io/files'
import { commit } from '../state/doc'
import { toast } from '../state/ui'

/** Files attached to a node: add, open, remove. Files are stored in the vault by content. */
export function AttachmentList({ nodeId, items }: { nodeId: string; items: Attachment[] }) {
  const [busy, setBusy] = useState(false)

  const add = async (files: File[]) => {
    if (!files.length) return
    setBusy(true)
    try {
      const added: Attachment[] = []
      for (const f of files) {
        try {
          added.push(await addAttachment(f))
        } catch (e) {
          toast(e instanceof Error ? e.message : String(e), 'error')
        }
      }
      if (added.length) commit((d) => void (d.nodes[nodeId] && (d.nodes[nodeId].attachments = [...(d.nodes[nodeId].attachments ?? []), ...added])))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {items.length > 0 && (
        <ul className="mb-2 space-y-1" aria-label="Attached files">
          {items.map((a) => (
            <li key={a.id} data-attachment={a.id} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1.5 text-[13px]">
              <FileText size={15} className="shrink-0 text-muted" />
              <button className="min-w-0 flex-1 truncate text-left hover:underline" dir="auto" title={`Open ${a.name}`} onClick={() => openAttachment(a).then((how) => how === 'revealed' && toast('Shown in your file manager (this file type is not opened from Mindroot)')).catch((e) => toast(e instanceof Error ? e.message : String(e), 'error'))}>
                {a.name}
              </button>
              <span className="shrink-0 text-[11.5px] tabular-nums text-muted">{formatSize(a.size)}</span>
              <button
                className="btn icon"
                style={{ width: 22, height: 22 }}
                aria-label={`Remove ${a.name}`}
                onClick={() => commit((d) => {
                  const n = d.nodes[nodeId]
                  if (!n) return
                  n.attachments = (n.attachments ?? []).filter((x) => x.id !== a.id)
                  if (!n.attachments.length) delete n.attachments
                })}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        className="btn bordered w-full"
        disabled={busy}
        onClick={async () => void add(await pickFile('*/*', true))}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          void add(Array.from(e.dataTransfer.files))
        }}
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />} Add file
      </button>
      <p className="mt-1.5 text-[11.5px] text-muted">Up to 25 MB each. Files are kept in your vault and sync with it.</p>
    </div>
  )
}
