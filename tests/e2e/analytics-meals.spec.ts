import { PRIVACY_POLICY_VERSION, PRIVACY_POLICY_HASH } from '../../src/lib/privacy-policy'
import { expect, test, type Page } from './support/language'

/**
 * UI contract MT38/MT39: the registered meal types chart never presents
 * glucose episodes ("Hipoglucemia") as meals, it warns about the excluded
 * records, and a divider separates data charts from time-evolution charts.
 * Runs only against an explicitly provided base URL with browser-mocked APIs.
 */
test.skip(
  process.env.PLAYWRIGHT_BASE_URL === undefined,
  "Set PLAYWRIGHT_BASE_URL to a disposable local deployment to run UI E2E tests.",
);

const FOOD = [
  ...mealRows('Desayuno', 30),
  ...mealRows('Almuerzo', 20),
  ...mealRows('Cena', 10),
  ...glucoseRows('Hipoglucemia', 4),
  ...glucoseRows('Hiperglucemia', 2),
];

function mealRows(type: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    username: 'synthetic-participant',
    food_type: type,
    quantity: 'Lo mismo que habitualmente',
    carbs: '40',
    date_time: `2026-11-${String((index % 28) + 1).padStart(2, '0')}T08:00:00.000Z`,
    rowKey: `meal-${type}-${index}`,
  }));
}

function glucoseRows(type: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    username: 'synthetic-participant',
    food_type: type,
    quantity: '',
    carbs: '0',
    date_time: `2026-11-05T0${index}:00:00.000Z`,
    rowKey: `glucose-${type}-${index}`,
  }));
}

const SESSION = {
  user: { id: '1', username: 'root', email: null, role: 'admin', uuid: null, gdprConsent: true, gdprConsentAt: null, createdAt: null },
  method: 'username' as const,
  expiresAt: '2030-01-01T00:00:00Z',
  privacy: { policyVersion: PRIVACY_POLICY_VERSION, policyHash: PRIVACY_POLICY_HASH, state: 'complete' },
};

async function mockAnalytics(page: Page, foodData = FOOD) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session') return route.fulfill({ json: SESSION });
    if (path.startsWith('/api/users')) return route.fulfill({ json: { users: [], total: 0 } });
    if (path === '/api/decrypted-data') {
      return route.fulfill({ json: {
        users: [],
        total: 0,
        insulinData: [],
        foodData,
        exerciseData: [],
        periodData: [],
        moodData: [],
      } });
    }
    return route.fulfill({ json: {} });
  });
}

test('the meal types chart excludes glucose episodes and warns about them', async ({ page }) => {
  await mockAnalytics(page);
  await page.goto('/analytics');
  await expect(page.getByRole('heading', { name: 'Tipos de Comida Registrados' })).toBeVisible();

  // MT38: glucose events are not meals; the chart only draws real meal types.
  const chartCard = page.locator('div.rounded-3xl').filter({ has: page.getByRole('heading', { name: 'Tipos de Comida Registrados' }) }).last();
  await expect(chartCard.getByText('Hipoglucemia', { exact: true })).toHaveCount(0);
  await expect(chartCard.getByText('Hiperglucemia', { exact: true })).toHaveCount(0);
  await expect(chartCard.getByText('Desayuno', { exact: true })).toBeVisible();

  // The exclusion is announced with the exact excluded count.
  await expect(chartCard.getByText(/6 registros de eventos de glucemia/)).toBeVisible();
});

test('a divider separates data charts from time-evolution charts', async ({ page }) => {
  await mockAnalytics(page);
  await page.goto('/analytics');
  await expect(page.getByRole('heading', { name: 'Tipos de Comida Registrados' })).toBeVisible();

  const separator = page.getByRole('separator');
  await expect(separator).toBeVisible();
  await expect(separator.getByText('Evolución temporal')).toBeVisible();

  // The evolution section comes after the separator.
  const evolutionHeading = page.getByRole('heading', { name: 'Evolución de Registros de Comidas' });
  await expect(evolutionHeading).toBeVisible();
});

test('insulin shots written into the food table are not meal types (T14)', async ({ page }) => {
  const foodWithInsulin = [
    ...mealRows('Desayuno', 30),
    ...mealRows('Almuerzo', 20),
    ...mealRows('Cena', 10),
    ...mealRows('Rápida', 5),
    ...mealRows('Lenta', 3),
  ];
  await mockAnalytics(page, foodWithInsulin);
  await page.goto('/analytics');
  await expect(page.getByRole('heading', { name: 'Tipos de Comida Registrados' })).toBeVisible();

  // The chart card never presents insulin types as meals and announces the
  // excluded records with the exact count.
  const chartCard = page.locator('div.rounded-3xl').filter({ has: page.getByRole('heading', { name: 'Tipos de Comida Registrados' }) }).last();
  await expect(chartCard.getByText('Rápida', { exact: true })).toHaveCount(0);
  await expect(chartCard.getByText('Lenta', { exact: true })).toHaveCount(0);
  await expect(chartCard.getByText(/8 registros de insulina/)).toBeVisible();
});
