import { expect, test, type Page } from '@playwright/test'

/**
 * UI personal de Kubios con respuestas interceptadas. No contacta Kubios ni la
 * API real: valida navegación, resumen y estados honestos con la cookie de
 * sesión simulada en el propio navegador. Requiere un servidor local:
 * PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test tests/e2e/kubios-personal.spec.ts
 */
test.describe('Kubios personal UI', () => {
  test.use({ timezoneId: 'UTC' })

  test.skip(
    process.env.PLAYWRIGHT_BASE_URL === undefined,
    'Set PLAYWRIGHT_BASE_URL to a local Next server to run these UI tests.',
  )

  const readySummary = {
    status: 'ready',
    measurement_count: 2,
    synced_at: '2026-11-03T10:00:00.000Z',
    latest_result: {
      measured_timestamp: '2026-11-01T08:30:00Z',
      daily_result: 'normal',
      result: {
        readiness: 72,
        mean_hr_bpm: 58,
        rmssd_ms: 44.2,
        pns_index: 1.5,
        sns_index: -0.5,
        physiological_age: 31,
        respiratory_rate: 14.5,
        stress_index: 12,
        artefact_level: 'good',
        freq_domain: { HF_power: 1200, LF_power: 800, VLF_power: 300, tot_power: 2300 },
      },
    },
  }

  const readyResults = {
    status: 'ready',
    synced_at: '2026-11-03T10:00:00.000Z',
    results: [
      readySummary.latest_result,
      {
        measured_timestamp: '2026-10-31T08:30:00Z',
        daily_result: 'normal',
        result: { readiness: 64, mean_hr_bpm: 60, rmssd_ms: 39.1 },
      },
    ],
  }

  const filteredResults = {
    status: 'ready',
    synced_at: '2026-11-03T10:00:00.000Z',
    results: [
      {
        measured_timestamp: '2026-10-15T12:00:00Z',
        daily_result: 'normal',
        result: { readiness: 55, mean_hr_bpm: 61, rmssd_ms: 39.5 },
      },
    ],
  }

  const emptyResults = {
    status: 'ready',
    synced_at: '2026-11-03T10:00:00.000Z',
    results: [],
  }

  async function mockSession(page: Page) {
    await page.route('**/api/auth/session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
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
        }),
      })
    })
  }

  async function mockMe(page: Page, body: unknown) {
    await page.route('**/api/kubios/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      })
    })
  }

  async function mockResults(page: Page, body: unknown) {
    await page.route('**/api/kubios/hrv-results*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      })
    })
  }

  async function mockResultsByRange(
    page: Page,
    resolveBody: (range: { from: string | null; to: string | null }) => unknown,
    beforeRespond?: (range: { from: string | null; to: string | null }) => Promise<void>,
  ) {
    await page.route('**/api/kubios/hrv-results*', async (route) => {
      const url = new URL(route.request().url())
      const range = {
        from: url.searchParams.get('from'),
        to: url.searchParams.get('to'),
      }

      if (beforeRespond !== undefined) {
        await beforeRespond(range)
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(resolveBody(range)),
      })
    })
  }

  test('shows only the signed-in user data and no team selector', async ({ page }) => {
    await mockSession(page)
    await mockMe(page, readySummary)
    await mockResults(page, readyResults)

    await page.goto('/kubios')

    await expect(page.getByText('Solo se muestran los datos propios de Kubios.')).toBeVisible()
    await expect(page.getByText('2 mediciones')).toBeVisible()
    await expect(page.getByText('72.0%', { exact: false }).first()).toBeVisible()

    await expect(page.getByText(/Usuarios del Equipo/i)).toHaveCount(0)
    await expect(page.getByText(/Seleccionar Usuario/i)).toHaveCount(0)
    await expect(page.locator('select')).toHaveCount(0)
  })

  test('shows the personal navigation entry only when measurements exist', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await mockSession(page)
    await mockMe(page, readySummary)
    await mockResults(page, readyResults)

    await page.goto('/kubios')
    await page.locator('button:has(svg.lucide-menu)').click()

    await expect(page.locator('a[href="/kubios"]')).toHaveCount(1)
  })

  test('shows an honest unlinked state without navigation access', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await mockSession(page)
    await mockMe(page, {
      status: 'unlinked',
      measurement_count: 0,
      synced_at: null,
      latest_result: null,
    })
    await mockResults(page, { status: 'unlinked', results: [], synced_at: null })

    await page.goto('/kubios')

    await expect(page.getByText(/no está vinculada a Kubios/i)).toBeVisible()
    await page.locator('button:has(svg.lucide-menu)').click()
    await expect(page.locator('a[href="/kubios"]')).toHaveCount(0)
    await expect(page.getByText(/Readiness/i)).toHaveCount(0)
  })

  test('keeps stale results visible with a warning', async ({ page }) => {
    await mockSession(page)
    await mockMe(page, { ...readySummary, status: 'stale' })
    await mockResults(page, { ...readyResults, status: 'stale' })

    await page.goto('/kubios')

    await expect(
      page.getByText(/última copia sincronizada y podrían no estar actualizados/i),
    ).toBeVisible()
    await expect(page.getByText('2 mediciones')).toBeVisible()
    await expect(page.getByText('72.0%', { exact: false }).first()).toBeVisible()
  })

  test('derives the summary total and latest measurement from the active range', async ({
    page,
  }) => {
    await mockSession(page)
    await mockMe(page, readySummary)
    await mockResultsByRange(page, ({ from, to }) => {
      if (from === null && to === null) return readyResults
      return filteredResults
    })

    await page.goto('/kubios')
    await expect(page.getByText('2 mediciones')).toBeVisible()

    await page.locator('#kubios-date-from').fill('2026-10-01')
    await page.locator('#kubios-date-to').fill('2026-10-31')

    await expect(page.getByText('1 mediciones')).toBeVisible()
    await expect(page.locator('article')).toHaveCount(1)

    const totalCard = page.getByText('mediciones', { exact: true }).locator('..')
    await expect(totalCard.getByText('1', { exact: true })).toBeVisible()

    const latestCard = page.getByText('Última medición', { exact: true }).locator('..')
    await expect(latestCard).toContainText(/15 oct 2026/)
    await expect(latestCard).not.toContainText(/1 nov 2026/)

    // Cabecera y lista muestran la misma readiness filtrada; la global no queda.
    await expect(page.getByText(/55\.0%/)).toHaveCount(2)
    await expect(page.getByText(/72\.0%/)).toHaveCount(0)
    await expect(page.getByText(/1 nov 2026/)).toHaveCount(0)
  })

  test('does not reuse the global summary while an empty range loads', async ({
    page,
  }) => {
    await mockSession(page)
    await mockMe(page, readySummary)

    let releaseEmptyRange!: () => void
    const emptyRangeGate = new Promise<void>((resolve) => {
      releaseEmptyRange = resolve
    })

    await mockResultsByRange(
      page,
      ({ from, to }) => {
        if (from === null && to === null) return readyResults
        if (from === '2026-09-01' && to === '2026-09-30') return emptyResults
        return filteredResults
      },
      async ({ from, to }) => {
        if (from === '2026-09-01' && to === '2026-09-30') {
          await emptyRangeGate
        }
      },
    )

    await page.goto('/kubios')
    await expect(page.getByText('2 mediciones')).toBeVisible()

    const emptyRangeRequest = page.waitForRequest((request) => {
      if (!request.url().includes('/api/kubios/hrv-results')) return false
      const url = new URL(request.url())
      return (
        url.searchParams.get('from') === '2026-09-01' &&
        url.searchParams.get('to') === '2026-09-30'
      )
    })

    await page.locator('#kubios-date-from').fill('2026-09-01')
    await page.locator('#kubios-date-to').fill('2026-09-30')
    await emptyRangeRequest

    // Mientras el nuevo rango carga no se muestran tarjetas del rango anterior.
    await expect(page.getByText('mediciones', { exact: true })).toHaveCount(0)
    await expect(page.getByText(/1 nov 2026/)).toHaveCount(0)

    releaseEmptyRange()

    await expect(
      page.getByText(/No hay mediciones HRV en el rango de fechas seleccionado/i),
    ).toBeVisible()
    await expect(page.locator('article')).toHaveCount(0)

    // Sin mediciones en el rango, la cabecera no anuncia un contador 0 y no
    // reutiliza el resumen global.
    await expect(page.getByText('0 mediciones')).toHaveCount(0)
    await expect(page.getByText('mediciones', { exact: true })).toHaveCount(0)
    await expect(page.getByText(/72\.0%/)).toHaveCount(0)
    await expect(page.getByText(/1 nov 2026/)).toHaveCount(0)
  })

  test('selects and clears a date with the shared calendar field', async ({
    page,
  }) => {
    await mockSession(page)
    await mockMe(page, readySummary)
    await mockResultsByRange(page, ({ from, to }) =>
      from === null && to === null ? readyResults : filteredResults,
    )

    await page.goto('/kubios')
    await expect(page.getByText('2 mediciones')).toBeVisible()

    const fromInput = page.locator('#kubios-date-from')
    const trigger = page.getByRole('button', {
      name: 'Fecha desde: Seleccionar fecha',
    })
    await trigger.click()

    const dialog = page.getByRole('dialog', { name: 'Fecha Específica' })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('[data-date][tabindex="0"]')).toBeFocused()

    // Las flechas mueven el foco del calendario y Enter selecciona el día.
    await page.keyboard.press('ArrowRight')
    const target = dialog.locator('[data-date][tabindex="0"]')
    await expect(target).toBeFocused()
    const targetValue = await target.getAttribute('data-date')
    expect(targetValue).not.toBeNull()

    const selectedRequest = page.waitForRequest((request) => {
      if (!request.url().includes('/api/kubios/hrv-results')) return false
      const url = new URL(request.url())
      return (
        url.searchParams.get('from') === targetValue &&
        url.searchParams.get('to') === null
      )
    })
    await page.keyboard.press('Enter')
    await selectedRequest

    await expect(dialog).toHaveCount(0)
    await expect(fromInput).toHaveValue(targetValue ?? '')
    await expect(trigger).toBeFocused()

    const clearedRequest = page.waitForRequest((request) => {
      if (!request.url().includes('/api/kubios/hrv-results')) return false
      return !new URL(request.url()).searchParams.has('from')
    })
    await page.getByRole('button', { name: 'Limpiar', exact: true }).click()
    await clearedRequest

    await expect(fromInput).toHaveValue('')
    await expect(fromInput).toBeFocused()
  })

  test('disables Hoy outside the active range without changing the filter', async ({
    page,
  }) => {
    await mockSession(page)
    await mockMe(page, readySummary)
    await mockResultsByRange(page, ({ from, to }) =>
      from === null && to === null ? readyResults : filteredResults,
    )

    await page.goto('/kubios')
    await expect(page.getByText('2 mediciones')).toBeVisible()

    const fromInput = page.locator('#kubios-date-from')
    const toInput = page.locator('#kubios-date-to')
    const dialog = page.getByRole('dialog', { name: 'Fecha Específica' })

    // Un máximo pasado deja hoy fuera del rango del campo «desde».
    await toInput.fill('2020-01-31')
    await page.getByRole('button', { name: 'Fecha desde: Seleccionar fecha' }).click()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Hoy' })).toBeDisabled()
    await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click()
    await expect(fromInput).toHaveValue('')
    await expect(toInput).toHaveValue('2020-01-31')

    // Un mínimo futuro deja hoy fuera del rango del campo «hasta».
    await page.getByRole('button', { name: 'Limpiar filtros', exact: true }).click()
    await fromInput.fill('2030-01-01')
    await expect(fromInput).toHaveValue('2030-01-01')
    await page.getByRole('button', { name: 'Fecha hasta: Seleccionar fecha' }).click()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Hoy' })).toBeDisabled()
    await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click()
    await expect(fromInput).toHaveValue('2030-01-01')
    await expect(toInput).toHaveValue('')
  })

  test('shows the compact personal summary on the main dashboard', async ({ page }) => {
    await mockSession(page)
    await mockMe(page, readySummary)
    await mockResults(page, readyResults)
    await page.route('**/api/users/count', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ count: 1 }),
      })
    })
    await page.route('**/api/decrypted-data*', async (route) => {
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
    })

    await page.goto('/')

    await expect(page.getByText('HRV (Kubios)', { exact: true })).toBeVisible()
    await expect(page.locator('a[href="/kubios"]')).toHaveCount(1)
    await expect(page.getByText('mediciones', { exact: true })).toBeVisible()
    await expect(page.getByText('72.0%', { exact: true })).toBeVisible()
  })

  test('hides the main dashboard summary and navigation when the user has no measurements', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await mockSession(page)
    await mockMe(page, {
      status: 'empty',
      measurement_count: 0,
      synced_at: null,
      latest_result: null,
    })
    await mockResults(page, emptyResults)
    await page.route('**/api/users/count', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ count: 1 }),
      })
    })
    await page.route('**/api/decrypted-data*', async (route) => {
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
    })

    await page.goto('/')

    await expect(page.getByText('HRV (Kubios)', { exact: true })).toHaveCount(0)
    await page.locator('button:has(svg.lucide-menu)').click()
    await expect(page.locator('a[href="/kubios"]')).toHaveCount(0)
  })
})
