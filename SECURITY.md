# Security

## Report a vulnerability

Do not open a public issue for a security problem.

Use GitHub's private report: **[Report a vulnerability](https://github.com/falhad/mindroot/security/advisories/new)**. Include the version, the steps to reproduce, and the effect. You get an answer within 7 days.

Only the latest release gets security fixes.

## What is in scope

- The desktop app: file storage, the Git runner (`src-tauri/src/git.rs`), the network command (`src-tauri/src/net.rs`), secret storage, plugin install and the updater.
- The collaboration relay (`server/relay`): authentication, room tokens, limits.
- Import of files from other people (a crafted map, `.mm`, OPML, XMind or canvas file), and Markdown or LaTeX notes.
- The exported single-file web page.

## How the app protects you

- **Local-first.** The app sends no data anywhere unless you turn on Git sync, live collaboration, the AI assistant, or the update check.
- **Secrets** (AI keys, relay secrets) never go to map files or to Git. You choose the place in Settings → General → Secret keys: a file in the app data folder that only your user account can read (`secrets.json`, mode 600), or the operating system keychain. The file is the default on macOS, the keychain on Windows and Linux. The file is not encrypted: a program that runs under your user account can read it. The keychain is the stronger choice; on macOS it asks for your password after each update, because the app is not signed by Apple yet.
- **Git** runs through an allow-list of calls. A contract test fails if the engine makes a call that is not on the list.
- **Notes** are sanitised (DOMPurify) before the app shows them.
- **Updates** are signed. The app refuses an update whose signature does not match the public key in the app.
- **Gallery plugins** are checked against a SHA-256 hash before install.
- **Collaboration invites** hold a token for one room, never the relay's master secret. See [docs/collab.md](docs/collab.md).

## Known limits

- **Plugins are trusted code.** An enabled plugin has the same power as the app. Enable only plugins you trust. See [docs/plugins.md](docs/plugins.md).
- The installers are not code-signed yet.
