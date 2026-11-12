#!/usr/bin/env node
// Pack a plugin folder into plugins/dist/<id>-<version>.zip and add or update its entry in plugins/index.json.
//   node scripts/pack-plugin.mjs examples/plugins/word-count [--author "Name"]
// The zip is reproducible (fixed file times and order), so the SHA-256 in the index stays stable.
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { zipSync } from 'fflate'

const args = process.argv.slice(2)
const dir = args.find((a) => !a.startsWith('--'))
const authorAt = args.indexOf('--author')
const author = authorAt >= 0 ? args[authorAt + 1] : undefined
if (!dir) {
  console.error('Usage: node scripts/pack-plugin.mjs <plugin-folder> [--author "Name"]')
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(manifest.id ?? '')) throw new Error('manifest.json has no valid "id"')

const files = {}
const walk = (d) => {
  for (const name of readdirSync(d).sort()) {
    if (name.startsWith('.')) continue
    const p = join(d, name)
    if (statSync(p).isDirectory()) walk(p)
    else files[relative(dir, p).split('\\').join('/')] = [new Uint8Array(readFileSync(p)), { mtime: new Date(Date.UTC(2020, 0, 1)), level: 9 }]
  }
}
walk(dir)
const zip = zipSync(files)
const sha256 = createHash('sha256').update(zip).digest('hex')

mkdirSync('plugins/dist', { recursive: true })
const zipName = `${manifest.id}-${manifest.version}.zip`
writeFileSync(join('plugins/dist', zipName), zip)

const indexPath = 'plugins/index.json'
const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : { version: 1, plugins: [] }
const entry = {
  id: manifest.id,
  name: manifest.name,
  version: manifest.version,
  description: manifest.description ?? '',
  ...(author ? { author } : {}),
  permissions: manifest.permissions ?? [],
  url: `https://raw.githubusercontent.com/falhad/mindroot/main/plugins/dist/${zipName}`,
  sha256,
}
const at = index.plugins.findIndex((p) => p.id === manifest.id)
if (at >= 0) index.plugins[at] = { ...index.plugins[at], ...entry }
else index.plugins.push(entry)
writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n')
console.log(`${zipName}  ${zip.length} bytes  sha256 ${sha256}`)
