import { expect, type Locator, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'

export async function openApp(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('banner').getByRole('button', { name: 'New map' })).toBeVisible()
}

/** Create a map from a Markdown outline through the Import button, then open it. */
export async function newMap(page: Page, outline = '# Root\n- A\n  - A1\n- B\n- C') {
  await openApp(page)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Import' }).click()
  await (await chooser).setFiles({ name: 'map.md', mimeType: 'text/markdown', buffer: Buffer.from(outline) })
  await expect(page.locator('[data-node-id]').first()).toBeVisible()
}

/** The node whose visible text equals `text`. */
export const node = (page: Page, text: string): Locator =>
  page.locator('[data-node-id]').filter({ has: page.locator('.node-text', { hasText: new RegExp(`^${escapeRe(text)}$`) }) })

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Screenshots of the current view: desktop and phone width, light and dark. */
export async function shoot(page: Page, name: string) {
  mkdirSync('tests/e2e/__shots__', { recursive: true })
  const original = page.viewportSize() ?? { width: 1440, height: 900 }
  for (const [w, h, label] of [[1440, 900, 'desktop'], [390, 844, 'mobile']] as const) {
    await page.setViewportSize({ width: w, height: h })
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await page.waitForTimeout(250)
      await page.screenshot({ path: `tests/e2e/__shots__/${name}-${label}-${scheme}.png` })
    }
  }
  await page.setViewportSize(original)
  await page.emulateMedia({ colorScheme: null })
}
