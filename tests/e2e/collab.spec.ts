import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { newMap, node, openApp, shoot } from './helpers'

const SERVER = 'ws://127.0.0.1:8787'
const SECRET = 'e2e-relay-secret-0123456789abcdef'

async function openSettingsTab(page: Page) {
  await page.keyboard.press('Control+,')
  await page.getByRole('button', { name: /^Live collaboration/ }).click()
}

async function configure(page: Page, name: string, secret = SECRET) {
  await openSettingsTab(page)
  await page.getByLabel('Relay server address').fill(SERVER)
  await page.getByLabel('Your name').fill(name)
  await page.getByLabel('Shared secret').fill(secret)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Secret saved.')).toBeVisible()
  await page.keyboard.press('Escape')
}

async function runCommand(page: Page, text: string) {
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/command/i).fill(text)
  await page.keyboard.press('Enter')
}

const status = (page: Page) => page.locator('[data-collab-status]')

/** Start the shared map on A and join it on B. Returns both pages on the same map. */
async function startSession(ctxA: BrowserContext, ctxB: BrowserContext) {
  const a = await ctxA.newPage()
  const b = await ctxB.newPage()
  // B's connection to the relay goes through a proxy we can cut: Playwright's setOffline does not close open sockets
  let down = false
  const open = new Set<{ close(): void }>()
  await b.routeWebSocket(/ws:\/\/127\.0\.0\.1:8787\//, (ws) => {
    if (down) return ws.close()
    ws.connectToServer()
    open.add(ws)
  })
  const network = (online: boolean) => {
    down = !online
    if (down) for (const ws of open) ws.close()
    if (down) open.clear()
  }
  await newMap(a, '# Shared plan\n- Alpha\n- Beta')
  await configure(a, 'Ann')
  await runCommand(a, 'Share this map live')
  await expect(status(a)).toHaveAttribute('data-collab-status', 'live')
  const invite = await a.evaluate(() => navigator.clipboard.readText())
  expect(invite.startsWith('mindroot-invite:')).toBe(true)

  await openApp(b)
  await openSettingsTab(b)
  await b.getByLabel('Your name').fill('Ben')
  await b.getByLabel('Invite').fill(invite)
  await b.getByRole('button', { name: 'Join', exact: true }).click()
  await expect(b.getByText('Joined. The map is open.')).toBeVisible()
  await b.keyboard.press('Escape')
  await expect(node(b, 'Alpha')).toBeVisible()
  await expect(status(b)).toHaveAttribute('data-collab-status', 'live')
  return { a, b, network }
}

