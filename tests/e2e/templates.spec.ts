import { expect, test } from '@playwright/test'
import { newMap, node, shoot } from './helpers'

test('save a map as a template, start a new map from it, delete the template', async ({ page }) => {
  await newMap(page, '# Weekly plan\n- Monday\n  - Standup\n- Friday')
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/command/i).fill('Save this map as a template')
  await page.keyboard.press('Enter')
  await expect(page.getByText(/Saved as a template/)).toBeVisible()
  await page.getByRole('button', { name: 'All maps' }).click()
  const card = page.locator('[data-user-template]')
  await expect(card).toHaveCount(1)
  await expect(card).toContainText('Weekly plan')
  await shoot(page, 'templates')

  await card.getByRole('button', { name: /New map from template/ }).click()
  await expect(node(page, 'Standup')).toBeVisible()
  await expect(node(page, 'Friday')).toBeVisible()
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: 'All maps' }).click()
  await expect(page.getByRole('button', { name: /Open Weekly plan/ })).toHaveCount(2) // the original and the new map

  await card.hover()
  await card.getByRole('button', { name: /Delete template/ }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.locator('[data-user-template]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Open Weekly plan/ })).toHaveCount(2) // maps stay
});
