# Branchmint Roadmap Features Implementation Plan

> **For agentic workers:** Execute with superpowers:executing-plans (native, in the main thread; the owner disabled sub-agents). Steps use checkbox syntax. Work on branch `feat/roadmap`; commit per task; do not push.

**Goal:** Add 30 features to Branchmint (everything from the brainstorm list except the mobile app), each with tests, then verify the whole app end to end.

**Architecture:** Keep the pure `src/core` model and add fields in an additive, sync-safe way (format v3, unknown fields and records preserved). Extend the plugin API to v2 (map edits, formats, network) so AI, collaboration, and the gallery are plugins. Network calls go through Rust (keeps keys out of the webview and out of the CSP). Collaboration is a Yjs mirror of the map plus a small relay server.

**Tech Stack:** Tauri 2, React 19, TS 7, Zustand 5, Immer, Vitest 5, Playwright (new, for E2E), Yjs + `ws` (collab), `marked` + `dompurify` + `katex` + `highlight.js` (lazy), `fflate` (zip), `reqwest` + `keyring` + `zip` + `tauri-plugin-updater` + `tauri-plugin-global-shortcut` (Rust).

**Spec:** Brainstorm answers in this conversation (2026-11-10): collab = Yjs + relay; AI = OpenAI-compatible and Anthropic-compatible APIs (OpenRouter, 9router); updates = GitHub Releases; plugin index = JSON in repo; cross-map links and tasks are sync-safe by map id; no mobile app.

## Global Constraints

