import { expect, test, type Page } from '@playwright/test'

/**
 * Contraste tarjeta ↔ vista /kubios con respuestas sintéticas del contrato.
 * No usa servicios reales ni Kubios: toda la API se intercepta, la sesión se
 * simula con una cookie sintética y los endpoints de usuarios y datos quedan
 * cubiertos para que ningún 401 accidental cambie el escenario.
 *
 * PLAYWRIGHT_BASE_URL=http://localhost:4630 npx playwright test tests/e2e/dashboard-hrv.spec.ts
 */
const BASE_URL = 'http://localhost:4630'
const configuredBaseURL = process.env.PLAYWRIGHT_BASE_URL

interface SyntheticUser {
  id: string
  username: string
  email: string | null
  role: 'user'
  uuid: string | null
  gdprConsent: boolean
  gdprConsentAt: string | null
  createdAt: string | null
}

interface StubResponse {
  status: number
  body: unknown
}

interface ApiState {
  session: SyntheticUser | null
  me: StubResponse
  results: StubResponse
  login: {
    user: SyntheticUser
    me: StubResponse
    results: StubResponse
  }
}

const alice: SyntheticUser = {
  id: 'hrv-e2e-alice',
  username: 'hrv.e2e.alice',
  email: null,
  role: 'user',
  uuid: null,
  gdprConsent: true,
  gdprConsentAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
}

const bob: SyntheticUser = {
  id: 'hrv-e2e-bob',
  username: 'hrv.e2e.bob',
  email: null,
  role: 'user',
  uuid: null,
  gdprConsent: true,
  gdprConsentAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
}

const latestAlice = {
  measured_timestamp: '2026-11-01T08:30:00Z',
  daily_result: 'normal',
  result: { readiness: 72, mean_hr_bpm: 58, rmssd_ms: 44.2 },
}

const latestBob = {
  measured_timestamp: '2026-10-20T08:30:00Z',
  daily_result: 'normal',
  result: { readiness: 43, mean_hr_bpm: 66, rmssd_ms: 31.2 },
}

const readySummary = {
  status: 'ready',
  measurement_count: 2,
  synced_at: '2026-11-03T10:00:00.000Z',
  latest_result: latestAlice,
}

const readyResults = {
  status: 'ready',
  synced_at: '2026-11-03T10:00:00.000Z',
  results: [
    latestAlice,
    {
      measured_timestamp: '2026-10-31T08:30:00Z',
      daily_result: 'normal',
      result: { readiness: 64, mean_hr_bpm: 60, rmssd_ms: 39.1 },
    },
  ],
}

const summaryOnly = {
  status: 'stale',
  measurement_count: 3,
  synced_at: '2026-11-03T10:00:00.000Z',
  latest_result: {
    measured_timestamp: '2026-10-28T08:30:00Z',
    daily_result: 'normal',
    result: { readiness: 81 },
  },
}

const staleWarning =
  'Los datos mostrados son la última copia sincronizada y podrían no estar actualizados.'
const serviceUnavailable =
  'El servicio de Kubios no está disponible en este momento. Inténtalo de nuevo más tarde.'

function ok(body: unknown): StubResponse {
  return { status: 200, body }
}

function failure(status: number, code: string): StubResponse {
  return {
    status,
    body: { error: { code, message: `Fallo sintético: ${code}` } },
  }
}

function sessionBody(user: SyntheticUser) {
  return {
    user,
    method: 'username',
    expiresAt: '2099-01-01T00:00:00.000Z',
  }
}

function createState(): ApiState {
  return {
    session: alice,
    me: ok(readySummary),
    results: ok(readyResults),
    login: {
      user: alice,
      me: ok(readySummary),
      results: ok(readyResults),
    },
  }
}

