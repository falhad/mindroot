import { expect, test } from '@playwright/test'
import { newMap, node, shoot } from './helpers'

test('tag a node, filter by the tag, other nodes dim, clearing restores them', async ({ page }) => {
  await newMap(page, '# Root\n- A\n  - A1\n- B\n- C')
  await node(page, 'A1').click()
  await page.getByRole('button', { name: 'Toggle side panel' }).evaluate((b) => {
    if (b.getAttribute('aria-pressed') !== 'true') (b as HTMLElement).click()
  })
  await page.getByLabel('Add tag').fill('Urgent')
  await page.getByLabel('Add tag').press('Enter')
  await page.getByLabel('Add tag').fill('کار')
  await page.getByLabel('Add tag').press('Enter')
  await expect(page.locator('[data-tag="urgent"]')).toBeVisible()
  await expect(page.locator('[data-tag="کار"]')).toBeVisible()

  await page.getByRole('button', { name: 'Filter by tag' }).click()
  await page.getByRole('menuitemcheckbox', { name: /#urgent/ }).click()
  await page.keyboard.press('Escape')
  await expect(node(page, 'B')).toHaveClass(/dim/)
  await expect(node(page, 'C')).toHaveClass(/dim/)
  await expect(node(page, 'A')).toHaveClass(/soft/)
  await expect(node(page, 'A1')).not.toHaveClass(/dim|soft/)
  await shoot(page, 'tags')

  await page.getByRole('button', { name: 'Filter by tag' }).click()
  await page.getByRole('button', { name: 'Clear filter' }).click()
  await expect(node(page, 'B')).not.toHaveClass(/dim/)
})