- Language of replies to owner: ASD-STE100 simple English. Code, commands, file names unchanged.
- No sub-agents. No Claude/AI mention in commits, PRs, or code comments. No push.
- Python is not used. Package manager is `pnpm`. Node 20+, Rust 1.80+.
- Map file stays JSON Lines, one record per line, sorted by id, fixed key order (`src/core/format.ts`). `FORMAT_VERSION` becomes 3. The reader MUST keep unknown fields and unknown record types and write them back unchanged.
- New data fields are optional. A map with none of them serializes byte-identical to today.
- Persian/RTL must work in every new text surface (use `dir="auto"`; test with a Persian string).
- Secrets (AI key) go to the OS keychain via `keyring`. Never into the vault, `plugin_settings`, or Git.
- Every new Rust command is added to `configure()` in `src-tauri/src/lib.rs` and gets a case in `src-tauri/tests/ipc.rs`.
- Each task follows this cycle: (1) write the failing test named below, (2) run it and see it fail, (3) implement the listed signatures, (4) run it and see it pass plus `pnpm typecheck`, (5) commit with a plain message.
- UI tasks: also screenshot desktop (1440) and mobile (390 width), light and dark, one RTL map, via the E2E suite from Task 3; look at the images.
- Definition of done for the whole plan: `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `cargo test --manifest-path src-tauri/Cargo.toml`, `pnpm build` all pass; docs updated.

## Review Focus

1. A v3 map opened and saved by this app must not lose groups, floats, links, or unknown fields; and the sync merge must carry new record types (Task 1, Task 2).
2. Persian text inside tags, outline view, HTML export, vector PDF, and presentation mode renders and exports correctly (Tasks 9, 17, 22, 23).
3. A 5,000-node map stays usable in outline, focus, presentation, and the tasks index (Tasks 8, 9, 11, 14).
4. Collab: two clients edit offline, reconnect, and converge; undo only undoes your own edits; a wrong room token is refused (Task 28).
5. AI replies that are not valid JSON, are empty, or time out never corrupt a map; one undo step reverts an AI edit (Task 26).
6. Updater and plugin install reject a bad signature or a wrong SHA-256 (Tasks 27, 29).

## File Structure (new or changed)

```
src/core/types.ts, tree.ts, format.ts, outline.ts, layout.ts, svg.ts   changed (model v3)
src/core/{tags,tasks,focus,present,diff,mdnotes,links}.ts               new, pure
src/core/import/{freemind,xmind,opml,obsidian}.ts                       new importers
src/core/export/{opml,html,pdfvector}.ts                                new exporters
src/sync/merge.ts                                                       changed (new records)
src/state/{focus,present,tasks,templates,history,capture}.ts            new stores
src/ui/{Outline,Presentation,FocusBar,TagFilter,TasksView,History,Compare,NotesView,AttachmentList,GroupView}.tsx  new
src/plugins/types.ts, host.ts                                           changed (API v2)
src/plugins/builtin/{ai,collab,gallery}/                                new built-in plugins
src-tauri/src/{net,secrets,templates,updates,capture}.rs                new
server/relay/                                                           new Node relay for collab
tests/e2e/                                                              new Playwright suite
docs/{features,collab,ai,plugins,sync,releasing}.md                     updated
```

---

## Phase A — Foundation

### Task 1: Model v3 and lossless format

**Files:** Modify `src/core/types.ts`, `src/core/format.ts`, `src/core/outline.ts` (`sanitizeDoc`), `src/core/tree.ts` (`createDoc`, `syncMeta`); Test `tests/format.test.ts`, `tests/core.test.ts`.

**Interfaces — Produces (all optional):**
- `MindNode`: `tags?: string[]`, `due?: string` (`YYYY-MM-DD`), `done?: boolean`, `mapLink?: { mapId: string; nodeId?: string }`, `attachments?: Attachment[]`, `pos?: { x: number; y: number }` (floating root), `sticky?: boolean`, `notesFmt?: 'md'`
- `Attachment = { id: string; name: string; asset: string; mime: string; size: number }`
- `Relation` adds `arrow?: 'end' | 'both' | 'none'`, `dash?: 'dashed' | 'solid' | 'dotted'`
- `MapDoc` adds `groups?: Group[]`, `summaries?: Summary[]`, `font?: FontId`, `dir?: 'ltr' | 'rtl'`, `customTheme?: string[]` (8 hex), `extra?: Record<string, unknown>`
- `Group = { id: string; ids: string[]; label?: string; color?: string }` (ids are siblings)
- `Summary = { id: string; parentId: string; from: string; to: string; label: string }` (from/to are sibling ids)
- `FontId = 'inter' | 'vazirmatn' | 'serif' | 'mono'`
- `format.ts`: record types `group`, `sum`; `FORMAT_VERSION = 3`; unknown record lines kept in `doc.extra.records: string[]` and re-emitted last, sorted.

- [ ] Tests: `roundtrip keeps every new field`, `unknown record type survives load+save byte for byte`, `unknown node field survives`, `doc without new fields serializes identical to v2 golden string`, `sanitizeDoc drops groups whose ids are not siblings`, `sanitizeDoc drops summaries with dangling ids`, `v2 file loads and is rewritten as v3`.
- [ ] Implement; keep key order fixed; unit-test with a Persian title.

### Task 2: Merge new records

**Files:** Modify `src/sync/merge.ts`; Test `tests/merge.test.ts`.

- [ ] Tests: `groups edited on two sides are merged by id`, `group deleted on one side and edited on the other keeps the edit`, `summary referencing a node deleted on the other side is dropped, not left dangling`, `new node fields (tags, due, done, mapLink) merge per field, newer wins on overlap`, `unknown records from both sides are unioned`.
- [ ] Implement `mergeDocs` handling for `group`, `sum`, floating `pos`, and per-field merge of the new node fields; reuse the existing per-field newer-wins path.

### Task 3: E2E harness

**Files:** Create `playwright.config.ts`, `tests/e2e/helpers.ts`, `tests/e2e/smoke.spec.ts`, `tests/e2e/shots.spec.ts`; Modify `package.json` (`"e2e": "playwright test"`, devDependency `@playwright/test`), `.github/workflows/ci.yml` (run e2e in the web build job).

**Interfaces — Produces:** `openApp(page)`, `newMap(page, outline?: string)` (imports a Markdown outline via the dashboard), `node(page, text)` locator, `shoot(page, name)` (saves desktop/mobile × light/dark to `tests/e2e/__shots__/`). `webServer` runs `pnpm dev` on port 1420 (IndexedDB mode).

- [ ] Test `smoke: create map, add child with Tab, rename, reload, text persists`.
- [ ] Run `pnpm exec playwright install chromium`; run `pnpm e2e`; expect pass.

### Task 4: Plugin API v2

**Files:** Modify `src/plugins/types.ts` (`PLUGIN_API_VERSION = 2`), `src/plugins/host.ts`, `docs/plugins.md`; Test `tests/plugins.test.ts`.

**Interfaces — Produces on `PluginContext`:**
- `docs.edit(label: string, recipe: (draft: MapDoc) => void): boolean` — one undo step through `commit`
- `docs.selection(): string[]`
- `formats.registerImporter({ id, title, extensions: string[], parse(file: File): Promise<MapDoc> }): Disposable`
- `formats.registerExporter({ id, title, extension, mime, build(doc: MapDoc): Promise<Uint8Array | string> }): Disposable`
- `net.request({ url, method, headers?, body?, timeoutMs? }): Promise<{ status: number; body: string }>` — needs permission `net`; calls Rust `net_request`
- `secrets.get(key)`, `secrets.set(key, value)`, `secrets.remove(key)` — needs permission `secrets`
- `PluginManifest.permissions` adds `'net' | 'secrets'`; `api: 1` plugins still load.

- [ ] Tests: `docs.edit makes one undo step`, `docs.edit returns false when no map is open`, `api 1 plugin still activates`, `plugin without net permission has no ctx.net`, `registered importer appears in the import list and is removed on deactivate`.

### Task 5: Rust network and secrets commands

**Files:** Create `src-tauri/src/net.rs`, `src-tauri/src/secrets.rs`; Modify `src-tauri/Cargo.toml` (`reqwest` rustls, `keyring`), `src-tauri/src/lib.rs`, `src-tauri/tests/ipc.rs`.

**Interfaces — Produces:** `net_request(req: NetRequest) -> Result<NetResponse, String>` (https only, plus `http://localhost` for dev; 2 MB response cap; timeout default 60 s); `secret_get/secret_set/secret_remove(plugin_id, key)` stored under service `app.branchmint.desktop`.

