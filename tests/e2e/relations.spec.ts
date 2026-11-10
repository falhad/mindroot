import { expect, test } from '@playwright/test'
import { newMap, node, shoot } from './helpers'

test('link two nodes, label the link by double-click, the label shows and is in the SVG export', async ({ page }) => {
  await newMap(page, '# Root\n- A\n- B\n- C')
  await node(page, 'A').click()
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/command/i).fill('Link to another')
  await page.keyboard.press('Enter')
  await node(page, 'B').click()
  const hit = page.locator('[data-relation] path').first()
  await expect(page.locator('[data-relation]')).toHaveCount(1)
  // click the real middle of the curve (its bounding box centre is not on a bowed line)
  const pt = await hit.evaluate((el) => {
    const p = el as SVGPathElement
    const at = p.getPointAtLength(p.getTotalLength() / 2)
    const m = p.getScreenCTM()!
    return { x: at.x * m.a + m.e, y: at.y * m.d + m.f }
  })
  await page.mouse.dblclick(pt.x, pt.y)
  await page.getByLabel('Link label').fill('blocks')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-relation] text')).toHaveText('blocks')
  await shoot(page, 'relations')

  await page.getByRole('button', { name: 'Export' }).first().click()
  await page.getByRole('button', { name: /SVG vector/ }).click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export .svg' }).click()])
  const text = (await (await download.createReadStream()).toArray()).join('')
  expect(text).toContain('blocks')
})
