import { expect, test } from '@playwright/test'
import { newMap, node, shoot } from './helpers'

type P = import('@playwright/test').Page
const row = (page: P, text: string) => page.locator(`[data-outline-row]:has(input[value="${text}"])`)
/** A locator that keeps pointing at the same row after its text changes. */
const stable = async (page: P, text: string) => page.locator(`[data-outline-row="${await row(page, text).getAttribute('data-outline-row')}"]`)

test('outline: typing edits the canvas, Enter adds, Tab indents, selection follows', async ({ page }) => {
  await newMap(page, '# Root\n- A\n- B')
  await page.getByRole('button', { name: 'Toggle outline' }).click()
  await expect(page.getByRole('complementary', { name: 'Outline' })).toBeVisible()
  await expect(page.locator('[data-outline-row]')).toHaveCount(3)

  // edit text in the outline: the canvas node changes
  const aRow = await stable(page, 'A')
  const a = aRow.locator('input')
  await a.click()
  await a.fill('Alpha')
  await expect(node(page, 'Alpha')).toBeVisible()

  // Enter adds a sibling after it and focuses it
  await a.press('Enter')
  await page.keyboard.type('Beta')
  await expect(node(page, 'Beta')).toBeVisible()
  // Tab makes Beta a child of Alpha
  await page.keyboard.press('Tab')
  await expect(row(page, 'Beta')).toHaveAttribute('aria-level', '3')

  // select on the canvas -> the outline row is selected
  await node(page, 'B').click()
  await expect(row(page, 'B')).toHaveAttribute('data-selected', 'true')
  await shoot(page, 'outline')
})

test('outline: Backspace on an empty leaf deletes it, and collapsed branches hide their rows', async ({ page }) => {
  await newMap(page, '# Root\n- A\n  - A1\n- B')
  await page.getByRole('button', { name: 'Toggle outline' }).click()
  await expect(page.locator('[data-outline-row]')).toHaveCount(4)
  await row(page, 'A').getByRole('button', { name: 'Collapse' }).click()
  await expect(page.locator('[data-outline-row]')).toHaveCount(3)
  const b = (await stable(page, 'B')).locator('input')
  await b.click()
  await b.fill('')
  await b.press('Backspace')
  await expect(page.locator('[data-outline-row]')).toHaveCount(2)
})

test('outline: a big map only renders the visible rows', async ({ page }) => {
  const lines = ['# Big']
  for (let i = 0; i < 40; i++) {
    lines.push(`- Branch ${i}`)
    for (let j = 0; j < 40; j++) lines.push(`  - Leaf ${i}-${j}`)
  }
  await newMap(page, lines.join('\n')) // 1,641 ideas
  await page.getByRole('button', { name: 'Toggle outline' }).click()
  await expect(page.getByTestId('outline-scroll')).toBeVisible()
  const rendered = await page.locator('[data-outline-row]').count()
  expect(rendered).toBeLessThan(80)
  await page.getByTestId('outline-scroll').evaluate((el) => (el.scrollTop = 30 * 1000))
  await expect(page.locator('[data-outline-row]').first()).toBeAttached()
  expect(await page.locator('[data-outline-row]').count()).toBeLessThan(80)
})