- [ ] Tests (Rust): `net_request rejects http to non-localhost`, `net_request enforces response cap` (local test server), `secrets reject empty plugin id`. Browser fallback: secrets in `sessionStorage` only, labelled "not stored" in the UI.

---

## Phase B — Editing features

### Task 6: Tags and tag filter

**Files:** Create `src/core/tags.ts`, `src/ui/TagFilter.tsx`; Modify `src/ui/Inspector.tsx`, `src/ui/NodeView.tsx`, `src/ui/commands.ts`, `src/state/ui.ts` (`tagFilter: string[]`); Test `tests/core.test.ts`, `tests/e2e/tags.spec.ts`.

**Interfaces:** `normalizeTag(s: string): string` (trim, strip `#`, lower-case, NFC); `allTags(doc): { tag: string; count: number }[]`; `matchesTags(node, filter: string[]): boolean`; `setNodeTags(doc, ids, tags)`.

- [ ] Tests: `normalizeTag handles Persian and mixed case`, `allTags counts across nodes`, `filter dims non-matching nodes to 25% opacity but keeps ancestors of matches at 60%`; e2e `tag a node, filter, dimmed nodes have the dim class, clear filter restores`.

### Task 7: Relation labels, arrows, styles

**Files:** Modify `src/core/edges.ts` (`relationPath` returns midpoint), `src/ui/Canvas.tsx`, `src/ui/Inspector.tsx`, `src/core/svg.ts`, `src/core/tree.ts` (`updateRelation(doc, id, patch)`); Test `tests/core.test.ts`, e2e.

- [ ] Tests: `relationPath returns a midpoint on the curve`, `svg export includes the label text and marker for arrow both`, `updateRelation ignores unknown ids`; e2e `double-click a relation, type "blocks", label shows, export SVG contains "blocks"`.

### Task 8: Groups and summary brackets

**Files:** Create `src/ui/GroupView.tsx`; Modify `src/core/tree.ts`, `src/core/layout.ts` (return `groupBoxes`, `summaryBoxes`), `src/core/svg.ts`, `src/ui/Canvas.tsx`, `src/ui/commands.ts`; Test `tests/core.test.ts`, e2e.

**Interfaces:** `groupSiblings(doc, ids: string[], label?): string | null` (null if not siblings, or fewer than 1); `ungroup(doc, groupId)`; `summarize(doc, ids: string[], label): string | null` (consecutive siblings only); layout adds `groupBoxes: Record<string, Box>` (union of member subtree bounds + 12 px pad) and `summaryBoxes: Record<string, { bracket: Box; label: Box; side: Side }>`. Deleting or moving a member updates or removes the group/summary in the same edit (inside `removeNodes`/`moveNode`).

- [ ] Tests: `groupSiblings refuses non-siblings`, `group box contains all member subtrees`, `removeNodes shrinks group, removes empty group`, `moveNode out of the parent removes the node from the group`, `summarize needs consecutive siblings`, `summary bracket is on the outer side in mindmap layout`, `svg export draws group and bracket`; e2e `select two siblings, run "Group", boundary visible; undo removes it`.

### Task 9: Floating nodes and sticky notes

**Files:** Modify `src/core/tree.ts`, `src/core/layout.ts`, `src/ui/Canvas.tsx`, `src/ui/NodeView.tsx`, `src/state/doc.ts`; Test `tests/core.test.ts`, e2e.

**Interfaces:** `addFloat(doc, x, y, text = '', sticky = false): string` (node with `parentId: null`, `pos`); layout places each float's subtree rooted at `pos` using the active layout; `moveFloat(doc, id, x, y)`; floats are listed in `orderedIds` after the main tree and never counted as the root; double-click empty canvas creates one; `attachFloat(doc, id, parentId)` turns it into a normal child.

- [ ] Tests: `float subtree is laid out at pos`, `float does not change main tree bounds` (bounds union is used only for fit), `sanitizeDoc keeps floats and still finds the single root`, `delete float removes its subtree`, `sticky node has no connector`; e2e `double-click canvas, type, drag, reload, position persists`.

### Task 10: Rich notes (Markdown, code, LaTeX) and attachments

**Files:** Create `src/core/mdnotes.ts`, `src/ui/NotesView.tsx`, `src/ui/AttachmentList.tsx`, `src-tauri/src/attachments.rs`; Modify `src/ui/Inspector.tsx`, `src/io/assets.ts`, `src/io/storage.ts` (IDB blobs), `src-tauri/src/storage.rs`, `src/sync/engine.ts` (assets already synced); Test `tests/core.test.ts`, `src-tauri/tests/ipc.rs`, e2e.

