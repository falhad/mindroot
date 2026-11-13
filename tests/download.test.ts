import { describe, expect, it } from 'vitest'
import { detectArch, detectOs, downloads, installSteps, primaryDownload, releaseVersion } from '../src/core/download'

const UA = {
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  chromeOs: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
}

describe('detectOs', () => {
  it('knows the three desktop systems', () => {
    expect(detectOs({ platform: 'MacIntel', userAgent: UA.macSafari, maxTouchPoints: 0 })).toBe('mac')
    expect(detectOs({ platform: 'Win32', userAgent: UA.win })).toBe('windows')
    expect(detectOs({ platform: 'Linux x86_64', userAgent: UA.linux })).toBe('linux')
  })

  it('does not offer an installer to a phone or a tablet', () => {
    expect(detectOs({ platform: 'Linux armv81', userAgent: UA.android })).toBe('mobile')
    expect(detectOs({ platform: 'iPhone', userAgent: UA.iphone, maxTouchPoints: 5 })).toBe('mobile')
    // An iPad asks for the desktop site: it says it is a Mac, but it has a touch screen.
    expect(detectOs({ platform: 'MacIntel', userAgent: UA.macSafari, maxTouchPoints: 5 })).toBe('mobile')
    expect(detectOs({ uaMobile: true, uaPlatform: 'Android' })).toBe('mobile')
  })

  it('gives unknown for a system without an installer', () => {
    expect(detectOs({ platform: 'Linux x86_64', userAgent: UA.chromeOs })).toBe('unknown')
    expect(detectOs({})).toBe('unknown')
  })
})

describe('detectArch', () => {
  it('reads the processor from a Chromium browser', () => {
    expect(detectArch({ uaArch: 'arm' })).toBe('arm')
    expect(detectArch({ uaArch: 'x86' })).toBe('x64')
  })

  it('does not guess from a Mac user agent, which says Intel on all Macs', () => {
    expect(detectArch({ platform: 'MacIntel', userAgent: UA.macSafari })).toBe('unknown')
  })

  it('sees Linux on ARM', () => {
    expect(detectArch({ platform: 'Linux aarch64' })).toBe('arm')
  })
})

describe('downloads', () => {
  const list = downloads('0.3.0')

  it('uses the file names of the release', () => {
    expect(list.map((d) => d.file)).toEqual([
      'Mindroot_0.3.0_aarch64.dmg', 'Mindroot_0.3.0_x64.dmg', 'Mindroot_0.3.0_x64-setup.exe', 'Mindroot_0.3.0_x64_en-US.msi',
      'Mindroot_0.3.0_amd64.AppImage', 'Mindroot_0.3.0_amd64.deb', 'Mindroot-0.3.0-1.x86_64.rpm',
    ])
    expect(list[0].url).toBe('https://github.com/falhad/mindroot/releases/download/v0.3.0/Mindroot_0.3.0_aarch64.dmg')
  })

  it('offers the installer that fits the computer', () => {
    expect(primaryDownload(list, 'mac', 'arm')?.id).toBe('mac-arm')
    expect(primaryDownload(list, 'mac', 'x64')?.id).toBe('mac-intel')
    expect(primaryDownload(list, 'mac', 'unknown')?.id).toBe('mac-arm')
    expect(primaryDownload(list, 'windows', 'unknown')?.id).toBe('win-exe')
    expect(primaryDownload(list, 'windows', 'arm')?.id).toBe('win-exe')
    expect(primaryDownload(list, 'linux', 'x64')?.id).toBe('linux-appimage')
  })

  it('offers nothing when no installer fits', () => {
    expect(primaryDownload(list, 'linux', 'arm')).toBeNull()
    expect(primaryDownload(list, 'mobile', 'arm')).toBeNull()
    expect(primaryDownload(list, 'unknown', 'unknown')).toBeNull()
  })
})

describe('releaseVersion', () => {
  const assets = (version: string) => downloads(version).map((d) => ({ name: d.file }))

  it('reads the version of a published release', () => {
    expect(releaseVersion({ tag_name: 'v0.4.1', assets: [...assets('0.4.1'), { name: 'latest.json' }] })).toBe('0.4.1')
  })

  it('refuses a release that the page cannot link to', () => {
    expect(releaseVersion({ tag_name: 'v0.4.1', draft: true, assets: assets('0.4.1') })).toBeNull()
    expect(releaseVersion({ tag_name: 'v0.4.1', prerelease: true, assets: assets('0.4.1') })).toBeNull()
    expect(releaseVersion({ tag_name: 'nightly', assets: assets('0.4.1') })).toBeNull()
    expect(releaseVersion({ tag_name: 'v0.4.1', assets: assets('0.4.1').slice(1) })).toBeNull() // a build is missing
    expect(releaseVersion({ tag_name: 'v0.4.1' })).toBeNull()
    expect(releaseVersion({ message: 'API rate limit exceeded' })).toBeNull()
    expect(releaseVersion(null)).toBeNull()
    expect(releaseVersion('v0.4.1')).toBeNull()
  })
})

describe('installSteps', () => {
  it('tells how to pass the warning for an unsigned app on each system', () => {
    expect(installSteps('mac').some((s) => s.code === 'xattr -dr com.apple.quarantine /Applications/Mindroot.app')).toBe(true)
    expect(installSteps('mac').some((s) => s.text.includes('Open Anyway'))).toBe(true)
    expect(installSteps('windows').some((s) => s.text.includes('Run anyway'))).toBe(true)
    expect(installSteps('linux').some((s) => s.code?.startsWith('chmod +x'))).toBe(true)
  })
})
