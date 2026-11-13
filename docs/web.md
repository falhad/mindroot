# The web version

Mindroot also runs in a browser. The web version is the same app as the desktop app, built to static files. There is no server program and no account: each map is saved in the browser of the user (IndexedDB).

The public copy is at <https://mindroot.app>.

## What is different from the desktop app

| | Desktop | Web |
|---|---|---|
| Where maps are kept | Files in the vault folder | The browser (IndexedDB), for each browser and device apart |
| Git sync, version history | Yes | No (needs Git on the computer) |
| Quick capture shortcut | Yes | No |
| Secrets (AI key) | A private file or the operating system keychain | The browser session only; type the key again after you close the tab |
| Automatic update | Signed updater | A reload gets the newest version |
| Import, export, layouts, notes, themes, presentation | Yes | Yes |
| Live collaboration | Yes | Yes, with a relay you run |
| AI assistant | Yes | Only with a service that allows calls from a browser (CORS) |

A browser can delete the data of a site when the disk is full, and "Clear site data" deletes all maps. The app asks the browser for persistent storage, but a browser can refuse. Export important maps (JSON) as a backup. The dashboard shows a short notice about this until the user closes it.

## Build

```bash
pnpm install
pnpm build        # static files in dist/ (about 4 MB)
pnpm preview      # serve dist/ on this computer to try it
```

The app uses no server routes: all navigation is in the URL hash. A plain static file server is enough, and no rewrite rule is necessary.

## Deploy to your own server

1. Point the DNS records of the domain (`A` and `AAAA`) to the server.
2. Make the folder on the server, for example `/var/www/mindroot.app`, and let your SSH user write to it.
3. Add the site to the web server. Ready configurations: [`deploy/web/Caddyfile`](../deploy/web/Caddyfile) (Caddy gets the certificate itself) and [`deploy/web/nginx.conf`](../deploy/web/nginx.conf).
4. Copy the build:

```bash
scripts/deploy-web.sh --host you@server --dry-run   # show what would change
scripts/deploy-web.sh --host you@server             # build, copy, then check the address
```

### Caddy in Docker

If a Caddy container holds ports 80 and 443 and reads one file per site from a `sites` folder, do steps 2 and 3 with one command:

```bash
scripts/setup-web-docker.sh --host you@server --dry-run   # show the steps
scripts/setup-web-docker.sh --host you@server             # set up
```

It starts a small container (`mindroot-web`, files in [`deploy/web/docker`](../deploy/web/docker)) that serves the static files on the shared Docker network with no public port. Then it adds one site file to the edge Caddy and reloads it. A configuration that the edge refuses is rolled back. No other container is restarted. `--remove` undoes the setup. If the site is behind the Cloudflare proxy and you use Cloudflare Web Analytics, add `--cloudflare-analytics`: it allows the analytics script in the security policy (`--script-src <origin>` does the same for another origin). `--help` lists the options for other folder, container and network names.

`scripts/deploy-web.sh --help` lists all options (`--path`, `--port`, `--url`, `--skip-build`, `--no-check`). After the copy, the script checks that the address answers with HTTP 200 and serves the build it just made.

For a domain other than `mindroot.app`, change the domain in the web server configuration and the `og:url`, `og:image` and `canonical` lines in `index.html`.

## What the server must send

The two configurations set these. If you use another server or a CDN, set them there:

- **Content-Security-Policy.** Scripts only from the site itself (`blob:` is for installed plugins). `connect-src` allows `https:` and `wss:`, because the user chooses the AI service and the collaboration relay.
- **Cache-Control.** `immutable` for `/assets/*` (the file names contain a hash). `no-cache` for all other files, so a new deploy shows on the next visit.
- **Strict-Transport-Security**, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and `frame-ancestors 'none'` (in the policy) so that no other site can put the app in a frame.

## Not built yet

- A service worker, so the web version also starts without a network connection.
- Hosted sync with accounts.