**Interfaces:** `renderNotes(md: string): Promise<string>` (marked → DOMPurify; `$...$`/`$$...$$` via lazy `katex`; fenced code via lazy `highlight.js/lib/core` with common languages); `addAttachment(file: File): Promise<Attachment>` (SHA-256 name, 25 MB cap, extension allowlist of `[a-z0-9]{1,8}`); Rust `save_asset` accepts any safe extension; `open_attachment(asset)` copies to temp dir then opens with the opener plugin.

- [ ] Tests: `renderNotes strips <script> and on* attributes`, `renderNotes renders $x^2$ to katex markup`, `renderNotes highlights ts fences`, `renderNotes keeps Persian paragraphs dir=auto`, `addAttachment rejects files over 25 MB`, `same file twice stores one asset`, Rust `save_asset rejects path traversal in extension`; e2e `write ## Title in notes, preview shows h2; attach a file, name appears, reload, still there`.

---

## Phase C — View features

### Task 11: Focus mode

**Files:** Create `src/core/focus.ts`, `src/state/focus.ts`, `src/ui/FocusBar.tsx`; Modify `src/state/doc.ts` (layout derived from `focusDoc`), `src/ui/commands.ts`, `src/ui/hotkeys.ts` (`⌘.` toggle, `Esc` exit); Test `tests/core.test.ts`, e2e.

**Interfaces:** `focusDoc(doc, id): MapDoc` (shallow projection: `root = id`, only subtree nodes and relations whose both ends are inside; nodes are the same objects, no copy); `useFocus: { id: string | null }`, `enterFocus(id)`, `exitFocus()`. Edits still apply to the real doc. Focus id resets when the node is deleted.

- [ ] Tests: `focusDoc contains only the subtree`, `relations leaving the subtree are hidden`, `adding a child in focus mode adds it to the real doc`, `deleting the focused node exits focus`; e2e `focus a branch, only it is visible, breadcrumb shows path, Esc returns, camera fits`.

### Task 12: Presentation mode

**Files:** Create `src/core/present.ts`, `src/state/present.ts`, `src/ui/Presentation.tsx`; Modify `src/ui/commands.ts`; Test `tests/core.test.ts`, e2e.

**Interfaces:** `presentationSteps(doc, mode: 'node' | 'branch'): string[][]` (each step = ids revealed *in addition* to earlier steps; `branch` mode reveals one first-level branch per step, depth-first inside `node` mode; collapsed nodes count as one step and are not opened); store `usePresent: { active, step, steps }`; keys `→ Space` next, `←` previous, `Esc` exit, `F` toggle fullscreen; camera uses `animateTo` to the bounds of the newly revealed ids; unrevealed nodes render at opacity 0 and are not hit-testable.

- [ ] Tests: `steps in node mode follow document order`, `branch mode gives one step per first-level child`, `collapsed branch is one step`, `empty map gives zero steps and presentation does not start`, `step index clamps at both ends`; e2e `start, press → three times, only 4 nodes visible, Esc restores all`.

### Task 13: Outline view

**Files:** Create `src/ui/Outline.tsx`; Modify `src/ui/Editor.tsx` (split pane, toggle `⌘⇧O`), `src/state/ui.ts` (`outlineOpen`); Test e2e.

Rows are the visible tree (`orderedIds(doc, true)`), indented by depth, one `textarea` per row (auto-size), `Tab`/`⇧Tab` = indent/outdent, `Enter` = new sibling, `⌥↑↓` = reorder, caret in a row selects the same node on the canvas and vice versa. Uses the existing `doc.ts` actions only. Rows are windowed (render visible range ± 20) to keep 5,000 nodes smooth.

- [ ] Tests (e2e): `type in outline, node appears on canvas`, `Tab in outline indents`, `select node on canvas, outline row is focused`, `5,000-node map scrolls: render time of first paint under 1.5 s` (generated via import).

### Task 14: Themes, fonts, RTL mirror, spellcheck

**Files:** Modify `src/core/themes.ts` (`resolveTheme(doc)` uses `customTheme`), `src/core/measure.ts` + `src/core/svg.ts` + `src/styles/index.css` (font by `doc.font`), `src/core/layout.ts` (`dir: 'rtl'` mirrors x about the root center and swaps `side`/attach), `src/ui/Inspector.tsx` (map tab: theme editor with 8 colour inputs, font select, direction toggle), `src/ui/Editor.tsx` (`spellcheck` + `lang` attribute from script detection); Test `tests/core.test.ts`, e2e.

- [ ] Tests: `rtl mirror puts first child left of root in right layout`, `rtl mirror is an involution` (mirror twice equals original), `customTheme overrides slots 0..7`, `measure uses the selected font` (different widths for mono vs inter), `svg export embeds only fonts used`; e2e `switch to RTL, screenshot, Persian node is right of root`.

---

## Phase D — Library features

### Task 15: Cross-map links and backlinks

**Files:** Create `src/core/links.ts`, `src/state/links.ts`; Modify `src/ui/Inspector.tsx` (map picker + node picker), `src/ui/NodeView.tsx` (link badge, click opens, `⌘`-click), `src-tauri/src/storage.rs` + `src/io/storage.ts` (cache stores `links: {mapId, nodeId?}[]` per map); Test `tests/core.test.ts`, e2e.

