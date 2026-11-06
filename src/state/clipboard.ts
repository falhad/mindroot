import { readImage } from '../io/files'
import { parseOutline, type OutNode } from '../core/outline'
import * as T from '../core/tree'
import type { ClipNode } from '../core/tree'
import { toast } from './ui'
import { commit, deleteSelection, primary, select, useDoc } from './doc'

let internal: { text: string; nodes: ClipNode[] } | null = null

function clipToText(nodes: ClipNode[], level = 0): string {
  return nodes
    .map((n) => {
      const self = `${'  '.repeat(level)}- ${n.text.replace(/\n+/g, ' ')}`
      return n.children.length ? `${self}\n${clipToText(n.children, level + 1)}` : self
    })
    .join('\n')
}

/** Is the user typing into a text field (so native copy/paste should win)? */
export function inTextField(target: EventTarget | null = document.activeElement): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

export function handleCopy(e: ClipboardEvent, cut = false) {
  if (inTextField(e.target)) return
  const { doc, selection } = useDoc.getState()
  if (!doc) return
  const ids = T.topLevel(doc, selection)
  if (!ids.length) return
  const nodes = ids.map((id) => T.copyTree(doc, id))
  internal = { text: clipToText(nodes), nodes }
  e.clipboardData?.setData('text/plain', internal.text)
  e.preventDefault()
  if (cut) {
    if (ids.includes(doc.root)) toast("The central idea can't be cut, only copied", 'info')
    deleteSelection()
  } else toast(`Copied ${ids.length > 1 ? ids.length + ' branches' : 'branch'}`, 'info')
}

function insertOutline(d: Parameters<Parameters<typeof commit>[0]>[0], parent: string, o: OutNode): string {
  const id = T.addChild(d, parent, o.text)
  const n = d.nodes[id]
  if (o.notes) n.notes = o.notes
  if (o.link) n.link = o.link
  for (const c of o.checklist ?? []) T.addChecklistItem(d, id, c.text, c.done)
  for (const c of o.children) insertOutline(d, id, c)
  return id
}

export async function handlePaste(e: ClipboardEvent) {
  if (inTextField(e.target)) return
  const { doc } = useDoc.getState()
  const target = primary()
  if (!doc || !target) return
  e.preventDefault()

  const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
  if (files.length) {
    try {
      const img = await readImage(files[0])
      commit((d) => T.setNodeImage(d, target, img))
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not paste the image', 'error')
    }
    return
  }

  const text = e.clipboardData?.getData('text/plain') ?? ''
  if (!text.trim()) return
  const ids: string[] = []
  if (internal && internal.text === text) {
    commit((d) => {
      for (const c of internal!.nodes) ids.push(T.pasteTree(d, target, c))
    })
  } else {
    let forest = parseOutline(text)
    if (!forest.length) forest = [{ text: text.trim(), children: [] }]
    commit((d) => {
      for (const o of forest) ids.push(insertOutline(d, target, o))
    })
  }
  if (ids.length) select(ids)
}
