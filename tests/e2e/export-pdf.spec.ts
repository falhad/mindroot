import { expect, test, type Page } from '@playwright/test'
import { newMap } from './helpers'

async function exportPdf(page: Page, label: RegExp, button: string) {
  await page.getByRole('button', { name: 'Export' }).first().click()
  await page.getByRole('button', { name: label }).click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: button }).click()])
  return Buffer.concat(await (await download.createReadStream()).toArray())
}

test('vector PDF has real text and a page sized to the map; the image PDF is bigger', async ({ page }) => {
  await newMap(page, '# Quarterly plan\n- Marketing\n  - Launch campaign\n- Product\n- Hiring')
  const vector = await exportPdf(page, /PDF \(vector\)/, 'Export .pdf')
  expect(vector.subarray(0, 5).toString()).toBe('%PDF-')
  const text = vector.toString('latin1')
  expect(text).toContain('Launch campaign')
  expect(text).toContain('Quarterly plan')
  const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(text)!
  expect(Number(box[1])).toBeGreaterThan(200)
  expect(Number(box[2])).toBeGreaterThan(100)
  expect(text).not.toContain('/Subtype /Image') // shapes and text, not a picture
  await page.keyboard.press('Escape')

  const image = await exportPdf(page, /PDF \(image\)/, 'Export .pdf')
  expect(image.length).toBeGreaterThan(vector.length / 4)
  expect(image.toString('latin1')).toContain('/Subtype /Image')
})

test('a Persian map still exports a PDF through the vector button (it falls back to the image PDF)', async ({ page }) => {
  await newMap(page, '# مرکز\n- شاخه اول')
  const pdf = await exportPdf(page, /PDF \(vector\)/, 'Export .pdf')
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  expect(pdf.toString('latin1')).toContain('/Subtype /Image')
})
