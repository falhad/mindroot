/**
 * Git sync for the vault folder.
 *
 * One `syncOnce` run: commit local changes -> fetch -> integrate remote changes (merging map
 * files with `mergeMapTexts` when Git itself cannot) -> push. It repeats the fetch/merge/push
 * a few times if somebody else pushes in between.
 *
 * It never decides anything about files except through Git and the merge, and it never drops
 * work: if a map file cannot be merged, the other side is kept as a "conflict copy" map.
 */
import { parseDocText, serializeDoc } from '../core/format'
import { uid } from '../core/ids'
import { sanitizeDoc } from '../core/outline'
import { mergeMapTexts } from './merge'

export interface GitOut {
  code: number
  stdout: string
  stderr: string
}

export interface SyncDeps {
  git(args: string[]): Promise<GitOut>
  /** Write a map file into the vault (`maps/<id>.jsonl`). */
  writeMap(id: string, text: string): Promise<void>
  device: string
  now?(): Date
  /** Called before the working tree is changed; the returned function resumes autosave. */
  pauseSaves?(): () => void
}

export interface SyncConfig {
  branch: string
}

export interface SyncResult {
  ok: boolean
  error?: string
  /** Local edits were committed. */
  committed: boolean
  /** Remote changes were brought in. */
  pulled: boolean
  pushed: boolean
  /** Map files that Git could not merge alone and the map merge combined. */
  merged: number
  /** Fields both sides changed; the newer edit won. */
  conflicts: number
  rescued: number
  /** Maps saved as "(conflict copy)" because they could not be merged. */
  copies: number
  /** Ids of maps whose files changed because of this sync. */
  changedMapIds: string[]
}

const blank = (): SyncResult => ({ ok: true, committed: false, pulled: false, pushed: false, merged: 0, conflicts: 0, rescued: 0, copies: 0, changedMapIds: [] })

class GitError extends Error {
  constructor(public args: string[], public out: GitOut) {
    super(describeGitError(out.stderr || out.stdout, args))
  }
}

/** Turn Git's raw message into something a person can act on. */
export function describeGitError(msg: string, args: string[] = []): string {
  const m = msg.trim()
  if (/could not resolve host|network is unreachable|timed out|connection (refused|reset|closed)|unable to access|operation timed out|no route to host/i.test(m))
    return 'Cannot reach GitHub. Check your internet connection.'
  if (/permission denied \(publickey\)|authentication failed|could not read (username|password)|terminal prompts disabled|invalid username or password|403/i.test(m))
    return 'GitHub did not accept the login. Make sure SSH keys, or `gh auth setup-git`, work for this repository.'
  if (/repository not found|does not appear to be a git repository|not found/i.test(m))
    return 'Repository not found. Check the address and that your account can access it.'
  if (/refusing to merge unrelated histories/i.test(m)) return 'The two copies have no common history.'
  const first = m.split('\n').find((l) => l.trim()) ?? 'unknown error'
  return `git ${args[0] ?? ''} failed: ${first}`.trim()
}

const MAP_PATH = /^maps\/([A-Za-z0-9_-]{1,64})\.jsonl?$/

export function mapIdOf(path: string): string | null {
  return MAP_PATH.exec(path)?.[1] ?? null
}

export async function connectRemote(deps: SyncDeps, url: string): Promise<void> {
  const cur = await deps.git(['remote', 'get-url', 'origin'])
  const r = await deps.git(cur.code === 0 ? ['remote', 'set-url', 'origin', url] : ['remote', 'add', 'origin', url])
  if (r.code !== 0) throw new GitError(['remote'], r)
}

export async function syncOnce(deps: SyncDeps, cfg: SyncConfig): Promise<SyncResult> {
  const res = blank()
  const branch = cfg.branch
  const remoteRef = `origin/${branch}`
  const must = async (args: string[]) => {
    const o = await deps.git(args)
    if (o.code !== 0) throw new GitError(args, o)
    return o
  }
  const ok = async (args: string[]) => (await deps.git(args)).code === 0
  const changed = new Set<string>()

  try {
    // 0. A device with no commits yet adopts the remote history first, so a new device does not
    //    start an unrelated history of its own. (Local files stay; they are committed on top.)
    if (!(await ok(['rev-parse', '--verify', '--quiet', 'HEAD'])) && (await deps.git(['fetch', 'origin'])).code === 0) {
      if (await ok(['rev-parse', '--verify', '--quiet', remoteRef])) {
        const resumeBoot = deps.pauseSaves?.()
        try {
          await must(['checkout', '-f', '-B', branch, remoteRef])
        } finally {
          resumeBoot?.()
        }
        res.pulled = true
        for (const f of (await must(['ls-files'])).stdout.split('\n')) {
          const id = mapIdOf(f.trim())
          if (id) changed.add(id)
        }
      }
    }

    // 1. commit what is on disk
    const resume = deps.pauseSaves?.()
    try {
      const status = await must(['status', '--porcelain'])
      if (status.stdout.trim()) {
        await must(['add', '-A'])
        const stamp = (deps.now?.() ?? new Date()).toISOString()
        await must(['commit', '-m', `Sync from ${deps.device} at ${stamp}`])
        res.committed = true
      }
    } finally {
      resume?.()
    }

    for (let attempt = 0; attempt < 4; attempt++) {
      // 2. fetch
      await must(['fetch', 'origin'])
      const remoteExists = await ok(['rev-parse', '--verify', '--quiet', remoteRef])
      if (!remoteExists) {
        // empty remote (first ever push)
        if (await ok(['rev-parse', '--verify', '--quiet', 'HEAD'])) {
          await must(['push', '-u', 'origin', `HEAD:refs/heads/${branch}`])
          res.pushed = true
        }
        break
      }

      // 3. bring remote changes in
      const hasHead = await ok(['rev-parse', '--verify', '--quiet', 'HEAD'])
      if (!hasHead) {
        await must(['checkout', '-B', branch, remoteRef])
        res.pulled = true
        for (const f of (await must(['ls-files'])).stdout.split('\n')) {
          const id = mapIdOf(f.trim())
          if (id) changed.add(id)
        }
        break
      }
      const [ahead, behind] = (await must(['rev-list', '--left-right', '--count', `HEAD...${remoteRef}`])).stdout.trim().split(/\s+/).map(Number)
      if (behind > 0) {
        await integrate(deps, res, changed, remoteRef)
        res.pulled = true
      }

      // 4. push
      const aheadNow = behind > 0 ? Number((await must(['rev-list', '--count', `${remoteRef}..HEAD`])).stdout.trim()) : ahead
      if (aheadNow === 0) break
      const push = await deps.git(['push', 'origin', `HEAD:refs/heads/${branch}`])
      if (push.code === 0) {
        res.pushed = true
        break
      }
      const rejected = /rejected|non-fast-forward|fetch first|failed to push some refs/i.test(push.stderr) && !/permission|denied|authentication/i.test(push.stderr)
      if (!rejected || attempt === 3) throw new GitError(['push'], push)
      // somebody pushed in the meantime: go around again
    }
  } catch (e) {
    res.ok = false
    res.error = e instanceof Error ? e.message : String(e)
  }
  res.changedMapIds = [...changed]
  return res
}

