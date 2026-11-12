import { PRIVACY_POLICY_VERSION, PRIVACY_POLICY_HASH } from '../../src/lib/privacy-policy'
import { expect, test, type Page } from './support/language'

/**
 * UI contract MT34/MT35: health data records render as compact pills with the
 * type-specific details, paginated at 10 records per page with a 10/25/50
 * page-size selector. Runs only against an explicitly provided base URL with
 * browser-mocked APIs.
 */
test.skip(
  process.env.PLAYWRIGHT_BASE_URL === undefined,
  "Set PLAYWRIGHT_BASE_URL to a disposable local deployment to run UI E2E tests.",
);

const INSULIN = Array.from({ length: 12 }, (_, index) => ({
  username: 'synthetic-participant',
  insulinType: index % 2 === 0 ? 'Rápida' : 'Lenta',
  dose: String(index + 1),
  carbs: '10',
  date_time: `2026-11-01T0${index % 10}:00:00.000Z`,
  rowKey: `insulin-${index}`,
}));

const SESSION = {
  user: { id: '1', username: 'root', email: null, role: 'admin', uuid: null, gdprConsent: true, gdprConsentAt: null, createdAt: null },
  method: 'username' as const,
  expiresAt: '2030-01-01T00:00:00Z',
  privacy: { policyVersion: PRIVACY_POLICY_VERSION, policyHash: PRIVACY_POLICY_HASH, state: 'complete' },
};

async function mockDataPage(page: Page) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session') return route.fulfill({ json: SESSION });
    if (path.startsWith('/api/users')) return route.fulfill({ json: { users: [], total: 0 } });
    if (path === '/api/decrypted-data') {
      return route.fulfill({ json: {
        users: [],
        total: 0,
        insulinData: INSULIN,
        foodData: [],
        exerciseData: [],
        periodData: [],
        moodData: [],
      } });
    }
    return route.fulfill({ json: {} });
  });
}

test('records render as pills paginated to 10 with a 10/25/50 selector', async ({ page }) => {
  await mockDataPage(page);
  await page.goto('/data');

  // Expand the user group (privileged roles need to expand each owner).
  await page.getByRole('button', { name: 'Ver todos' }).click();

  // Default page size is 10 and 12 records make 2 pages.
  await expect(page.getByText('1-10 / 12')).toBeVisible();
  await expect(page.getByText('1 / 2')).toBeVisible();

  const pageSize = page.getByLabel('Filas por página');
  await expect(pageSize).toHaveValue('10');

  // Navigate to the second page.
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page.getByText('11-12 / 12')).toBeVisible();
  await expect(page.getByText('2 / 2')).toBeVisible();

  // The pill shows the type-specific information (dose and insulin type).
  await expect(page.getByText('Dosis: 11')).toBeVisible();

  // First/last page jump buttons bookend the page-by-page controls.
  await page.getByRole('button', { name: 'Primera página' }).click();
  await expect(page.getByText('1-10 / 12')).toBeVisible();
  await expect(page.getByText('1 / 2')).toBeVisible();
  await page.getByRole('button', { name: 'Última página' }).click();
  await expect(page.getByText('11-12 / 12')).toBeVisible();
  await expect(page.getByText('2 / 2')).toBeVisible();
  // Both end buttons stay disabled while sitting at the boundary.
  await expect(page.getByRole('button', { name: 'Primera página' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Última página' })).toBeDisabled();

  // MT35: the selector accepts 10, 25 and 50. With 25 every record fits on
  // one page, so the pagination footer disappears.
  await pageSize.selectOption('25');
  await expect(page.getByText('1-12 / 12')).toHaveCount(0);
  await expect(page.getByText(/Dosis:/)).toHaveCount(12);
});
