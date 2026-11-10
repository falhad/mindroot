# Branchmint

A fast, keyboard-first mind-mapping app for the desktop. Built with **Tauri 2**, React 19, TypeScript 7, Vite 8, Tailwind 4, and Zustand 5.

## Run it

```bash
pnpm install
pnpm tauri dev        # desktop app (hot reload)
pnpm dev              # browser only: http://localhost:1420 (maps live in IndexedDB)
pnpm tauri build      # installer for this computer (.app/.dmg, .msi, .deb ...)
                      # all platforms: push a tag, see docs/releasing.md
pnpm test             # unit + sync tests (vitest; the sync tests use real git)
cargo test --manifest-path src-tauri/Cargo.toml   # storage, git runner, and an IPC test of every command
pnpm typecheck
```

Requirements: Node 20+, pnpm, Rust 1.80+, Git (for sync), and the [Tauri system dependencies](https://tauri.app/start/prerequisites/).

## What it does

- Infinite canvas: pan, zoom (wheel / pinch / `⌘ +/-`), minimap, fit to screen, camera remembered per map.
- Six layouts: mind map (both sides), right tree, left tree, org chart down/up, radial. Three line styles. Right-to-left maps (the whole layout mirrors) for Persian, Arabic and Hebrew.
- Nodes: add child/sibling, inline editing (multi-line, RTL aware), delete, duplicate, drag to re-parent or re-order, multi-select (shift-click / marquee), collapse/expand (Space, or the ⊖ button that appears on hover), cross-links between any two nodes.
- Per node: colour (theme slots or custom), shape, icon (lucide or emoji), notes (Markdown, code, LaTeX), link, image, checklist with progress, tags, due date and done state, attached files, and a link to another map or to one idea in it.
- Structure: groups (a boundary around siblings), summary brackets, labelled cross-links with arrows and line styles, floating ideas and sticky notes (double-click empty canvas; Shift for a sticky note).
- Views: **focus mode** (one branch on its own, `⌘.`), **outline** (an editable list beside the map, `⌘⇧O`), **presentation** (`F5` one idea at a time, `⇧F5` one branch at a time), tag filter, **compare** two maps or versions, **tasks** across all maps, backlinks.
- Customise a map: eight own colours, per-map font (Inter, Vazirmatn, serif, mono), direction (left to right or mirrored).
- Quick capture: a system-wide shortcut (default `Alt+Shift+Space`) opens a small window; a thought goes into your Inbox map.
- Undo/redo (300 steps), copy/cut/paste (rich inside the app, outlines as plain text, images from the clipboard).
- Dashboard: search across titles and node text, sort, star, tags, trash with restore, rename, duplicate, six templates, import by file picker or drag-and-drop.
- Autosave (600 ms debounce, atomic writes, flushed on close/hide), save-state indicator.
- **Git sync** (built-in plugin): keep your maps in a private Git repository and in step across computers, with idea-by-idea merging. See [docs/sync.md](docs/sync.md).
- **Plugins**: add commands, header chips, settings panels and event listeners; built-in and installed plugins share one API. See [docs/plugins.md](docs/plugins.md).
- Import: Branchmint JSON, any `{text|title, children}` JSON, Markdown/indented outlines, FreeMind (`.mm`), OPML, XMind, Obsidian canvas. Export: JSON, Markdown, OPML, PNG, SVG, PDF (vector with selectable text, or image), and a single-file **web page** you can open anywhere.
- **Live collaboration** with a small relay server you run, with presence, and undo that only undoes your own edits. See [docs/collab.md](docs/collab.md).
- **AI assistant** (plugin): expand an idea, find gaps, summarize, rewrite, with any OpenAI-compatible or Anthropic-compatible service. See [docs/ai.md](docs/ai.md).
- **Plugin gallery** and signed **automatic updates**. See [docs/plugins.md](docs/plugins.md) and [docs/releasing.md](docs/releasing.md).
- Map history from Git (restore a version or one idea). Custom templates.
- Fonts: Inter + Vazirmatn (Persian/Arabic), bundled for offline use and embedded in SVG/PNG/PDF exports.
- Light / dark / system appearance; six colour themes; responsive down to phone width (touch pan, pinch zoom).
- Command palette (`⌘K`), in-map find (`⌘F`), shortcut sheet (`?`).

## Keyboard

| Action | Key |
|---|---|
| Add child / sibling / sibling above | `Tab` / `Enter` / `Shift Enter` |
| Edit text | `F2` or double-click |
| While typing: new sibling / new child / newline / finish | `Enter` / `Tab` / `Shift Enter` / `Esc` |
| Delete / duplicate | `Del` / `⌘D` |
| Collapse or expand | `Space` |
| Focus on a branch / leave focus | `⌘.` / `Esc` |
| Outline panel | `⌘⇧O` |
| Present (by idea / by branch) | `F5` / `⇧F5` |
| New floating idea / sticky note | double-click / `⇧`+double-click on empty canvas |
| Move selection | arrow keys (`Shift` extends) |
| Reorder / indent / outdent | `⌥↑↓` / `⌥→` / `⌥←` |
| Undo / redo | `⌘Z` / `⌘⇧Z` |
| Select all | `⌘A` |
| Copy / cut / paste | `⌘C` `⌘X` `⌘V` |
| Fit / 100% / zoom | `⌘0` / `⌘1` / `⌘+` `⌘-` |
| Palette / find / export / panel | `⌘K` / `⌘F` / `⌘E` / `⌘I` |

(`Ctrl` on Windows and Linux.)

## Architecture

```
src/core     Pure TypeScript, no React, fully unit-tested (also: focus, present, diff, links, tasks, tags, import/ and export/)
  tree.ts      document model + every edit (works on Immer drafts)
  layout.ts    6 layout algorithms, spatial navigation, hit-testing
  measure.ts   canvas text measurement + wrapping (shared by DOM and SVG)
  visual.ts    how a node looks (colours, shapes) - shared by DOM and SVG
  svg.ts       SVG renderer for export and dashboard thumbnails
  outline.ts   Markdown/JSON import, Markdown export, document sanitising
src/state    Zustand stores: doc (history, selection, derived layout), view, ui, library, search
src/io       storage (Tauri commands or IndexedDB), image assets, exporters, file dialogs
src/sync     Git sync engine + three-way map merge (pure, tested against real Git)
src/plugins  plugin API, host, loader for installed plugins; builtin/ has Git sync
src/ui       React components
src-tauri    Rust: atomic JSON file storage, raw-bytes export command
```

Design notes:

- **One map, one file, one record per line.** Each map is `<app-data>/vault/maps/<id>.jsonl` (JSON Lines), written atomically (temp file + rename). The first line holds a `meta` block, so the dashboard lists maps by reading one line each. Images are content-addressed files in `vault/assets/`. Thumbnails and search text live in a local cache. `sanitizeDoc` repairs dangling ids, cycles and bad enums on load. Format details: [docs/sync.md](docs/sync.md).
- **Undo = array of Immer snapshots.** Structural sharing keeps this cheap. Rapid edits with the same key (typing in notes) merge into one step.
- **Same numbers everywhere.** Node sizes come from one measure function; the canvas, minimap, thumbnails and all exports read the same layout, so exports match the screen.
- **Browser fallback.** Outside Tauri the storage layer uses IndexedDB, so `pnpm dev` is a complete app for fast UI work.
- PDF export embeds a 2-3x raster of the map on a page sized to the map. Vector PDF is a possible upgrade.

## Roadmap hooks (not built yet)

The model, storage and plugin API were shaped for these, but they are not built yet: AI-assisted brainstorming (a plugin with a `suggest children` command; needs a write API for plugins), real-time collaboration, share links, a template gallery beyond the six built-ins, and a version-history browser (Git sync already records every state; a UI to browse it is missing).

## Releases

GitHub Actions run the tests on every push (`ci.yml`) and build installers for macOS, Windows and Linux when you push a version tag (`release.yml`). See [docs/releasing.md](docs/releasing.md).

## License

[MIT](LICENSE)
