# Branchmint

A fast, keyboard-first mind-mapping app for the desktop. Built with **Tauri 2**, React 19, TypeScript 7, Vite 8, Tailwind 4, and Zustand 5.

## Run it

```bash
pnpm install
pnpm tauri dev        # desktop app (hot reload)
pnpm dev              # browser only: http://localhost:1420 (maps live in IndexedDB)
pnpm tauri build      # release bundle (.app / .dmg / .msi / .deb ...)
pnpm test             # unit tests (vitest) ; cargo test --manifest-path src-tauri/Cargo.toml
pnpm typecheck
```

Requirements: Node 20+, pnpm, Rust 1.80+, and the [Tauri system dependencies](https://tauri.app/start/prerequisites/).

## What it does

- Infinite canvas: pan, zoom (wheel / pinch / `⌘ +/-`), minimap, fit to screen, camera remembered per map.
- Six layouts: mind map (both sides), right tree, left tree, org chart down/up, radial. Three line styles.
- Nodes: add child/sibling, inline editing (multi-line, RTL aware), delete, duplicate, drag to re-parent or re-order, multi-select (shift-click / marquee), collapse/expand, cross-links between any two nodes.
- Per node: colour (theme slots or custom), shape, icon (lucide or emoji), notes, link, image, checklist with progress.
- Undo/redo (300 steps), copy/cut/paste (rich inside the app, outlines as plain text, images from the clipboard).
- Dashboard: search across titles and node text, sort, star, tags, trash with restore, rename, duplicate, six templates, import by file picker or drag-and-drop.
- Autosave (600 ms debounce, atomic writes, flushed on close/hide), save-state indicator.
- Import: Branchmint JSON, any `{text|title, children}` JSON, Markdown/indented outlines. Export: JSON, Markdown, PNG, SVG, PDF.
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
src/core     Pure TypeScript, no React, fully unit-tested
  tree.ts      document model + every edit (works on Immer drafts)
  layout.ts    6 layout algorithms, spatial navigation, hit-testing
  measure.ts   canvas text measurement + wrapping (shared by DOM and SVG)
  visual.ts    how a node looks (colours, shapes) - shared by DOM and SVG
  svg.ts       SVG renderer for export and dashboard thumbnails
  outline.ts   Markdown/JSON import, Markdown export, document sanitising
src/state    Zustand stores: doc (history, selection, derived layout), view, ui, library, search
src/io       storage (Tauri commands or IndexedDB), exporters, file dialogs
src/ui       React components
src-tauri    Rust: atomic JSON file storage, raw-bytes export command
```

Design notes:

- **One document, one file.** Each map is `<app-data>/maps/<id>.json`, written atomically (temp file + rename). A `meta` block (title, counts, search text, SVG thumbnail) lets the dashboard list maps without parsing nodes. `sanitizeDoc` repairs dangling ids, cycles and bad enums on load, so a hand-edited file cannot crash the app.
- **Undo = array of Immer snapshots.** Structural sharing keeps this cheap. Rapid edits with the same key (typing in notes) merge into one step.
- **Same numbers everywhere.** Node sizes come from one measure function; the canvas, minimap, thumbnails and all exports read the same layout, so exports match the screen.
- **Browser fallback.** Outside Tauri the storage layer uses IndexedDB, so `pnpm dev` is a complete app for fast UI work.
- PDF export embeds a 2-3x raster of the map on a page sized to the map. Vector PDF is a possible upgrade.

## Roadmap hooks (not built yet)

The model and storage were shaped for these, but they are not part of the MVP: AI-assisted brainstorming (a `suggest children` action on a node), real-time collaboration (the document is already a plain tree of ids that CRDTs map onto), share links, a template gallery beyond the six built-ins, and version history (snapshots are already immutable values).

## License

[MIT](LICENSE)
