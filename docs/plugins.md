# Writing a Branchmint plugin

A plugin can add **commands** (they appear in the `⌘K` palette), **status chips** (small items in the header), a **settings panel** (a tab in Settings), and **listeners for app events**. The built-in Git sync is a plugin that uses only this API (`src/plugins/builtin/sync`).

## Install a plugin

1. Open **Settings → Plugins**. At the bottom it shows the plugins folder.
2. Put your plugin folder there:
   ```
   plugins/word-count/
     manifest.json
     index.js
   ```
3. Restart Branchmint. The plugin is listed but **switched off**. Switch it on in Settings → Plugins.

A working example is in [`examples/plugins/word-count`](../examples/plugins/word-count).

> **Trust.** An enabled plugin runs with the same power as the app: it can read your maps and, with the `native` permission, call the app's file and Git commands. Only enable code you trust. A broken plugin never crashes the app: it is shown with its error and stays off.

## manifest.json

```json
{
  "id": "acme.word-count",
  "name": "Word count",
  "version": "1.0.0",
  "description": "Shows how many words the open map has.",
  "main": "index.js",
  "api": 1,
  "permissions": []
}
```

| Field | Rule |
|---|---|
| `id` | Lower-case letters, digits, `.`, `-`, `_`. Unique. Used to store settings. |
| `main` | A file name inside the plugin folder (no paths). Default `index.js`. |
| `api` | Plugin API version. Optional; the app refuses a plugin that needs a different one. |
| `permissions` | `["native"]` gives `ctx.native.invoke(...)` (desktop only). Shown to the user. |

## index.js

An ES module. The default export has `activate(ctx)` and optionally `deactivate()`.

```js
export default {
  activate(ctx) {
    ctx.commands.register({ id: 'hello', title: 'Say hello', run: () => ctx.ui.toast('Hello!', 'success') })
  },
}
```

There is no build step. If you write JSX or TypeScript, bundle to one ES module and use `ctx.react` as your React (do not bundle React). Everything you register is removed automatically when the plugin is switched off.

## The `ctx` object

| API | What it does |
|---|---|
| `ctx.react` | The app's React (`createElement`, hooks). |
| `ctx.isDesktop` | `true` in the desktop app. |
| `ctx.commands.register({ id, title, group?, hint?, run })` | Adds a palette command. |
| `ctx.status.register({ id, order?, render })` | Adds a header chip. `render()` returns a React element; use hooks inside it to stay live. |
| `ctx.settingsPanel.register({ title, render })` | Adds a tab in Settings. |
| `ctx.settings.get(defaults)` / `.set(value)` | Your own saved settings (a JSON object, per plugin, per device). |
| `ctx.events.on(event, handler)` | `app:ready`, `app:before-quit` (async handlers are awaited, up to 10 s), `doc:opened`, `doc:saved`, `doc:closed`. |
| `ctx.docs.current()` / `.subscribe(fn)` | Read-only access to the open map; `subscribe` fires on every change. |
| `ctx.docs.flush()` / `.pauseSaves()` / `.reloadOpen()` | Save now; hold autosave while you change files; re-read the open map from disk. |
| `ctx.library.refresh()` | Re-read the list of maps. |
| `ctx.ui.toast(text, kind?)`, `.confirm({...})`, `.openSettings(tab?)` | Messages, a confirm dialog, open Settings. |
| `ctx.native.invoke(cmd, args)` | Call a Rust command (desktop + `native` permission). |

Each `register`/`on` call returns `{ dispose() }` if you want to remove something earlier.

## Example: a header chip

```js
export default {
  activate(ctx) {
    const h = ctx.react.createElement
    const { useSyncExternalStore } = ctx.react
    function Chip() {
      const doc = useSyncExternalStore(
        (notify) => { const s = ctx.docs.subscribe(notify); return () => s.dispose() },
        () => ctx.docs.current(),
      )
      return doc ? h('span', { className: 'btn' }, `${Object.keys(doc.nodes).length} ideas`) : null
    }
    ctx.status.register({ id: 'count', render: () => h(Chip) })
  },
}
```

## API version 2

Version 2 adds what the built-in AI and collaboration plugins need. Plugins written for version 1 still load: the API only grows. Set `"api": 2` in the manifest when you use these.

| API | What it does | Needs permission |
|---|---|---|
| `ctx.docs.edit(label, recipe)` | Change the open map. One call is one undo step. Returns false when no map is open or nothing changed. | |
| `ctx.docs.selection()` | Ids of the selected ideas. | |
| `ctx.docs.applyRemote(doc)` | Put a version made elsewhere into the open map (not an undo step). Used by live collaboration. | |
| `ctx.docs.setUndoHandlers({ undo, redo })` | Take over undo and redo. Pass `null` to give them back. | |
| `ctx.formats.registerImporter({ id, title, extensions, parse(file) })` | Add a file type to **Import**. `parse` returns a map. | |
| `ctx.formats.registerExporter({ id, title, extension, mime, build(doc) })` | Add a format to **Export**. `build` returns text or bytes. | |
| `ctx.net.request({ url, method, headers, body, timeoutMs })` | HTTP request. `https` only (`http` to localhost). Answers `{ status, body }`. | `net` |
| `ctx.secrets.get / set / remove` | Keep a secret (an API key) in the operating system keychain. Never saved in the vault. In the browser build it lasts for the tab only. | `secrets` |

`permissions` in the manifest can now also list `"net"` and `"secrets"`. They are shown to the user.

### Plugin gallery

**Settings → Plugins → Browse plugins** lists plugins from a JSON file (default: `plugins/index.json` in this repository; the address can be changed). Each entry has an id, version, permissions, the zip address and its **SHA-256**. The app downloads the zip over https, checks the SHA-256 before opening it, and refuses a zip whose `manifest.json` has another id than the entry or asks for permissions the list did not show. Plugins install **switched off**; a new plugin, or an update that asks for more permissions, must be switched on again by you.

To publish your own: `node scripts/pack-plugin.mjs path/to/plugin --author "You"` makes `plugins/dist/<id>-<version>.zip` and updates `plugins/index.json`. Commit both.

## For app developers

- Contracts: `src/plugins/types.ts`. Host and lifecycle: `src/plugins/host.ts`. Loader for installed plugins: `src/plugins/external.ts`. Tests: `tests/plugins.test.ts`.
- Built-in plugins are listed in `src/plugins/builtin/index.ts`.
- The Rust side only lists and reads plugin files (`src-tauri/src/plugins.rs`); it never runs them.
