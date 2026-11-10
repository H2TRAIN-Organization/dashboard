import { expect, test, type Page } from '@playwright/test'
import { PRIVACY_POLICY_HASH, PRIVACY_POLICY_VERSION } from '../../src/lib/privacy-policy'

/**
 * Vista Estudio (/study) con la sesión integrada.
 *
 * Todas las respuestas se interceptan en el navegador: no se contacta la base
 * real. Requiere un servidor Next local compartido:
 * PLAYWRIGHT_BASE_URL=http://127.0.0.1:3107 npx playwright test tests/e2e/admin-study.spec.ts
 */
test.skip(
  process.env.PLAYWRIGHT_BASE_URL === undefined,
  'Set PLAYWRIGHT_BASE_URL to a local Next server to run these UI tests.',
)

interface StudyAssociation {
  coefficient: number | null
  sampleSize: number
  participants: number
}

interface StudyBody {
  period: string
  days: Array<{ person: string; day: string }>
  excludedRecords: number
  records: { exercise: number; mood: number; insulin: number; food: number; kubios: number }
  sources: { health: 'ready'; kubios: 'ready' | 'partial' | 'unavailable' | 'restricted' }
  associations: Record<'durationMood' | 'intensityMood' | 'durationRmssd', StudyAssociation>
}

function studyFixture(period: string, kubios: StudyBody['sources']['kubios']): StudyBody {
  const association = (coefficient: number | null): StudyAssociation => ({
    coefficient,
    sampleSize: 24,
    participants: 4,
  })
  return {
    period,
    days: [{ person: 'user-1', day: '2026-11-09' }],
    excludedRecords: 2,
    records: { exercise: 80, mood: 40, insulin: 90, food: 60, kubios: 20 },
    sources: { health: 'ready', kubios },
    associations: {
      durationMood: association(0.42),
      intensityMood: association(0.21),
      durationRmssd: association(0.17),
    },
  }
}

async function mockStudySession(page: Page, role: 'admin' | 'doctor') {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/session') {
      return route.fulfill({ json: {
        user: { id: '1', username: role === 'admin' ? 'root' : 'dnsilva', email: null, role, uuid: null, gdprConsent: true, gdprConsentAt: null, createdAt: null },
        method: 'email', expiresAt: '2026-12-01T00:00:00Z',
        privacy: { policyVersion: PRIVACY_POLICY_VERSION, policyHash: PRIVACY_POLICY_HASH, state: 'complete' },
      } })
    }
    if (path === '/api/study') {
      const period = new URL(route.request().url()).searchParams.get('period') ?? '90d'
      return route.fulfill({ json: studyFixture(period, role === 'doctor' ? 'restricted' : 'ready') })
    }
    return route.fulfill({ json: {} })
  })
}

test('admin opens Estudio and sees all descriptive associations', async ({ page }) => {
  await mockStudySession(page, 'admin')
  await page.goto('/study')

  await expect(page.getByRole('main').getByRole('heading', { name: 'Estudio', exact: true })).toBeVisible()
  const summary = page.getByRole('status').filter({ hasText: 'Fuente Kubios:' })
  await expect(summary).toContainText('Kubios:')

  for (const heading of [
    'Duración del ejercicio ↔ Estado de ánimo',
    'Intensidad del ejercicio ↔ Estado de ánimo',
    'Duración del ejercicio ↔ RMSSD',
  ]) {
    const card = page.locator('section').filter({ has: page.getByRole('heading', { name: heading, exact: true }) })
    await expect(card).toBeVisible()
    await expect(card).toContainText('r =')
    await expect(card).toContainText('n = 24 días de persona emparejados')
    await expect(card).toContainText('4 participantes')
  }

  await page.getByRole('combobox').selectOption('7d')
  await expect(page.getByRole('combobox')).toHaveValue('7d')
  const alert = page.locator('[role="alert"]:not([id="__next-route-announcer__"])')
  await expect(alert).toHaveCount(0)
})

test('doctor keeps the health associations without collective Kubios', async ({ page }) => {
  await mockStudySession(page, 'doctor')
  await page.goto('/study')

  await expect(page.getByText('Kubios colectivo reservado a administradores')).toBeVisible()
  await expect(page.locator('section').filter({ has: page.getByRole('heading', { name: 'Duración del ejercicio ↔ RMSSD' }) })).toHaveCount(0)
  await expect(page.locator('section').filter({ has: page.getByRole('heading', { name: 'Duración del ejercicio ↔ Estado de ánimo' }) })).toBeVisible()
})

test('a failed study request shows a recoverable alert', async ({ page }) => {
  let failing = true
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/session') {
      return route.fulfill({ json: {
        user: { id: '1', username: 'root', email: null, role: 'admin', uuid: null, gdprConsent: true, gdprConsentAt: null, createdAt: null },
        method: 'email', expiresAt: '2026-12-01T00:00:00Z',
        privacy: { policyVersion: PRIVACY_POLICY_VERSION, policyHash: PRIVACY_POLICY_HASH, state: 'complete' },
      } })
    }
    if (path === '/api/study' && failing) {
      return route.fulfill({ status: 503, json: { error: { code: 'SERVICE_UNAVAILABLE', message: 'Synthetic outage' } } })
    }
    return route.fulfill({ json: studyFixture('90d', 'ready') })
  })
  await page.goto('/study')

  const alert = page.locator('[role="alert"]:not([id="__next-route-announcer__"])')
  await expect(alert).toContainText('No se pudieron cargar los datos.')
  await expect(alert).not.toContainText('Synthetic outage')
  failing = false
  await page.getByRole('button', { name: 'Reintentar' }).click()
  await expect(page.getByRole('main').getByRole('heading', { name: 'Estudio', exact: true })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Fuente Kubios:' })).toBeVisible()
})
