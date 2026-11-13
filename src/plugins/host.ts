import * as React from 'react'
import { create } from 'zustand'
import { mergeDocs } from '../sync/merge'
import { isTauri } from '../io/env'
import { store } from '../io/storage'
import { applyRemoteDoc, commit, markSaved, replaceDoc, undoHandlers, useDoc } from '../state/doc'
import { createFromOutline, refreshLibrary } from '../state/library'
import { flushSave, pauseSaves, saveListeners } from '../state/persist'
import { askConfirm, askPrompt, goTo, toast, ui } from '../state/ui'
import type { Command } from '../ui/commands'
import type { AppEvent, Disposable, ExporterSpec, ImporterSpec, NewMapAction, NetRequest, NetResponse, Plugin, PluginContext, PluginManifest, SettingsPanel, StatusItem } from './types'

export interface PluginRecord {
  manifest: PluginManifest
  builtin: boolean
  state: 'active' | 'disabled' | 'error'
  error?: string
}

type Contributed<T> = T & { pluginId: string }

interface RegistryState {
  plugins: PluginRecord[]
  commands: Contributed<Command>[]
  status: Contributed<StatusItem>[]
  panels: Contributed<SettingsPanel>[]
  importers: Contributed<ImporterSpec>[]
  exporters: Contributed<ExporterSpec>[]
  /** Buttons that plugins add to the "new map" area of the dashboard. */
  newMap: Contributed<NewMapAction>[]
  ready: boolean
}

export const useRegistry = create<RegistryState>(() => ({ plugins: [], commands: [], status: [], panels: [], importers: [], exporters: [], newMap: [], ready: false }))
const set = useRegistry.setState

interface Loaded {
  plugin: Plugin
  disposables: Disposable[]
}
const loaded = new Map<string, Loaded>()
const pluginSources = new Map<string, Plugin>()
const handlers = new Map<AppEvent, Set<{ pluginId: string; fn: (p?: any) => void | Promise<void> }>>()

// ---------- settings storage ----------

async function readSettings(id: string): Promise<Record<string, unknown> | null> {
  try {
    if (isTauri) {
      const { invoke } = await import('@tauri-apps/api/core')
      const text = await invoke<string | null>('plugin_settings_get', { id })
      return text ? JSON.parse(text) : null
    }
    const t = localStorage.getItem(`mr.plugin.${id}`)
    return t ? JSON.parse(t) : null
  } catch {
    return null
  }
}

async function writeSettings(id: string, value: object) {
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('plugin_settings_set', { id, json: JSON.stringify(value) })
  } else localStorage.setItem(`mr.plugin.${id}`, JSON.stringify(value))
}

// ---------- network and secrets ----------

const isLocalHost = (u: URL) => u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]'

/** https only; plain http is allowed only to this computer (development and tests). */
function checkUrl(raw: string): URL {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new Error('Invalid URL')
  }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocalHost(u))) throw new Error('Only https:// addresses are allowed (http only for localhost)')
  return u
}

export async function netRequest(req: NetRequest): Promise<NetResponse> {
  checkUrl(req.url)
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<NetResponse>('net_request', { req: { method: 'GET', ...req } })
  }
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), req.timeoutMs ?? 60_000)
  try {
    const res = await fetch(req.url, { method: req.method ?? 'GET', headers: req.headers, body: req.body, signal: ctl.signal })
    return { status: res.status, body: await res.text() }
  } finally {
    clearTimeout(timer)
  }
}

const secretKey = (pid: string, key: string) => `mr.secret.${pid}.${key}`

function makeSecrets(pid: string): NonNullable<PluginContext['secrets']> {
  if (isTauri) {
    const call = async <T,>(cmd: string, args: Record<string, unknown>) => (await import('@tauri-apps/api/core')).invoke<T>(cmd, { pluginId: pid, ...args })
    return {
      get: (key) => call<string | null>('secret_get', { key }),
      set: (key, value) => call<void>('secret_set', { key, value }),
      remove: (key) => call<void>('secret_remove', { key }),
    }
  }
  // Browser build: kept for this tab only (sessionStorage); the desktop app uses a private file or the OS keychain.
  return {
    get: async (key) => sessionStorage.getItem(secretKey(pid, key)),
    set: async (key, value) => void sessionStorage.setItem(secretKey(pid, key), value),
    remove: async (key) => void sessionStorage.removeItem(secretKey(pid, key)),
  }
}

// ---------- context ----------

function track<T extends Disposable>(l: Loaded, d: T): T {
  l.disposables.push(d)
  return d
}

