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
