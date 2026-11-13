import { PRIVACY_POLICY_VERSION, PRIVACY_POLICY_HASH } from '../../src/lib/privacy-policy'
import { expect, test, type Page } from './support/language'

/**
 * UI contract MT42: when a participant is selected in the admin Kubios view,
 * scrollable charts of their measurements appear; with "all participants"
 * they stay hidden. Runs only against an explicitly provided base URL with
 * browser-mocked APIs.
 */
test.skip(
  process.env.PLAYWRIGHT_BASE_URL === undefined,
  "Set PLAYWRIGHT_BASE_URL to a disposable local deployment to run UI E2E tests.",
);

const PARTICIPANTS = [
  { userId: 1, username: 'participant-one', status: 'ready', measurementCount: 30 },
  { userId: 2, username: 'participant-two', status: 'empty', measurementCount: 0 },
];

const MEASUREMENTS = Array.from({ length: 30 }, (_, index) => ({
  userId: 1,
  username: 'participant-one',
  measuredTimestamp: `2026-11-${String((index % 28) + 1).padStart(2, '0')}T08:30:00.000Z`,
  syncedAt: '2026-11-11T10:00:00.000Z',
  status: 'ready',
  metrics: {
    readiness: 60 + (index % 30),
    mean_hr_bpm: 58 + (index % 10),
    rmssd_ms: 40 + (index % 15),
    pns_index: 0.5 + (index % 5) / 10,
    sns_index: -(index % 5) / 10,
    HF_power: 900 + index,
    LF_power: 700 + index,
    VLF_power: 400 + index,
  },
}));

const SESSION = {
  user: { id: '9', username: 'root', email: null, role: 'admin', uuid: null, gdprConsent: true, gdprConsentAt: null, createdAt: null },
  method: 'username' as const,
  expiresAt: '2030-01-01T00:00:00Z',
  privacy: { policyVersion: PRIVACY_POLICY_VERSION, policyHash: PRIVACY_POLICY_HASH, state: 'complete' },
};

async function mockAdminKubios(page: Page) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session') return route.fulfill({ json: SESSION });
    if (path === '/api/admin/kubios/participants') {
      return route.fulfill({ json: { participants: PARTICIPANTS } });
    }
    if (path === '/api/admin/kubios/measurements') {
      return route.fulfill({ json: {
        measurements: MEASUREMENTS,
        nextCursor: null,
        status: 'ready',
        unavailableCount: 0,
      } });
    }
    return route.fulfill({ json: {} });
  });
}

test('a selected participant shows scrollable charts; "all" keeps them hidden', async ({ page }) => {
  await mockAdminKubios(page);
  await page.goto('/admin/kubios');

  // With "all participants" no charts section is rendered.
  await expect(page.getByText('Gráficos del participante')).toHaveCount(0);

  // Select a participant through the autocomplete: focus opens the popup and
  // the choice is an option inside the listbox portal.
  const input = page.getByRole('combobox', { name: 'Filtrar por participante' });
  await input.click();
  await input.fill('participant-one');
  await page.getByRole('option', { name: 'participant-one' }).click();

  const charts = page.getByText('Gráficos del participante');
  await expect(charts).toBeVisible();
  await expect(page.getByText(/30 mediciones del participante seleccionado/)).toBeVisible();

  // MT42: the series are scrollable in both axes when data is dense.
  const scrollWrapper = page.locator('.overflow-auto').first();
  await expect(scrollWrapper).toBeVisible();
});

test('MT53: the table renders before the charts when a participant is selected', async ({ page }) => {
  await mockAdminKubios(page);
  await page.goto('/admin/kubios');

  const input = page.getByRole('combobox', { name: 'Filtrar por participante' });
  await input.click();
  await input.fill('participant-one');
  await page.getByRole('option', { name: 'participant-one' }).click();

  const chartsHeading = page.getByText('Gráficos del participante');
  const firstRow = page.getByTestId('admin-kubios-row').first();
  await expect(firstRow).toBeVisible();
  await expect(chartsHeading).toBeVisible();

  // MT53 layout contract: the measurement table comes first and the charts
  // below it.
  const rowBox = await firstRow.boundingBox();
  const chartsBox = await chartsHeading.boundingBox();
  expect(rowBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(chartsBox?.y ?? Number.NEGATIVE_INFINITY);
});
