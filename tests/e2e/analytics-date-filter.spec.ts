import { PRIVACY_POLICY_VERSION, PRIVACY_POLICY_HASH } from '../../src/lib/privacy-policy'
import { expect, test, type Page } from './support/language'

/**
 * UI contract T13: the Advanced Analytics filters accept an explicit
 * "desde - hasta" date range. The UI sends dateFrom/dateTo, the mocked server
 * honors them, and the clear button removes the filter. Runs only against an
 * explicitly provided base URL with browser-mocked APIs.
 */
test.skip(
  process.env.PLAYWRIGHT_BASE_URL === undefined,
  "Set PLAYWRIGHT_BASE_URL to a disposable local deployment to run UI E2E tests.",
);

const DAY_BASE = '2026-10-01';
const TOTAL_DAYS = 20;

const SESSION = {
  user: { id: '1', username: 'root', email: null, role: 'admin', uuid: null, gdprConsent: true, gdprConsentAt: null, createdAt: null },
  method: 'username' as const,
  expiresAt: '2030-01-01T00:00:00Z',
  privacy: { policyVersion: PRIVACY_POLICY_VERSION, policyHash: PRIVACY_POLICY_HASH, state: 'complete' },
};

function dayOffsetUtc(days: number): string {
  const date = new Date(`${DAY_BASE}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function exerciseRowsFor(days: readonly string[]) {
  return days.map((date, index) => ({
    username: 'synthetic-participant',
    exercise_type: 'Aeróbico',
    exercise_description: 'Caminata rápida',
    date_time: `${date}T18:00:00.000Z`,
    rowKey: `exercise-${index}`,
  }));
}

const ALL_DAYS = Array.from({ length: TOTAL_DAYS }, (_, index) => dayOffsetUtc(index));

async function mockAnalyticsWithRangeFilter(page: Page, queries: { url: string }[]) {
  await page.route('**/api/**', async (route) => {
    const requestUrl = route.request().url();
    const path = new URL(requestUrl).pathname;
    if (path === '/api/auth/session') return route.fulfill({ json: SESSION });
    if (path.startsWith('/api/users')) return route.fulfill({ json: { users: [], total: 0 } });
    if (path === '/api/decrypted-data') {
      queries.push({ url: requestUrl });
      const params = new URL(requestUrl).searchParams;
      const dateFrom = params.get('dateFrom');
      const dateTo = params.get('dateTo');
      const days = ALL_DAYS.filter(
        (day) => (dateFrom === null || day >= dateFrom) && (dateTo === null || day <= dateTo),
      );
      return route.fulfill({ json: {
        users: [],
        total: 0,
        insulinData: [],
        foodData: [],
        exerciseData: exerciseRowsFor(days),
        periodData: [],
        moodData: [],
      } });
    }
    return route.fulfill({ json: {} });
  });
}

async function exerciseEvolutionTickCount(page: Page): Promise<number> {
  const card = page.locator('div', { has: page.getByRole('heading', { name: 'Evolución de Registros de Ejercicio' }) }).last();
  await expect(card).toBeVisible();
  return card.locator('.recharts-xAxis .recharts-cartesian-axis-tick-value').count();
}

test('the from-to filter narrows the queried window and the charts follow', async ({ page }) => {
  const queries: { url: string }[] = [];
  await mockAnalyticsWithRangeFilter(page, queries);
  await page.goto('/analytics');

  // Initial load has no range: all 20 days are queried and rendered.
  await expect(page.getByRole('heading', { name: 'Evolución de Registros de Ejercicio' })).toBeVisible();
  await expect.poll(async () => exerciseEvolutionTickCount(page)).toBe(TOTAL_DAYS);

  await page.getByLabel('Rango de fechas - Desde').fill('2026-10-05');
  await page.getByLabel('Rango de fechas - Hasta').fill('2026-10-14');

  // The last issued query carries the complete range.
  await expect.poll(() => queries.at(-1)?.url ?? '').toContain('dateTo=2026-10-14');
  expect(queries.at(-1)?.url).toContain('dateFrom=2026-10-05');

  // The server honored the range: only the 10 filtered days render.
  await expect.poll(async () => exerciseEvolutionTickCount(page)).toBe(10);
});

test('the clear button removes the range filter', async ({ page }) => {
  const queries: { url: string }[] = [];
  await mockAnalyticsWithRangeFilter(page, queries);
  await page.goto('/analytics');

  await page.getByLabel('Rango de fechas - Desde').fill('2026-10-05');
  await expect.poll(() => queries.at(-1)?.url ?? '').toContain('dateFrom=2026-10-05');

  const clearButton = page.getByRole('button', { name: 'Limpiar fechas' });
  await expect(clearButton).toBeVisible();
  await clearButton.click();

  await expect.poll(async () => queries.at(-1)?.url ?? '').not.toContain('dateFrom');
  await expect(clearButton).toHaveCount(0);
});
