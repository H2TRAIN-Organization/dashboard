import { test, expect } from '@playwright/test'

/**
 * Backend-real suite. Auth and users calls go to the mounted Root 4630 API;
 * only /api/kubios/** and non-local hosts are intercepted. This file must not
 * import the frontend API mock.
 */
const baseURL = 'http://localhost:4630'
const admin = { email: 'admin.acceptance@example.test', password: 'Acceptance-Admin-1!' }
const usernameUser = { username: 'acceptance.bcrypt', password: 'Acceptance-Bcrypt-1!' }

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ page }) => {
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

test('admin email login, cookie reload, Users CRUD and logout', async ({ page }) => {
  await page.goto('/login')
  await waitForHydration(page)
  await page.locator('#email').fill(admin.email)
  await page.locator('#password').fill(admin.password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL('**/')
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
  await page.waitForURL('**/app-login')
})

test('username login, cookie reload, app logout isolation', async ({ page }) => {
  await page.goto('/app-login')
  await waitForHydration(page)
  await page.locator('#username').fill(usernameUser.username)
  await page.locator('#password').fill(usernameUser.password)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL('**/app-dashboard')
  await expect(page.getByText(usernameUser.username).first()).toBeVisible()
  await page.reload()
  await expect(page.getByText(usernameUser.username).first()).toBeVisible()

  await page.getByRole('button', { name: /Cerrar sesi.n/i }).last().click()
  await page.waitForURL('**/app-login')
  await page.goto('/')
  await page.waitForURL('**/login')
})
