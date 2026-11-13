import { detectArch, detectOs, LATEST_RELEASE_API, releaseVersion, type Arch, type Os, type PlatformHints } from '../core/download'

declare const __APP_VERSION__: string
/** The version of this build (from package.json). */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

const CACHE_KEY = 'mr.release'

/**
 * The version of the newest published release. The web version can be newer or older than the last release,
 * so the page asks GitHub. If GitHub does not answer in time (offline, rate limit), the version of this build is used.
 * The answer is kept for the browser tab, so the page asks one time only.
 */
export async function latestReleaseVersion(timeoutMs = 4000): Promise<string> {
  try {
    const cached = sessionStorage.getItem(CACHE_KEY)
    if (cached) return cached
  } catch { /* storage is blocked: ask each time */ }
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), timeoutMs)
  try {
    const res = await fetch(LATEST_RELEASE_API, { signal: stop.signal, headers: { Accept: 'application/vnd.github+json' } })
    const version = res.ok ? releaseVersion(await res.json()) : null
    if (!version) return APP_VERSION
    try { sessionStorage.setItem(CACHE_KEY, version) } catch { /* not kept */ }
    return version
  } catch {
    return APP_VERSION
  } finally {
    clearTimeout(timer)
  }
}

interface UaData {
  platform?: string
  mobile?: boolean
  getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>
}

function hints(): PlatformHints {
  if (typeof navigator === 'undefined') return {}
  const ua = (navigator as Navigator & { userAgentData?: UaData }).userAgentData
  return { platform: navigator.platform, userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints, uaPlatform: ua?.platform, uaMobile: ua?.mobile }
}

/** The system of this computer, known at once. */
export const visitorOs: Os = detectOs(hints())

/** The processor type. Only Chromium browsers tell it, and only when asked. */
export async function visitorArch(): Promise<Arch> {
  const h = hints()
  try {
    const ua = (navigator as Navigator & { userAgentData?: UaData }).userAgentData
    const more = await ua?.getHighEntropyValues?.(['architecture'])
    if (more?.architecture) h.uaArch = more.architecture
  } catch { /* the browser refused: unknown */ }
  return detectArch(h)
}
