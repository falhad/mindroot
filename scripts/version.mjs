#!/usr/bin/env node
// Keeps the app version in one place. The version lives in three files:
//   package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml
//
//   node scripts/version.mjs            print the three versions
//   node scripts/version.mjs check v1.2.3   fail unless all three equal 1.2.3 (used by the release workflow)
//   node scripts/version.mjs set 1.2.3      write 1.2.3 into all three
import { readFileSync, writeFileSync } from 'node:fs'

const files = {
  'package.json': { read: (t) => JSON.parse(t).version, write: (t, v) => t.replace(/("version"\s*:\s*")[^"]+(")/, `$1${v}$2`) },
  'src-tauri/tauri.conf.json': { read: (t) => JSON.parse(t).version, write: (t, v) => t.replace(/("version"\s*:\s*")[^"]+(")/, `$1${v}$2`) },
  'src-tauri/Cargo.toml': {
    read: (t) => /^version\s*=\s*"([^"]+)"/m.exec(t)?.[1],
    write: (t, v) => t.replace(/^(version\s*=\s*")[^"]+(")/m, `$1${v}$2`),
  },
}
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

const current = () => Object.fromEntries(Object.entries(files).map(([f, h]) => [f, h.read(readFileSync(f, 'utf8'))]))
const [cmd, arg] = process.argv.slice(2)

if (!cmd) {
  console.table(current())
} else if (cmd === 'check') {
  const want = (arg ?? '').replace(/^v/, '')
  if (!SEMVER.test(want)) fail(`"${arg}" is not a version like v1.2.3`)
  const bad = Object.entries(current()).filter(([, v]) => v !== want)
  if (bad.length) fail(`Version mismatch. The tag says ${want}, but:\n${bad.map(([f, v]) => `  ${f} is ${v}`).join('\n')}\nRun: node scripts/version.mjs set ${want}`)
  console.log(`OK: all files are at ${want}`)
} else if (cmd === 'set') {
  const v = (arg ?? '').replace(/^v/, '')
  if (!SEMVER.test(v)) fail(`"${arg}" is not a version like 1.2.3`)
  for (const [f, h] of Object.entries(files)) writeFileSync(f, h.write(readFileSync(f, 'utf8'), v))
  console.log(`Set ${v} in ${Object.keys(files).join(', ')}.\nNext: cargo check --manifest-path src-tauri/Cargo.toml   (refreshes Cargo.lock)`)
} else fail('usage: version.mjs [check <tag> | set <version>]')

function fail(msg) {
  console.error(msg)
  process.exit(1)
}
