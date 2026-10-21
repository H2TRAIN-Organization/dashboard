import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { installVisualMocks } from './fixtures/mock-api';
import { collectVisualSnapshot } from './support/collect';
import { PAGE_DEFINITIONS, seedBrowserStorage } from './support/session';

const OUTPUT_DIR = process.env.VISUAL_OUTPUT_DIR || path.resolve(process.cwd(), 'tests/visual/.output');
const FREEZE_CSS = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
  }
  html { scroll-behavior: auto !important; }
  nextjs-portal { display: none !important; }
`;

for (const definition of PAGE_DEFINITIONS.filter((page) => page.rendered)) {
  test(`${definition.id} - ${definition.label}`, async ({ context, page }, testInfo) => {
    testInfo.setTimeout(75_000);

    const targetDir = path.join(OUTPUT_DIR, testInfo.project.name);
    await fs.mkdir(targetDir, { recursive: true });
    const baseName = definition.id;

    const state = await installVisualMocks(context, { authenticated: definition.auth !== 'none' });
    await seedBrowserStorage(context, definition.auth);
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: Array<{ url: string; error: string }> = [];

    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('requestfailed', (request) => {
      failedRequests.push({ url: request.url(), error: request.failure()?.errorText ?? 'unknown' });
    });

    const response = await page.goto(definition.path, { waitUntil: 'domcontentloaded' });
    expect(response?.status(), `HTTP status for ${definition.path}`).toBe(200);

    try {
      await page.locator(`${definition.ready}:visible`).first().waitFor({ state: 'visible', timeout: 15_000 });
    } catch (error) {
      const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
      const blocked = {
        page: definition,
        baseURL: testInfo.project.use.baseURL,
        readySelector: definition.ready,
        observedBody: bodyText.replace(/\s+/g, ' ').trim().slice(0, 500),
        spinnerVisible: /Cargando|Verificando autenticaci|loading/i.test(bodyText),
        networkState: state,
        consoleErrors,
        pageErrors,
        failedRequests,
        error: error instanceof Error ? error.message : String(error),
        capturedAt: new Date().toISOString(),
        note: 'Rendered baseline blocked before ready selector. This is failure evidence, not a PASS.',
      };
      await fs.writeFile(path.join(targetDir, `${baseName}.blocked.json`), JSON.stringify(blocked, null, 2));
      await fs.writeFile(path.join(targetDir, `${baseName}.blocked.html`), await page.content().catch(() => ''));
      await page.screenshot({ path: path.join(targetDir, `${baseName}.blocked.png`), fullPage: true }).catch(() => undefined);
      throw new Error(`BLOCKED ${definition.path}: ready selector "${definition.ready}" not visible within 15s. spinner=${blocked.spinnerVisible} body="${blocked.observedBody}"`);
    }

    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    await page.evaluate(() => document.fonts.ready).catch(() => undefined);
    await page.addStyleTag({ content: FREEZE_CSS });
    await page.waitForTimeout(2_500);
    await page.evaluate(() => window.scrollTo(0, 0));

    const snapshot = await collectVisualSnapshot(page);
    const cleanedHtml = await page.evaluate(() => {
      const clone = document.body.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('nextjs-portal, script').forEach((node) => node.remove());
      return clone.outerHTML;
    });

    await fs.writeFile(path.join(targetDir, `${baseName}.snapshot.json`), JSON.stringify(snapshot, null, 2));
    await fs.writeFile(path.join(targetDir, `${baseName}.dom.html`), cleanedHtml);
    await fs.writeFile(
      path.join(targetDir, `${baseName}.network.json`),
      JSON.stringify(
        {
          page: definition,
          baseURL: testInfo.project.use.baseURL,
          label: process.env.VISUAL_PROJECT_LABEL ?? 'unlabelled',
          sourceCommit: process.env.VISUAL_SOURCE_COMMIT ?? null,
          sourceRoot: process.env.VISUAL_SOURCE_ROOT ?? null,
          serverPid: process.env.VISUAL_SERVER_PID ?? null,
          capturedAt: new Date().toISOString(),
          state,
          consoleErrors,
          pageErrors,
          failedRequests,
        },
        null,
        2,
      ),
    );
    await page.screenshot({
      path: path.join(targetDir, `${baseName}.png`),
      fullPage: true,
      animations: 'disabled',
    });

    expect(state.writeAttempts, 'no write may reach any API').toEqual([]);
    expect(state.unmocked, 'every local API call must have a fixture').toEqual([]);
    expect(state.external, 'no external request may leave the browser').toEqual([]);
  });
}
