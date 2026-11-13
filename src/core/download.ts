// The installers of the desktop app: which one fits the visitor's computer, where it is, and how to install it.
// Pure: the browser facts come in as `PlatformHints`, so a test can give any computer.

export type Os = 'mac' | 'windows' | 'linux' | 'mobile' | 'unknown'
export type Arch = 'arm' | 'x64' | 'unknown'
/** The systems that have an installer. */
export type DesktopOs = 'mac' | 'windows' | 'linux'

export interface PlatformHints {
  /** `navigator.platform`. */
  platform?: string
  /** `navigator.userAgent`. */
  userAgent?: string
  /** `navigator.maxTouchPoints`. An iPad says it is a Mac; a Mac has no touch screen. */
  maxTouchPoints?: number
  /** `navigator.userAgentData.platform` (Chromium browsers only). */
  uaPlatform?: string
  /** `architecture` from `navigator.userAgentData.getHighEntropyValues` (Chromium browsers only). */
  uaArch?: string
  /** `navigator.userAgentData.mobile`. */
  uaMobile?: boolean
}

export function detectOs(h: PlatformHints): Os {
  const ua = h.userAgent ?? ''
  const p = `${h.uaPlatform ?? ''} ${h.platform ?? ''}`
  if (h.uaMobile || /Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return 'mobile'
  if (/Mac/i.test(p) || /Macintosh/i.test(ua)) return (h.maxTouchPoints ?? 0) > 1 ? 'mobile' : 'mac'
  if (/Win/i.test(p) || /Windows/i.test(ua)) return 'windows'
  if (/CrOS/i.test(ua) || /Chrom(e|ium) ?OS/i.test(p)) return 'unknown'
  if (/Linux|X11/i.test(p) || /Linux|X11/i.test(ua)) return 'linux'
  return 'unknown'
}

/** Only Chromium browsers tell the processor type. Safari and Firefox give `unknown`. */
export function detectArch(h: PlatformHints): Arch {
  const a = (h.uaArch ?? '').toLowerCase()
  if (a === 'arm') return 'arm'
  if (a === 'x86') return 'x64'
  if (/aarch64|arm64/i.test(`${h.platform ?? ''} ${h.userAgent ?? ''}`)) return 'arm'
  return 'unknown'
}

export interface Download {
  id: string
  os: DesktopOs
  /** For example `Apple Silicon`. */
  label: string
  /** One line that helps the user choose. */
  detail: string
  file: string
  url: string
}

export const REPO_URL = 'https://github.com/falhad/mindroot'
export const RELEASES_URL = `${REPO_URL}/releases/latest`
/** Answers with the newest published release. It allows requests from a web page. */
export const LATEST_RELEASE_API = 'https://api.github.com/repos/falhad/mindroot/releases/latest'

const VERSION = /^\d+\.\d+\.\d+$/

export function downloads(version: string): Download[] {
  const d = (id: string, os: DesktopOs, label: string, detail: string, file: string): Download =>
    ({ id, os, label, detail, file, url: `${REPO_URL}/releases/download/v${version}/${file}` })
  return [
    d('mac-arm', 'mac', 'Apple Silicon', 'Macs from 2020 and later (M1, M2, M3, M4 …)', `Mindroot_${version}_aarch64.dmg`),
    d('mac-intel', 'mac', 'Intel', 'Macs with an Intel processor', `Mindroot_${version}_x64.dmg`),
    d('win-exe', 'windows', 'Installer (.exe)', 'The usual choice', `Mindroot_${version}_x64-setup.exe`),
    d('win-msi', 'windows', 'MSI package', 'For managed computers', `Mindroot_${version}_x64_en-US.msi`),
    d('linux-appimage', 'linux', 'AppImage', 'Runs on most distributions, no install', `Mindroot_${version}_amd64.AppImage`),
    d('linux-deb', 'linux', '.deb', 'Debian, Ubuntu, Mint', `Mindroot_${version}_amd64.deb`),
    d('linux-rpm', 'linux', '.rpm', 'Fedora, openSUSE', `Mindroot-${version}-1.x86_64.rpm`),
  ]
}

/**
 * The installer to offer first. Null when there is none for this computer (a phone, an unknown system,
 * Linux on ARM). A Mac with an unknown processor gets Apple Silicon: all Macs sold since 2020 have it.
 */
export function primaryDownload(list: Download[], os: Os, arch: Arch): Download | null {
  const id = os === 'mac' ? (arch === 'x64' ? 'mac-intel' : 'mac-arm')
    : os === 'windows' ? 'win-exe'
    : os === 'linux' && arch !== 'arm' ? 'linux-appimage'
    : null
  return list.find((x) => x.id === id) ?? null
}

/**
 * The version of the newest release, from the answer of `LATEST_RELEASE_API`. Null when the answer is not a
 * usable release: a draft, a pre-release, a tag that is not `v1.2.3`, or a release without the installers.
 */
export function releaseVersion(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null
  const r = json as { tag_name?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown }
  if (r.draft === true || r.prerelease === true || typeof r.tag_name !== 'string') return null
  const version = r.tag_name.replace(/^v/, '')
  if (!VERSION.test(version) || !Array.isArray(r.assets)) return null
  const names = new Set(r.assets.map((a) => (a && typeof a === 'object' ? (a as { name?: unknown }).name : null)))
  return downloads(version).every((d) => names.has(d.file)) ? version : null
}

export interface InstallStep {
  text: string
  /** A command to copy into a terminal. */
  code?: string
}

export const OS_NAMES: Record<DesktopOs, string> = { mac: 'macOS', windows: 'Windows', linux: 'Linux' }

/** The installers are not code-signed, so each system shows a warning the first time. The steps say what to do. */
export function installSteps(os: DesktopOs): InstallStep[] {
  if (os === 'mac') return [
    { text: 'Open the downloaded .dmg file and drag Mindroot to the Applications folder.' },
    { text: 'Open Mindroot from Applications. macOS shows a warning, because the app is not signed by Apple yet. Close the warning.' },
    { text: 'Open System Settings → Privacy & Security, scroll down, and click "Open Anyway" beside Mindroot. You do this one time only.' },
    { text: 'If macOS says the app is damaged, or you prefer the terminal, run this command and open the app again:', code: 'xattr -dr com.apple.quarantine /Applications/Mindroot.app' },
  ]
  if (os === 'windows') return [
    { text: 'Open the downloaded file.' },
    { text: 'Windows shows "Windows protected your PC", because the installer is not signed yet. Click "More info", then "Run anyway".' },
    { text: 'Follow the installer. Mindroot is then in the Start menu.' },
  ]
  return [
    { text: 'AppImage: make the file executable, then run it.', code: 'chmod +x Mindroot_*.AppImage && ./Mindroot_*.AppImage' },
    { text: 'Debian, Ubuntu, Mint: install the .deb file.', code: 'sudo apt install ./Mindroot_*.deb' },
    { text: 'Fedora, openSUSE: install the .rpm file.', code: 'sudo rpm -i Mindroot-*.rpm' },
  ]
}