async function integrate(deps: SyncDeps, res: SyncResult, changed: Set<string>, remoteRef: string) {
  const must = async (args: string[]) => {
    const o = await deps.git(args)
    if (o.code !== 0) throw new GitError(args, o)
    return o
  }
  const names = (await must(['diff', '--name-only', 'HEAD', remoteRef])).stdout.split('\n')
  for (const n of names) {
    const id = mapIdOf(n.trim())
    if (id) changed.add(id)
  }

  const resume = deps.pauseSaves?.()
  try {
    const unrelated = (await deps.git(['merge-base', 'HEAD', remoteRef])).code !== 0
    const merge = await deps.git(['merge', remoteRef, '--no-edit', '-m', `Sync: merge ${remoteRef} into ${deps.device}`, ...(unrelated ? ['--allow-unrelated-histories'] : [])])
    if (merge.code === 0) return

    const conflicted = (await must(['diff', '--name-only', '--diff-filter=U'])).stdout.split('\n').map((s) => s.trim()).filter(Boolean)
    if (!conflicted.length) throw new GitError(['merge'], merge)
    try {
      for (const path of conflicted) await resolveConflict(deps, res, changed, path)
      await must(['add', '-A'])
      await must(['commit', '--no-edit'])
    } catch (e) {
      await deps.git(['merge', '--abort'])
      throw e
    }
  } finally {
    resume?.()
  }
}

async function resolveConflict(deps: SyncDeps, res: SyncResult, changed: Set<string>, path: string) {
  const stage = async (n: 1 | 2 | 3) => {
    const o = await deps.git(['show', `:${n}:${path}`])
    return o.code === 0 ? o.stdout : null
  }
  const id = mapIdOf(path)
  if (!id || !path.endsWith('.jsonl')) {
    // not a map file we understand: keep our version
    if ((await deps.git(['checkout', '--ours', '--', path])).code !== 0) await deps.git(['rm', '-q', '--', path])
    await deps.git(['add', '-A', '--', path])
    return
  }
  const [base, ours, theirs] = await Promise.all([stage(1), stage(2), stage(3)])
  if (ours && theirs) {
    const oursOk = parses(ours)
    const theirsOk = parses(theirs)
    if (oursOk && theirsOk) {
      try {
        const m = mergeMapTexts(base, ours, theirs)
        await deps.writeMap(id, m.text)
        res.merged++
        res.conflicts += m.conflicts
        res.rescued += m.rescued
      } catch {
        // both files are fine but the merge failed: keep ours, save theirs as a separate map
        await deps.writeMap(id, ours)
        const copyId = await saveConflictCopy(deps, theirs)
        if (copyId) {
          changed.add(copyId)
          res.copies++
          await deps.git(['add', '-A', '--', `maps/${copyId}.jsonl`])
        }
      }
    } else if (theirsOk || oursOk) {
      // one side is damaged: keep the readable one (the damaged one stays in Git history)
      await deps.writeMap(id, (theirsOk ? theirs : ours)!)
      res.conflicts++
    } else {
      await deps.git(['checkout', '--ours', '--', path])
      await deps.git(['add', '-A', '--', path])
      return
    }
  } else {
    // one side deleted it, the other changed it: keep the changed one
    await deps.writeMap(id, (ours ?? theirs)!)
  }
  changed.add(id)
  await deps.git(['add', '-A', '--', path.replace(/\.json$/, '.jsonl')])
}

function parses(text: string): boolean {
  try {
    sanitizeDoc(parseDocText(text))
    return true
  } catch {
    return false
  }
}

async function saveConflictCopy(deps: SyncDeps, text: string): Promise<string | null> {
  try {
    const doc = sanitizeDoc(parseDocText(text))
    const id = uid(12)
    doc.meta = { ...doc.meta, id, starred: false }
    doc.nodes[doc.root].text = `${doc.nodes[doc.root].text} (conflict copy)`
    doc.meta.title = doc.nodes[doc.root].text
    await deps.writeMap(id, serializeDoc(doc, () => undefined))
    return id
  } catch {
    return null
  }
}
