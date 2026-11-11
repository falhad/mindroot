import { useEffect, useState } from 'react'
import type { PluginContext } from '../../types'
import { chat, parseAiJson, parseText, type AiConfig, type AiKind } from './client'

const DEFAULTS: AiConfig = { kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', timeoutMs: 60_000 }

const PRESETS: { id: string; name: string; kind: AiKind; baseUrl: string; model: string }[] = [
  { id: 'openrouter', name: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  { id: 'openai', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'anthropic', name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5-5' },
]

export function AiSettings({ ctx }: { ctx: PluginContext }) {
  const [cfg, setCfg] = useState<AiConfig>(DEFAULTS)
  const [hasKey, setHasKey] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void ctx.settings.get(DEFAULTS).then(setCfg)
    void ctx.secrets!.get('apikey').then((k) => setHasKey(!!k))
  }, [ctx])

  const save = (next: AiConfig) => {
    setCfg(next)
    void ctx.settings.set(next)
  }
  const preset = PRESETS.find((p) => p.kind === cfg.kind && p.baseUrl === cfg.baseUrl)?.id ?? 'custom'

  const saveKey = async () => {
    const k = keyInput.trim()
    if (!k) return
    await ctx.secrets!.set('apikey', k)
    setKeyInput('')
    setHasKey(true)
    setStatus({ ok: true, text: ctx.isDesktop ? 'Key saved in your system keychain.' : 'Key kept for this tab only (the web version does not store keys).' })
  }
  const removeKey = async () => {
    await ctx.secrets!.remove('apikey')
    setHasKey(false)
    setStatus({ ok: true, text: 'Key removed.' })
  }
  const test = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const key = (await ctx.secrets!.get('apikey')) ?? ''
      const answer = await chat(cfg, key, [{ role: 'user', content: 'Reply with exactly this JSON and nothing else: {"text":"ok"}' }], ctx.net!)
      setStatus(parseText(parseAiJson(answer)) ? { ok: true, text: 'Connected. The model answered.' } : { ok: true, text: 'Connected, but the model did not follow the JSON format. Try a stronger model.' })
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted">
        Pick any service that speaks the OpenAI or the Anthropic format. When you run an AI command, only the selected idea, what is under it (up to 200 ideas) and the titles above it are sent. Your key stays on this computer.
      </p>
      <label className="block text-[12.5px]">
        <span className="mb-1 block text-muted">Service</span>
        <select className="field" aria-label="AI service" value={preset} onChange={(e) => {
          const p = PRESETS.find((x) => x.id === e.target.value)
          if (p) save({ ...cfg, kind: p.kind, baseUrl: p.baseUrl, model: p.model })
        }}>
          {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="custom">Custom address (for example 9router or a local server)</option>
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[12.5px]">
          <span className="mb-1 block text-muted">Format</span>
          <select className="field" aria-label="API format" value={cfg.kind} onChange={(e) => save({ ...cfg, kind: e.target.value as AiKind })}>
            <option value="openai">OpenAI-compatible</option>
            <option value="anthropic">Anthropic-compatible</option>
          </select>
        </label>
        <label className="block text-[12.5px]">
          <span className="mb-1 block text-muted">Model</span>
          <input className="field" aria-label="Model" value={cfg.model} spellCheck={false} onChange={(e) => save({ ...cfg, model: e.target.value })} />
        </label>
      </div>
      <label className="block text-[12.5px]">
        <span className="mb-1 block text-muted">API address</span>
        <input className="field" aria-label="API address" value={cfg.baseUrl} spellCheck={false} onChange={(e) => save({ ...cfg, baseUrl: e.target.value })} />
      </label>
      <div className="text-[12.5px]">
        <span className="mb-1 block text-muted">API key {hasKey && <b className="text-ink">· saved</b>}</span>
        <div className="flex gap-2">
          <input className="field" type="password" aria-label="API key" autoComplete="off" placeholder={hasKey ? '•••••••• (saved, type a new one to replace)' : 'Paste your key'} value={keyInput} onChange={(e) => setKeyInput(e.target.value)} />
          <button className="btn outline" onClick={() => void saveKey()} disabled={!keyInput.trim()}>Save key</button>
          {hasKey && <button className="btn" onClick={() => void removeKey()}>Remove</button>}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button className="btn outline" onClick={() => void test()} disabled={busy || !hasKey}>{busy ? 'Testing…' : 'Test connection'}</button>
        {status && <span role="status" className="text-[12.5px]" style={{ color: status.ok ? undefined : 'var(--danger)' }}>{status.text}</span>}
      </div>
    </div>
  )
}
