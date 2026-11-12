# Contributing to Mindroot

Thank you for your interest. All help is welcome: bug reports, ideas, documentation, plugins and code.

## Ways to help

- **Report a bug.** Open an issue with the bug template. Give the steps, what you expected, and what occurred.
- **Propose a feature.** Open an issue with the feature template first. For a large change, agree on the design before you write code.
- **Write a plugin.** A plugin needs no change in this repository. See [docs/plugins.md](docs/plugins.md) and [`examples/plugins/word-count`](examples/plugins/word-count). To list it in the gallery, add an entry to [`plugins/index.json`](plugins/index.json) in a pull request.
- **Pick an issue.** Issues with the label `good first issue` are small and have a clear scope. The [roadmap](README.md#roadmap) lists the large items.

## Set up

Requirements: Node 20+, pnpm, Rust 1.80+, Git, and the [Tauri system dependencies](https://tauri.app/start/prerequisites/).

```bash
git clone https://github.com/falhad/mindroot.git
cd mindroot
pnpm install
pnpm dev          # browser only, fastest loop for UI work (maps live in IndexedDB)
pnpm tauri dev    # the desktop app
```

Most UI work needs only `pnpm dev`. You need `pnpm tauri dev` when you change Rust code, Git sync, file storage, quick capture or the updater.

## Where code goes

| Folder | Rule |
|---|---|
| `src/core` | Pure TypeScript. No React, no browser APIs, no I/O. Each function has unit tests. |
| `src/state` | Zustand stores. They call `core` and `io`. |
| `src/io` | Storage, files, exporters. Each has a Tauri path and a browser path. |
| `src/sync` | Git sync engine and the three-way merge. Tested against real Git. |
| `src/plugins` | The plugin API and the built-in plugins. A built-in plugin uses only the public API. |
| `src/ui` | React components. |
| `src-tauri` | Rust commands. Each command has an IPC test. |

The README has an [architecture section](README.md#architecture) with the design notes.

## Before you open a pull request

Run the same checks as CI:

```bash
pnpm typecheck
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
pnpm e2e          # when you changed the UI
```

Rules:

- **A bug fix comes with a test** that fails without the fix.
- **New logic comes with tests.** Logic belongs in `src/core` where a test is easy.
- **UI changes:** check light and dark, desktop width and phone width, and one right-to-left map. Add screenshots to the pull request.
- **Keep documentation in step.** If behaviour changes, update `README.md` or the page in `docs/`.
- **The map file format is a contract.** Old files must still open. Unknown fields must survive a load and save. Read [docs/sync.md](docs/sync.md) before you change it.
- **Git calls are an allow-list.** If the sync tests change `src-tauri/tests/fixtures/git-calls.json`, commit the new file and check that the Rust allow-list agrees.
- **One subject for each pull request.** Small pull requests get a faster review.
- **New GitHub Actions** must be pinned to a full commit SHA. See [docs/releasing.md](docs/releasing.md).

## Commit messages

Write a short summary line that says what changed and where, for example `Sync: keep the local edit when both sides rename an idea`. Add a body when the reason is not obvious.

## Conduct

Be kind and be specific. See the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Your contribution is licensed under the [MIT License](LICENSE), the same as the project.
