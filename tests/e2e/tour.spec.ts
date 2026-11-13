import { expect, test } from '@playwright/test'
import { openApp, shoot } from './helpers'

// The other tests run with the tour off (playwright.config.ts). Here the user is new.
test.use({ storageState: { cookies: [], origins: [] } })

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

async function blankMap(page: import('@playwright/test').Page) {
  await openApp(page)
  await page.getByRole('banner').getByRole('button', { name: 'New map' }).click()
  await expect(page.locator('[data-node-id]').first()).toBeVisible()
}

test('the first map shows a tour that follows what the user does', async ({ page }) => {
  await blankMap(page)
  const tour = page.getByRole('status', { name: 'Quick tour' })
  await expect(tour).toContainText('Press Tab to add your first idea')
  await shoot(page, 'tour-first')

  await page.keyboard.press('Tab')
  await expect(tour).toContainText('Then press Enter for the next idea')
  await page.keyboard.type('One')
  await page.keyboard.press('Enter')
  await expect(tour).toContainText('K to see all commands')
  await expect(tour).not.toContainText('ai there')
  await page.keyboard.type('Two')
  await page.keyboard.press('Escape')

  await page.keyboard.press(`${mod}+k`)
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(tour).toContainText('That is all you need')
  await expect(tour).toContainText('type help')
  await shoot(page, 'tour-last')

  await tour.getByRole('button', { name: 'Shortcuts' }).click()
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toContainText('To open this list again')
  await page.keyboard.press('Escape')
  await expect(tour).toBeHidden()

  // not shown on the next map, and not after a reload
  await page.reload()
  await expect(page.locator('[data-node-id]').first()).toBeVisible()
  await expect(tour).toBeHidden()
})

test('the tour can be skipped and started again from the palette', async ({ page }) => {
  await blankMap(page)
  const tour = page.getByRole('status', { name: 'Quick tour' })
  await tour.getByRole('button', { name: 'Skip the tour' }).click()
  await expect(tour).toBeHidden()
  await page.reload()
  await expect(page.locator('[data-node-id]').first()).toBeVisible()
  await expect(tour).toBeHidden()

  await page.keyboard.press(`${mod}+k`)
  await page.keyboard.type('tour')
  await page.keyboard.press('Enter')
  await expect(tour).toContainText('Press Tab')
})

test('a phone gets the tour with buttons, not keys', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await blankMap(page)
  const tour = page.getByRole('status', { name: 'Quick tour' })
  await expect(tour).toContainText('Tap Child below')
  await page.getByRole('button', { name: 'Child' }).click()
  await expect(tour).toContainText('Then tap Sibling')
  await page.getByRole('button', { name: 'Sibling' }).click()
  await expect(tour).toContainText('That is all you need')
  await expect(tour.getByRole('button', { name: 'Shortcuts' })).toHaveCount(0)
  await tour.getByRole('button', { name: 'Got it' }).click()
  await expect(tour).toBeHidden()
})

for (const q of ['?', 'help', 'shortcut']) {
  test(`the palette finds the shortcut list with "${q}"`, async ({ page }) => {
    await blankMap(page)
    await page.keyboard.press(`${mod}+k`)
    const palette = page.getByRole('dialog', { name: 'Command palette' })
    await page.keyboard.type(q)
    await expect(palette.getByRole('button').first()).toContainText('Keyboard shortcuts')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
  })
}