function createContext(plugin: Plugin, l: Loaded, isBuiltin: boolean): PluginContext {
  const m = plugin.manifest
  const pid = m.id
  const ctx: PluginContext = {
    manifest: m,
    isDesktop: isTauri,
    react: React,
    settings: {
      get: async <T extends object>(defaults: T) => ({ ...defaults, ...((await readSettings(pid)) ?? {}) }) as T,
      set: (v) => writeSettings(pid, v),
    },
    commands: {
      register(c) {
        const entry = { id: `${pid}:${c.id}`, title: c.title, group: c.group ?? m.name, hint: c.hint, run: () => void Promise.resolve(c.run()).catch((e) => toast(`${m.name}: ${e instanceof Error ? e.message : e}`, 'error')), pluginId: pid }
        set((s) => ({ commands: [...s.commands.filter((x) => x.id !== entry.id), entry] }))
        return track(l, { dispose: () => set((s) => ({ commands: s.commands.filter((x) => x.id !== entry.id) })) })
      },
    },
    status: {
      register(item) {
        const entry = { ...item, id: `${pid}:${item.id}`, pluginId: pid }
        set((s) => ({ status: [...s.status.filter((x) => x.id !== entry.id), entry].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)) }))
        return track(l, { dispose: () => set((s) => ({ status: s.status.filter((x) => x.id !== entry.id) })) })
      },
    },
    settingsPanel: {
      register(panel) {
        const entry = { ...panel, pluginId: pid }
        set((s) => ({ panels: [...s.panels.filter((x) => x.pluginId !== pid), entry] }))
        return track(l, { dispose: () => set((s) => ({ panels: s.panels.filter((x) => x.pluginId !== pid) })) })
      },
    },
    events: {
      on(event, fn) {
        const entry = { pluginId: pid, fn }
        if (!handlers.has(event)) handlers.set(event, new Set())
        handlers.get(event)!.add(entry)
        return track(l, { dispose: () => void handlers.get(event)?.delete(entry) })
      },
    },
    ui: {
      toast: (text, kind) => toast(text, kind),
      confirm: (o) => askConfirm(o),
      openSettings: (tab) => ui.setSettings(true, tab ?? pid),
      prompt: (o) => askPrompt(o),
    },
    library: {
      refresh: () => refreshLibrary(),
      async create(outline, opts) {
        const id = await createFromOutline(outline)
        if (opts?.open) goTo({ name: 'editor', id })
        return id
      },
    },
    newMap: {
      register(action) {
        const entry = { ...action, id: `${pid}:${action.id}`, pluginId: pid, run: () => void Promise.resolve(action.run()).catch((e) => toast(`${m.name}: ${e instanceof Error ? e.message : e}`, 'error')) }
        set((s) => ({ newMap: [...s.newMap.filter((x) => x.id !== entry.id), entry] }))
        return track(l, { dispose: () => set((s) => ({ newMap: s.newMap.filter((x) => x.id !== entry.id) })) })
      },
    },
    docs: {
      openId: () => useDoc.getState().doc?.meta.id ?? null,
      current: () => useDoc.getState().doc,
      subscribe(handler) {
        const off = useDoc.subscribe((s, prev) => {
          if (s.doc !== prev.doc) handler(s.doc)
        })
        return track(l, { dispose: off })
      },
      flush: () => flushSave(),
      pauseSaves: () => pauseSaves(),
      reloadOpen: reloadOpenDoc,
      // the label is for future history UI; every call is one undo step
      edit: (_label, recipe) => commit(recipe),
      selection: () => [...useDoc.getState().selection],
      applyRemote: (doc) => applyRemoteDoc(doc),
      setUndoHandlers: (h) => {
        undoHandlers.undo = h ? () => h.undo() : null
        undoHandlers.redo = h ? () => h.redo() : null
        if (h) track(l, { dispose: () => { undoHandlers.undo = null; undoHandlers.redo = null } })
      },
    },
    formats: {
      registerImporter(spec) {
        const entry = { ...spec, id: `${pid}:${spec.id}`, pluginId: pid }
        set((s) => ({ importers: [...s.importers.filter((x) => x.id !== entry.id), entry] }))
        return track(l, { dispose: () => set((s) => ({ importers: s.importers.filter((x) => x.id !== entry.id) })) })
      },
      registerExporter(spec) {
        const entry = { ...spec, id: `${pid}:${spec.id}`, pluginId: pid }
        set((s) => ({ exporters: [...s.exporters.filter((x) => x.id !== entry.id), entry] }))
        return track(l, { dispose: () => set((s) => ({ exporters: s.exporters.filter((x) => x.id !== entry.id) })) })
      },
    },
  }
  if (isBuiltin || m.permissions?.includes('net')) ctx.net = { request: netRequest }
  if (isBuiltin || m.permissions?.includes('secrets')) ctx.secrets = makeSecrets(pid)
  if (isTauri && (isBuiltin || m.permissions?.includes('native'))) {
    ctx.native = {
      invoke: async (command, args) => {
        const { invoke } = await import('@tauri-apps/api/core')
        return invoke(command, args)
      },
    }
  }
  return ctx
}

/**
 * Re-read the open map from disk after something else changed it. If the user has unsaved
 * edits, they are merged into the incoming version (same three-way merge as sync).
 */
export async function reloadOpenDoc() {
  const s = useDoc.getState()
  if (!s.doc) return
  const disk = await store.load(s.doc.meta.id)
  if (!disk) return
  const now = useDoc.getState()
  if (!now.doc || now.doc.meta.id !== disk.meta.id) return
  const unsaved = now.saveState === 'dirty' || now.saveState === 'saving'
  if (!unsaved) {
    if (disk.meta.updatedAt === now.doc.meta.updatedAt && JSON.stringify(disk.nodes) === JSON.stringify(now.doc.nodes)) return
    replaceDoc(disk, false)
    markSaved(disk)
    return
  }
  const r = mergeDocs((now.savedDoc ?? disk) as any, now.doc as any, disk as any)
  replaceDoc(r.doc, true)
  markSaved(disk)
}

