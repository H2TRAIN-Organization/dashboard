import { PRIVACY_POLICY_VERSION, PRIVACY_POLICY_HASH } from '../../src/lib/privacy-policy.ts'
import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

/**
 * Backend-real suite. Auth and users calls go to the mounted Root 4630 API;
 * only /api/kubios/** and non-local hosts are intercepted. This file must not
 * import the frontend API mock.
 */
const baseURL = 'http://localhost:4630'
const admin = { email: 'admin.acceptance@example.test', password: 'Acceptance-Admin-1!' }
const usernameUser = { username: 'acceptance.bcrypt', password: 'Acceptance-Bcrypt-1!' }

test.describe.configure({ mode: 'default' })

test.beforeEach(async ({ page, request }) => {
  const reset = await request.post('http://127.0.0.1:4900/supabase/__reset')
  expect(reset.status()).toBe(204)
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      await route.abort()
      return
    }
    await route.continue()
  })
  await page.route('**/api/kubios/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ users: [{ user_id: 'synthetic-kubios', name: 'Synthetic' }] }),
    }),
  )
})

async function waitForHydration(page) {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(800)
}

async function acceptAccessNotices(page) {
  const initial = page.getByRole('dialog', { name: /^(Aviso de privacidad|Privacy notice)$/ })
  await initial.getByRole('button', { name: /He leído y acepto continuar|I have read and accept to continue|I have read and agree to continue/ }).click()
  // Single-stage flow: one acceptance dismisses the gate; no banner exists.
  await expect(initial).not.toBeVisible()
  await expect(page.getByRole('complementary', { name: /^(Aviso de privacidad|Privacy notice)$/ })).toHaveCount(0)
}

