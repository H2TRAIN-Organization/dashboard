import { expect, test, type Page } from '@playwright/test'
import { PRIVACY_POLICY_HASH, PRIVACY_POLICY_VERSION } from '../../src/lib/privacy-policy'

/**
 * La parte de Estudio se retira del front sin borrar su código fuente:
 * la ruta /study responde 404 para cualquier rol y no existe entrada en
 * la navegación. Ver README.md. La API /api/study sigue desplegada.
 *
 * Requiere un servidor Next local compartido:
 * PLAYWRIGHT_BASE_URL=http://127.0.0.1:3107 npx playwright test tests/e2e/admin-study.spec.ts
 */
test.skip(
  process.env.PLAYWRIGHT_BASE_URL === undefined,
  'Set PLAYWRIGHT_BASE_URL to a local Next server to run these UI tests.',
)

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
    return route.fulfill({ json: {} })
  })
}

test('the study route is disabled for privileged roles', async ({ page }) => {
  await mockStudySession(page, 'admin')
  const response = await page.goto('/study')

  expect(response?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: 'Estudio', exact: true })).toHaveCount(0)
})