test.describe('live collaboration (two browsers and the relay)', () => {
  test('edits, presence and undo are shared between two people', async ({ browser }) => {
    const ctxA = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
    const ctxB = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
    const { a, b } = await startSession(ctxA, ctxB)

    // A adds a node: B sees it quickly
    await node(a, 'Alpha').click()
    await a.keyboard.press('Tab')
    await a.keyboard.type('From Ann')
    await a.keyboard.press('Escape')
    await expect(node(b, 'From Ann')).toBeVisible({ timeout: 4000 })

    // B edits the text of a node: A sees it
    await node(b, 'Beta').dblclick()
    await b.keyboard.type('Beta by Ben')
    await b.keyboard.press('Escape')
    await expect(node(a, 'Beta by Ben')).toBeVisible({ timeout: 4000 })

    // presence: A selects a node, B sees A's name next to it
    await node(a, 'Beta by Ben').click()
    await expect(b.locator('[data-peer="Ann"]')).toBeVisible({ timeout: 4000 })
    await expect(status(b)).toContainText('1 other')
    await shoot(b, 'collab')

    // undo on B removes only B's own edit
    await node(b, 'Alpha').click()
    await b.keyboard.press('Tab')
    await b.keyboard.type('From Ben')
    await b.keyboard.press('Escape')
    await expect(node(a, 'From Ben')).toBeVisible({ timeout: 4000 })
    await b.waitForTimeout(700) // let the undo manager close its step
    await b.locator('.canvas').first().click({ position: { x: 5, y: 5 } }).catch(() => {})
    await b.keyboard.press('Control+z')
    await expect(node(b, 'From Ben')).toHaveCount(0)
    await expect(node(a, 'From Ben')).toHaveCount(0, { timeout: 4000 }) // the undo is shared
    await expect(node(b, 'From Ann')).toBeVisible() // Ann's node is still there
    await expect(node(a, 'From Ann')).toBeVisible()
    await ctxA.close()
    await ctxB.close()
  })

  test('edits made offline on both sides are merged when the connection returns', async ({ browser }) => {
    const ctxA = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
    const ctxB = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
    const { a, b, network } = await startSession(ctxA, ctxB)

    network(false)
    await expect(status(b)).toHaveAttribute('data-collab-status', 'offline', { timeout: 15_000 })
    // both people edit different things
    await node(a, 'Alpha').click()
    await a.keyboard.press('Tab')
    await a.keyboard.type('Ann while Ben is away')
    await a.keyboard.press('Escape')
    await node(b, 'Beta').click()
    await b.keyboard.press('Tab')
    await b.keyboard.type('Ben offline')
    await b.keyboard.press('Escape')
    await expect(node(b, 'Ben offline')).toBeVisible()
    await expect(node(a, 'Ben offline')).toHaveCount(0)

    network(true)
    await expect(node(a, 'Ben offline')).toBeVisible({ timeout: 20_000 })
    await expect(node(b, 'Ann while Ben is away')).toBeVisible({ timeout: 20_000 })
    await expect(status(b)).toHaveAttribute('data-collab-status', 'live', { timeout: 20_000 })
    await ctxA.close()
    await ctxB.close()
  })

  test('a wrong token is refused: no map is downloaded and nothing is remembered', async ({ browser }) => {
    const ctxA = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
    const a = await ctxA.newPage()
    await newMap(a, '# Private\n- One')
    await configure(a, 'Ann')
    await runCommand(a, 'Share this map live')
    await expect(status(a)).toHaveAttribute('data-collab-status', 'live')
    const invite = await a.evaluate(() => navigator.clipboard.readText())

    // the same invite with a different secret inside
    const body = JSON.parse(Buffer.from(invite.slice('mindroot-invite:'.length), 'base64url').toString('utf8'))
    body.k = 'c'.repeat(64) // a token the relay did not issue for this room
    const forged = 'mindroot-invite:' + Buffer.from(JSON.stringify(body)).toString('base64url')

    const ctxC = await browser.newContext()
    const c = await ctxC.newPage()
    await openApp(c)
    await openSettingsTab(c)
    await c.getByLabel('Invite').fill(forged)
    await c.getByRole('button', { name: 'Join', exact: true }).click()
    await expect(c.getByText(/did not accept this invite/)).toBeVisible({ timeout: 20_000 })
    await c.keyboard.press('Escape')
    await expect(c.getByRole('button', { name: /Open Private/ })).toHaveCount(0)
    await ctxA.close()
    await ctxC.close()
  })

  test('an invite opens one map only: the invitee has no secret and cannot share anything else', async ({ browser }) => {
    const ctxA = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
    const ctxB = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
    const { a, b } = await startSession(ctxA, ctxB)
    // the invite text does not contain the master secret
    const invite = await a.evaluate(() => navigator.clipboard.readText())
    expect(Buffer.from(invite.slice('mindroot-invite:'.length), 'base64url').toString('utf8')).not.toContain(SECRET)
    // B can use the map it was invited to ...
    await expect(status(b)).toHaveAttribute('data-collab-status', 'live')
    // ... but has no secret and no server of its own, so it cannot share another map
    await b.getByRole('button', { name: 'All maps' }).click()
    await newMap(b, '# Ben private\n- X')
    await runCommand(b, 'Share this map live')
    await expect(b.getByText(/Set the server address and the secret first/)).toBeVisible()
    await ctxA.close()
    await ctxB.close()
  })

  test('an invite that would re-point an already shared map asks first, and Cancel changes nothing', async ({ browser }) => {
    const ctxA = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
    const ctxB = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
    const { a, b } = await startSession(ctxA, ctxB)
    const invite = await a.evaluate(() => navigator.clipboard.readText())
    const body = JSON.parse(Buffer.from(invite.slice('mindroot-invite:'.length), 'base64url').toString('utf8'))
    body.s = 'ws://127.0.0.1:8799' // a different (not running) server, for the same map
    const other = 'mindroot-invite:' + Buffer.from(JSON.stringify(body)).toString('base64url')

    await openSettingsTab(b)
    await b.getByLabel('Invite').fill(other)
    await b.getByRole('button', { name: 'Join', exact: true }).click()
    await expect(b.getByRole('dialog', { name: /Replace how this map is shared/ })).toBeVisible()
    await b.getByRole('button', { name: 'Cancel' }).click()
    await expect(b.getByText(/Cancelled. Nothing was changed./)).toBeVisible()
    await b.keyboard.press('Escape')
    // still connected to the original server
    await expect(status(b)).toHaveAttribute('data-collab-status', 'live')
    await node(a, 'Alpha').click()
    await a.keyboard.press('Tab')
    await a.keyboard.type('Still shared')
    await a.keyboard.press('Escape')
    await expect(node(b, 'Still shared')).toBeVisible({ timeout: 5000 })
    await ctxA.close()
    await ctxB.close()
  })
})