test('admin email login, cookie reload, Users CRUD and logout', async ({ page }) => {
  await page.goto('/login')
  await waitForHydration(page)
  await page.locator('#identifier').fill(admin.email)
  await page.locator('#password').fill(admin.password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL('**/')
  await acceptAccessNotices(page)
  await expect(page.locator('a[href="/users"]').first()).toBeVisible()
  await page.reload()
  await expect(page.locator('a[href="/users"]').first()).toBeVisible()

  await page.goto('/users')
  await expect(page.locator('tbody tr', { hasText: 'admin.acceptance@example.test' })).toBeVisible()
  const unique = `real.${Date.now()}`
  await page.getByRole('button', { name: /Crear Usuario/ }).click()
  const createModal = page.locator('div.fixed.inset-0').filter({ hasText: 'Crear Nuevo Usuario' })
  await createModal.locator('input[type="text"]').fill(unique)
  await createModal.locator('input[type="password"]').fill('Real-Pass-1!')
  await createModal.locator('select').selectOption('user')
  await createModal.locator('button[type="submit"]').click()
  await expect(page.getByText('Usuario creado exitosamente')).toBeVisible()
  const row = page.locator('tbody tr', { hasText: unique })
  await expect(row).toBeVisible()

  await row.locator('button[title="Editar"]').click()
  const editModal = page.locator('div.fixed.inset-0').filter({ hasText: 'Editar Usuario' })
  await editModal.locator('#gdpr-consent').check()
  await editModal.getByRole('button', { name: /Guardar/ }).click()
  await expect(page.getByText('Usuario actualizado exitosamente')).toBeVisible()

  await row.locator('select').selectOption('doctor')
  await expect(page.getByText('Rol actualizado exitosamente')).toBeVisible()
  await expect(row.locator('select')).toHaveValue('doctor')

  page.once('dialog', (dialog) => dialog.accept())
  await row.locator('button[title="Eliminar"]').click()
  await expect(page.getByText('Usuario eliminado exitosamente')).toBeVisible()
  await expect(page.locator('tbody tr', { hasText: unique })).toHaveCount(0)

  await page.getByRole('button', { name: /Cerrar sesi.n/i }).last().click()
  await page.waitForURL('**/login')
  await page.goto('/app-dashboard')
  await page.waitForURL('**/login')
})

test('username login, cookie reload, app logout isolation', async ({ page }) => {
  await page.goto('/app-login')
  await waitForHydration(page)
  await page.locator('#identifier').fill(usernameUser.username)
  await page.locator('#password').fill(usernameUser.password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL('**/')
  await acceptAccessNotices(page)
  await expect(page.getByText(usernameUser.username).first()).toBeVisible()
  await page.reload()
  await expect(page.getByText(usernameUser.username).first()).toBeVisible()

  await page.getByRole('button', { name: /Cerrar sesi.n/i }).last().click()
  await page.waitForURL('**/login')
  await page.goto('/')
  await page.waitForURL('**/login')
})

test('user opens categories directly, exports hidden records, and cannot elevate a local role', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/app-login')
  await page.waitForURL('**/login')
  await waitForHydration(page)
  await page.locator('#identifier').fill(usernameUser.username)
  await page.locator('#password').fill(usernameUser.password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL('**/')
  await acceptAccessNotices(page)
  await page.goto('/data')
  await expect(page.getByRole('heading', { name: /Insulina \(4/ })).toBeVisible()
  await expect(page.getByRole('combobox')).toHaveCount(2)
  await expect(page.getByPlaceholder(/Buscar en todos/i)).toHaveCount(0)
  const downloadable = page.waitForEvent('download')
  await page.getByRole('button', { name: /Exportar CSV/i }).click()
  const download = await downloadable
  const csv = await readFile(await download.path(), 'utf8')
  expect(csv.trim().split('\n')).toHaveLength(5)
  expect(csv).toContain('record_id;username;category;recorded_at')
  expect(csv).not.toMatch(/_iv|PasswordHash|ciphertext/)
  await page.reload()
  await expect(page.getByRole('heading', { name: /Insulina \(4/ })).toBeVisible()
  await page.evaluate(() => localStorage.setItem('appUser', JSON.stringify({ username: 'forged', role: 'admin' })))
  await page.goto('/users')
  await page.waitForURL('**/')
  await expect(page.locator('a[href="/admin"]')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('language selector persists on login and mobile navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/login')
  await waitForHydration(page)
  const selector = page.getByTestId('global-language-selector')
  await expect(selector).toBeVisible()
  await selector.getByRole('button', { name: 'Idioma' }).click()
  await selector.getByRole('menuitemradio', { name: /English/ }).click()
  await expect(page.locator('label[for="identifier"]')).toHaveText(/Email or participant name/i)
  await page.reload()
  await expect(page.locator('label[for="identifier"]')).toHaveText(/Email or participant name/i)
  await page.locator('#identifier').fill(usernameUser.username)
  await page.locator('#password').fill(usernameUser.password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL('**/')
  await acceptAccessNotices(page)
  await expect(page.getByTestId('global-language-selector')).toBeVisible()
  await page.goto('/data')
  await expect(page.getByRole('heading', { name: /Insulin.*\(4/ })).toBeVisible()
  await page.screenshot({ path: 'test-results/dashboard-remaking/mobile-health-en.png', fullPage: true })
})

test('admin pages the same users on desktop and mobile and synchronizes horizontal scroll', async ({ page, request }) => {
  const cleanup = await request.delete('http://127.0.0.1:4900/supabase/rest/v1/users?Username=like.dr.ui.member*')
  expect(cleanup.status()).toBe(204)
  const seed = await request.post('http://127.0.0.1:4900/supabase/rest/v1/users', {
    data: Array.from({ length: 32 }, (_, index) => ({ UserID: 500 + index, Username: `dr.ui.member${String(index + 1).padStart(2, '0')}`, PasswordHash: 'a'.repeat(64), role: 'user' })),
  })
  expect(seed.status()).toBe(201)
  await page.goto('/login')
  await waitForHydration(page)
  await page.locator('#identifier').fill(admin.email)
  await page.locator('#password').fill(admin.password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL('**/')
  await acceptAccessNotices(page)
  await page.goto('/users')
  await expect(page.locator('#users-page-size')).toHaveValue('25')
  await expect(page.locator('tbody tr')).toHaveCount(25)
  await page.getByRole('textbox', { name: /Buscar usuarios/i }).fill('dr.ui.member')
  await expect(page.locator('tbody tr')).toHaveCount(25)
  await page.locator('#users-page-size').selectOption('10')
  await expect(page.locator('tbody tr')).toHaveCount(10)
  await expect(page.locator('tbody tr').first()).toContainText('dr.ui.member01')
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click()
  await expect(page.locator('tbody tr').first()).toContainText('dr.ui.member11')
  await page.setViewportSize({ width: 1100, height: 900 })
  const top = page.locator('div[aria-hidden="true"].overflow-x-auto')
  await expect(top).toBeVisible()
  await top.evaluate(element => { element.scrollLeft = 50; element.dispatchEvent(new Event('scroll')) })
  await expect.poll(() => page.locator('table').locator('..').evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
  await page.locator('#users-page-size').selectOption('50')
  await expect(page.locator('tbody tr')).toHaveCount(32)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('table')).not.toBeVisible()
  await expect(page.getByText('dr.ui.member32', { exact: true }).filter({ visible: true }).first()).toBeVisible()
  await page.screenshot({ path: 'test-results/dashboard-remaking/mobile-users.png', fullPage: true })
})

test('renders the verified 24-row live readback in the UI with a synthetic session fixture', async ({ page }) => {
  const fixturePath = 'test-results/dashboard-remaking/seed-health.json'
  test.skip(!existsSync(fixturePath), 'Optional: run the read-only live seed verification first')
  const data = JSON.parse(await readFile(fixturePath, 'utf8'))
  const username = data.insulinData[0].username
  await page.route('**/api/auth/session', route => route.fulfill({ json: { user: { id: 'synthetic-display-only', username, email: null, role: 'user', uuid: null, gdprConsent: false, gdprConsentAt: null, createdAt: null }, method: 'username', expiresAt: '2099-01-01T00:00:00.000Z', privacy: { policyVersion: PRIVACY_POLICY_VERSION, policyHash: PRIVACY_POLICY_HASH, state: 'complete' } } }))
  await page.route(/\/api\/users(?:\?.*)?$/, route => route.fulfill({ json: { users: [{ id: 'synthetic-display-only', username, email: null, role: 'user', uuid: null, gdprConsent: false, gdprConsentAt: null, createdAt: null }], total: 1 } }))
  await page.route('**/api/decrypted-data?**', route => route.fulfill({ json: data }))
  await page.goto('/data')
  await expect(page.getByRole('heading', { name: /insulina.*\(8/i })).toBeVisible()
  await expect(page.getByRole('heading', { name: /comidas.*\(8/i })).toBeVisible()
  await expect(page.getByRole('heading', { name: /ejercicio.*\(8/i })).toBeVisible()
  const downloadable = page.waitForEvent('download')
  await page.getByRole('button', { name: /Exportar CSV/i }).click()
  const csv = await readFile(await (await downloadable).path(), 'utf8')
  expect(csv.trim().split('\n')).toHaveLength(25)
  await page.screenshot({ path: 'test-results/dashboard-remaking/verified-seed-render.png', fullPage: true })
})
