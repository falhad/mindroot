import { expect, test } from '@playwright/test'
import { newMap, node } from './helpers'

test('create a map, add a child with Tab, rename it, reload, the text persists', async ({ page }) => {
  await newMap(page)
  await node(page, 'B').click()
  await page.keyboard.press('Tab')
  await page.keyboard.type('Child of B')
  await page.keyboard.press('Escape')
  await expect(node(page, 'Child of B')).toBeVisible()
  await page.waitForTimeout(900) // autosave is debounced 600 ms
  await page.reload()
  await expect(node(page, 'Child of B')).toBeVisible()
})

test('double-click a node edits its text; it does not create a new floating node', async ({ page }) => {
  await newMap(page, '# Root\n- Alpha\n- Beta')
  const before = await page.locator('[data-node-id]').count()
  await node(page, 'Beta').dblclick()
  await page.keyboard.type('Beta changed')
  await page.keyboard.press('Escape')
  await expect(node(page, 'Beta changed')).toBeVisible()
  await expect(node(page, 'Beta')).toHaveCount(0) // renamed, not duplicated
  expect(await page.locator('[data-node-id]').count()).toBe(before)
})
