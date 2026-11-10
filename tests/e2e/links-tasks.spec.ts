import { expect, test, type Page } from '@playwright/test'
import { newMap, node, shoot } from './helpers'

async function openPanel(page: Page) {
  const b = page.getByRole('button', { name: 'Toggle side panel' })
  if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click()
}
test('link a node to another map, follow it, see the backlink, come back', async ({ page }) => {
  await newMap(page, '# Target map\n- T1\n- T2')
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: 'All maps' }).click()
  await newMap(page, '# Source map\n- S1')
  await node(page, 'S1').click()
  await openPanel(page)
  await page.getByLabel('Linked map').selectOption({ label: 'Target map' })
  await page.getByRole('button', { name: 'Pick an idea' }).click()
  await page.getByRole('button', { name: 'Open' }).waitFor({ state: 'visible' })
  await page.getByLabel('Find an idea in the linked map').fill('T2')
  await page.getByRole('option', { name: 'T2' }).click()
  await expect(page.locator('[data-badge="maplink"]')).toBeVisible()
  await page.waitForTimeout(900)

  await page.locator('[data-badge="maplink"]').click()
  await expect(node(page, 'T2')).toBeVisible()
  await expect(page.getByLabel('Map title')).toHaveValue('Target map')
  // the selected node is T2 (the link target) and shows the backlink
  await node(page, 'T2').click()
  await openPanel(page)
  await expect(page.getByRole('list', { name: 'Linked from' }).first()).toContainText('S1')
  await shoot(page, 'maplink')
  await page.getByRole('list', { name: 'Linked from' }).first().getByRole('button').click()
  await expect(page.getByLabel('Map title')).toHaveValue('Source map')
  await expect(page.locator('[data-node-id].selected')).toContainText('S1')
})

test('tasks view: tasks from two maps grouped by date, tick one, reopen the map and it is done', async ({ page }) => {
  const day = (offset: number) => {
    const d = new Date()
    d.setDate(d.getDate() + offset)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }
  await newMap(page, '# Alpha map\n- Write report\n- Plain idea')
  await node(page, 'Write report').click()
  await openPanel(page)
  await page.getByLabel('Track as task').check()
  await page.getByLabel('Due date').fill(day(-2))
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: 'All maps' }).click()
  await newMap(page, '# Beta map\n- Call Sam')
  await node(page, 'Call Sam').click()
  await openPanel(page)
  await page.getByLabel('Track as task').check()
  await page.getByLabel('Due date').fill(day(0))
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: 'All maps' }).click()

  await page.getByRole('button', { name: 'Tasks' }).click()
  await expect(page.locator('[data-bucket="overdue"] [data-task]')).toContainText('Write report')
  await expect(page.locator('[data-bucket="today"] [data-task]')).toContainText('Call Sam')
  await expect(page.getByText('Plain idea')).toHaveCount(0)
  await shoot(page, 'tasks')

  await page.getByRole('button', { name: /Mark “Write report” done/ }).click()
  await expect(page.locator('[data-bucket="done"] [data-task]')).toContainText('Write report')
  await expect(page.locator('[data-bucket="overdue"]')).toHaveCount(0)

  // open the map from the task: the change is saved
  await page.locator('[data-bucket="done"] [data-task]').getByRole('button').nth(1).click()
  await node(page, 'Write report').click()
  await openPanel(page)
  await expect(page.getByLabel('Done', { exact: true })).toBeChecked()
})
