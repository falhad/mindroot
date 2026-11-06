import type * as ReactNS from 'react'
import type { ReactNode } from 'react'
import type { MapDoc } from '../core/types'

/**
 * The Branchmint plugin API (version 1).
 *
 * A plugin is an object with a manifest and an `activate(ctx)` function. Everything a plugin
 * adds (commands, status chips, settings panels, event listeners) is registered through `ctx`
 * and removed automatically when the plugin is turned off.
 *
 * Built-in plugins (like Git sync) use exactly this API. Plugins installed in the plugins
 * folder get the same `ctx`.
 */
export const PLUGIN_API_VERSION = 1

export interface PluginManifest {
  /** Unique, lower-case, e.g. `branchmint.sync` or `acme.word-count`. */
  id: string
  name: string
  version: string
  description?: string
  /** Script file inside the plugin folder (installed plugins only). Default `index.js`. */
  main?: string
  /** What the plugin needs: `native` = call the app's Rust commands. Shown to the user. */
  permissions?: ('native')[]
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
  }
  library: {
    /** Re-read the list of maps (after files changed on disk). */
    refresh(): Promise<void>
  }
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
