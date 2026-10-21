# T-058 final visual report

## Source freeze

- Visual snapshot: `C:\Users\Jia_admin\Desktop\dashboard-worktrees\final-visual`
  detached at **`394cd73029ab12f8da526c0d2fbb41d4d5d3ff48`** (`dev` at capture start).
- Root advanced during capture to **`c9f6ef2`** (`dev`, lint promotion). Diff
  `394cd73..c9f6ef2` is package scripts plus whitespace-only
  `Navigation.tsx`/`HybridNavigation.tsx`/`SimpleNavigation.tsx`; no material UI/DOM
  change. The snapshot's key UI source hashes below also match current root.
- AppRoot source SHA-256:
  - `src/app/page.tsx`: `48A4CD468AA506527A65A4795AC4B1D16C1F2951CD02A6CE375292DC7959C2AE`
  - `src/lib/translations.ts`: `3C54DE87EE92E95DA7F3074AC1F16605392996D11E8F3AA49257A664693B051B`
  - `src/components/Navigation.tsx`: `75209773A6F1641D7DC325B3FEBF53E76A2F25FD670C28C2FF03F041FEE17F92`
  - `src/app/login/page.tsx`: `A5D4BACB23255EF075F59C172311E48B03B9E409DD36C9FB8B3DD8A88C48B7FD`
- Dependencies were a temporary junction to root `node_modules`; versions matched the
  snapshot lock exactly (Next 16.4.2 / React 19.3.1 / Supabase 2.118.0). No `.env` was
  copied and no Supabase/environment secrets were loaded. Junction removed after capture;
  root node_modules intact.
- Final snapshot tree is clean after capture. No commits/merges/rebase.

## Capture

- Hidden server port 4611, PID **47548**, stopped by the runner.
- **20 passed, 2 skipped** (viewport-independent structural checks), 1.3 min.
- 9 pages x 1440x900 + 375x812.
- `0` unmocked APIs, `0` write attempts, `0` external requests, `0` page errors.
- `8` console messages are only expected `401` probes from `/api/auth/session` on
  login/app-login (no-session fixture). No other console errors; calendar/context clean.
- Session/user/data/Kubios fixtures are synthetic and do not prove backend behavior.

## Mechanical comparison

**12 PASS / 6 REVIEW**; overall remains **REVIEW**, not global pixel equivalence.

PASS (both viewports): `login`, `app-login`, `data`, `analytics`, `overview`, `users`.
Pixel 0.000-0.160%, class Jaccard 1.0, chart primitives equal.

Triage of 6 REVIEWs:

1. **Home** (desktop/mobile): height delta **0**; pixel 0.080%/0.311%; text hash differs
   because baseline fake 97%/100% is now `-` (actual final source uses `'-'`, not `—`).
   The former “No disponible” wrap/+32 px defect is closed. Remaining difference is
   intentional null-metric content, no layout regression.
2. **Data**: PASS; lowercase `registros totales` restored. Former copy defect closed.
3. **Admin** (both): content delta only: 5/44/`No disponible` vs baseline static
   15/2847/99.8%. Class Jaccard 1.0, height 0; pixel 0.868%/1.253% is localized text.
   Expected content/contract delta, not a CSS defect.
4. **Database** (both): 6 vs 7 table cards, Kubios absent by scope, API table names/labels
   and totals differ; height -180/-208 px. Class Jaccard 1.0; pixel 9.395%/10.425% overlap
   is the row-set/vertical shift. Expected content/scope delta, not a class regression.

Chart primitives are equal on every page. No threshold changes.

## T052 logos

- Login/app-login: `next/image` DOM is identical to baseline (same `srcset`, `src`, alt,
  width/height, classes); geometry 315.8x128 desktop / 158.5x64 mobile; logo-crop pixel
  mismatch **0%**.
- Navigation home: geometry exact (118.6x48 desktop, 158.1x64 mobile), alt/classes/
  component source `/logo-horizontal.png` preserved. Baseline used raw `<img>`; final uses
  optimized `next/image` DOM. Logo-crop mismatch 5.55% desktop / 4.16% mobile (image
  optimization/antialiasing); labelled side-by-sides show identical rendering.
- Evidence: `.visual-final\compare\evidence\logo-*-side-by-side.png`,
  `.visual-final\compare\logo-check.json`.

## Tooling

- `tests/visual` lint with current root ESLint config: **0 warnings/0 errors**.
- `tests/visual` TypeScript check with root TS: **0 errors**.
- Root `npm run lint`, `npm run typecheck`, `npm run typecheck:app`: **pass**.

## Artifacts

- Final candidate: `<BASELINE_UI>\.visual-final\candidate`
- Final comparison: `<BASELINE_UI>\.visual-final\compare` (`comparison.{md,json}`,
  `diffs/`, `crops/`, `evidence/`, `logo-check.json`)
- Baseline retained unchanged: `<BASELINE_UI>\.visual-baseline\baseline`
- T038 retained unchanged: `<BASELINE_UI>\.visual-candidate\candidate` and
  `<BASELINE_UI>\.visual-compare\latest`
- No new real defects. T043 home/data visual closure confirmed; T052 logo verification
  passed.
