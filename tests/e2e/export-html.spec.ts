import { expect, test } from '@playwright/test'
import { newMap, node } from './helpers'

test('export OPML and the HTML page; the page opens, zooms, and shows notes', async ({ page, context }) => {
  await newMap(page, '# Root\n- Alpha\n  - Alpha child\n- Beta')
  await node(page, 'Alpha').click()
  await page.getByRole('button', { name: 'Toggle side panel' }).evaluate((b) => { if (b.getAttribute('aria-pressed') !== 'true') (b as HTMLElement).click() })
  await page.getByPlaceholder('Write details, context, links…').fill('Secret note for alpha')
  await page.waitForTimeout(300)

  // OPML
  await page.getByRole('button', { name: 'Export' }).first().click()
  await page.getByRole('button', { name: /OPML outline/ }).click()
  const [opml] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export .opml' }).click()])
  expect(opml.suggestedFilename()).toBe('Root.opml')
  const opmlText = (await (await opml.createReadStream()).toArray()).join('')
  expect(opmlText).toContain('text="Alpha child"')
  expect(opmlText).toContain('_note="Secret note for alpha"')

  // HTML
  await page.getByRole('button', { name: 'Export' }).first().click()
  await page.getByRole('button', { name: /Web page/ }).click()
  const [html] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export .html' }).click()])
  expect(html.suggestedFilename()).toBe('Root.html')
  const text = (await (await html.createReadStream()).toArray()).join('')

  // open the exported page on its own, with every network request blocked: it must not need any
  const viewer = await context.newPage()
  const requests: string[] = []
  await viewer.route('**/*', (r) => { requests.push(r.request().url()); return r.abort() })
  await viewer.setContent(text, { waitUntil: 'load' })
  const stage = viewer.locator('#stage')
  const before = await stage.evaluate((el) => el.style.transform)
  await viewer.mouse.move(400, 300)
  await viewer.mouse.wheel(0, -400)
  await expect.poll(() => stage.evaluate((el) => el.style.transform)).not.toBe(before)
  await viewer.locator('[data-node]').filter({ hasText: 'Alpha' }).first().locator('text').first().click({ force: true })
  await expect(viewer.locator('#card')).toContainText('Secret note for alpha')
  expect(requests.filter((u) => !u.startsWith('about:') && !u.startsWith('data:'))).toEqual([])
})
