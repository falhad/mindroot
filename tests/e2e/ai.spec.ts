import { expect, test } from '@playwright/test'
import { newMap, node, shoot } from './helpers'

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' }

test('AI assistant: set it up in Settings, expand an idea, undo removes everything it added', async ({ page }) => {
  const bodies: string[] = []
  const auth: string[] = []
  await page.route('https://openrouter.ai/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    bodies.push(req.postData() ?? '')
    auth.push(req.headers()['authorization'] ?? '')
    await route.fulfill({
      status: 200,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: JSON.stringify({ choices: [{ message: { content: 'Here you go:\n```json\n{"items":["Budget","Timeline","Team","Risks"]}\n```' } }] }),
    })
  })

  await newMap(page, '# Project\n- Launch\n- Secret side branch')
  // no key yet: the command asks for one and sends nothing
  await node(page, 'Launch').click()
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/command/i).fill('AI: Expand')
  await page.keyboard.press('Enter')
  await expect(page.getByText(/Add your API key first/)).toBeVisible()
  expect(bodies).toHaveLength(0)
  await expect(page.getByRole('dialog', { name: /Settings/i })).toBeVisible() // it opened the settings for us

  // set the key
  await page.getByLabel('API key').fill('sk-e2e-test-key')
  await page.getByRole('button', { name: 'Save key' }).click()
  await expect(page.getByText(/saved/).first()).toBeVisible()
  await shoot(page, 'ai-settings')
  await page.keyboard.press('Escape')

  await node(page, 'Launch').click()
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/command/i).fill('AI: Expand')
  await page.keyboard.press('Enter')
  for (const t of ['Budget', 'Timeline', 'Team', 'Risks']) await expect(node(page, t)).toBeVisible()
  expect(auth[0]).toBe('Bearer sk-e2e-test-key')
  expect(bodies[0]).toContain('Launch')
  expect(bodies[0]).not.toContain('Secret side branch') // only the selected branch is sent

  await page.keyboard.press('Control+z')
  for (const t of ['Budget', 'Timeline', 'Team', 'Risks']) await expect(node(page, t)).toHaveCount(0)
  await expect(node(page, 'Launch')).toBeVisible()

  // the key is not in any saved setting
  const leaked = await page.evaluate(() => Object.keys(localStorage).some((k) => (localStorage.getItem(k) ?? '').includes('sk-e2e-test-key')))
  expect(leaked).toBe(false)
})

test('AI assistant: an error from the service is shown and the map is not changed', async ({ page }) => {
  await page.route('https://openrouter.ai/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    await route.fulfill({ status: 401, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ error: { message: 'No auth credentials found' } }) })
  })
  await newMap(page, '# Project\n- Launch')
  await node(page, 'Launch').click()
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/command/i).fill('AI: Expand')
  await page.keyboard.press('Enter')
  await page.getByLabel('API key').fill('bad-key')
  await page.getByRole('button', { name: 'Save key' }).click()
  await page.keyboard.press('Escape')
  await node(page, 'Launch').click()
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/command/i).fill('AI: Expand')
  await page.keyboard.press('Enter')
  await expect(page.getByText(/answered 401/)).toBeVisible()
  await expect(page.locator('[data-node-id]')).toHaveCount(2)
})
