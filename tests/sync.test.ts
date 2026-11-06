// @vitest-environment node
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { produce } from 'immer'
import { parseDocText, serializeDoc } from '../src/core/format'
import { docFromOutline, parseOutline, sanitizeDoc } from '../src/core/outline'
import * as T from '../src/core/tree'
import type { MapDoc } from '../src/core/types'
import { connectRemote, describeGitError, syncOnce, type SyncDeps, type SyncResult } from '../src/sync/engine'

const run = promisify(execFile)
const ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }

let root: string
let remote: string

// Every git call the engine makes is recorded (with ids/messages/addresses normalised) and written to
// src-tauri/tests/fixtures/git-calls.json. The Rust test `git_contract` replays them through the real
// argument validator, so the TypeScript engine and the Rust allow-list cannot drift apart unnoticed.
const recorded = new Set<string>()
function record(args: string[]) {
  const a = args.map((x, i) => {
    if (args[i - 1] === '-m') return 'message'
    if (args[0] === 'remote' && i === args.length - 1 && /^(add|set-url)$/.test(args[1])) return 'git@github.com:you/vault.git'
    return x.replace(/maps\/[A-Za-z0-9_-]+\.jsonl?/g, 'maps/ID.jsonl')
  })
  recorded.add(JSON.stringify(a))
}

async function git(cwd: string, args: string[]) {
  try {
    const { stdout, stderr } = await run('git', args, { cwd, env: ENV })
    return { code: 0, stdout, stderr }
  } catch (e: any) {
    return { code: typeof e.code === 'number' ? e.code : 1, stdout: e.stdout ?? '', stderr: e.stderr ?? String(e) }
  }
}

class Device {
  vault: string
  paused = 0
  constructor(public name: string) {
    this.vault = join(root, name)
    mkdirSync(join(this.vault, 'maps'), { recursive: true })
  }
  async init(url = remote) {
    await git(this.vault, ['init', '-b', 'main'])
    await git(this.vault, ['config', 'user.name', this.name])
    await git(this.vault, ['config', 'user.email', `${this.name}@test`])
    writeFileSync(join(this.vault, '.gitignore'), '*.tmp\n')
    await connectRemote(this.deps(), url)
  }
  deps(hook?: (args: string[]) => Promise<void>): SyncDeps {
    return {
      device: this.name,
      git: async (args) => {
        await hook?.(args)
        record(args)
        return git(this.vault, args)
      },
      writeMap: async (id, text) => void writeFileSync(join(this.vault, 'maps', `${id}.jsonl`), text),
      pauseSaves: () => {
        this.paused++
        return () => void this.paused--
      },
    }
  }
  sync(hook?: (args: string[]) => Promise<void>): Promise<SyncResult> {
    return syncOnce(this.deps(hook), { branch: 'main' })
  }
  save(doc: MapDoc) {
    writeFileSync(join(this.vault, 'maps', `${doc.meta.id}.jsonl`), serializeDoc(doc, () => undefined))
  }
  load(id: string): MapDoc {
    return sanitizeDoc(parseDocText(readFileSync(join(this.vault, 'maps', `${id}.jsonl`), 'utf8')))
  }
  has(id: string) {
    return existsSync(join(this.vault, 'maps', `${id}.jsonl`))
  }
  maps() {
    return readdirSync(join(this.vault, 'maps')).filter((f) => f.endsWith('.jsonl'))
  }
}

const newMap = (outline: string, at = 1000): MapDoc => {
  const d = docFromOutline(parseOutline(outline))
  d.meta.updatedAt = at
  return d
}
const nid = (d: MapDoc, t: string) => Object.values(d.nodes).find((n) => n.text === t)!.id
const edit = (d: MapDoc, at: number, fn: (x: MapDoc) => void) => produce(d, (x) => { fn(x); x.meta.updatedAt = at })

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'bm-sync-'))
})
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  const file = fileURLToPath(new URL('../src-tauri/tests/fixtures/git-calls.json', import.meta.url))
  mkdirSync(fileURLToPath(new URL('../src-tauri/tests/fixtures/', import.meta.url)), { recursive: true })
  writeFileSync(file, JSON.stringify([...recorded].sort().map((l) => JSON.parse(l)), null, 1) + '\n')
})

async function freshRemote(name: string) {
  remote = join(root, `${name}.git`)
  await git(root, ['init', '--bare', '-b', 'main', remote])
}

