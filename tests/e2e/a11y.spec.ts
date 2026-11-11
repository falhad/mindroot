import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { newMap, node, openApp } from './helpers'

/** Serious and critical problems only, with the rule and the first elements named in the failure. */
async function scan(page: Page, label: string) {
  await page.waitForTimeout(450) // let entry animations finish: axe would measure half-transparent text
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  const text = bad.map((v) => `${v.id} (${v.impact}): ${v.help}\n   ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join('\n   ')}`).join('\n')
  expect(bad, `${label}\n${text}`).toEqual([])
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`accessibility, ${scheme} mode`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
    })

    test('dashboard and settings', async ({ page }) => {
      await openApp(page)
      await scan(page, 'dashboard')
      await page.getByRole('button', { name: 'Settings' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await scan(page, 'settings')
    })

    test('editor with the side panel, outline and a dialog', async ({ page }) => {
      await newMap(page, '# Root\n- Alpha\n  - Child\n- Beta')
      await node(page, 'Alpha').click()
      await scan(page, 'editor')
      await page.getByRole('button', { name: 'Toggle outline' }).click()
      await scan(page, 'editor with outline')
      await page.getByRole('button', { name: 'Export' }).first().click()
      await expect(page.getByRole('dialog', { name: 'Export' })).toBeVisible()
      await scan(page, 'export dialog')
    })

    test('tasks view', async ({ page }) => {
      await openApp(page)
      await page.getByRole('button', { name: 'Tasks' }).click()
      await scan(page, 'tasks view')
    })
  })
}

test('the map is a tree: items have levels, expansion and selection, and the selection is announced', async ({ page }) => {
  await newMap(page, '# Root\n- Alpha\n  - Child\n- Beta')
  const tree = page.getByRole('tree', { name: /mind map/i })
  await expect(tree).toBeVisible()
  const alpha = tree.getByRole('treeitem', { name: /^Alpha/ })
  await expect(alpha).toHaveAttribute('aria-level', '2')
  await expect(alpha).toHaveAttribute('aria-expanded', 'true')
  await expect(tree.getByRole('treeitem', { name: /^Child/ })).toHaveAttribute('aria-level', '3')
  await expect(tree.getByRole('treeitem', { name: /^Beta/ })).not.toHaveAttribute('aria-expanded', /.*/)
  await node(page, 'Alpha').click()
  await expect(alpha).toHaveAttribute('aria-selected', 'true')
  // the arrow keys move the selection and the live region says where it went
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('a11y-live')).toContainText('Child')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Space')
  await expect(tree.getByRole('treeitem', { name: /^Alpha/ })).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('a11y-live')).toContainText(/collapsed/i)
})

test('dashboard cards can be reached and opened with the keyboard', async ({ page }) => {
  await newMap(page, '# Keyboard map\n- One')
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: 'All maps' }).click()
  const card = page.getByRole('button', { name: /Open Keyboard map/ })
  await card.focus()
  await expect(card).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(node(page, 'One')).toBeVisible()
})

test('a dialog keeps focus inside and gives it back to the button that opened it', async ({ page }) => {
  await openApp(page)
  const opener = page.getByRole('button', { name: 'Settings' })
  await opener.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()
})

test('keyboard focus is always visible', async ({ page }) => {
  await openApp(page)
  await page.keyboard.press('Tab')
  const outline = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    const s = getComputedStyle(el)
    return { width: parseFloat(s.outlineWidth), style: s.outlineStyle, shadow: s.boxShadow }
  })
  expect(outline.style !== 'none' && outline.width >= 2 || outline.shadow !== 'none').toBe(true)
})
