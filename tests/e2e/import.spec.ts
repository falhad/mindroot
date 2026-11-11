import { expect, test, type Page } from '@playwright/test'
import { node, openApp } from './helpers'

async function importAs(page: Page, name: string, body: string | Buffer, type = 'text/plain') {
  await openApp(page)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Import' }).click()
  await (await chooser).setFiles({ name, mimeType: type, buffer: Buffer.isBuffer(body) ? body : Buffer.from(body) })
}

test('import an OPML outline (with Persian text)', async ({ page }) => {
  await importAs(page, 'notes.opml', '<?xml version="1.0"?><opml version="2.0"><head><title>Trip</title></head><body><outline text="Packing"><outline text="Passport"/><outline text="سیب"/></outline></body></opml>')
  await expect(node(page, 'Passport')).toBeVisible()
  await expect(node(page, 'سیب')).toBeVisible()
})

test('import a FreeMind map', async ({ page }) => {
  await importAs(page, 'plan.mm', '<map version="1.0.1"><node TEXT="Plan"><node TEXT="Phase 1" POSITION="right"/><node TEXT="Phase 2" POSITION="left"/></node></map>')
  await expect(node(page, 'Phase 1')).toBeVisible()
  await expect(node(page, 'Phase 2')).toBeVisible()
})

test('import an Obsidian canvas', async ({ page }) => {
  const canvas = { nodes: [{ id: 'a', type: 'text', text: 'Hub', x: 0, y: 0, width: 100, height: 40 }, { id: 'b', type: 'text', text: 'Spoke', x: 200, y: 0, width: 100, height: 40 }], edges: [{ id: 'e', fromNode: 'a', toNode: 'b' }] }
  await importAs(page, 'board.canvas', JSON.stringify(canvas), 'application/json')
  await expect(node(page, 'Spoke')).toBeVisible()
})

test('a broken file shows a readable message and creates no map', async ({ page }) => {
  await importAs(page, 'bad.mm', '<html></html>')
  await expect(page.getByText(/not a FreeMind map/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Open / })).toHaveCount(0)
})
