import { expect, test, type Page } from './support/language'
import type { Route } from '@playwright/test'
import { PRIVACY_POLICY_VERSION, PRIVACY_POLICY_HASH } from '../../src/lib/privacy-policy'

/**
 * Ciclo de vida del botón Actualizar de la vista personal de Kubios.
 *
 * Las respuestas se interceptan en el navegador: no se contacta Kubios ni la
 * API real. Cada prueba comprueba que la recarga manual vuelve a leer ambos
 * endpoints personales, mantiene el rango activo y muestra carga y fin de la
 * recarga, incluso cuando el snapshot no cambia.
 *
 * Requiere un servidor local:
 * PLAYWRIGHT_BASE_URL=http://127.0.0.1:3107 npx playwright test tests/e2e/kubios-refresh.spec.ts
 */
test.describe('Kubios personal manual refresh', () => {
  test.use({ timezoneId: 'UTC' })

  test.skip(
    process.env.PLAYWRIGHT_BASE_URL === undefined,
    'Set PLAYWRIGHT_BASE_URL to a local Next server to run these UI tests.',
  )

  interface KubiosRange {
    from: string | null
    to: string | null
  }

  interface MockResponse {
    status?: number
    body: unknown
  }

  type Responder<T> = (
    value: T,
    callIndex: number,
  ) => MockResponse | Promise<MockResponse>

  interface KubiosMockOptions {
    me?: (callIndex: number) => MockResponse | Promise<MockResponse>
    results?: Responder<KubiosRange>
  }

  function result(
    measuredTimestamp: string,
    readiness: number,
    extra: Record<string, unknown> = {},
  ) {
    return {
      measured_timestamp: measuredTimestamp,
      daily_result: 'normal',
      result: {
        readiness,
        mean_hr_bpm: 58,
        rmssd_ms: 44.2,
        pns_index: 1.5,
        sns_index: -0.5,
        physiological_age: 31,
        respiratory_rate: 14.5,
        stress_index: 12,
        artefact_level: 'good',
        freq_domain: {
          HF_power: 1200,
          LF_power: 800,
          VLF_power: 300,
          tot_power: 2300,
        },
        ...extra,
      },
    }
  }

  const latestResult = result('2026-11-01T08:30:00Z', 72)

  const baseSummary = {
    status: 'ready',
    measurement_count: 2,
    synced_at: '2026-11-03T10:00:00.000Z',
    latest_result: latestResult,
  }

  const baseResults = {
    status: 'ready',
    synced_at: '2026-11-03T10:00:00.000Z',
    results: [latestResult, result('2026-10-31T08:30:00Z', 64)],
  }

  const rangeResults = {
    status: 'ready',
    synced_at: '2026-11-03T10:00:00.000Z',
    results: [result('2026-10-15T12:00:00Z', 55)],
  }

  const secondRangeResults = {
    status: 'ready',
    synced_at: '2026-11-03T10:00:00.000Z',
    results: [result('2026-09-20T12:00:00Z', 62)],
  }

  const staleRefreshResults = {
    status: 'ready',
    synced_at: '2026-11-03T10:00:00.000Z',
    results: [result('2026-10-16T12:00:00Z', 99)],
  }

  const updatedLatest = result('2026-11-05T08:30:00Z', 81)

  const updatedSummary = {
    status: 'ready',
    measurement_count: 3,
    synced_at: '2026-11-05T10:00:00.000Z',
    latest_result: updatedLatest,
  }

  const updatedRangeResults = {
    status: 'ready',
    synced_at: '2026-11-05T10:00:00.000Z',
    results: [
      updatedLatest,
      result('2026-10-20T08:30:00Z', 77),
      result('2026-10-05T08:30:00Z', 70),
    ],
  }

  function deferred() {
    let resolve!: () => void
    const promise = new Promise<void>((next) => {
      resolve = next
    })
    return { promise, resolve }
  }

  async function fulfill(route: Route, response: MockResponse) {
    try {
      await route.fulfill({
        status: response.status ?? 200,
        contentType: 'application/json',
        body: JSON.stringify(response.body),
      })
    } catch {
      // La UI puede abortar la petición al cambiar de rango o de sesión.
    }
  }

  async function mockSession(page: Page) {
    await page.route('**/api/auth/session', (route) =>
      fulfill(route, {
        body: {
          user: {
            id: '42',
            username: 'alice',
            email: null,
            role: 'user',
            uuid: null,
            gdprConsent: true,
            gdprConsentAt: null,
            createdAt: null,
          },
          method: 'email',
          expiresAt: '2026-11-04T10:00:00.000Z',
          privacy: { policyVersion: PRIVACY_POLICY_VERSION, policyHash: PRIVACY_POLICY_HASH, state: 'complete' },
        },
      }),
    )
  }

  async function mockKubios(page: Page, options: KubiosMockOptions = {}) {
    const meRequests: string[] = []
    const resultRequests: string[] = []

    await page.route('**/api/kubios/me', async (route) => {
      const callIndex = meRequests.length
      meRequests.push(route.request().url())
      const response = await (options.me ?? (() => ({ body: baseSummary })))(
        callIndex,
      )
      await fulfill(route, response)
    })

    await page.route('**/api/kubios/hrv-results*', async (route) => {
      const url = new URL(route.request().url())
      const range = {
        from: url.searchParams.get('from'),
        to: url.searchParams.get('to'),
      }
      const callIndex = resultRequests.length
      resultRequests.push(url.search)
      const response = await (options.results ?? (() => ({ body: baseResults })))(
        range,
        callIndex,
      )
      await fulfill(route, response)
    })

    return { meRequests, resultRequests }
  }

  function refreshButton(page: Page) {
    return page.getByRole('button', { name: 'Actualizar', exact: true })
  }

  test('keeps the active range, shows immediate loading and reads new snapshots', async ({
    page,
  }) => {
    await mockSession(page)

    let holdRefresh = false
    const meGate = deferred()
    const resultsGate = deferred()

    const { meRequests, resultRequests } = await mockKubios(page, {
      me: async () => {
        if (holdRefresh) {
          await meGate.promise
          return { body: updatedSummary }
        }
        return { body: baseSummary }
      },
      results: async (range) => {
        if (holdRefresh) {
          await resultsGate.promise
          return { body: updatedRangeResults }
        }
        if (range.from !== null || range.to !== null) {
          return { body: rangeResults }
        }
        return { body: baseResults }
      },
    })

    await page.goto('/kubios')
    await expect(page.getByText('2 mediciones', { exact: true })).toBeVisible()

    await page.locator('#kubios-date-from').fill('2026-10-01')
    await page.locator('#kubios-date-to').fill('2026-10-31')
    await expect(page.getByText('1 mediciones', { exact: true })).toBeVisible()
    await expect(page.getByText('55.0%', { exact: false }).first()).toBeVisible()

    const meBefore = meRequests.length
    const resultsBefore = resultRequests.length
    holdRefresh = true

    const button = refreshButton(page)
    await button.click()

    // La carga se muestra antes de liberar las respuestas, de modo que la
    // prueba no depende de la latencia del servidor.
    await expect(button).toBeDisabled()
    await expect(button.locator('svg.animate-spin')).toBeVisible()
    await expect(page.getByText('Cargando...', { exact: true })).toBeVisible()

    await expect.poll(() => meRequests.length).toBe(meBefore + 1)
    await expect.poll(() => resultRequests.length).toBe(resultsBefore + 1)
    expect(resultRequests.at(-1)).toBe('?from=2026-10-01&to=2026-10-31')

    // hrv-results puede terminar antes que /me. La cabecera ya refleja el
    // recuento filtrado, pero la recarga manual sigue en curso: no se debe
    // habilitar Actualizar ni retirar la carga hasta que /me asiente.
    resultsGate.resolve()
    const totalCard = page.getByText('mediciones', { exact: true }).locator('..')
    await expect(totalCard.getByText('3', { exact: true })).toBeVisible()

    await expect(page.getByText('Cargando...', { exact: true })).toBeVisible()
    await expect(button).toBeDisabled()
    await expect(button.locator('svg.animate-spin')).toBeVisible()

    meGate.resolve()

    await expect(page.getByText('Cargando...', { exact: true })).toHaveCount(0)
    await expect(button).toBeEnabled()
    await expect(page.getByText('3 mediciones', { exact: true })).toBeVisible()
    await expect(page.getByText('81.0%', { exact: false }).first()).toBeVisible()
    await expect(page.getByText('55.0%', { exact: false })).toHaveCount(0)
  })

  test('completes the refresh and keeps the data when the snapshot is unchanged', async ({
    page,
  }) => {
    await mockSession(page)

    let holdRefresh = false
    const meGate = deferred()
    const resultsGate = deferred()

    const { meRequests, resultRequests } = await mockKubios(page, {
      me: async () => {
        if (holdRefresh) {
          await meGate.promise
        }
        return { body: baseSummary }
      },
      results: async () => {
        if (holdRefresh) {
          await resultsGate.promise
        }
        return { body: baseResults }
      },
    })

    await page.goto('/kubios')
    await expect(page.getByText('2 mediciones', { exact: true })).toBeVisible()
    await expect(page.getByText('72.0%', { exact: false }).first()).toBeVisible()

    const meBefore = meRequests.length
    const resultsBefore = resultRequests.length
    holdRefresh = true

    const button = refreshButton(page)
    await button.click()

    await expect(page.getByText('Cargando...', { exact: true })).toBeVisible()
    await expect.poll(() => meRequests.length).toBe(meBefore + 1)
    await expect.poll(() => resultRequests.length).toBe(resultsBefore + 1)

    meGate.resolve()
    resultsGate.resolve()

    // El fin de la recarga no depende de que cambie el contenido.
    await expect(page.getByText('Cargando...', { exact: true })).toHaveCount(0)
    await expect(button).toBeEnabled()
    await expect(page.getByText('2 mediciones', { exact: true })).toBeVisible()
    await expect(page.getByText('72.0%', { exact: false }).first()).toBeVisible()
  })

  test('shows an honest error when the refresh fails and Retry recovers', async ({
    page,
  }) => {
    await mockSession(page)

    let failRefresh = false
    const failureGate = deferred()

    await mockKubios(page, {
      me: () => ({ body: baseSummary }),
      results: async () => {
        if (failRefresh) {
          await failureGate.promise
          return {
            status: 503,
            body: {
              error: {
                code: 'UNAVAILABLE',
                message: 'Kubios no disponible',
              },
            },
          }
        }
        return { body: baseResults }
      },
    })

    await page.goto('/kubios')
    await expect(page.getByText('2 mediciones', { exact: true })).toBeVisible()

    failRefresh = true
    const button = refreshButton(page)
    await button.click()
    await expect(page.getByText('Cargando...', { exact: true })).toBeVisible()

    failureGate.resolve()

    const errorMessage =
      'El servicio de Kubios no está disponible en este momento. Inténtalo de nuevo más tarde.'
    await expect(page.getByText(errorMessage, { exact: true })).toBeVisible()

    failRefresh = false
    await page.getByRole('button', { name: 'Reintentar', exact: true }).click()

    await expect(page.getByText(errorMessage, { exact: true })).toHaveCount(0)
    await expect(page.getByText('Cargando...', { exact: true })).toHaveCount(0)
    await expect(page.getByText('2 mediciones', { exact: true })).toBeVisible()
    await expect(page.getByText('72.0%', { exact: false }).first()).toBeVisible()
  })

  test('changing the range cancels the refresh response of the previous range', async ({
    page,
  }) => {
    await mockSession(page)

    let holdRangeARefresh = false
    const rangeAGate = deferred()

    await mockKubios(page, {
      me: () => ({ body: baseSummary }),
      results: async (range) => {
        if (
          holdRangeARefresh &&
          range.from === '2026-10-01' &&
          range.to === '2026-10-31'
        ) {
          await rangeAGate.promise
          return { body: staleRefreshResults }
        }
        if (range.from === '2026-09-01') {
          return { body: secondRangeResults }
        }
        if (range.from === '2026-10-01') {
          return { body: rangeResults }
        }
        return { body: baseResults }
      },
    })

    await page.goto('/kubios')
    await expect(page.getByText('2 mediciones', { exact: true })).toBeVisible()

    await page.locator('#kubios-date-from').fill('2026-10-01')
    await page.locator('#kubios-date-to').fill('2026-10-31')
    await expect(page.getByText('1 mediciones', { exact: true })).toBeVisible()
    await expect(page.getByText('55.0%', { exact: false }).first()).toBeVisible()

    holdRangeARefresh = true
    await refreshButton(page).click()
    await expect(page.getByText('Cargando...', { exact: true })).toBeVisible()

    // Mientras la recarga del rango A sigue retenida se activa el rango B.
    await page.locator('#kubios-date-from').fill('2026-09-01')
    await page.locator('#kubios-date-to').fill('2026-09-30')

    await expect(page.getByText('1 mediciones', { exact: true })).toBeVisible()
    await expect(page.getByText('62.0%', { exact: false }).first()).toBeVisible()

    // La respuesta antigua se libera después: no debe reemplazar al rango B.
    rangeAGate.resolve()
    await page.waitForTimeout(300)

    await expect(page.getByText('99.0%', { exact: false })).toHaveCount(0)
    await expect(page.getByText('55.0%', { exact: false })).toHaveCount(0)
    await expect(page.getByText('62.0%', { exact: false }).first()).toBeVisible()
    await expect(page.getByText('Cargando...', { exact: true })).toHaveCount(0)
  })

  test('session loss during a refresh discards the stale personal snapshot', async ({
    page,
  }) => {
    await mockSession(page)

    let holdRefresh = false
    const meGate = deferred()
    const resultsGate = deferred()

    await mockKubios(page, {
      me: async () => {
        if (holdRefresh) {
          await meGate.promise
        }
        return { body: baseSummary }
      },
      results: async () => {
        if (holdRefresh) {
          await resultsGate.promise
        }
        return { body: baseResults }
      },
    })

    await page.goto('/kubios')
    await expect(page.getByText('72.0%', { exact: false }).first()).toBeVisible()

    holdRefresh = true
    await refreshButton(page).click()
    await expect(page.getByText('Cargando...', { exact: true })).toBeVisible()

    // Mismo evento que emite el cliente ante una sesión caducada.
    await page.evaluate(() => {
      window.dispatchEvent(new Event('auth:unauthorized'))
    })

    await expect(page).toHaveURL(/\/login/)
    await expect(
      page.getByRole('heading', { name: 'Diabetes Tracker Dashboard' }),
    ).toBeVisible()

    meGate.resolve()
    resultsGate.resolve()
    await page.waitForTimeout(300)

    await expect(page.getByText('72.0%', { exact: false })).toHaveCount(0)
    await expect(page.getByText('2 mediciones', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Cargando...', { exact: true })).toHaveCount(0)
  })
})
