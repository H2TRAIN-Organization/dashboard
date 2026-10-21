import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const outputDir =
  process.env.VISUAL_OUTPUT_DIR || path.resolve(__dirname, '.output');

fs.mkdirSync(outputDir, { recursive: true });

const browserChannel =
  process.env.VISUAL_BROWSER_CHANNEL === 'bundled'
    ? {}
    : { channel: process.env.VISUAL_BROWSER_CHANNEL || 'chrome' };

export default defineConfig({
  testDir: __dirname,
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  workers: 2,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(outputDir, 'playwright-report.json') }],
  ],
  outputDir: path.join(outputDir, '_test-results'),
  use: {
    baseURL: process.env.VISUAL_BASE_URL || 'http://127.0.0.1:4610',
    headless: true,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    colorScheme: 'light',
    trace: 'retain-on-failure',
    screenshot: 'off',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
    ...browserChannel,
  },
  projects: [
    {
      name: 'desktop-1440',
      use: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    },
    {
      name: 'mobile-375',
      use: { viewport: { width: 375, height: 812 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
    },
  ],
});
