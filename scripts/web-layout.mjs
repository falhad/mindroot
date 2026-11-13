#!/usr/bin/env node
// Arranges dist/ for the website, after `vite build --mode web`:
//   dist/site/index.html  ->  dist/index.html      the landing page, at /
//   dist/index.html       ->  dist/app/index.html  the app, at /app/
// The files under /assets/ and the public files keep their place: both pages use absolute addresses.
// The desktop app (`pnpm build`) does not use this script; its dist/index.html is the app.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'

const dist = new URL('../dist/', import.meta.url)
const at = (p) => new URL(p, dist)
const fail = (msg) => { console.error(`web-layout: ${msg}`); process.exit(1) }

if (!existsSync(at('site/index.html'))) fail('dist/site/index.html is missing. Run `vite build --mode web` first (or `pnpm build:web`).')
if (existsSync(at('app/index.html'))) fail('dist/app/index.html exists already. Build again before you run this script.')

// The app page: its address is /app/, and search engines must show the landing page, not this empty shell.
let app = readFileSync(at('index.html'), 'utf8')
const swap = (from, to) => {
  if (!app.includes(from)) fail(`the app page has no "${from}". Update scripts/web-layout.mjs.`)
  app = app.replace(from, to)
}
swap('<link rel="canonical" href="https://mindroot.app/" />', '<link rel="canonical" href="https://mindroot.app/app/" />\n    <meta name="robots" content="noindex, follow" />')
swap('<meta property="og:url" content="https://mindroot.app/" />', '<meta property="og:url" content="https://mindroot.app/app/" />')
mkdirSync(at('app/'), { recursive: true })
writeFileSync(at('app/index.html'), app)

let site = readFileSync(at('site/index.html'), 'utf8')
if (/(src|href)="\.\.?\//.test(site)) fail('the landing page has a relative address. It would break at /.')
writeFileSync(at('index.html'), site)
rmSync(at('site/'), { recursive: true })

console.log('web-layout: / is the landing page, /app/ is the app')
