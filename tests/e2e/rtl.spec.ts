import { expect, test } from '@playwright/test'
import { newMap, node, shoot } from './helpers'

test('right-to-left: the map mirrors, Persian text reads right to left, the font changes, the palette is editable', async ({ page }) => {
  await newMap(page, '# مرکز\n- شاخه اول\n- شاخه دوم')
  await page.getByRole('button', { name: 'Toggle side panel' }).evaluate((b) => { if (b.getAttribute('aria-pressed') !== 'true') (b as HTMLElement).click() })
  await page.getByRole('button', { name: 'Map', exact: true }).click()
  const rootBefore = await node(page, 'مرکز').boundingBox()
  const firstBefore = await node(page, 'شاخه اول').boundingBox()
  await page.getByRole('button', { name: 'Right tree' }).click()
  const ltrX = (await node(page, 'شاخه اول').boundingBox())!.x
  const ltrRoot = (await node(page, 'مرکز').boundingBox())!.x
  expect(ltrX).toBeGreaterThan(ltrRoot) // children on the right
  await page.getByRole('button', { name: 'Right to left' }).click()
  await page.waitForTimeout(500)
  const rtlX = (await node(page, 'شاخه اول').boundingBox())!.x
  const rtlRoot = (await node(page, 'مرکز').boundingBox())!.x
  expect(rtlX).toBeLessThan(rtlRoot) // now on the left
  expect(rootBefore && firstBefore).toBeTruthy()

  await page.getByLabel('Map font').selectOption('serif')
  await expect(node(page, 'مرکز').locator('.node-text').first()).toBeVisible()
  const family = await node(page, 'شاخه اول').evaluate((el) => getComputedStyle(el).fontFamily)
  expect(family).toMatch(/Georgia|serif/)

  await page.getByRole('button', { name: 'Edit the eight colours' }).click()
  await expect(page.getByRole('group', { name: 'Custom palette' }).locator('input')).toHaveCount(8)
  await shoot(page, 'rtl')
  // survives a reload
  await page.waitForTimeout(900)
  await page.reload()
  await page.getByRole('button', { name: 'Toggle side panel' }).evaluate((b) => { if (b.getAttribute('aria-pressed') !== 'true') (b as HTMLElement).click() })
  await page.getByRole('button', { name: 'Map', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Right to left' })).toHaveClass(/on/)
})