async function installSyntheticApi(page: Page, state: ApiState) {
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()

    if (path === '/api/auth/session' && method === 'GET') {
      if (state.session === null) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'UNAUTHORIZED', message: 'Sesión sintética cerrada' },
          }),
        })
        return
      }

      const currentUser = state.session
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(sessionBody(currentUser)),
      })
      return
    }

    if (path === '/api/auth/logout' && method === 'POST') {
      state.session = null
      await route.fulfill({
        status: 204,
        headers: {
          'set-cookie':
            'dashboard_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
        },
      })
      return
    }

    if (path === '/api/auth/login' && method === 'POST') {
      const nextUser = state.login.user
      state.session = nextUser
      state.me = state.login.me
      state.results = state.login.results
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'set-cookie':
            'dashboard_session=synthetic-hrv-e2e; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600',
        },
        body: JSON.stringify(sessionBody(nextUser)),
      })
      return
    }

    if (path === '/api/users/count' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ count: 1 }),
      })
      return
    }

    if (path === '/api/users' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ users: [], total: 0 }),
      })
      return
    }

    if (path === '/api/decrypted-data' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          insulinData: [],
          foodData: [],
          exerciseData: [],
          periodData: [],
          moodData: [],
        }),
      })
      return
    }

    if (path === '/api/kubios/team-users' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ users: [] }),
      })
      return
    }

    if (path === '/api/kubios/me' && method === 'GET') {
      await route.fulfill({
        status: state.me.status,
        contentType: 'application/json',
        body: JSON.stringify(state.me.body),
      })
      return
    }

    if (path === '/api/kubios/hrv-results' && method === 'GET') {
      await route.fulfill({
        status: state.results.status,
        contentType: 'application/json',
        body: JSON.stringify(state.results.body),
      })
      return
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'NOT_MOCKED', message: `Sin mock: ${method} ${path}` },
      }),
    })
  })
}

function card(page: Page) {
  return page.getByRole('link', { name: 'Ver Kubios', exact: true })
}

function viewMarker(page: Page) {
  return page.getByText('Solo se muestran los datos propios de Kubios.', {
    exact: true,
  })
}

async function openDashboard(page: Page, state: ApiState) {
  await installSyntheticApi(page, state)
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Diabetes Tracker' }).first(),
  ).toBeVisible()
  await page.waitForLoadState('networkidle')
}

async function openKubios(page: Page) {
  await page.goto('/kubios')
  await expect(viewMarker(page)).toBeVisible()
}

