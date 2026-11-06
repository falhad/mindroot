# Git sync and the vault

Branchmint keeps all maps in one folder, the **vault**. Git sync (a built-in plugin) turns that folder into a Git repository and keeps it in step with a private repo, like the Obsidian Git plugin does for a notes vault.

```
<app data>/vault/              <- the Git repository
  maps/<id>.jsonl                one file per map
  assets/<sha256>.png|jpg|webp   images, shared by content
  .gitignore                     ignores *.tmp
<app data>/cache/<id>.json     thumbnails + search text (never synced; rebuilt on demand)
```

On macOS `<app data>` is `~/Library/Application Support/app.branchmint.desktop`.

## Set it up

1. Create a **private** repository (for example `you/branchmint-vault`). Leave it empty.
2. Make sure `git` can reach it without a prompt: an SSH key in your agent, or `gh auth setup-git` for https. Check with `git ls-remote <address>`.
3. In Branchmint open **Settings → Git sync**, paste the address, press **Connect and sync**.
4. On a second computer, do the same with the same address. Its maps are downloaded and merged with any local ones.

Sync runs on start, every N minutes, about 30 seconds after you stop editing, when you close the app, and on **Sync now**. The header shows its state ("Synced 2 min ago", "Sync problem"). The status text explains failures in plain words (no internet, login refused, repository not found).

## What one sync does

1. Saves the open map, commits everything in the vault (`Sync from <device> at <time>`).
2. `git fetch`. A device that has no commits yet adopts the remote history first.
3. If the remote has new commits, merges them. Git merges what it can; for map files it cannot merge, Branchmint merges them itself (below).
4. `git push`. If someone pushed in between, it fetches, merges and pushes again (up to 4 times).
5. Reloads the open map if its file changed. If you typed during the sync, your unsaved edits are merged into the incoming version, not lost.

Every sync is a normal Git commit, so history is your version history: `git log -- maps/<id>.jsonl` and `git checkout <commit> -- maps/<id>.jsonl` work in the vault folder.

## The map file (format version 2, JSON Lines)

One record per line. Records are sorted by id, keys have a fixed order, so an edit changes only the lines of the ideas that changed and Git merges edits to different ideas without conflicts.

```
{"t":"map","v":2,"meta":{"id":"…","title":"…","createdAt":1,"updatedAt":2,"nodeCount":3,"tags":[]},"root":"a1","layout":"mindmap","edge":"curve","themeId":"mint","bg":"dots"}
{"t":"node","id":"a1","parentId":null,"children":["b2"],"text":"Root"}
{"t":"node","id":"b2","parentId":"a1","children":[],"text":"Child","image":{"asset":"<sha256>.png","w":200,"h":120}}
{"t":"rel","id":"r1","from":"a1","to":"b2"}
```

- Positions are not stored: layout is recomputed from the tree.
- Images are files in `assets/`, named by their SHA-256, so the same image is stored once.
- Thumbnails and search text are derived data and live outside the vault.
- Maps from earlier versions (`<id>.json`, one JSON document) still open and are rewritten in the new format on the next save.
- Unknown record types are ignored, so newer files still open.

## How two devices' edits are merged

The merge is per idea and per field (`src/sync/merge.ts`):

| Situation | Result |
|---|---|
| Different ideas or fields edited | Both changes kept. |
| Same field changed on both sides | The newer edit wins; you get a message ("N edits overlapped"). |
| Both added children to the same idea | Both kept. |
| Edited on one device, deleted on the other | The edit is kept (nothing is lost silently). |
| Concurrent moves that would create a loop | No idea is lost; the affected ideas are attached to the central idea. |
| A map file one side damaged | The readable side wins; the damaged version stays in Git history. |
| Merge impossible for another reason | Yours is kept and the other version becomes "<title> (conflict copy)". |

## Limits to know

- Needs `git` installed. Desktop app only.
- Both devices should have the same Branchmint version family; an older app may not read newer files.
- A synced repo contains your maps and images in clear text. Keep the repository private.
- If Git cannot ask for a password (no key, no stored https login), sync reports "GitHub did not accept the login" instead of hanging.
- A long, offline editing session on two devices is merged idea by idea, but if both changed the same text the newer one wins.
