import { expect, test, type Page } from '@playwright/test'

// In development the landing page is at /site/ and the app at /. On the website they are at / and /app/
// (scripts/web-layout.mjs); the development server sends /app/ to /.
const FILES = (v: string) => [
  `Mindroot_${v}_aarch64.dmg`, `Mindroot_${v}_x64.dmg`, `Mindroot_${v}_x64-setup.exe`, `Mindroot_${v}_x64_en-US.msi`,
  `Mindroot_${v}_amd64.AppImage`, `Mindroot_${v}_amd64.deb`, `Mindroot-${v}-1.x86_64.rpm`,
]

async function open(page: Page, opts: { release?: string | null; windows?: boolean } = {}) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  if (opts.windows) {
    await page.addInitScript(() => {
      const def = (name: string, value: unknown) => Object.defineProperty(Navigator.prototype, name, { get: () => value, configurable: true })
      def('platform', 'Win32')
      def('userAgent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36')
      def('userAgentData', undefined)
    })
  }
  const release = opts.release === undefined ? '9.8.7' : opts.release
  await page.route('https://api.github.com/**', (route) => release
    ? route.fulfill({ json: { tag_name: `v${release}`, draft: false, prerelease: false, assets: FILES(release).map((name) => ({ name })) } })
    : route.abort())
  await page.goto('/site/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Think at the speed')
  return errors
}

test('the landing page says what Mindroot is and leads to the app', async ({ page }) => {
  const errors = await open(page)
  await expect(page).toHaveTitle(/Mindroot: fast, keyboard-first mind mapping/)
  for (const name of ['Built for people who think in structure.', 'Your repository is the cloud.', 'Get Mindroot for your desktop.', 'Good to know.']) {
    await expect(page.getByRole('heading', { name })).toBeAttached()
  }
  const cta = page.getByRole('link', { name: 'Open in your browser' })
  await expect(cta).toHaveAttribute('href', '/app/')
  await cta.click()
  await expect(page.getByRole('banner').getByRole('button', { name: 'New map' })).toBeVisible()
  expect(errors).toEqual([])
})

test('the download buttons offer the installer of the newest release for this computer', async ({ page }) => {
  await open(page, { windows: true })
  const main = page.locator('#download [data-download-main]')
  await expect(main).toContainText('Download for Windows')
  await expect(main).toHaveAttribute('href', 'https://github.com/falhad/mindroot/releases/download/v9.8.7/Mindroot_9.8.7_x64-setup.exe')
  await expect(page.locator('.platform[data-os="windows"]')).toHaveClass(/here/)
  await expect(page.locator('[data-files="linux"] a')).toHaveCount(3)
  await expect(page.locator('[data-files="mac"] a').first()).toHaveAttribute('href', /Mindroot_9\.8\.7_aarch64\.dmg$/)
  await expect(page.locator('#download')).toContainText('Version 9.8.7')
  // The install steps come from the same list as the dialog in the app.
  await page.locator('.platform[data-os="windows"] summary').click()
  await expect(page.locator('[data-steps-for="windows"]')).toContainText('Run anyway')
})

test('without an answer from GitHub the page still has working download links', async ({ page }) => {
  await open(page, { release: null })
  await expect(page.locator('[data-files="mac"] a').first()).toHaveAttribute('href', /\/releases\/download\/v\d+\.\d+\.\d+\/Mindroot_\d+\.\d+\.\d+_aarch64\.dmg$/)
})

test('the tour shows the screenshot of the chosen view', async ({ page }) => {
  await open(page)
  const tab = page.getByRole('tab', { name: /Outline/ })
  await tab.scrollIntoViewIfNeeded()
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#shot-1')).toHaveClass(/on/)
  await expect(page.locator('#shot-0')).not.toHaveClass(/on/)
  await tab.press('ArrowDown')
  await expect(page.getByRole('tab', { name: /Notes/ })).toBeFocused()
  await expect(page.locator('#shot-2')).toHaveClass(/on/)
})

test('a question opens, and the theme button changes the theme for the app too', async ({ page }) => {
  await open(page)
  const q = page.locator('.faq details').first()
  await q.locator('summary').click()
  await expect(q.locator('p')).toBeVisible()
  const before = await page.evaluate(() => document.documentElement.dataset.theme)
  await page.getByRole('button', { name: 'Switch between light and dark' }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).not.toBe(before)
  expect(await page.evaluate(() => localStorage.getItem('mr.theme'))).toBe(before === 'dark' ? 'light' : 'dark')
})

test('with reduced motion the map in the hero is complete at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page)
  await expect(page.locator('[data-demo] .nd')).toHaveCount(13)
  await expect(page.locator('[data-demo] .edge')).toHaveCount(12)
})

test('the page fits a phone without a sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)
  await expect(page.getByRole('link', { name: 'Open the app' })).toBeVisible()
})

test('the install steps fit inside their card: no text is cut off', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await open(page)
    for (const os of ['mac', 'windows', 'linux']) {
      const card = page.locator(`.platform[data-os="${os}"]`)
      await card.locator('summary').click()
      await expect(card.locator('ol li').first()).toBeVisible()
      await page.waitForTimeout(450) // the box slides open
      const cut = await card.evaluate((el) => {
        const box = el.getBoundingClientRect()
        const bad: string[] = []
        for (const item of el.querySelectorAll<HTMLElement>('details li, details code')) {
          const r = item.getBoundingClientRect()
          if (r.right > box.right - 8 || r.bottom > box.bottom - 8) bad.push(`outside the card: ${item.textContent?.slice(0, 40)}`)
          if (item.scrollWidth > item.clientWidth + 1) bad.push(`needs a sideways scroll: ${item.textContent?.slice(0, 40)}`)
        }
        return bad
      })
      expect(cut, `${os} at ${width}px`).toEqual([])
    }
  }
})
