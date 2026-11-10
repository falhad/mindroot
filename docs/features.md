# Feature guide

How to use the features added after the first release. Everything works in the desktop app. In the browser build the parts that need files or the system (Git history, attachments on disk, quick capture, installing plugins, updates) are marked.

## Structure

| Feature | How |
|---|---|
| **Tags** | Select an idea, add tags in the side panel. The `#` button in the header filters the map: matching ideas stay, their parents fade a little, everything else dims. |
| **Labelled links** | Link two ideas (⌘K → "Link to another node…"). Double-click the line to give it a label. In the panel: arrow (→ ↔ none) and line style. |
| **Groups** | Select sibling ideas, ⌘K → "Group selected siblings". A dashed boundary surrounds them and their branches. |
| **Summary bracket** | Select two or more neighbouring siblings, ⌘K → "Add summary bracket". Edit its label in the panel. |
| **Floating ideas** | Double-click empty canvas. `Shift`+double-click makes a sticky note. Drag a floating branch onto an idea to attach it. "Make selection a floating branch" detaches one. |
| **Notes** | Tick "Markdown" above the notes to write headings, lists, code (highlighted) and `$math$`. Preview is sanitized, so notes cannot run scripts. |
| **Files** | "Files" in the panel: up to 25 MB each, stored in the vault by content and synced with it. Safe types (documents, images, audio, video) open with your default app; other types are only shown in the file manager. |
| **Tasks** | "Track as task" and a due date. The **Tasks** page (maps page, left list) shows every task from every map: overdue, today, next 7 days, later, no date, done. Tick one there and the map changes. |
| **Map links** | "Map link" in the panel links an idea to another map or to one idea in it. Click the arrow badge to follow it. "Linked from" shows what links here. Links use map ids, so renaming a map does not break them and they sync. |

## Views

| Feature | How |
|---|---|
| **Focus** | Select a branch, `⌘.`. Only it is shown, with a breadcrumb. `Esc` leaves. Edits still change the real map. |
| **Outline** | `⌘⇧O`. Type to edit, `Enter` new idea, `Tab`/`⇧Tab` indent, `⌥↑/↓` move, `Backspace` on an empty leaf deletes. It stays in step with the map and handles thousands of ideas. |
| **Presentation** | `F5` shows one idea at a time, `⇧F5` one branch at a time. Arrows, `Space`, `Esc`, `F` for full screen. |
| **Compare** | ⌘K → "Compare with another map…". Two panes with synced pan and zoom. Added, removed, changed and moved ideas are outlined. |
| **Map customisation** | Side panel → Map: eight own colours, font, direction (right to left mirrors the whole layout). |

## Library

| Feature | How |
|---|---|
| **Templates** | ⌘K → "Save this map as a template". Your templates show first on the maps page and sync with the vault. |
| **Quick capture** (desktop) | Settings → General → Quick capture. Default shortcut `Alt+Shift+Space` works anywhere. Type, `Enter`. The thought is added to the map named "Inbox" (made on first use; change the name in Settings). |
| **History** (desktop, needs Git sync) | ⌘K → "History of this map…". See [sync.md](sync.md#map-history). |

## Import and export

Import accepts `.json`, Markdown, `.mm` (FreeMind/Freeplane), `.opml`, `.xmind`, `.canvas` (Obsidian) and anything a plugin adds. In an Obsidian canvas the arrows give the tree; an arrow that would give a card a second parent or close a loop becomes a cross-link.

Export adds **OPML**, a **web page** (one file: pan, zoom, fold, notes and links; no internet needed) and **PDF (vector)**.

**PDF note.** A PDF viewer's built-in fonts cannot draw Persian, Arabic, CJK or emoji. For a map that contains such text, "PDF (vector)" uses the image-based PDF instead (the picture is drawn by the browser engine, which can shape those scripts). Use "PDF (image)" to choose that yourself.

## Known limits

- In the mind-map layout, siblings on opposite sides of the central idea share one boundary box when you group them.
- Floating ideas are not part of presentations and are not laid out against the main map, so they can overlap it.
- The web-page export folds branches in place (no re-layout), and shows notes as plain text.
