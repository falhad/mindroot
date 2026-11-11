import { expect, test } from '@playwright/test'
import { newMap, node, shoot } from './helpers'

test('compare a map with its copy: changed and added ideas are outlined, and both sides pan together', async ({ page }) => {
  await newMap(page, '# Original\n- Alpha\n- Beta\n- Gamma')
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: 'All maps' }).click()
  await page.getByRole('button', { name: 'More actions' }).first().click()
  await page.getByRole('menuitem', { name: /Duplicate/ }).click()
  await page.getByRole('button', { name: 'Open Original copy' }).click()

  // change one idea and add another in the copy
  await node(page, 'Beta').dblclick()
  await page.keyboard.type('Beta changed')
  await page.keyboard.press('Escape')
  await node(page, 'Gamma').click()
  await page.keyboard.press('Tab')
  await page.keyboard.type('Delta')
  await page.keyboard.press('Escape')

  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/command/i).fill('Compare with another map')
  await page.keyboard.press('Enter')
  await page.getByRole('list', { name: 'Maps' }).getByRole('button', { name: 'Original', exact: true }).click()

  const dialog = page.getByRole('dialog', { name: 'Compare versions' })
  await expect(dialog.locator('img')).toHaveCount(2)
  await expect(dialog.locator('[data-count="added"]')).toHaveText('1 added')
  await expect(dialog.locator('[data-count="changed"]')).toHaveText('2 changed')
  await expect(dialog.locator('[data-count="removed"]')).toHaveText('0 removed')
  await expect(dialog.locator('img')).toHaveCount(2)
  await shoot(page, 'compare')

  const left = dialog.locator('[data-compare-pane="a"]')
  const imgs = dialog.locator('img')
  const t0 = await imgs.nth(1).evaluate((el) => (el as HTMLElement).style.transform)
  const box = (await left.boundingBox())!
  await page.mouse.move(box.x + 100, box.y + 100)
  await page.mouse.down()
  await page.mouse.move(box.x + 180, box.y + 150, { steps: 4 })
  await page.mouse.up()
  const [a, b] = await Promise.all([imgs.nth(0).evaluate((el) => (el as HTMLElement).style.transform), imgs.nth(1).evaluate((el) => (el as HTMLElement).style.transform)])
  expect(b).not.toBe(t0) // the right side moved too
  expect(a).toBe(b)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('history needs Git sync: the browser build says so instead of failing', async ({ page }) => {
  await newMap(page, '# One\n- A')
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/command/i).fill('History of this map')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Map history' })).toContainText('only in the desktop app')
})
