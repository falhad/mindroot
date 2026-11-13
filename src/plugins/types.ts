import type * as ReactNS from 'react'
import type { ReactNode } from 'react'
import type { MapDoc } from '../core/types'

export interface ImporterSpec {
  /** Unique inside the plugin. */
  id: string
  title: string
  /** File extensions with the dot, lower case: `['.mm']`. */
  extensions: string[]
  parse(file: File): Promise<MapDoc>
}

export interface ExporterSpec {
  id: string
  title: string
  /** With the dot: `.opml`. */
  extension: string
  mime: string
  build(doc: MapDoc): Promise<Uint8Array | string>
}

export interface NetRequest {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
}

export interface NetResponse {
  status: number
  body: string
}

/**
 * The Mindroot plugin API (version 3; version 1 and 2 plugins still load).
 *
 * A plugin is an object with a manifest and an `activate(ctx)` function. Everything a plugin
 * adds (commands, status chips, settings panels, event listeners) is registered through `ctx`
 * and removed automatically when the plugin is turned off.
 *
 * Built-in plugins (like Git sync) use exactly this API. Plugins installed in the plugins
 * folder get the same `ctx`.
 */
export const PLUGIN_API_VERSION = 3
/** Plugins written for these API versions still load (the API only grows). */
export const SUPPORTED_API_VERSIONS: readonly number[] = [1, 2, 3]

/** `native` = app Rust commands, `net` = HTTP requests, `secrets` = the secret store of the app. */
export type PluginPermission = 'native' | 'net' | 'secrets'

export interface PluginManifest {
  /** Unique, lower-case, e.g. `mindroot.sync` or `acme.word-count`. */
  id: string
  name: string
  version: string
  description?: string
  /** Script file inside the plugin folder (installed plugins only). Default `index.js`. */
  main?: string
  /** What the plugin needs: `native` = call the app's Rust commands. Shown to the user. */
  permissions?: PluginPermission[]
}

export interface Disposable {
  dispose(): void
}

export interface PluginCommand {
  /** Unique inside the plugin. */
  id: string
  title: string
  /** Group label in the command palette. Defaults to the plugin name. */
  group?: string
  /** Shortcut text shown on the right, for display only. */
  hint?: string
  run(): void | Promise<void>
}

export interface StatusItem {
  id: string
  /** Lower numbers come first. */
  order?: number
  /** A small React element; it re-renders itself (use your own store or hooks). */
  render(): ReactNode
}

export interface SettingsPanel {
  title: string
  render(): ReactNode
}

/** (API 3) One idea of a new map: its text, optional notes, and the ideas under it. */
export interface OutlineIdea {
  text: string
  notes?: string
  children?: OutlineIdea[]
}

/** (API 3) A dialog that asks the user for text. */
export interface PromptOptions {
  title: string
  body?: string
  placeholder?: string
  /** A text area with several lines instead of one line. */
  multiline?: boolean
  confirmLabel: string
  initial?: string
  /**
   * Work to do with the text while the dialog stays open and shows that it is busy.
   * Return a message to show it as an error and keep the dialog open (the user's text is kept).
   * Return nothing to close the dialog. `state.cancelled()` is true when the user closed the dialog
   * in the meantime: drop your result then. `state.status(text)` says what you do now; the dialog
   * shows it beside a spinner and the seconds since the start.
   */
  submit?(value: string, state: { cancelled(): boolean; status(text: string): void }): Promise<string | void>
}

/** (API 3) A button in the "new map" area of the dashboard. */
export interface NewMapAction {
  /** Unique inside the plugin. */
  id: string
  title: string
  /** Shown as a tooltip. */
  hint?: string
  icon?: ReactNode
  run(): void | Promise<void>
}

export type AppEvent =
  /** All plugins are loaded. */
  | 'app:ready'
  /** The window is closing. Handlers may be async; the app waits a few seconds for them. */
  | 'app:before-quit'
  | 'doc:opened'
  | 'doc:saved'
  | 'doc:closed'

export interface PluginContext {
  manifest: PluginManifest
  /** True in the desktop app. Git, files and native commands exist only there. */
  isDesktop: boolean
  /** The app's React, so an installed plugin can build UI without bundling its own copy. */
  react: typeof ReactNS
  settings: {
    /** Saved settings merged over `defaults`. */
    get<T extends object>(defaults: T): Promise<T>
    set(value: object): Promise<void>
  }
  commands: { register(command: PluginCommand): Disposable }
  status: { register(item: StatusItem): Disposable }
  settingsPanel: { register(panel: SettingsPanel): Disposable }
  events: { on(event: AppEvent, handler: (payload?: any) => void | Promise<void>): Disposable }
  ui: {
    toast(text: string, kind?: 'info' | 'error' | 'success'): void
    confirm(opts: { title: string; body?: string; confirmLabel: string; danger?: boolean }): Promise<boolean>
    openSettings(tab?: string): void
    /** (API 3) Ask the user for text. Resolves with the text, or null when the user cancelled. */
    prompt(opts: PromptOptions): Promise<string | null>
  }
  library: {
    /** Re-read the list of maps (after files changed on disk). */
    refresh(): Promise<void>
    /** (API 3) Make a new map from a tree of ideas. Returns the id of the map. `open` shows it in the editor. */
    create(outline: OutlineIdea, opts?: { open?: boolean }): Promise<string>
  }
  /** (API 3) Add a button to the "new map" area of the dashboard. */
  newMap: { register(action: NewMapAction): Disposable }
  docs: {
    /** Id of the map open in the editor, or null. */
    openId(): string | null
    /** The open map (read-only snapshot), or null. A new object after every change. */
    current(): Readonly<MapDoc> | null
    /** Called after the open map changes or is opened/closed. */
    subscribe(handler: (doc: Readonly<MapDoc> | null) => void): Disposable
    /** Write the open map now. */
    flush(): Promise<void>
    /** Hold autosave while you change files on disk. Call the returned function to resume. */
    pauseSaves(): () => void
    /** Re-read the open map from disk, merging any unsaved edits into it. */
    reloadOpen(): Promise<void>
    /** (API 2) Change the open map. One call = one undo step. False when no map is open or nothing changed. */
    edit(label: string, recipe: (draft: MapDoc) => void): boolean
    /** (API 2) Ids of the selected nodes in the open map. */
    selection(): string[]
    /** (API 2) Put a version that came from other people into the open map. Not an undo step. */
    applyRemote(doc: MapDoc): void
    /** (API 2) Take over undo and redo (return true when handled). Pass null to give them back. */
    setUndoHandlers(handlers: { undo(): boolean; redo(): boolean } | null): void
  }
  /** (API 2) Add import and export formats. Removed when the plugin is turned off. */
  formats: {
    registerImporter(spec: ImporterSpec): Disposable
    registerExporter(spec: ExporterSpec): Disposable
  }
  /** (API 2) HTTP requests. Needs the `net` permission. https only (plain http only to localhost). */
  net?: { request(req: NetRequest): Promise<NetResponse> }
  /** (API 2) Secrets (API keys) kept in the secret store of the app (a private file or the OS keychain), never in the vault. Needs the `secrets` permission. */
  secrets?: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
    remove(key: string): Promise<void>
  }
  /** Call the app's Rust commands. Desktop only; needs the `native` permission. */
  native?: {
    invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>
  }
}

export interface Plugin {
  manifest: PluginManifest
  activate(ctx: PluginContext): void | Promise<void>
  deactivate?(): void | Promise<void>
}
