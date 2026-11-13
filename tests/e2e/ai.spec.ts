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

test('AI: "Generate with AI" on the dashboard makes a new map from a topic and opens it', async ({ page }) => {
  const bodies: string[] = []
  let answer = 'No JSON here, sorry.'
  await page.route('https://openrouter.ai/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    bodies.push(req.postData() ?? '')
    await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ choices: [{ message: { content: answer } }] }) })
  })
  await page.addInitScript(() => sessionStorage.setItem('mr.secret.mindroot.ai.apikey', 'sk-e2e-test-key'))
  await page.goto('/')

  await page.getByRole('button', { name: 'Generate with AI' }).click()
  const dialog = page.getByRole('dialog', { name: 'New map with AI' })
  const box = dialog.getByRole('textbox')
  await expect(box).toBeFocused()
  await expect(dialog.getByRole('button', { name: 'Make the map' })).toBeDisabled() // nothing typed yet
  await box.fill('Plan a trip to Japan')
  await shoot(page, 'ai-generate')

  // a bad answer: the dialog stays open with a message, and the text is still there
  await dialog.getByRole('button', { name: 'Make the map' }).click()
  await expect(dialog.getByRole('alert')).toContainText('did not give a usable map')
  await expect(box).toHaveValue('Plan a trip to Japan')

  answer = '```json\n{"title":"Trip to Japan","children":[{"text":"Tokyo","children":[{"text":"Shibuya"},{"text":"Museums"}]},{"text":"Kyoto","children":[{"text":"Temples"}]},{"text":"Budget"}]}\n```'
  await box.press('Control+Enter')
  for (const t of ['Trip to Japan', 'Tokyo', 'Shibuya', 'Museums', 'Kyoto', 'Temples', 'Budget']) await expect(node(page, t)).toBeVisible()
  await expect(dialog).toHaveCount(0)
  expect(JSON.parse(bodies[1]).messages[1].content).toBe('Plan a trip to Japan')

  // the map is saved: it is on the dashboard after a reload
  await page.getByRole('button', { name: 'All maps' }).click()
  await page.reload()
  await expect(page.getByText('Trip to Japan').first()).toBeVisible()
})

test('typing fields switch off the text suggestions of the system', async ({ page }) => {
  await newMap(page, '# Root\n- A')
  await page.keyboard.press('Control+k')
  const palette = page.getByPlaceholder(/command/i)
  await expect(palette).toBeFocused()
  for (const [name, value] of [['autocomplete', 'off'], ['autocorrect', 'off'], ['writingsuggestions', 'false']]) await expect(palette).toHaveAttribute(name, value)
})

test('AI shows what it is doing: a chip in the header for the open map, a status line in the dialog', async ({ page }) => {
  let release: () => void = () => {}
  let content = '{"items":["Budget","Timeline"]}'
  await page.route('https://openrouter.ai/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    await new Promise<void>((r) => { release = r }) // the model is "thinking" until the test lets it answer
    await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ choices: [{ message: { content } }] }) })
  })
  await page.addInitScript(() => sessionStorage.setItem('mr.secret.mindroot.ai.apikey', 'sk-e2e-test-key'))

  // a command on the open map: the chip is there while the model works, with the step and the seconds
  await newMap(page, '# Project\n- Launch')
  await node(page, 'Launch').click()
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/command/i).fill('AI: Expand')
  await page.keyboard.press('Enter')
  const chip = page.getByRole('banner').getByRole('status').filter({ hasText: 'AI:' })
  await expect(chip).toContainText('AI: asking gpt-4o-mini')
  await expect(chip).toContainText(/[1-9]\d* s/) // the seconds count up
  await expect(chip).toHaveAttribute('title', 'Expanding “Launch”: asking gpt-4o-mini')
  await shoot(page, 'ai-working-chip')
  release()
  await expect(node(page, 'Budget')).toBeVisible()
  await expect(chip).toHaveCount(0)

  // a new map: the dialog says what happens and stays busy until the answer comes
  await page.getByRole('button', { name: 'All maps' }).click()
  await page.getByRole('button', { name: 'Generate with AI' }).click()
  const dialog = page.getByRole('dialog', { name: 'New map with AI' })
  await dialog.getByRole('textbox').fill('Plan a trip')
  content = '{"title":"Trip","children":[{"text":"Tokyo"},{"text":"Kyoto"}]}'
  await dialog.getByRole('button', { name: 'Make the map' }).click()
  await expect(dialog.getByRole('status')).toContainText('Asking gpt-4o-mini for the map…')
  await expect(dialog.getByRole('status')).toContainText(/[1-9]\d* s/)
  await expect(dialog.getByRole('button', { name: 'Make the map' })).toBeDisabled()
  await shoot(page, 'ai-working-dialog')
  release()
  await expect(node(page, 'Tokyo')).toBeVisible()
})