**Interfaces:** `collectLinks(doc): { from: string; mapId: string; nodeId?: string }[]`; `backlinksTo(index, mapId, nodeId?)`; `useLinks: { index: Record<mapId, Link[]>, ready }`, `rebuildLinks()` (reads cache; rebuilds missing entries by loading maps). Links are by map id, so they survive rename and sync. A link to a missing map shows a "missing map" badge and does not throw.

- [ ] Tests: `collectLinks lists node links`, `backlinksTo finds source nodes in other maps`, `trashed map links are marked unavailable`, `link survives renameMap`; e2e `link node in map A to map B, click it, B opens, B shows a backlink to A, click returns to A`.

### Task 16: Tasks view

**Files:** Create `src/core/tasks.ts`, `src/state/tasks.ts`, `src/ui/TasksView.tsx`; Modify `src/state/ui.ts` (`Route` adds `{ name: 'tasks' }`, `parseRoute`), `src/ui/App.tsx`, `src/ui/Dashboard.tsx` (nav), `src/ui/Inspector.tsx` (due date, done); Test `tests/core.test.ts`, e2e.

**Interfaces:** `Task = { mapId; mapTitle; nodeId; text; due?: string; done: boolean; checklist?: { done: number; total: number } }`; `collectTasks(doc): Task[]` (nodes with `due` or `done !== undefined`); `bucketTasks(tasks, today: string): { overdue; today; week; later; noDate; done: Task[] }` (week = next 7 days, local date strings, no timezone math on `Date` objects); cache stores `tasks` per map. Toggling done in the view edits the map file through the store (and the open doc if it is open).

- [ ] Tests: `bucketTasks uses the given today, not the clock`, `task due today is in today not overdue`, `done tasks leave overdue`, `collectTasks ignores plain nodes`, `invalid due string is dropped by sanitizeDoc`; e2e `set due dates on nodes in two maps, tasks view lists both grouped, tick one, it moves to done, reopen map shows it ticked`.

### Task 17: Custom templates

**Files:** Create `src-tauri/src/templates.rs`, `src/state/templates.ts`; Modify `src/io/storage.ts`, `src/ui/Dashboard.tsx` (templates grid shows user templates first), `src/ui/commands.ts` ("Save map as template…"); Test `src-tauri/tests/ipc.rs`, `tests/store.test.ts`, e2e.

**Interfaces:** vault folder `templates/<id>.jsonl` (synced by Git); Rust `template_list`, `template_save(id, text)`, `template_delete(id)`; `saveAsTemplate(name): Promise<string>`, `docFromUserTemplate(id)` (new map ids, fresh meta).

- [ ] Tests: `template roundtrip via ipc`, `creating a map from a template gives new node ids`, `template keeps images`; e2e `save as template, dashboard shows it, new map from it has same text`.

### Task 18: Quick capture

**Files:** Create `src-tauri/src/capture.rs`, `src/ui/Capture.tsx`, `src/state/capture.ts`; Modify `src-tauri/Cargo.toml` (`tauri-plugin-global-shortcut`), `src-tauri/tauri.conf.json` (second window `capture`, hidden, always on top, 520×120), `src-tauri/capabilities/default.json`, `src/state/ui.ts` (`Route` adds `{ name: 'capture' }`), `src/ui/SettingsDialog.tsx` (shortcut, default `Alt+Shift+Space`, inbox map name).

**Interfaces:** `appendToInbox(text: string): Promise<void>` — finds or creates the map titled by setting (default "Inbox"); if that map is open in the main window it uses `commit`, otherwise it loads the map, appends a child of the root, saves via the store. The capture window emits event `capture:add`; the main window (always alive, may be hidden) performs the write so there is one writer.

- [ ] Tests: `appendToInbox creates the map on first use`, `appendToInbox appends to an open map as one undo step`, `two quick appends keep both` (store test); Rust `capture shortcut string is validated`. Manual E2E on desktop: press the shortcut, type, Enter, window hides, node is in Inbox (record in verification notes; Playwright cannot press OS-global keys).

---

## Phase E — Import and export

### Task 19: Importers (FreeMind, XMind, OPML, Obsidian canvas)

**Files:** Create `src/core/import/{freemind,xmind,opml,obsidian}.ts`; Modify `src/state/library.ts` (`importFile` dispatches by extension and by registered plugin importers), `src/io/files.ts` (accept list), `package.json` (`fflate`); Test `tests/import.test.ts` with fixtures in `tests/fixtures/`.

**Interfaces (all pure):** `fromFreeMind(xml: string): MapDoc`, `fromOpml(xml: string): MapDoc`, `fromXmind(bytes: Uint8Array): Promise<MapDoc>` (reads `content.json`; falls back to `content.xml`), `fromObsidianCanvas(json: string): MapDoc` (text and file nodes become nodes; edges become tree parent links by first-seen direction; extra edges and cycles become `relations`; groups become `groups` only when members are siblings, else ignored).

