import type { MapDoc } from '../../../core/types'
import type { ChatMessage } from './client'

/** Only this much of a map is ever sent to a model: the selected branch, capped. */
export const MAX_IDEAS = 200

const clip = (s: string, n = 300) => s.replace(/\s+/g, ' ').trim().slice(0, n)

/** Texts of the ancestors of `id`, from the central idea down (not including the node itself). */
function pathTo(doc: MapDoc, id: string): string[] {
  const out: string[] = []
  for (let p = doc.nodes[id]?.parentId; p; p = doc.nodes[p]?.parentId ?? null) out.unshift(clip(doc.nodes[p].text) || '(empty)')
  return out
}

/** The branch of `id` as an indented list, at most `limit` ideas. */
export function branchOutline(doc: MapDoc, id: string, limit = MAX_IDEAS): string {
  const lines: string[] = []
  let total = 0
  let shown = 0
  const walk = (nid: string, depth: number) => {
    total++
    if (shown < limit) {
      lines.push(`${'  '.repeat(depth)}- ${clip(doc.nodes[nid].text) || '(empty)'}`)
      shown++
    }
    for (const c of doc.nodes[nid].children) walk(c, depth + 1)
  }
  walk(id, 0)
  if (total > shown) lines.push(`(… ${total - shown} more ideas not shown)`)
  return lines.join('\n')
}

const BASE = 'You help people build mind maps. Reply with JSON only, with no other text. Write in the same language as the map.'

function context(doc: MapDoc, id: string): string {
  const path = pathTo(doc, id)
  return `${path.length ? `Path from the central idea: ${path.join(' > ')}\n\n` : ''}The selected idea and what is under it:\n${branchOutline(doc, id)}`
}

export function expandMessages(doc: MapDoc, id: string): ChatMessage[] {
  return [
    { role: 'system', content: `${BASE} Suggest 3 to 7 new ideas that belong directly under the selected idea. Each is short (at most 8 words) and different from the ones already there. Reply as {"items": ["…", "…"]}.` },
    { role: 'user', content: context(doc, id) },
  ]
}

export function gapsMessages(doc: MapDoc, id: string): ChatMessage[] {
  return [
    { role: 'system', content: `${BASE} Find what is missing: 3 to 6 important topics that belong under the selected idea but are not covered yet. Each is short (at most 8 words). Reply as {"items": ["…", "…"]}.` },
    { role: 'user', content: context(doc, id) },
  ]
}

export function summarizeMessages(doc: MapDoc, id: string): ChatMessage[] {
  return [
    { role: 'system', content: `${BASE} Summarize the selected idea and everything under it in 2 to 5 sentences. Plain Markdown is allowed. Reply as {"text": "…"}.` },
    { role: 'user', content: context(doc, id) },
  ]
}

export function rewriteMessages(doc: MapDoc, id: string): ChatMessage[] {
  return [
    { role: 'system', content: `${BASE} Rewrite the text of the selected idea so it is clearer and shorter. Keep its meaning. Reply as {"text": "…"}.` },
    { role: 'user', content: `${context(doc, id)}\n\nText to rewrite: ${clip(doc.nodes[id].text, 500) || '(empty)'}` },
  ]
}
