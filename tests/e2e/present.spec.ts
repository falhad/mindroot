import { expect, test } from '@playwright/test'
import { newMap, node, shoot } from './helpers'

test('present one idea at a time: reveal with arrows, go back, Escape restores everything', async ({ page }) => {
  await newMap(page, '# Root\n- A\n  - A1\n- B\n- C')
  await node(page, 'Root').click()
  await page.keyboard.press('F5')
  const hidden = page.locator('.node.step-hidden')
  await expect(page.getByTestId('presentation-controls')).toBeVisible()
  await expect(page.getByText('1 / 5')).toBeVisible()
  await expect(hidden).toHaveCount(4) // only Root is shown
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByText('4 / 5')).toBeVisible()
  await expect(hidden).toHaveCount(1) // only C is still hidden
  await shoot(page, 'present')
  await page.keyboard.press('ArrowLeft')
  await expect(hidden).toHaveCount(2)
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight')
  await expect(page.getByText('5 / 5')).toBeVisible() // clamps at the end
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('presentation-controls')).toHaveCount(0)
  await expect(hidden).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Toggle side panel' })).toBeVisible()
})

test('presenting by branch shows a whole branch per step', async ({ page }) => {
  await newMap(page, '# Root\n- A\n  - A1\n  - A2\n- B')
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/command/i).fill('one branch at a time')
  await page.keyboard.press('Enter')
  await expect(page.getByText('1 / 3')).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.node.step-hidden')).toHaveCount(1) // B only
})