- [ ] Tests: `freemind keeps nested nodes, colors, icons text`, `freemind folded=true becomes collapsed`, `opml nested outline`, `opml with entities and Persian text`, `xmind content.json topics tree`, `xmind with attached notes becomes notes`, `canvas graph with a cycle yields relations and no loop`, `canvas with several roots creates a central idea`, `all importers return docs that pass sanitizeDoc unchanged`, `malformed input throws a readable Error and creates no map`.

### Task 20: Exporters (OPML, HTML page)

**Files:** Create `src/core/export/{opml,html}.ts`; Modify `src/io/exporters.ts`, `src/ui/ExportDialog.tsx`; Test `tests/export.test.ts`, e2e.

**Interfaces:** `toOpml(doc): string` (valid OPML 2.0, escapes, notes in `_note`); `toHtml(doc, opts: { title }): string` — one self-contained file: inline SVG of the map, inline JSON of nodes (notes, links), ~6 KB of vanilla JS for pan, zoom, collapse, and a notes popover; no external requests; fonts embedded as base64 woff2 subsets only for the fonts used; read-only.

- [ ] Tests: `opml roundtrips through fromOpml`, `html contains no http(s) references except node links`, `html escapes </script> inside notes`, `html size for a 200-node map is under 600 KB with fonts`; e2e `export HTML, open the saved file in a new page, wheel zoom changes transform, click node shows note`.

### Task 21: Vector PDF (spike first)

**Files:** Create `src/core/export/pdfvector.ts`; Modify `src/io/exporters.ts`; Test `tests/export.test.ts`; Spike notes in `docs/features.md`.

- [ ] **Spike (time-box 2 h):** render one map with Latin and Persian text to PDF using `svg2pdf.js` + `jspdf` with fonts registered as TTF. Check Persian output visually. If Persian shaping is wrong, switch text to outlines via `opentype.js` paths with `harfbuzzjs` shaping. If that also fails, keep raster PDF for maps that contain RTL script and use vector for the rest; record the decision in the docs.
- [ ] Interface: `buildVectorPdf(doc, opts): Promise<Uint8Array>`; the export dialog offers "PDF (vector)" and keeps "PDF (image)".
- [ ] Tests: `vector pdf is smaller than 5x the SVG size`, `pdf contains selectable text for Latin nodes` (search the text in the raw PDF stream), `page size matches map bounds`; manual check on a Persian map screenshot compare.

---

## Phase F — History and compare

### Task 22: Map history from Git

**Files:** Create `src/state/history.ts`, `src/ui/History.tsx`; Modify `src-tauri/src/git.rs` and `src-tauri/tests/fixtures/git-calls.json` (exact templates `log --format=%H%x1f%an%x1f%at%x1f%s -n 200 -- maps/<id>.jsonl` and `show <sha>:maps/<id>.jsonl`, with `<id>` and `<sha>` validated as `[0-9a-f-]+`), `src/sync/engine.ts` (`gitDeps`), `src/ui/commands.ts`; Test `tests/sync.test.ts` (real git), `src-tauri/tests/git_contract.rs`.

**Interfaces:** `listVersions(mapId): Promise<Version[]>` (`{ sha, author, at, subject }`); `loadVersion(mapId, sha): Promise<MapDoc>`; `restoreMap(mapId, sha)` (loads version, replaces open doc as **one undo step** via `replaceDoc`, not by touching Git); `restoreNode(mapId, sha, nodeId)` (copies the subtree from the old version under the current parent, or under root if the parent is gone, with new ids).

- [ ] Tests: `listVersions returns newest first`, `loadVersion returns the map as of that commit`, `restoreNode brings back a deleted subtree under root when the parent is gone`, `sha with shell characters is refused by the contract`, `history panel is hidden when sync is not set up` (e2e in browser mode: command is absent).

### Task 23: Compare maps and versions

**Files:** Create `src/core/diff.ts`, `src/ui/Compare.tsx`; Modify `src/ui/commands.ts`, `src/state/ui.ts` (`compare: { a: MapDoc; b: MapDoc; labelA; labelB } | null`); Test `tests/core.test.ts`, e2e.

**Interfaces:** `diffDocs(a: MapDoc, b: MapDoc): { added: string[]; removed: string[]; changed: string[]; moved: string[] }` (node ids; matching by id first, then by `(parent text path, text)` for maps with different ids); the view shows two read-only canvases side by side with synced pan/zoom and colours: added (green outline), removed (red, only in A), changed (amber). Entry points: "Compare with another map…" and "Compare with version…" (from History).

- [ ] Tests: `diff of identical docs is empty`, `renamed node is changed not added+removed`, `moved node is moved`, `different-id maps match by path and text`, `1,000-node diff under 100 ms`; e2e `duplicate map, edit one node, compare, one amber node, pan on left moves right`.

---

## Phase G — AI, gallery, updates

### Task 24: AI plugin

