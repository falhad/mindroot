import { expect, test, type Page } from '@playwright/test'
import { openApp, shoot } from './helpers'

const FILES = (v: string) => [
  `Mindroot_${v}_aarch64.dmg`, `Mindroot_${v}_x64.dmg`, `Mindroot_${v}_x64-setup.exe`, `Mindroot_${v}_x64_en-US.msi`,
  `Mindroot_${v}_amd64.AppImage`, `Mindroot_${v}_amd64.deb`, `Mindroot-${v}-1.x86_64.rpm`,
]

interface Computer { platform: string; userAgent: string; touch?: number; arch?: string; mobile?: boolean }

const MAC: Computer = { platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', arch: 'arm' }
const MAC_INTEL: Computer = { ...MAC, arch: 'x86' }
const WINDOWS: Computer = { platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', arch: 'x86' }
const LINUX: Computer = { platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0' }
const PHONE: Computer = { platform: 'Linux armv81', userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36', touch: 5, mobile: true }

/** The page sees this computer, and GitHub answers with this release (or does not answer). */
async function setUp(page: Page, c: Computer, release: string | null) {
  await page.addInitScript((c) => {
    const def = (name: string, value: unknown) => Object.defineProperty(Navigator.prototype, name, { get: () => value, configurable: true })
    def('platform', c.platform)
    def('userAgent', c.userAgent)
    def('maxTouchPoints', c.touch ?? 0)
    def('userAgentData', c.arch || c.mobile
      ? { platform: '', mobile: !!c.mobile, getHighEntropyValues: async () => ({ architecture: c.arch }) }
      : undefined)
  }, c)
  await page.route('https://api.github.com/**', (route) => release
    ? route.fulfill({ json: { tag_name: `v${release}`, draft: false, prerelease: false, assets: FILES(release).map((name) => ({ name })) } })
    : route.abort())
  await openApp(page)
}

const openDialog = async (page: Page) => {
  await page.getByRole('banner').getByRole('button', { name: 'Download the desktop app' }).click()
  const dialog = page.getByRole('dialog', { name: 'Download the desktop app' })
  await expect(dialog).toBeVisible()
  return dialog
}

test('a Mac with Apple Silicon gets the Apple Silicon installer of the newest release', async ({ page }) => {
  await setUp(page, MAC, '9.8.7')
  const dialog = await openDialog(page)
  const main = dialog.getByTestId('download-main')
  await expect(main).toContainText('Download for macOS')
  await expect(main).toContainText('Apple Silicon')
  await expect(main).toHaveAttribute('href', 'https://github.com/falhad/mindroot/releases/download/v9.8.7/Mindroot_9.8.7_aarch64.dmg')
  await expect(dialog).toContainText('Version 9.8.7')
  // The other Mac build is one click away.
  await expect(dialog.getByTestId('download-mac-intel')).toHaveAttribute('href', /Mindroot_9\.8\.7_x64\.dmg$/)
  await expect(dialog.getByRole('tab', { name: /macOS/ })).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.getByTestId('install-steps')).toContainText('Open Anyway')
  await expect(dialog.getByTestId('install-steps')).toContainText('xattr -dr com.apple.quarantine /Applications/Mindroot.app')
  await shoot(page, 'download-mac')
})

test('an Intel Mac gets the Intel installer', async ({ page }) => {
  await setUp(page, MAC_INTEL, '9.8.7')
  const dialog = await openDialog(page)
  await expect(dialog.getByTestId('download-main')).toHaveAttribute('href', /Mindroot_9\.8\.7_x64\.dmg$/)
  await expect(dialog.getByTestId('download-mac-arm')).toBeVisible()
})

test('Windows gets the .exe installer and the SmartScreen steps', async ({ page }) => {
  await setUp(page, WINDOWS, '9.8.7')
  const dialog = await openDialog(page)
  await expect(dialog.getByTestId('download-main')).toHaveAttribute('href', /Mindroot_9\.8\.7_x64-setup\.exe$/)
  await expect(dialog.getByTestId('download-win-msi')).toBeVisible()
  await expect(dialog.getByTestId('install-steps')).toContainText('Run anyway')
})

test('Linux gets the AppImage; the user can look at the files of a different system', async ({ page }) => {
  await setUp(page, LINUX, '9.8.7')
  const dialog = await openDialog(page)
  await expect(dialog.getByTestId('download-main')).toHaveAttribute('href', /Mindroot_9\.8\.7_amd64\.AppImage$/)
  await expect(dialog.getByTestId('download-linux-deb')).toBeVisible()
  await expect(dialog.getByTestId('download-linux-rpm')).toHaveAttribute('href', /Mindroot-9\.8\.7-1\.x86_64\.rpm$/)

  await dialog.getByRole('tab', { name: 'Windows' }).click()
  await expect(dialog.getByTestId('download-main')).toHaveCount(0) // the large button is for this computer only
  await expect(dialog.getByTestId('download-win-exe')).toBeVisible()
  await expect(dialog.getByTestId('install-steps')).toContainText('Run anyway')
})

test('when GitHub does not answer, the links use the version of this build', async ({ page }) => {
  await setUp(page, MAC, null)
  const dialog = await openDialog(page)
  const href = await dialog.getByTestId('download-main').getAttribute('href')
  expect(href).toMatch(/\/releases\/download\/v(\d+\.\d+\.\d+)\/Mindroot_\1_aarch64\.dmg$/)
  await expect(dialog.getByRole('link', { name: /All files and notes/ })).toHaveAttribute('href', 'https://github.com/falhad/mindroot/releases/latest')
})

test('a phone has no download button; the palette still explains', async ({ page }) => {
  await setUp(page, PHONE, '9.8.7')
  await expect(page.getByRole('banner').getByRole('button', { name: 'New map' })).toBeVisible()
  await expect(page.getByRole('banner').getByRole('button', { name: 'Download the desktop app' })).toHaveCount(0)
})

test('the command palette finds the download with "install"', async ({ page }) => {
  await setUp(page, MAC, '9.8.7')
  await page.getByRole('banner').getByRole('button', { name: 'New map' }).click()
  await expect(page.locator('[data-node-id]').first()).toBeVisible()
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+k`)
  await page.keyboard.type('install')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Download the desktop app' })).toBeVisible()
})
