import { expect, test } from '@playwright/test'
import { newMap, node, shoot } from './helpers'

async function palette(page: import('@playwright/test').Page, text: string) {
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/command/i).fill(text)
  await page.keyboard.press('Enter')
}

test('group two siblings, add a bracket, undo removes them', async ({ page }) => {
  await newMap(page, '# Root\n- A\n  - A1\n- B\n- C')
  await node(page, 'B').click()
  await node(page, 'C').click({ modifiers: ['Shift'] })
  await palette(page, 'Group selected')
  await expect(page.locator('[data-group]')).toHaveCount(1)
  await palette(page, 'summary bracket')
  await expect(page.locator('[data-summary]')).toHaveCount(1)
  await expect(page.locator('[data-summary] text')).toHaveText('Summary')
  await shoot(page, 'arrange')
  await page.keyboard.press('Control+z')
  await expect(page.locator('[data-summary]')).toHaveCount(0)
  await page.keyboard.press('Control+z')
  await expect(page.locator('[data-group]')).toHaveCount(0)
})

test('grouping non-siblings shows a message and changes nothing', async ({ page }) => {
  await newMap(page, '# Root\n- A\n  - A1\n- B')
  await node(page, 'A1').click()
  await node(page, 'B').click({ modifiers: ['Shift'] })
  await palette(page, 'Group selected')
  await expect(page.getByText(/share the same parent/)).toBeVisible()
  await expect(page.locator('[data-group]')).toHaveCount(0)
})

test('double-click empty canvas makes a floating node, it survives a reload', async ({ page }) => {
  await newMap(page, '# Root\n- A\n- B')
  const box = (await page.locator('.world').boundingBox())!
  await page.mouse.dblclick(box.x + 40, box.y + 170)
  await page.keyboard.type('Loose idea')
  await page.keyboard.press('Escape')
  await expect(node(page, 'Loose idea')).toBeVisible()
  const before = await node(page, 'Loose idea').boundingBox()
  await page.waitForTimeout(900)
  await page.reload()
  await expect(node(page, 'Loose idea')).toBeVisible()
  const after = await node(page, 'Loose idea').boundingBox()
  expect(Math.abs(after!.x - before!.x)).toBeLessThan(80) // same place (the camera is remembered)
  await shoot(page, 'floats')
})

test('Shift+double-click makes a sticky note', async ({ page }) => {
  await newMap(page, '# Root\n- A')
  const box = (await page.locator('.world').boundingBox())!
  await page.keyboard.down('Shift')
  await page.mouse.dblclick(box.x + 60, box.y + 190)
  await page.keyboard.up('Shift')
  await page.keyboard.type('Remember')
  await page.keyboard.press('Escape')
  await expect(node(page, 'Remember')).toBeVisible()
})