**Files:** Create `src/plugins/builtin/ai/{index.tsx,client.ts,prompts.ts,AiPanel.tsx}`, `docs/ai.md`; Modify `src/plugins/builtin/index.ts`; Test `tests/ai.test.ts`, e2e with a local stub server.

**Interfaces:** Settings `{ kind: 'openai' | 'anthropic'; baseUrl: string; model: string; timeoutMs: number }` (key in secrets). `chat(cfg, key, messages, net): Promise<string>` — `openai`: `POST {baseUrl}/chat/completions`, `Authorization: Bearer`; `anthropic`: `POST {baseUrl}/v1/messages`, `x-api-key`, `anthropic-version: 2023-06-01`, `max_tokens` set. Presets for OpenRouter (`https://openrouter.ai/api/v1`) and a custom base URL (for 9router). Commands: *Expand this node* (adds 3–7 children), *Summarize branch* (writes into notes), *Find gaps* (shows a list; click adds a node), *Rewrite text*. Model replies must be JSON `{ "items": string[] }` or `{ "text": string }`; `parseAiJson(text)` strips code fences and takes the first JSON object; invalid replies show a toast and change nothing. Each edit uses `docs.edit` (one undo step). Prompts include only the selected branch (max 200 nodes), never the whole vault.

- [ ] Tests: `openai request has bearer header and chat path`, `anthropic request has x-api-key and version header`, `parseAiJson handles fenced json`, `parseAiJson returns null on prose`, `expand adds children under the selected node in one undo step`, `network error leaves the map unchanged`, `prompt contains only the selected subtree`, `api key is never in plugin settings JSON`; e2e `with stub server, run Expand, 4 children appear, undo removes all 4`.

### Task 25: Plugin gallery

**Files:** Create `src/plugins/builtin/gallery/`, `src-tauri/src/gallery.rs`, `plugins/index.json`, `docs/plugins.md` section; Modify `src-tauri/Cargo.toml` (`zip`, `sha2`); Test `src-tauri/tests/ipc.rs`, `tests/plugins.test.ts`.

