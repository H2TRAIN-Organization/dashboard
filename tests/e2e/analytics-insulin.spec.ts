import { PRIVACY_POLICY_VERSION, PRIVACY_POLICY_HASH } from '../../src/lib/privacy-policy'
import { expect, test, type Page } from "@playwright/test";

/**
 * UI contract MT29: the insulin pie chart labels never overlap.
 *
 * Tiny slices (< 5%) draw no label; their data stays in the tooltip and, for
 * the insulin chart, in the "Otros" breakdown dropdown. Runs only against an
 * explicitly provided base URL with browser-mocked APIs.
 */
test.skip(
  process.env.PLAYWRIGHT_BASE_URL === undefined,
  "Set PLAYWRIGHT_BASE_URL to a disposable local deployment to run UI E2E tests.",
);

const SMALL_TYPES = ['detemir', 'degludec', 'lispro', 'aspart', 'regular', 'glargina', 'mezcla'];
// With INSULIN_TOP_TYPES = 5 the first five types render individually and the
// remaining tail (stable order, equal values) is aggregated into «Otros».
const OTHERS_BREAKDOWN = SMALL_TYPES.slice(3);
const INSULIN = [
  ...Array.from({ length: 200 }, (_, index) => insulinRow('Rápida', index)),
  ...Array.from({ length: 90 }, (_, index) => insulinRow('Lenta', index)),
  ...SMALL_TYPES.flatMap((type, index) => [insulinRow(type, index), insulinRow(type, 100 + index)]),
];
const MOOD = [
  ...Array.from({ length: 20 }, (_, index) => moodRow('8', index)),
  moodRow('3', 0),
];

function insulinRow(type: string, index: number) {
  return {
    username: 'synthetic-participant',
    insulinType: type,
    dose: '1',
    carbs: '10',
    date_time: '2026-11-01T08:00:00.000Z',
    rowKey: `insulin-${index}`,
  };
}

function moodRow(level: string, index: number) {
  return {
    username: 'synthetic-participant',
    mood_value: level,
    date_time: '2026-11-01T09:00:00.000Z',
    rowKey: `mood-${index}`,
  };
}

const SESSION = {
  user: { id: '1', username: 'root', email: null, role: 'admin', uuid: null, gdprConsent: true, gdprConsentAt: null, createdAt: null },
  method: 'username' as const,
  expiresAt: '2030-01-01T00:00:00Z',
  privacy: { policyVersion: PRIVACY_POLICY_VERSION, policyHash: PRIVACY_POLICY_HASH, state: 'complete' },
};

async function mockAnalytics(page: Page) {
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
        moodData: MOOD,
      } });
    }
    return route.fulfill({ json: {} });
  });
}

test('the insulin pie labels big slices and hides tiny overlapping ones', async ({ page }) => {
  await mockAnalytics(page);
  await page.goto('/analytics');
  await expect(page.getByRole('heading', { name: 'Tipos de Insulina Utilizados' })).toBeVisible();

  // Big slices keep their outside labels (66.67% -> 67%).
  await expect(page.getByText(/Rápida 6[0-9]%/)).toBeVisible();
  await expect(page.getByText('Lenta 30%')).toBeVisible();

  // Tiny slices (3% and below) draw no label: they used to overlap.
  await expect(page.getByText('Otros 3%')).toHaveCount(0);
  await expect(page.getByText(/Dete.*\d+%$/)).toHaveCount(0);
  await expect(page.getByText('Mezcla 0%')).toHaveCount(0);

  // The «Otros» dropdown keeps the full breakdown of the aggregated types.
  const dropdown = page.getByRole('button', { name: /Tipos incluidos en «Otros» \(\d+\)/ });
  await expect(dropdown).toHaveText(new RegExp(`Tipos incluidos en «Otros» \\(${OTHERS_BREAKDOWN.length}\\)`));
  await dropdown.click();
  for (const type of OTHERS_BREAKDOWN) {
    await expect(page.locator('li', { hasText: type })).toBeVisible();
  }
});

test('the mood pie follows the same label threshold', async ({ page }) => {
  await mockAnalytics(page);
  await page.goto('/analytics');
  await expect(page.getByRole('heading', { name: 'Distribución de Estado de Ánimo' })).toBeVisible();

  // 20/21 records ≈ 95% keeps its label…
  await expect(page.getByText('8/10 95%')).toBeVisible();
  // …and 1/21 ≈ 4.8% (displayed as 5% after rounding) draws no label.
  await expect(page.getByText('3/10 5%')).toHaveCount(0);
});
