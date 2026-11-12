import { expect, test } from './support/language'
import { PRIVACY_POLICY_HASH, PRIVACY_POLICY_VERSION } from '../../src/lib/privacy-policy'

/**
 * Botones superiores de Administración > Base de datos (/admin/database).
 *
 * Todas las respuestas se interceptan en el navegador: no se contacta la base
 * real. Requiere un servidor Next local compartido:
 * PLAYWRIGHT_BASE_URL=http://127.0.0.1:3107 npx playwright test tests/e2e/admin-database.spec.ts
 */
test.skip(
  process.env.PLAYWRIGHT_BASE_URL === undefined,
  'Set PLAYWRIGHT_BASE_URL to a local Next server to run these UI tests.',
)

interface StatsBody {
  tables: Array<{ name: string; recordCount: number; accessible: boolean }>
  totalRecords: number
  accessibleCount: number
  totalCount: number
  observedAt: string
  status: 'complete' | 'partial' | 'failed'
}

function sessionFixture() {
  return {
    user: { id: '1', username: 'root', email: null, role: 'admin', uuid: null, gdprConsent: true, gdprConsentAt: null, createdAt: null },
    method: 'email' as const,
    expiresAt: '2026-12-01T00:00:00Z',
    privacy: { policyVersion: PRIVACY_POLICY_VERSION, policyHash: PRIVACY_POLICY_HASH, state: 'complete' as const },
  }
}

function statsFixture(): StatsBody {
  return {
    tables: [
      { name: 'users', recordCount: 32, accessible: true },
      { name: 'insulindata', recordCount: 1011, accessible: true },
      { name: 'kubios_snapshots', recordCount: 90, accessible: false },
    ],
    totalRecords: 1133,
    accessibleCount: 2,
    totalCount: 3,
    observedAt: '2026-11-10T12:00:00.000Z',
    status: 'complete',
  }
}

function pageFixture(table: string): Record<string, unknown> {
  return {
    tableName: table,
    data: table === 'users'
      ? [{ UserID: 1, username: 'synthetic_a' }, { UserID: 2, username: 'synthetic_b' }]
      : [{ user_id: 1 }, { user_id: 2 }],
    totalRecords: 32,
    returnedRecords: 2,
    limit: 50,
    offset: 0,
    hasMore: false,
  }
}

test('the four admin database buttons run their real function', async ({ page }) => {
  let statsLoads = 0
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    if (path === '/api/auth/session') {
      return route.fulfill({ json: sessionFixture() })
    }
    if (path === '/api/admin/database/tables') {
      statsLoads += 1
      return route.fulfill({ json: statsFixture() })
    }
    if (path === '/api/admin/database/table-data') {
      return route.fulfill({ json: pageFixture(url.searchParams.get('table') ?? 'users') })
    }
    if (path === '/api/admin/database/export') {
      const format = url.searchParams.get('format')
      return route.fulfill({ json: {
        filename: `synthetic-${format}.file`,
        contentType: format === 'csv' ? 'text/csv' : 'application/json',
        content: 'UserID,username\n1,synthetic_a\n',
      } })
    }
    if (path === '/api/admin/database/logical-backup') {
      const body = route.request().postDataJSON() as Record<string, unknown>
      // The passphrase never travels: only the browser-derived key material.
      expect(body.password).toBeUndefined()
      expect(typeof body.salt).toBe('string')
      expect(typeof body.key).toBe('string')
      expect(JSON.stringify(body)).not.toContain('synthetic-passphrase')
      return route.fulfill({ json: {
        filename: 'logical-copy.bin', contentType: 'application/octet-stream', content: 'synthetic-cipher',
      } })
    }
    return route.fulfill({ json: {} })
  })

  await page.goto('/admin/database')

  // Los 4 botones superiores existen y tienen función real (3 anclas + refresco).
  const nav = page.locator('nav', { has: page.getByText('Explorar tablas') })
  for (const label of ['Explorar tablas', 'Exportar datos', 'Copia lógica cifrada', 'Actualizar estadísticas']) {
    await expect(nav.getByText(label, { exact: true })).toBeVisible()
  }
  expect(statsLoads).toBe(1)

  // Botón 1: el explorador salta a su sección y consulta registros paginados.
  await nav.getByText('Explorar tablas', { exact: true }).click()
  await expect(page.locator('#explorer')).toBeInViewport()
  await page.getByRole('button', { name: 'Consultar' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Mostrando 1–2 de 32' })).toBeVisible()
  await expect(page.locator('table tbody tr')).toHaveCount(2)

  // Botón 4: actualizar estadísticas repite la consulta confirmada.
  await page.getByRole('button', { name: 'Actualizar estadísticas' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Consulta completa' })).toBeVisible()
  expect(statsLoads).toBe(2)

  // Botón 2: la exportación CSV completa prepara la descarga.
  await nav.getByText('Exportar datos', { exact: true }).click()
  await expect(page.locator('#exports')).toBeInViewport()
  await page.getByRole('button', { name: 'CSV', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Descarga preparada.' })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'No disponible' })).toHaveCount(0)
})

test('the logical copy validates the password before any download', async ({ page }) => {
  let backupRequests = 0
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/session') {
      return route.fulfill({ json: sessionFixture() })
    }
    if (path === '/api/admin/database/tables') {
      return route.fulfill({ json: statsFixture() })
    }
    if (path === '/api/admin/database/logical-backup') {
      backupRequests += 1
      return route.fulfill({ json: {
        filename: 'logical-copy.bin', contentType: 'application/octet-stream', content: 'synthetic-cipher',
      } })
    }
    return route.fulfill({ json: {} })
  })
  await page.goto('/admin/database')

  const passwords = page.locator('#logical-copy form input[type="password"]')
  await passwords.nth(0).fill('synthetic-passphrase')
  await passwords.nth(1).fill('different-passphrase!!')
  await page.getByRole('button', { name: 'Descargar copia cifrada' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Las contraseñas deben coincidir' })).toBeVisible()
  expect(backupRequests).toBe(0)

  await passwords.nth(1).fill('synthetic-passphrase')
  await page.getByRole('button', { name: 'Descargar copia cifrada' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Descarga preparada.' })).toBeVisible()
  expect(backupRequests).toBe(1)
  await expect(passwords.nth(0)).toHaveValue('')
})

test('a failed stats query never shows unconfirmed numbers', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/session') {
      return route.fulfill({ json: sessionFixture() })
    }
    if (path === '/api/admin/database/tables') {
      return route.fulfill({ status: 503, json: { error: { code: 'SERVICE_UNAVAILABLE', message: 'Synthetic outage' } } })
    }
    return route.fulfill({ json: {} })
  })
  await page.goto('/admin/database')

  await expect(page.getByRole('status').filter({ hasText: 'La actualización falló. Se conservan los últimos resultados confirmados.' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Consulta completa' })).toHaveCount(0)
  await expect(page.locator('ul')).toHaveCount(0)
})
