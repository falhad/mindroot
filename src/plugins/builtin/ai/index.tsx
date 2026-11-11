import { addChild, setText } from '../../../core/tree'
import { normalizeTag } from '../../../core/tags'
import type { Plugin, PluginContext } from '../../types'
import { AiSettings } from './AiSettings'
import { chat, parseAiJson, parseItems, parseText, type AiConfig, type ChatMessage } from './client'
import { expandMessages, gapsMessages, rewriteMessages, summarizeMessages } from './prompts'

export const AI_DEFAULTS: AiConfig = { kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', timeoutMs: 60_000 }

type Task = 'expand' | 'gaps' | 'summarize' | 'rewrite'

const WORKING = new Set<string>()

async function run(ctx: PluginContext, task: Task) {
  const cfg = await ctx.settings.get(AI_DEFAULTS)
  const key = (await ctx.secrets!.get('apikey')) ?? ''
  if (!key.trim()) {
    ctx.ui.toast('Add your API key first (Settings → AI assistant)', 'error')
    ctx.ui.openSettings()
    return
  }
  const doc = ctx.docs.current()
  const mapId = ctx.docs.openId()
  const sel = ctx.docs.selection()
  const id = sel[sel.length - 1]
  if (!doc || !mapId || !id || !doc.nodes[id]) {
    ctx.ui.toast('Select an idea first', 'info')
    return
  }
  if (WORKING.has(mapId)) return ctx.ui.toast('The AI is still working on this map', 'info')
  const messages: ChatMessage[] = { expand: expandMessages, gaps: gapsMessages, summarize: summarizeMessages, rewrite: rewriteMessages }[task](doc, id)

  WORKING.add(mapId)
  ctx.ui.toast('Asking the AI…')
  try {
    const answer = await chat(cfg, key, messages, ctx.net!)
    // the map may have changed or closed while the model was thinking
    if (ctx.docs.openId() !== mapId || !ctx.docs.current()?.nodes[id]) {
      ctx.ui.toast('The map changed while the AI was working, so its answer was not used', 'info')
      return
    }
    const json = parseAiJson(answer)
    if (task === 'expand' || task === 'gaps') {
      const items = parseItems(json)
      if (!items) return ctx.ui.toast('The AI did not give a usable list. Nothing was changed.', 'error')
      ctx.docs.edit(task === 'expand' ? 'AI: expand' : 'AI: find gaps', (d) => {
        for (const text of items) {
          const nid = addChild(d, id, text)
          if (task === 'gaps') d.nodes[nid].tags = [normalizeTag('ai-gap')]
        }
      })
      ctx.ui.toast(`Added ${items.length} ideas. Undo removes them all.`, 'success')
    } else {
      const text = parseText(json)
      if (!text) return ctx.ui.toast('The AI did not give a usable answer. Nothing was changed.', 'error')
      ctx.docs.edit(task === 'summarize' ? 'AI: summarize' : 'AI: rewrite', (d) => {
        if (task === 'summarize') {
          d.nodes[id].notes = text
          d.nodes[id].notesFmt = 'md'
        } else setText(d, id, text)
      })
      ctx.ui.toast(task === 'summarize' ? 'Summary written to the notes.' : 'Text rewritten. Undo restores it.', 'success')
    }
  } catch (e) {
    ctx.ui.toast(e instanceof Error ? e.message : String(e), 'error')
  } finally {
    WORKING.delete(mapId)
  }
}

export const aiPlugin: Plugin = {
  manifest: {
    id: 'branchmint.ai',
    name: 'AI assistant',
    version: '1.0.0',
    description: 'Expand an idea, summarize a branch, find gaps, or rewrite text with a model you choose (OpenAI-compatible or Anthropic-compatible). Only the selected branch is sent.',
    permissions: ['net', 'secrets'],
  },
  activate(ctx) {
    const cmd = (id: Task, title: string) => ctx.commands.register({ id, title, group: 'AI', run: () => run(ctx, id) })
    cmd('expand', 'AI: Expand this idea')
    cmd('gaps', 'AI: Find what is missing under this idea')
    cmd('summarize', 'AI: Summarize this branch into notes')
    cmd('rewrite', 'AI: Rewrite this idea’s text')
    ctx.settingsPanel.register({ title: 'AI assistant', render: () => <AiSettings ctx={ctx} /> })
  },
}
