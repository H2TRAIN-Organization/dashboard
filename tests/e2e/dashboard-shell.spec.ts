import { PRIVACY_POLICY_VERSION, PRIVACY_POLICY_HASH } from '../../src/lib/privacy-policy'
import { expect, test, type Page } from './support/language'

const sessionFor = (role: 'admin' | 'doctor' | 'user') => ({
  user: {
    id: `user-${role}`,
    username: role === 'user' ? 'participante_01' : `cuenta_${role}`,
    email: role === 'user' ? null : `${role}@example.test`,
    role,
    uuid: null,
    gdprConsent: false,
    gdprConsentAt: null,
    createdAt: null,
  },
  method: role === 'user' ? 'username' : 'email',
  expiresAt: '2030-01-01T00:00:00.000Z',
  privacy: { policyVersion: PRIVACY_POLICY_VERSION, policyHash: PRIVACY_POLICY_HASH, state: 'complete' },
})

async function mockUnauthenticated(page: Page) {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/problem+json',
      body: JSON.stringify({ code: 'UNAUTHORIZED', message: 'No session' }),
    }),
  )
}

async function mockSession(page: Page, role: 'admin' | 'doctor' | 'user') {
  const session = sessionFor(role)
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(session),
    }),
  )
  await page.route('**/api/users/count', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ count: 4 }),
    }),
  )
  await page.route(/\/api\/users(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { users: [session.user], total: 1 } }),
  )
  await page.route('**/api/decrypted-data**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        insulinData: [],
        foodData: [],
        exerciseData: [],
        periodData: [],
        moodData: [],
      }),
    }),
  )
  await page.route('**/api/kubios/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'empty',
        measurement_count: 0,
        synced_at: null,
        latest_result: null,
      }),
    }),
  )
  await page.route('**/api/kubios/hrv-results**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'empty', results: [], synced_at: null }),
    }),
  )
  return session
}

test.describe('dashboard shell', () => {
  test('las rutas antiguas redirigen al acceso y al inicio comunes', async ({ page }) => {
    await mockUnauthenticated(page)
    await page.goto('/app-login')
    await expect(page).toHaveURL(/\/login$/)

    await mockSession(page, 'user')
    await page.goto('/app-dashboard')
    await expect(page).toHaveURL(/\/$/)
  })

  test('sin sesión, el inicio lleva al login unificado', async ({ page }) => {
    await mockUnauthenticated(page)
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.locator('#identifier')).toBeVisible()
    await expect(page.locator('input#email')).toHaveCount(0)
    await expect(page.locator('select[name="role"]')).toHaveCount(0)
  })

  test('un identificador con arroba se envía una sola vez y admite el legado del backend', async ({ page }) => {
    await mockUnauthenticated(page)
    const session = sessionFor('user')
    const bodies: Array<Record<string, unknown>> = []

    await page.route('**/api/auth/login', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>
      bodies.push(body)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(session),
      })
    })
    await page.goto('/login')
    await page.locator('#identifier').fill('javier.alayón@ulpgc.es')
    await page.locator('#password').fill('secreta')
    await page.getByRole('button', { name: /iniciar sesión/i }).click()

    await expect(page).toHaveURL(/\/$/)
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toEqual({
      email: 'javier.alayón@ulpgc.es',
      password: 'secreta',
    })
    expect(bodies[0]).not.toHaveProperty('username')
  })

  test('un usuario normal no puede abrir una vista restringida por URL directa', async ({ page }) => {
    await mockSession(page, 'user')
    await page.goto('/users')
    await expect(page).toHaveURL(/\/$/)
  })

  test('un doctor conserva el resumen sin recibir administración', async ({ page }) => {
    await mockSession(page, 'doctor')
    await page.goto('/overview')
    await expect(page).toHaveURL(/\/overview$/)

    await page.goto('/admin')
    await expect(page).toHaveURL(/\/$/)
  })

  test('el selector de idioma del layout persiste tras recargar', async ({ page }) => {
    await mockUnauthenticated(page)
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Bienvenido' })).toBeVisible()

    const languageTrigger = page
      .getByTestId('global-language-selector')
      .locator('button:visible')
      .first()
    await expect(languageTrigger).toHaveAttribute('aria-label', 'Idioma')
    await expect(languageTrigger).toHaveAttribute('aria-expanded', 'false')
    await languageTrigger.click()
    await page.getByRole('menuitemradio', { name: /English/ }).click()
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible()

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible()
  })

  test('el control de regreso de una vista interna apunta al inicio común', async ({ page }) => {
    await mockSession(page, 'user')
    await page.goto('/data')
    await page.locator('a[href="/"]').first().click()
    await expect(page).toHaveURL(/\/$/)
  })
})