// ---------- lifecycle ----------

async function activate(plugin: Plugin, builtin: boolean) {
  const id = plugin.manifest.id
  const l: Loaded = { plugin, disposables: [] }
  loaded.set(id, l)
  try {
    await plugin.activate(createContext(plugin, l, builtin))
    setRecord(id, { state: 'active', error: undefined })
  } catch (e) {
    console.error(`plugin ${id} failed to activate`, e)
    await deactivate(id)
    setRecord(id, { state: 'error', error: e instanceof Error ? e.message : String(e) })
  }
}

async function deactivate(id: string) {
  const l = loaded.get(id)
  if (!l) return
  loaded.delete(id)
  try {
    await l.plugin.deactivate?.()
  } catch (e) {
    console.error(`plugin ${id} failed to deactivate`, e)
  }
  for (const d of l.disposables.splice(0)) {
    try {
      d.dispose()
    } catch {
      /* ignore */
    }
  }
}

function setRecord(id: string, patch: Partial<PluginRecord>) {
  set((s) => ({ plugins: s.plugins.map((p) => (p.manifest.id === id ? { ...p, ...patch } : p)) }))
}

const CORE = 'mindroot.core'

interface CoreSettings {
  /** Built-in plugins the user turned off. */
  disabled: string[]
  /** Installed plugins the user turned on (they start off). */
  enabledExternal: string[]
}

async function coreSettings(): Promise<CoreSettings> {
  const v = (await readSettings(CORE)) ?? {}
  const arr = (x: unknown) => (Array.isArray(x) ? x.filter((y): y is string => typeof y === 'string') : [])
  return { disabled: arr(v.disabled), enabledExternal: arr(v.enabledExternal) }
}

const isOn = (c: CoreSettings, id: string, builtin: boolean) => (builtin ? !c.disabled.includes(id) : c.enabledExternal.includes(id))

/** Register and start plugins. Plugins that are off are listed but not activated. */
export async function startPlugins(list: { plugin: Plugin; builtin: boolean; error?: string }[]) {
  for (const { plugin } of list) pluginSources.set(plugin.manifest.id, plugin)
  const core = await coreSettings()
  saveListeners.add((id) => emit('doc:saved', { id }))
  set({
    plugins: list.map(({ plugin, builtin, error }) => ({
      manifest: plugin.manifest,
      builtin,
      state: error ? 'error' : isOn(core, plugin.manifest.id, builtin) ? 'active' : 'disabled',
      error,
    })),
  })
  for (const { plugin, builtin, error } of list) if (!error && isOn(core, plugin.manifest.id, builtin)) await activate(plugin, builtin)
  set({ ready: true })
  emit('app:ready')
}

/**
 * Forget that the user switched an installed plugin on. Used when a plugin is removed, freshly installed,
 * or updated to ask for more permissions: the user must then switch it on again on purpose.
 */
export async function forgetPluginEnabled(id: string) {
  const core = await coreSettings()
  if (!core.enabledExternal.includes(id)) return
  core.enabledExternal = core.enabledExternal.filter((x) => x !== id)
  await writeSettings(CORE, core)
}

export async function setPluginEnabled(id: string, enabled: boolean) {
  const rec = useRegistry.getState().plugins.find((p) => p.manifest.id === id)
  if (!rec) return
  const core = await coreSettings()
  const without = (a: string[]) => a.filter((x) => x !== id)
  if (rec.builtin) core.disabled = enabled ? without(core.disabled) : [...without(core.disabled), id]
  else core.enabledExternal = enabled ? [...without(core.enabledExternal), id] : without(core.enabledExternal)
  await writeSettings(CORE, core)
  if (!enabled) {
    await deactivate(id)
    setRecord(id, { state: 'disabled', error: undefined })
  } else if (!loaded.has(id)) {
    const plugin = pluginSources.get(id)
    if (plugin) await activate(plugin, rec.builtin)
  }
}

// ---------- events ----------

export function emit(event: AppEvent, payload?: unknown) {
  for (const h of handlers.get(event) ?? []) {
    try {
      void Promise.resolve(h.fn(payload)).catch((e) => console.error(`plugin ${h.pluginId} ${event}`, e))
    } catch (e) {
      console.error(`plugin ${h.pluginId} ${event}`, e)
    }
  }
}

/** Like `emit`, but waits for async handlers (at most `timeoutMs`). */
export async function emitAndWait(event: AppEvent, payload?: unknown, timeoutMs = 8000) {
  const runs = [...(handlers.get(event) ?? [])].map((h) => Promise.resolve().then(() => h.fn(payload)).catch((e) => console.error(`plugin ${h.pluginId} ${event}`, e)))
  await Promise.race([Promise.all(runs), new Promise((r) => setTimeout(r, timeoutMs))])
}
