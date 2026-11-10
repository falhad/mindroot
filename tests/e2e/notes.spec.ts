import { expect, test } from '@playwright/test'
import { newMap, node, shoot } from './helpers'

async function openPanel(page: import('@playwright/test').Page) {
  const b = page.getByRole('button', { name: 'Toggle side panel' })
  if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click()
}

test('Markdown notes: write, preview headings, code and math, Persian stays readable', async ({ page }) => {
  await newMap(page, '# Root\n- A\n- B')
  await node(page, 'A').click()
  await openPanel(page)
  await page.getByLabel('Markdown').check()
  await page.getByPlaceholder(/Heading/).fill('## Plan\n\n- one\n- **two**\n\n```ts\nconst a: number = 1\n```\n\nEnergy $E=mc^2$\n\nاین یک یادداشت است')
  await page.getByRole('button', { name: 'Preview' }).click()
  const view = page.getByTestId('notes-preview')
  await expect(view.locator('h2')).toHaveText('Plan')
  await expect(view.locator('li')).toHaveCount(2)
  await expect(view.locator('.hljs-keyword').first()).toBeVisible()
  await expect(view.locator('.katex').first()).toBeVisible()
  await expect(view.getByText('این یک یادداشت است')).toHaveAttribute('dir', 'auto')
  await shoot(page, 'notes')
  // survives reload
  await page.waitForTimeout(900)
  await page.reload()
  await node(page, 'A').click()
  await openPanel(page)
  await expect(page.getByLabel('Markdown')).toBeChecked()
})

test('Markdown preview never runs scripts', async ({ page }) => {
  let dialog = false
  page.on('dialog', (d) => { dialog = true; void d.dismiss() })
  await newMap(page, '# Root\n- A')
  await node(page, 'A').click()
  await openPanel(page)
  await page.getByLabel('Markdown').check()
  await page.getByPlaceholder(/Heading/).fill('<img src=x onerror=alert(1)><script>alert(2)</script>hello')
  await page.getByRole('button', { name: 'Preview' }).click()
  await expect(page.getByTestId('notes-preview')).toContainText('hello')
  await page.waitForTimeout(300)
  expect(dialog).toBe(false)
})

test('attach a file: it is listed, opens as a download, and survives a reload', async ({ page }) => {
  await newMap(page, '# Root\n- A')
  await node(page, 'A').click()
  await openPanel(page)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Add file' }).click()
  await (await chooser).setFiles({ name: 'plan.txt', mimeType: 'text/plain', buffer: Buffer.from('hello attachment') })
  const item = page.locator('[data-attachment]')
  await expect(item).toContainText('plan.txt')
  await page.waitForTimeout(900)
  await page.reload()
  await node(page, 'A').click()
  await openPanel(page)
  await expect(page.locator('[data-attachment]')).toContainText('plan.txt')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTitle('Open plan.txt').click()])
  expect(download.suggestedFilename()).toBe('plan.txt')
  expect((await (await download.createReadStream()).toArray()).join('')).toBe('hello attachment')
  await page.getByRole('button', { name: 'Remove plan.txt' }).click()
  await expect(page.locator('[data-attachment]')).toHaveCount(0)
})