describe('git sync (real git, bare remote, two devices)', () => {
  it('first sync pushes; a second device receives the map', async () => {
    await freshRemote('r1')
    const a = new Device('a1')
    await a.init()
    const doc = newMap('# Trip\n- Route\n- Packing')
    a.save(doc)
    const r1 = await a.sync()
    expect(r1).toMatchObject({ ok: true, committed: true, pushed: true })

    const b = new Device('b1')
    await b.init()
    const r2 = await b.sync()
    expect(r2).toMatchObject({ ok: true, pulled: true, pushed: false })
    expect(r2.changedMapIds).toEqual([doc.meta.id])
    expect(b.load(doc.meta.id).nodes).toEqual(doc.nodes)

    const idle = await b.sync()
    expect(idle).toMatchObject({ ok: true, committed: false, pulled: false, pushed: false })
  })

  it('edits to different nodes on two devices merge cleanly in both directions', async () => {
    await freshRemote('r2')
    const a = new Device('a2'), b = new Device('b2')
    await a.init(); await b.init()
    const base = newMap('# Plan\n- Goals\n- Risks\n- Team')
    a.save(base)
    await a.sync(); await b.sync()

    a.save(edit(a.load(base.meta.id), 2000, (x) => void (x.nodes[nid(x, 'Goals')].text = 'Goals v2')))
    b.save(edit(b.load(base.meta.id), 3000, (x) => void T.addChild(x, nid(x, 'Risks'), 'Scope creep')))
    expect((await a.sync()).pushed).toBe(true)
    const rb = await b.sync()
    expect(rb).toMatchObject({ ok: true, merged: 1, conflicts: 0, pushed: true })
    expect(rb.changedMapIds).toEqual([base.meta.id])

    const merged = b.load(base.meta.id)
    expect(merged.nodes[nid(base, 'Goals')].text).toBe('Goals v2')
    expect(Object.values(merged.nodes).some((n) => n.text === 'Scope creep')).toBe(true)

    const ra = await a.sync()
    expect(ra).toMatchObject({ ok: true, pulled: true })
    expect(a.load(base.meta.id).nodes).toEqual(merged.nodes)
    // devices have converged
    expect((await a.sync()).pushed).toBe(false)
    expect((await b.sync()).pulled).toBe(false)
  })

  it('both devices add a child to the same node: both are kept', async () => {
    await freshRemote('r3')
    const a = new Device('a3'), b = new Device('b3')
    await a.init(); await b.init()
    const base = newMap('# Ideas\n- Inbox')
    a.save(base); await a.sync(); await b.sync()
    a.save(edit(a.load(base.meta.id), 2000, (x) => void T.addChild(x, nid(x, 'Inbox'), 'from A')))
    b.save(edit(b.load(base.meta.id), 3000, (x) => void T.addChild(x, nid(x, 'Inbox'), 'from B')))
    await a.sync()
    const r = await b.sync()
    expect(r.ok && r.conflicts === 0).toBe(true)
    const d = b.load(base.meta.id)
    expect(d.nodes[nid(d, 'Inbox')].children.map((c) => d.nodes[c].text).sort()).toEqual(['from A', 'from B'])
  })

  it('the same node edited on both: the newer edit wins and it is reported', async () => {
    await freshRemote('r4')
    const a = new Device('a4'), b = new Device('b4')
    await a.init(); await b.init()
    const base = newMap('# Doc\n- Title idea')
    a.save(base); await a.sync(); await b.sync()
    a.save(edit(a.load(base.meta.id), 2000, (x) => void (x.nodes[nid(x, 'Title idea')].text = 'older text')))
    b.save(edit(b.load(base.meta.id), 3000, (x) => void (x.nodes[nid(x, 'Title idea')].text = 'newer text')))
    await a.sync()
    const r = await b.sync()
    expect(r).toMatchObject({ ok: true, merged: 1, conflicts: 1 })
    expect(b.load(base.meta.id).nodes[nid(base, 'Title idea')].text).toBe('newer text')
    await a.sync()
    expect(a.load(base.meta.id).nodes[nid(base, 'Title idea')].text).toBe('newer text')
  })

  it('retries when the remote moves between fetch and push', async () => {
    await freshRemote('r5')
    const a = new Device('a5'), b = new Device('b5'), c = new Device('c5')
    await a.init(); await b.init(); await c.init()
    const base = newMap('# Race\n- One')
    a.save(base); await a.sync(); await b.sync(); await c.sync()

    a.save(edit(a.load(base.meta.id), 2000, (x) => void T.addChild(x, nid(x, 'One'), 'from a')))
    c.save(edit(c.load(base.meta.id), 2500, (x) => void T.addChild(x, nid(x, 'One'), 'from c')))
    let raced = false
    const r = await a.sync(async (args) => {
      // right before A's first push, C pushes
      if (args[0] === 'push' && !raced) {
        raced = true
        expect((await c.sync()).pushed).toBe(true)
      }
    })
    expect(raced).toBe(true)
    expect(r).toMatchObject({ ok: true, pushed: true, pulled: true })
    const d = a.load(base.meta.id)
    expect(d.nodes[nid(d, 'One')].children.map((x) => d.nodes[x].text).sort()).toEqual(['from a', 'from c'])
    await b.sync()
    expect(b.load(base.meta.id).nodes).toEqual(d.nodes)
  })

  it('two devices that each already have different maps end up with all of them', async () => {
    await freshRemote('r6')
    const a = new Device('a6'), b = new Device('b6')
    await a.init(); await b.init()
    const m1 = newMap('# From A'), m2 = newMap('# From B')
    a.save(m1); b.save(m2)
    await a.sync()
    const r = await b.sync() // unrelated histories
    expect(r).toMatchObject({ ok: true, pulled: true, pushed: true })
    await a.sync()
    expect(a.maps().sort()).toEqual([`${m1.meta.id}.jsonl`, `${m2.meta.id}.jsonl`].sort())
    expect(b.maps().sort()).toEqual(a.maps().sort())
  })

  it('a map deleted on one device and edited on the other keeps the edit', async () => {
    await freshRemote('r7')
    const a = new Device('a7'), b = new Device('b7')
    await a.init(); await b.init()
    const base = newMap('# Keep me\n- x')
    a.save(base); await a.sync(); await b.sync()
    rmSync(join(a.vault, 'maps', `${base.meta.id}.jsonl`))
    b.save(edit(b.load(base.meta.id), 3000, (x) => void T.addChild(x, x.root, 'edited on b')))
    await a.sync()
    const r = await b.sync()
    expect(r.ok).toBe(true)
    expect(Object.values(b.load(base.meta.id).nodes).some((n) => n.text === 'edited on b')).toBe(true)
    await a.sync()
    expect(a.has(base.meta.id)).toBe(true)
  })

  it('a map deleted on one device and untouched on the other is deleted everywhere', async () => {
    await freshRemote('r8')
    const a = new Device('a8'), b = new Device('b8')
    await a.init(); await b.init()
    const base = newMap('# Gone')
    a.save(base); await a.sync(); await b.sync()
    rmSync(join(a.vault, 'maps', `${base.meta.id}.jsonl`))
    await a.sync()
    const r = await b.sync()
    expect(r.ok).toBe(true)
    expect(b.has(base.meta.id)).toBe(false)
  })

  it('a damaged local file loses to the readable remote one, and sync still succeeds', async () => {
    await freshRemote('r9')
    const a = new Device('a9'), b = new Device('b9')
    await a.init(); await b.init()
    const base = newMap('# Fragile\n- a')
    a.save(base); await a.sync(); await b.sync()
    a.save(edit(a.load(base.meta.id), 2000, (x) => void (x.nodes[nid(x, 'a')].text = 'a edited')))
    await a.sync()
    // damage the very line A edited, so Git cannot merge it and the resolver must choose
    const file = join(b.vault, 'maps', `${base.meta.id}.jsonl`)
    writeFileSync(file, readFileSync(file, 'utf8').split('\n').map((l) => (l.includes('"text":"a"') ? '{ broken' : l)).join('\n'))
    const r = await b.sync()
    expect(r.ok).toBe(true)
    expect(b.load(base.meta.id).nodes[nid(base, 'a')].text).toBe('a edited')
  })

  it('a damaged remote file does not overwrite a readable local edit', async () => {
    await freshRemote('r9b')
    const a = new Device('a9b'), b = new Device('b9b')
    await a.init(); await b.init()
    const base = newMap('# Fragile\n- a')
    a.save(base); await a.sync(); await b.sync()
    const file = join(a.vault, 'maps', `${base.meta.id}.jsonl`)
    writeFileSync(file, readFileSync(file, 'utf8').split('\n').map((l) => (l.includes('"text":"a"') ? '{ broken' : l)).join('\n'))
    await a.sync()
    b.save(edit(b.load(base.meta.id), 3000, (x) => void (x.nodes[nid(x, 'a')].text = 'b edited')))
    const r = await b.sync()
    expect(r.ok).toBe(true)
    expect(b.load(base.meta.id).nodes[nid(base, 'a')].text).toBe('b edited')
  })

  it('reports an unreachable remote in plain words and leaves local data alone', async () => {
    await freshRemote('r10')
    const a = new Device('a10')
    await a.init(join(root, 'does-not-exist.git'))
    const d = newMap('# Offline')
    a.save(d)
    const r = await a.sync()
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/not found|reach/i)
    expect(r.committed).toBe(true) // local commit still happened, so nothing is lost
    expect(a.has(d.meta.id)).toBe(true)
  })

  it('pauses autosave only while the working tree changes, and always resumes', async () => {
    await freshRemote('r11')
    const a = new Device('a11')
    await a.init()
    a.save(newMap('# Pause'))
    await a.sync()
    expect(a.paused).toBe(0)
    const bad = new Device('a11b')
    await bad.init(join(root, 'nope.git'))
    bad.save(newMap('# x'))
    await bad.sync()
    expect(bad.paused).toBe(0)
  })
})

describe('error messages', () => {
  it.each([
    ['fatal: Could not resolve host: github.com', /internet/],
    ['git@github.com: Permission denied (publickey).', /login/],
    ['remote: Repository not found.', /not found/i],
    ['fatal: could not read Username for https://github.com: terminal prompts disabled', /login/],
    ['something odd happened', /git push failed: something odd/],
  ])('%s', (raw, re) => {
    expect(describeGitError(raw, ['push'])).toMatch(re)
  })
})