test.describe('Dashboard HRV card and /kubios coherence', () => {
  test.use({ baseURL: BASE_URL, timezoneId: 'UTC' })

  test.skip(
    configuredBaseURL === undefined ||
      configuredBaseURL.replace(/\/$/, '') !== BASE_URL,
    'Set PLAYWRIGHT_BASE_URL=http://localhost:4630 to run these UI tests.',
  )

  test.beforeEach(async ({ context }) => {
    await context.addCookies([
      {
        name: 'dashboard_session',
        value: 'synthetic-hrv-e2e',
        url: BASE_URL,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ])
  })

  test('ready: card and view show the same measurements', async ({ page }) => {
    const state = createState()
    await openDashboard(page, state)

    await expect(card(page)).toBeVisible()
    await expect(card(page)).toContainText('72.0%')
    await expect(card(page)).toContainText('2')
    await expect(card(page).getByText(staleWarning)).toHaveCount(0)

    await card(page).click()
    await expect(page).toHaveURL(/\/kubios$/)
    await expect(viewMarker(page)).toBeVisible()
    await expect(page.getByText('2 mediciones', { exact: true })).toBeVisible()
    await expect(page.locator('article')).toHaveCount(2)
    await expect(page.getByText(staleWarning)).toHaveCount(0)
  })

  test('stale with results: card and view keep rows and the stale label', async ({
    page,
  }) => {
    const state = createState()
    state.me = ok({ ...readySummary, status: 'stale' })
    state.results = ok({ ...readyResults, status: 'stale' })

    await openDashboard(page, state)

    await expect(card(page)).toBeVisible()
    await expect(card(page)).toContainText('72.0%')
    await expect(card(page).getByText(staleWarning)).toBeVisible()

    await card(page).click()
    await expect(page).toHaveURL(/\/kubios$/)
    await expect(viewMarker(page)).toBeVisible()
    await expect(page.getByText(staleWarning)).toBeVisible()
    await expect(page.getByText('2 mediciones', { exact: true })).toBeVisible()
    await expect(page.locator('article')).toHaveCount(2)
  })

  test('stale with summary only: card and view use latest_result without inventing rows', async ({
    page,
  }) => {
    const state = createState()
    state.me = ok(summaryOnly)
    state.results = ok({
      status: 'stale',
      synced_at: '2026-11-03T10:00:00.000Z',
      results: [],
    })

    await openDashboard(page, state)

    await expect(card(page)).toBeVisible()
    await expect(card(page)).toContainText('81.0%')
    await expect(card(page).getByText('3', { exact: true })).toBeVisible()
    await expect(card(page).getByText(staleWarning)).toBeVisible()

    await card(page).click()
    await expect(page).toHaveURL(/\/kubios$/)
    await expect(viewMarker(page)).toBeVisible()
    await expect(page.getByText(staleWarning)).toBeVisible()
    await expect(page.getByText(/81\.0%/).first()).toBeVisible()
    await expect(page.locator('article')).toHaveCount(0)
    await expect(
      page.getByText('Todavía no hay mediciones HRV sincronizadas en la cuenta.', {
        exact: true,
      }),
    ).toBeVisible()

    const totalCard = page.getByText('mediciones', { exact: true }).locator('..')
    await expect(totalCard.getByText('3', { exact: true })).toBeVisible()
  })

  test('results failure: card and view keep the summary and show the error', async ({
    page,
  }) => {
    const state = createState()
    state.me = ok({
      ...summaryOnly,
      measurement_count: 2,
      latest_result: {
        measured_timestamp: '2026-10-28T08:30:00Z',
        daily_result: 'normal',
        result: { readiness: 84 },
      },
    })
    state.results = failure(503, 'KUBIOS_UNAVAILABLE')

    await openDashboard(page, state)

    await expect(card(page)).toBeVisible()
    await expect(card(page)).toContainText('84.0%')
    await expect(card(page).getByText(staleWarning)).toBeVisible()
    await expect(card(page).getByText(serviceUnavailable)).toBeVisible()

    await card(page).click()
    await expect(page).toHaveURL(/\/kubios$/)
    await expect(viewMarker(page)).toBeVisible()
    await expect(page.getByText(serviceUnavailable)).toBeVisible()
    await expect(page.getByText(staleWarning)).toBeVisible()
    await expect(page.getByText(/84\.0%/).first()).toBeVisible()
    await expect(page.locator('article')).toHaveCount(0)

    const totalCard = page.getByText('mediciones', { exact: true }).locator('..')
    await expect(totalCard.getByText('2', { exact: true })).toBeVisible()
  })

  test('an active range never displays global summary metrics when its results fail', async ({ page }) => {
    const state = createState()
    state.me = ok({ ...summaryOnly, measurement_count: 2, latest_result: { ...latestAlice, result: { readiness: 84 } } })
    state.results = failure(503, 'KUBIOS_UNAVAILABLE')
    await openDashboard(page, state)
    await expect(card(page)).toContainText('84.0%')
    await card(page).click()
    await expect(page.getByText(/84\.0%/).first()).toBeVisible()
    await page.locator('#kubios-date-from').fill('2026-11-02')
    await expect(page.getByText(serviceUnavailable)).toBeVisible()
    await expect(page.getByText(/84\.0%/)).toHaveCount(0)
    await expect(page.locator('article')).toHaveCount(0)
    await expect(page.locator('#kubios-date-from')).toHaveValue('2026-11-02')
  })

  test('empty: card and view do not announce measurements', async ({ page }) => {
    const state = createState()
    state.me = ok({
      status: 'empty',
      measurement_count: 0,
      synced_at: null,
      latest_result: null,
    })
    state.results = ok({ status: 'empty', synced_at: null, results: [] })

    await openDashboard(page, state)
    await expect(card(page)).toHaveCount(0)

    await openKubios(page)
    await expect(
      page.getByText('Todavía no hay mediciones HRV sincronizadas en la cuenta.', {
        exact: true,
      }),
    ).toBeVisible()
    await expect(page.locator('article')).toHaveCount(0)
    await expect(page.getByText(staleWarning)).toHaveCount(0)
  })

  test('identity change: a new session never reuses the previous summary', async ({
    page,
  }) => {
    const state = createState()
    state.login = {
      user: bob,
      me: ok({
        status: 'ready',
        measurement_count: 1,
        synced_at: '2026-11-03T11:00:00.000Z',
        latest_result: latestBob,
      }),
      results: ok({
        status: 'ready',
        synced_at: '2026-11-03T11:00:00.000Z',
        results: [latestBob],
      }),
    }

    await openDashboard(page, state)
    await expect(card(page)).toBeVisible()
    await expect(card(page)).toContainText('72.0%')

    await page.getByRole('button', { name: /cerrar sesión/i }).click()
    await page.waitForURL(/\/login$/)

    await page.locator('#identifier').fill(bob.username)
    await page.locator('#password').fill('synthetic-password')
    await page.locator('button[type="submit"]').click()
    await page.waitForURL((url) => url.pathname === '/')

    await expect(card(page)).toBeVisible()
    await expect(card(page)).toContainText('43.0%')
    await expect(card(page)).not.toContainText('72.0%')

    await card(page).click()
    await expect(page).toHaveURL(/\/kubios$/)
    await expect(viewMarker(page)).toBeVisible()
    await expect(page.getByText(/43\.0%/).first()).toBeVisible()
    await expect(page.getByText(/72\.0%/)).toHaveCount(0)
    await expect(page.locator('article')).toHaveCount(1)
  })
})
