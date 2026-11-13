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
pnpm build:web    # static files in dist/ (about 5 MB): the landing page at /, the app at /app/
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

## The landing page

The website has two pages:

| Address | What | Source |
|---|---|---|
| `/` | The landing page: static HTML, so search engines can read it | `site/index.html`, `site/landing.css`, `site/landing.ts` |
| `/app/` | The app | `index.html`, `src/` |

- `pnpm build:web` builds both and then runs `scripts/web-layout.mjs`, which puts each page at its address. `pnpm build` (used by the desktop app) builds the app only, at `/`.
- In development (`pnpm dev`) the app is at `/` and the landing page at `/site/`. A link to `/app/` goes to the app.
- Maps do not move: the browser keeps them for the whole site, not for one address.
- The landing page uses no framework. Its download links come from the same code as the dialog in the app (`src/core/download.ts`). All motion stops for people who ask their system for reduced motion.
- The screenshots in `site/img/` are smaller copies of `docs/screenshots/`. To make them again: `cwebp -q 80 -resize 1800 0 docs/screenshots/<name>.png -o site/img/<name>.webp`.

## Search engines and AI assistants

The page is an app that needs JavaScript, and most crawlers do not run JavaScript. These files tell them what Mindroot is:

| File | Purpose |
|---|---|
| `public/llms.txt` | A short description with links, in the [llms.txt](https://llmstxt.org) format |
| `public/llms-full.txt` | The full description: features, install steps, limits, common questions |
| `public/robots.txt`, `public/sitemap.xml` | Allow all crawlers and list the pages |
| `site/index.html` | The landing page: the text itself, the description and preview tags, and structured data (`SoftwareApplication`, `FAQPage`) |
| `index.html` | The app page. It has a `<noscript>` block with the main facts; on the website it is marked `noindex`, so search results show the landing page |

Keep them in step with the app: when a feature, a platform or a limit changes, change `llms.txt`, `llms-full.txt` and the landing page in the same pull request. A wrong statement there is repeated by assistants for a long time.

If the site is behind Cloudflare, check **Security → Bots** in the dashboard: "Block AI bots" and "AI Labyrinth" must be off, or the assistants cannot read the site.