**Interfaces:** index entry `{ id, name, version, description, author, permissions, url, sha256 }`. Rust `plugin_install(url, sha256) -> Result<String>`: https only, 5 MB cap, verifies SHA-256 **before** unzipping, rejects entries with `..` or absolute paths, rejects archives without `manifest.json`, installs to `plugins/<id>/`, installed **disabled**. UI: Settings → Plugins → "Browse" shows the index (URL in settings, default raw GitHub URL of this repo's `plugins/index.json`), permission badges, Install, Update.

- [ ] Tests (Rust): `install rejects wrong sha256`, `install rejects zip-slip entry`, `install rejects missing manifest`, `install leaves plugin disabled`; TS: `index entries with invalid id are skipped`, `newer version shows Update`.
- [ ] Ship the existing `examples/plugins/word-count` as the first index entry (zip built by `scripts/pack-plugin.mjs`, which prints the sha256).

### Task 26: Auto-update

**Files:** Modify `src-tauri/Cargo.toml` (`tauri-plugin-updater`, `tauri-plugin-process`), `src-tauri/tauri.conf.json` (`bundle.createUpdaterArtifacts: true`, `plugins.updater.pubkey`, `endpoints: ["https://github.com/<owner>/<repo>/releases/latest/download/latest.json"]`), `src-tauri/capabilities/default.json`, `.github/workflows/release.yml` (`TAURI_SIGNING_PRIVATE_KEY`, `..._PASSWORD`, `includeUpdaterJson: true`), `src/ui/SettingsDialog.tsx` (General: "Check for updates", automatic check on start, toggle), `docs/releasing.md`; Test `tests/updater.test.ts` (version compare + UI state with a mocked plugin).

- [ ] Owner action (listed in the final report, not automated): run `pnpm tauri signer generate -w ~/.tauri/branchmint.key`, put the public key in `tauri.conf.json`, add the private key and password as repository secrets. **The updater cannot read releases of a private repository.** If the repo stays private, host `latest.json` and installers elsewhere; record the owner's choice.
- [ ] Tests: `no update shows "up to date"`, `update available shows version and notes, install asks to restart`, `check failure shows a plain message and does not block the app`; verify `release.yml` still passes `scripts/version.mjs check`.

---

## Phase H — Live collaboration

### Task 27: Yjs binding

**Files:** Create `src/plugins/builtin/collab/{index.tsx,bind.ts,awareness.ts,CollabPanel.tsx}`; Modify `package.json` (`yjs`, `y-protocols`, `lib0`); Test `tests/collab.test.ts`.

**Interfaces:** `bindDoc(ydoc: Y.Doc, ctx): Disposable` — Y structure: `nodes: Y.Map<Y.Map>` (field per key; `order: string` fractional index instead of `children[]`), `meta: Y.Map` (layout, edge, themeId, bg, font, dir), `rels: Y.Map`, `groups: Y.Map`, `sums: Y.Map`. `toYDoc(doc: MapDoc, ydoc)`, `fromYDoc(ydoc): MapDoc` (children derived by sorting siblings by `order`, ties by id; cycles repaired by `sanitizeDoc`). Local edits → `Y.Transaction` with origin `'local'`; remote updates → `ctx.docs.replace` flagged as non-undoable remote. Undo uses `Y.UndoManager` tracking origin `'local'` only, and bridges to the app's undo/redo keys when the collab session is active. Awareness: `{ name, color, selection: string[] }`; remote selections draw as coloured outlines with a name tag.

- [ ] Tests: `toYDoc/fromYDoc roundtrip equals the doc`, `two docs, concurrent child adds converge to the same order`, `concurrent move to different parents never creates a cycle after sanitize`, `undo undoes only local edits`, `offline edits on both sides merge after exchange of updates`, `fractional order inserts between two siblings without renumbering`.

### Task 28: Relay server and end-to-end collaboration

**Files:** Create `server/relay/{package.json,src/index.ts,src/auth.ts,Dockerfile,README.md}`, `tests/e2e/collab.spec.ts`; Modify `src/plugins/builtin/collab/index.tsx` (settings: server URL, room secret per vault; command *Start sharing this map* copies an invite link `branchmint://join?...`), `src-tauri/tauri.conf.json` (CSP `connect-src` adds `wss:`), `docs/collab.md`.

**Interfaces:** Relay speaks the `y-websocket` protocol over `ws`; room name = `HMAC-SHA256(secret, mapId)`; connection requires `?token=HMAC(secret, room)`; wrong token → close code 4401; in-memory docs with periodic snapshot to a local LevelDB folder; limits: 50 rooms per process, 20 clients per room, 10 MB update size. Env: `PORT`, `SECRET`, `DATA_DIR`. Docker runs as its own unit on its own port, behind the owner's reverse proxy (the owner approves any VPS change separately; this task only produces the image and docs).

- [ ] Tests: server unit `rejects bad token with 4401`, `drops oversized update`, `room limit refused`; e2e (two Playwright pages + relay started by `webServer`) `A types a node, B sees it within 2 s`, `B goes offline, both edit, B reconnects, both edits present`, `remote cursor outline for A visible on B`, `undo on B does not remove A's node`, `wrong secret: page shows "could not join" and map is unchanged`.

---

## Phase I — Quality and docs

### Task 29: Accessibility pass

**Files:** Modify `src/ui/Canvas.tsx`, `src/ui/NodeView.tsx`, `src/ui/Dashboard.tsx`, `src/ui/Overlays.tsx`, `src/styles/index.css`; Test `tests/e2e/a11y.spec.ts` (add `@axe-core/playwright`).

Canvas container `role="tree"`; nodes `role="treeitem"` with `aria-level`, `aria-expanded`, `aria-selected`, accessible name = node text; a visually hidden live region announces selection and "collapsed/expanded"; dashboard cards reachable and operable by keyboard (arrows, Enter, Delete→confirm); dialogs trap focus and return it; visible focus ring in light and dark; contrast ≥ 4.5:1 for text.

- [ ] Tests: `axe reports no serious or critical violations on dashboard, editor, settings, tasks view (light and dark)`, `arrow keys move selection and the live region announces the new node`, `dialog focus returns to the opener on close`.

### Task 30: Docs, final verification, report

**Files:** Modify `README.md` (feature list, keyboard table: `⌘.` focus, `⌘⇧O` outline, presentation key, capture shortcut), `docs/sync.md` (format v3, new records, history), create `docs/features.md`; Test: the whole suite.

- [ ] Run, in order, and record results: `pnpm typecheck`, `pnpm test`, `cargo test --manifest-path src-tauri/Cargo.toml`, `pnpm e2e`, `pnpm build`, `pnpm tauri build --debug` (smoke-launch the app and run the capture and updater checks by hand).
- [ ] Look at the screenshots from `tests/e2e/__shots__/` for every new UI (desktop/mobile, light/dark, RTL) and fix what is wrong.
- [ ] Final report lists: what passed, what needs the owner (updater keys and public hosting, relay deploy, global shortcut manual check), and anything not done.

---

## Self-Review

- **Coverage:** focus (11), presentation (12), history (22), cross-map (15), tasks (16), relation labels (7), groups/summaries (8), floats/sticky (9), outline (13), rich notes (10), attachments (10), templates (17), tags (6), importers (19), OPML+HTML (20), vector PDF (21), AI (24), quick capture (18), compare (23), live collab (27–28), auto-update (26), plugin gallery (25), themes/fonts (14), spellcheck+RTL mirror (14), accessibility (29). Mobile is excluded by the owner.
- **Order:** model and merge first (1–2), harness (3), API (4–5), then features that depend on them. Tasks 24, 27, and 28 need Tasks 4 and 5.
- **Known risks:** vector PDF with Persian (Task 21 has a spike and a fallback); updater and private repository (Task 26 flags it); collab edge cases (Task 27 tests concurrent moves).
- **Proportion:** the plan names files, signatures, and tests. It leaves function bodies to the implementer.
