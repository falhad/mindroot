/**
 * Map history from Git. Every sync is a commit, so the vault's Git log is the version history of each map.
 * Read-only: nothing here changes the repository. Restoring replaces the open map (one undo step) and the
 * next sync records the restore as a new commit.
 */
import type { GitOut } from './engine'

export interface Version {
  /** Full commit id (40 hex characters). */
  sha: string
  author: string
  /** Commit time in milliseconds. */
  at: number
  subject: string
}

type GitFn = (args: string[]) => Promise<GitOut>

const MAP_ID = /^[A-Za-z0-9_-]{1,64}$/
const SHA = /^[0-9a-f]{40}$/
const FIELD = '\u001f'

const mapPath = (mapId: string) => {
  if (!MAP_ID.test(mapId)) throw new Error('Not a map id')
  return `maps/${mapId}.jsonl`
}

/** The commits that changed this map's file, newest first (up to 200). Empty when the vault has no history yet. */
export async function listVersions(git: GitFn, mapId: string): Promise<Version[]> {
  const out = await git(['log', '--format=%H%x1f%an%x1f%at%x1f%s', '-n', '200', '--', mapPath(mapId)])
  if (out.code !== 0) {
    // a fresh repository has no commits: that is "no history", not an error
    if (/does not have any commits|bad default revision|unknown revision/i.test(out.stderr)) return []
    throw new Error(out.stderr.trim() || 'Could not read the history')
  }
  const versions: Version[] = []
  for (const line of out.stdout.split('\n')) {
    const [sha, author, at, ...rest] = line.split(FIELD)
    if (!sha || !SHA.test(sha)) continue
    versions.push({ sha, author: author ?? '', at: Number(at) * 1000 || 0, subject: rest.join(FIELD) })
  }
  return versions
}

/** The text of the map file as it was in that commit. */
export async function loadVersionText(git: GitFn, mapId: string, sha: string): Promise<string> {
  if (!SHA.test(sha)) throw new Error('Not a commit id')
  const out = await git(['show', `${sha}:${mapPath(mapId)}`])
  if (out.code !== 0) throw new Error(out.stderr.trim() || 'That version could not be read')
  return out.stdout
}
