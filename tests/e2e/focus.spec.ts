import { expect, test } from '@playwright/test'
import { newMap, node, shoot } from './helpers'

test('focus a branch: only it is visible with a breadcrumb; Esc returns', async ({ page }) => {
  await newMap(page, '# Root\n- A\n  - A1\n  - A2\n- B\n- C')
  await node(page, 'A').click()
  await page.keyboard.press('Control+.')
  await expect(page.getByRole('navigation', { name: 'Focus path' })).toBeVisible()
  await expect(node(page, 'A1')).toBeVisible()
  await expect(node(page, 'B')).toHaveCount(0)
  await expect(node(page, 'Root')).toHaveCount(0)
  await shoot(page, 'focus')
  // add a child while focused: it lands in the real map
  await node(page, 'A').click()
  await page.keyboard.press('Tab')
  await page.keyboard.type('A3')
  await page.keyboard.press('Escape')
  await expect(node(page, 'A3')).toBeVisible()
  // breadcrumb: click the root to leave
  await page.getByRole('navigation', { name: 'Focus path' }).getByRole('button', { name: 'Root' }).click()
  await expect(node(page, 'B')).toBeVisible()
  await expect(node(page, 'A3')).toBeVisible()
  // Esc leaves focus too
  await node(page, 'B').click()
  await page.keyboard.press('Control+.')
  await expect(node(page, 'A')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(node(page, 'A')).toBeVisible()
})
