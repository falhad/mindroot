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

/** Only this much of a pasted text is sent to a model. */
export const MAX_SOURCE_CHARS = 12_000

/** A whole new map from a topic or from a pasted text. */
export function generateMessages(source: string): ChatMessage[] {
  const text = source.trim().slice(0, MAX_SOURCE_CHARS)
  return [
    {
      role: 'system',
      content:
        'You make mind maps. Reply with JSON only, with no other text. Write in the same language as the input. ' +
        'If the input is a short topic or a question, make a map of that topic from what you know. ' +
        'If the input is a longer text (notes, an article, a transcript), make a map of what the text says and add nothing that is not in it. ' +
        'The map has a short title, 4 to 7 main branches, and 2 to 5 ideas under each branch. Add a third level only where it helps. ' +
        'At most 60 ideas in total. Each idea is short (at most 8 words) and is not a full sentence. ' +
        'Reply as {"title": "…", "children": [{"text": "…", "children": [{"text": "…"}]}]}.',
    },
    { role: 'user', content: text },
  ]
}
