import { expect, test } from '@playwright/test'
import { openApp, shoot } from './helpers'

test('plugin gallery lists plugins with permissions, skips invalid entries, and installing needs the desktop app', async ({ page }) => {
  const sha = 'a'.repeat(64)
  const index = {
    version: 1,
    plugins: [
      { id: 'acme.notes', name: 'Smart notes', version: '2.1.0', description: 'Better notes', author: 'Acme', permissions: ['net', 'secrets'], url: 'https://example.com/notes.zip', sha256: sha },
      { id: 'acme.plain', name: 'Plain helper', version: '1.0.0', description: 'No permissions', permissions: [], url: 'https://example.com/plain.zip', sha256: sha },
      { id: 'Bad Id', name: 'Broken', version: '1', url: 'http://example.com/x.zip', sha256: 'nope', permissions: [] },
    ],
  }
  await page.route('https://raw.githubusercontent.com/**', (route) =>
    route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify(index) }),
  )
  await openApp(page)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: /^Plugins/ }).click()
  const gallery = page.getByRole('region', { name: 'Plugin gallery' })
  await expect(gallery.locator('[data-gallery-entry]')).toHaveCount(2)
  const notes = gallery.locator('[data-gallery-entry="acme.notes"]')
  await expect(notes).toContainText('Smart notes')
  await expect(notes.locator('[data-permission="net"]')).toBeVisible()
  await expect(notes.locator('[data-permission="secrets"]')).toBeVisible()
  await expect(gallery.locator('[data-gallery-entry="acme.plain"] [data-permission]')).toHaveCount(0)
  await expect(gallery.getByText(/1 entry was skipped/)).toBeVisible()
  await expect(notes.getByRole('button', { name: /Install/ })).toBeDisabled() // browser build
  await shoot(page, 'gallery')
})

test('plugin gallery: a failing list address shows a readable error', async ({ page }) => {
  await page.route('https://raw.githubusercontent.com/**', (route) => route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: 'not found' }))
  await openApp(page)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: /^Plugins/ }).click()
  await expect(page.getByRole('alert').filter({ hasText: /404/ })).toBeVisible()
})
