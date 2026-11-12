import type { NetRequest, NetResponse } from '../../types'

/**
 * Talks to a language model over HTTP. Two wire formats cover most services:
 *  - `openai`: the Chat Completions format (OpenAI, OpenRouter, 9router, local servers, many others)
 *  - `anthropic`: the Messages format (Anthropic and compatible gateways)
 */
export type AiKind = 'openai' | 'anthropic'

export interface AiConfig {
  kind: AiKind
  /** For example `https://openrouter.ai/api/v1` or `https://api.anthropic.com`. */
  baseUrl: string
  model: string
  timeoutMs: number
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const MAX_TOKENS = 2048

function base(cfg: AiConfig): string {
  const b = cfg.baseUrl.trim().replace(/\/+$/, '')
  if (!/^https?:\/\/[^\s/]+/i.test(b)) throw new Error('Enter the API address in Settings → AI (it starts with https://)')
  return b
}

export function buildRequest(cfg: AiConfig, key: string, messages: ChatMessage[]): NetRequest {
  const root = base(cfg)
  if (cfg.kind === 'anthropic') {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
    return {
      url: /\/v1$/.test(root) ? `${root}/messages` : `${root}/v1/messages`,
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, max_tokens: MAX_TOKENS, stream: false, ...(system ? { system } : {}), messages: messages.filter((m) => m.role !== 'system') }),
      timeoutMs: cfg.timeoutMs,
    }
  }
  return {
    url: `${root}/chat/completions`,
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: cfg.model, messages, stream: false }),
    timeoutMs: cfg.timeoutMs,
  }
}

/** The text of the model's answer. Throws a readable error when there is none. */
export function parseResponse(kind: AiKind, body: string): string {
  let data: any
  try {
    data = JSON.parse(body)
  } catch {
    // some gateways stream the answer even when asked not to: server-sent events ("data: {...}" lines)
    if (/^\s*(event:|data:)/m.test(body)) return parseSse(kind, body)
    const snippet = body.replace(/\s+/g, ' ').trim().slice(0, 120)
    throw new Error(`Could not understand the reply from the AI service${snippet ? `: "${snippet}"` : ' (it was empty)'}`)
  }
  let text = ''
  if (kind === 'anthropic') {
    text = (Array.isArray(data?.content) ? data.content : []).filter((b: any) => b?.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('')
  } else {
    const c = data?.choices?.[0]?.message?.content
    text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('') : ''
  }
  if (!text.trim()) throw new Error('The AI service returned nothing')
  return text
}

/** The text of a streamed answer: the pieces from every `data:` line, joined. */
function parseSse(kind: AiKind, body: string): string {
  let text = ''
  for (const line of body.split('\n')) {
    const m = /^data:\s?(.*)$/.exec(line.trim())
    if (!m || m[1] === '[DONE]') continue
    try {
      const d = JSON.parse(m[1])
      if (kind === 'anthropic') text += d?.type === 'content_block_delta' && typeof d.delta?.text === 'string' ? d.delta.text : ''
      else {
        const c = d?.choices?.[0]
        const piece = c?.delta?.content ?? c?.message?.content
        text += typeof piece === 'string' ? piece : ''
      }
    } catch {
      /* a keep-alive or comment line */
    }
  }
  if (!text.trim()) throw new Error('The AI service returned nothing')
  return text
}

/** A short, key-free description of an error body. */
function errorDetail(body: string, key: string): string {
  let msg = ''
  try {
    const e = JSON.parse(body)?.error
    msg = typeof e === 'string' ? e : typeof e?.message === 'string' ? e.message : ''
  } catch {
    msg = ''
  }
  if (key) msg = msg.split(key).join('…')
  msg = msg.replace(/\s+/g, ' ').trim().slice(0, 200)
  return msg ? `: ${msg}` : ''
}

export async function chat(cfg: AiConfig, key: string, messages: ChatMessage[], net: { request(r: NetRequest): Promise<NetResponse> }): Promise<string> {
  if (!key.trim()) throw new Error('Add your API key in Settings → AI')
  const res = await net.request(buildRequest(cfg, key.trim(), messages))
  if (res.status < 200 || res.status >= 300) throw new Error(`The AI service answered ${res.status}${errorDetail(res.body, key.trim())}`)
  try {
    return parseResponse(cfg.kind, res.body)
  } catch (e) {
    // an unreadable reply may quote the request: never show the key
    throw new Error((e instanceof Error ? e.message : String(e)).split(key.trim()).join('…'))
  }
}

/** The first complete JSON object in a model's answer (it may be fenced or have words around it). */
export function parseAiJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) {
      try {
        const v = JSON.parse(text.slice(start, i + 1))
        return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
      } catch {
        return null
      }
    }
  }
  return null
}

/** `items`: up to 12 short, different, non-empty strings. Null when there are none. */
export function parseItems(obj: Record<string, unknown> | null): string[] | null {
  const raw = obj && Array.isArray(obj.items) ? obj.items : null
  if (!raw) return null
  const out: string[] = []
  for (const x of raw) {
    if (typeof x !== 'string') continue
    const t = x.trim().slice(0, 200)
    if (t && !out.includes(t)) out.push(t)
    if (out.length === 12) break
  }
  return out.length ? out : null
}

/** `text`: one string of up to 8,000 characters. Null when missing or empty. */
export function parseText(obj: Record<string, unknown> | null): string | null {
  const t = obj && typeof obj.text === 'string' ? obj.text.trim().slice(0, 8000) : ''
  return t || null
}
