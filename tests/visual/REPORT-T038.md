# T-038 candidate visual report

## Checkpoint: capture block and fix

First candidate run stopped in `app-login` after 5.6 s because the new frontend requested
`GET /api/auth/session` and the visual harness returned 501 (unmocked). This was a harness
gap, not a frontend failure. Fix limited to `tests/visual`:

- authenticated pages -> synthetic `200 { user, method:'email', expiresAt }`;
- login/app-login -> synthetic `401` (no session);
- `GET /api/users` -> canonical camelCase list `{ users, total }` + pagination;
- all other existing fixtures unchanged.

After this fix: **20 passed, 2 skipped** in 48 s, port 4611, hidden server PID 36760 stopped
by the runner. Candidate `3806a3c`, Next 16.4.2 / React 19.3.1 / Supabase 2.118.0.
0 unmocked API, 0 writes, 0 external requests, 0 page/console errors. No remote calls.

## Comparison result

Mechanical comparison: 10/18 page comparisons **PASS**, 8 **REVIEW**. The word REVIEW is
not accepted as a verdict here; each is triaged below.

PASS (both 1440x900 and 375x812, no measured defect):
`login`, `app-login`, `users`, `analytics`, `overview`. Pixel mismatch 0.000-0.116%;
class Jaccard 1.0; charts equal.

### 1. Real visual defect: home desktop height +32 px

`home` at 1440 grows from 1352 to 1384 px. `formatPercent(null)` renders
`No disponible` inside the `text-2xl` metric of the “Análisis Avanzado” card. It wraps to
two lines, stretches the first grid row, and shifts the second row down. Pixel difference
in the overlapping area is 2.250%; layout Jaccard 0.800. Mobile has no height delta
(+0 px) but the same text substitution.

Action: keep the metric on one line (nowrap / smaller fallback token) or provide a stable
value; do not restore the baseline's fake 97%.

Evidence:
`...\.visual-compare\latest\evidence\home-desktop-metric-cards-side-by-side.png`
`...\latest\diffs\desktop-1440--home.diff.png`

### 2. Copy regression: data totals capitalization

Baseline user rows: `15 registros totales`; candidate: `15 Registros Totales`.
The runtime string comes from `t.dashboard.totalRecords` (`src/app/data/page.tsx:1094`).
Baseline's `dashboard` translation object had duplicate `totalRecords` keys
(`Registros Totales`, then `registros totales`; the last wins). The candidate keeps the
uppercase key only. Pixel diff 0.167% desktop / 0.499% mobile, localized to text; desktop
layout Jaccard 1.0, page height unchanged. Charts equal.

Action: decide the canonical copy; if parity is required, restore lowercase. Otherwise
document as intentional.

Evidence:
`...\latest\evidence\data-desktop-user-card-side-by-side.png`
`...\latest\diffs\desktop-1440--data.diff.png`

### 3. Data-contract deltas, not CSS regressions

- `home`: accuracy/system status are now `null` -> `No disponible`; baseline showed seeded
  97%/100%. Same classes; mobile geometry unchanged.
- `admin`: 15/2847/99.8% becomes 5/44/`No disponible`; pixel 0.844% desktop / 1.204%
  mobile, all localized to stat values. Admin height unchanged, class Jaccard 1.0,
  layout Jaccard 0.79/0.86 only because text widths differ. Baseline values were static.
- `database`: 7->6 table cards, Kubios row absent (Kubios is excluded by scope), table
  names lose underscores (`insulin_data` -> `insulindata`), size labels become `Operativo`,
  record total 8807 -> 44. Height -180 px desktop / -208 px mobile. Class Jaccard 1.0;
  the height change is row-set/content, not a CSS class regression.
  Decide whether table names should be humanized; do not re-add Kubios unless scope changes.

Evidence:
`...\latest\evidence\admin-desktop-stats-side-by-side.png`
`...\latest\evidence\database-desktop-table-list-side-by-side.png`
`...\latest\evidence\database-mobile-table-list-side-by-side.png`
`...\latest\evidence\home-mobile-metric-cards-side-by-side.png`

### Charts

All pages: chart counts and primitives equal (`chartCount`, lines, areas, bars, sectors,
dots, SVG). No chart defect found.

## Artifacts

- Candidate captures: `...\baseline-ui\.visual-candidate\candidate`
- Comparison: `...\baseline-ui\.visual-compare\latest\comparison.{md,json}`
- Diff images: `...\latest\diffs\`
- Hotspot crops: `...\latest\crops\`
- Labelled evidence crops: `...\latest\evidence\`
- This report: `tests/visual/REPORT-T038.md`

No commits. Candidate worktree restored clean; no product source edited.
