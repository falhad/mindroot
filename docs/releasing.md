# Releasing Branchmint

Two GitHub Actions workflows live in `.github/workflows/`:

| Workflow | Runs when | Does |
|---|---|---|
| `ci.yml` | every push to `main` and every pull request | type-check, frontend tests (real git), the git-contract check, Rust tests, web build |
| `release.yml` | you push a tag like `v0.2.0` (or run it by hand) | builds installers for macOS (Apple Silicon + Intel), Windows, Linux and attaches them to a **draft** GitHub release |

## Security of the workflows

- Every third-party action is pinned to a full commit SHA (the version is in the comment next to it), so a moved tag cannot change what runs with your token or signing secrets.
- Dependabot (`.github/dependabot.yml`) opens a pull request weekly when a pinned action has a new release. CI runs on it before you merge.
- Jobs get only the permissions they need: CI and the version check are read-only; only the build job can write to the release. Signing secrets are passed only to the one step that uses them, and checkouts do not keep the token.
- When you add a new action, pin it the same way: `gh api repos/OWNER/REPO/git/ref/tags/TAG` gives the SHA (for an annotated tag, follow it with `git/tags/<sha>`).

## Make a release

```bash
node scripts/version.mjs set 0.2.0                       # writes the version into the 3 files
cargo check --manifest-path src-tauri/Cargo.toml          # refreshes Cargo.lock
git commit -am "Release 0.2.0"
git tag v0.2.0
git push origin main v0.2.0
```

1. The workflow first checks that the tag equals the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`. If not, it stops and tells you which file is wrong (`node scripts/version.mjs` shows all three).
2. Four builds run in parallel (about 10 to 15 minutes in total).
3. Open the repository's **Releases** page. You will find a draft with these files:
   - macOS: `Branchmint_<version>_aarch64.dmg` and `Branchmint_<version>_x64.dmg`
   - Windows: `Branchmint_<version>_x64-setup.exe` and a `.msi`
   - Linux: `.deb`, `.rpm` and `.AppImage`
4. Check the draft, then press **Publish release**.

To rebuild an existing tag, open **Actions → Release → Run workflow** and enter the tag.

The repository can stay private. Installers are then visible only to people with access to the repository. Making the repository public later changes nothing in the workflows.

## Installing an unsigned build

Without signing secrets, the installers are not code-signed. Your own machine is fine. On other machines:

- **macOS:** the system may say the app is damaged or from an unidentified developer. Move it to Applications, then run
  `xattr -dr com.apple.quarantine /Applications/Branchmint.app`
  or right-click the app, choose **Open**, and confirm.
- **Windows:** SmartScreen shows "Windows protected your PC". Choose **More info → Run anyway**.
- **Linux:** `chmod +x Branchmint_*.AppImage` and run it, or install the `.deb` / `.rpm`.

## Turn on signing (optional, later)

Add these as repository secrets (**Settings → Secrets and variables → Actions**). The workflow already reads them; empty means unsigned.

| Secret | Value |
|---|---|
| `APPLE_CERTIFICATE` | Your "Developer ID Application" certificate as a base64 `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | The password of that `.p12` |
| `APPLE_SIGNING_IDENTITY` | For example `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | For notarization (an app-specific password) |

This needs a paid Apple Developer account. Windows signing needs a code-signing certificate and a small change to `tauri.conf.json`; see the [Tauri signing guide](https://tauri.app/distribute/sign/windows/).

## When CI fails

- **"Git call contract is up to date" fails:** the sync engine now makes a git call it did not make before. Run `pnpm test`, check that `src-tauri/tests/fixtures/git-calls.json` changed as you expect, make sure the Rust allow-list in `src-tauri/src/git.rs` accepts the new call, and commit the file.
- **Lockfile errors:** run `pnpm install` locally and commit `pnpm-lock.yaml`.

## Automatic updates (signed)

Installed apps check for new versions and install them after a signature check. The release workflow builds the update files; the app trusts only files signed with your private key.

How it works:

1. `src-tauri/tauri.conf.json` holds the **public** key (`plugins.updater.pubkey`) and the address of `latest.json` (`plugins.updater.endpoints`): `https://github.com/<owner>/<repo>/releases/latest/download/latest.json`.
2. The release workflow signs each installer with the **private** key (`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) and attaches `latest.json` to the release.
3. When you **publish** the draft release, `releases/latest/download/latest.json` starts to point at it. Old apps see the new version.

One-time setup (the key pair is already made for you; see below if you want your own):

| Step | What to do |
|---|---|
| Private key | Add the content of the private key file as the repository secret `TAURI_SIGNING_PRIVATE_KEY` |
| Password | Add its password as the repository secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` |
| Backup | Keep the key file and password in a safe place. If you lose them, installed apps cannot be updated and you must ship a new build with a new public key by hand |

To make your own key pair: `pnpm tauri signer generate -w ~/.tauri/branchmint-updater.key`, then put the new **public** key (the `.key.pub` file) into `plugins.updater.pubkey` in `tauri.conf.json`. Do this before the first public release: a changed key cannot update apps that already have the old one.

### The repository must be public (or the files hosted elsewhere)

The updater downloads `latest.json` and the installers **without a login**. GitHub does not allow that for a **private** repository: the address answers "not found", and the app shows "Could not find update information". Choose one:

- Make the repository public.
- Publish releases from a separate **public** repository (for example `branchmint-releases`) and point `endpoints` there.
- Host `latest.json` and the installers on your own server and put its address in `endpoints`.

Until one of these is done, update checks fail with a plain message and nothing else is affected. People can still install new versions by hand from the release page.
