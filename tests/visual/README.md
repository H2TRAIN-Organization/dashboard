# T-013/T-038/T-044 portable visual harness

Scope: `tests/visual/**` only. No commits, no product edits, no threshold changes.
Mechanical verdicts remain **REVIEW** until manually triaged; REVIEW is not accepted as
visual PASS and pixel equality is never implied by a missing diff.

## Portable prerequisites

The harness has no machine-specific `AppRoot` or output defaults.

1. Playwright dependencies for the runner:
   ```powershell
   cd <VALIDATION_WORKTREE>
   npm ci
   ```
   `tests/visual` imports `@playwright/test`, so the validation worktree must have
   `node_modules` (or a local ignored junction). `-PlaywrightCli` only overrides the CLI
   binary; it does not fix test-module resolution by itself.
2. Baseline app (example, no dependency on a sibling checkout):
   ```powershell
   git worktree add --detach <BASELINE_DIR> 8ed4a3d
   cd <BASELINE_DIR>
   npm ci --no-audit --no-fund
   ```
   Expected baseline tree: Next 15.4.6 / React 19.1.0 / Supabase 2.54.0.
3. Integrated candidate app: use the commit/path supplied by the integrator. It must use
   its own installed dependencies (Next 16 + React 19.3 for T038). Do not point it at the
   baseline tree or at the changing root checkout.

Keep baseline/candidate/compare outputs outside the repository when possible, e.g.
`<OUTSIDE_REPO>\t013\baseline`. Defaults write to ignored `tests/visual/.output/<mode>`.

## Capture

```powershell
# Baseline: explicit app root and output. Hidden server on 4610, exact PID, own cleanup.
pwsh -NoProfile -ExecutionPolicy Bypass -File tests/visual/scripts/run-visual.ps1 `
  -Mode baseline `
  -AppRoot <BASELINE_DIR> `
  -OutputDir <OUTSIDE_REPO>\t013\baseline `
  -Workers 2 -MaxFailures 1

# Candidate: orchestrator starts the integrated app, or use -StartApp.
pwsh -NoProfile -ExecutionPolicy Bypass -File tests/visual/scripts/run-candidate.ps1 `
  -AppRoot <INTEGRATED_DIR> `
  -BaseUrl http://127.0.0.1:4611 `
  -OutputDir <OUTSIDE_REPO>\t044\candidate
# add -StartApp to launch hidden Next dev on 4611 with an owned PID.
```

Pages: login, app-login, home, users, data, analytics, overview, admin, database.
Viewports: 1440x900 and 375x812. `login/app-login` also get static JSX records.
Every local API, Supabase call, Kubios home call and external host is intercepted; writes
fail the test. Session storage/api fixtures are synthetic and do not prove login/backend.

## Compare and evidence

All paths are explicit CLI arguments; no defaults contain a machine path.

```powershell
node tests/visual/scripts/compare.mjs `
  --baseline <OUTSIDE_REPO>\t013\baseline `
  --candidate <OUTSIDE_REPO>\t044\candidate `
  --out <OUTSIDE_REPO>\t044\compare

node tests/visual/scripts/crop-evidence.mjs `
  --baseline <OUTSIDE_REPO>\t013\baseline `
  --candidate <OUTSIDE_REPO>\t044\candidate `
  --out <OUTSIDE_REPO>\t044\compare\evidence
```

`compare.mjs` always writes `comparison.json`/`comparison.md`, full-page diff images under
`diffs/`, hotspot crops under `crops/`, and per-page pixel/class/layout/chart metrics.
`crop-evidence.mjs` produces labelled side-by-side crops for the fixed T-038 hotspots.

## Defaults (no absolute machine paths)

`run-visual.ps1`
- `Mode=baseline`, `Port=4610`, `BaseUrl=http://127.0.0.1:<port>`
- `AppRoot` **required**; `SourceRoot=AppRoot`
- `OutputDir=tests/visual/.output/<mode>` (gitignored)
- `Workers=2`, `MaxFailures=1`, `BrowserChannel=chrome`
- `PlaywrightCli`: `tests/visual/node_modules` then validation `node_modules`
- logs/PIDs: `%TEMP%\opencode\t013-visual`
- `-NoStart`, `-StartApp`, `-KeepServer`, `-NoWarmup`, `-Grep` retained

`run-candidate.ps1`
- `AppRoot` **required**
- `BaseUrl=http://127.0.0.1:4611`, `OutputDir` defaults through `run-visual.ps1`
- refuses to test an incomplete/stale app when `-StartApp` is not supplied and 4611 is down

## Current freeze

- T058 final captured against detached snapshot `394cd73`, output
  `<OUTSIDE_REPO>\t013\...` equivalent: `.visual-final/candidate` and `.visual-final/compare`.
  See `REPORT-FINAL.md`: 12 PASS / 6 content-delta REVIEW, home height 0, data PASS,
  T052 logo geometry/alt/classes verified.
- T-038 baseline and candidate evidence are preserved unchanged; T044 was not captured.
- T043 source is integrated: actual `formatPercent(null)` returns `'-'`; Spanish
  `dashboard.totalRecords` is lowercase. Visual closure is recorded in `REPORT-FINAL.md`.
- T052: login/app-login `next/image` matches baseline attrs; nav logo keeps geometry,
  alt/class and component source, with optimized DOM image source as intended.

## T-038 retained evidence

Baseline: `<BASELINE_UI>\.visual-baseline\baseline` (9 pages x 2 viewports + structural).
Candidate T038: `<BASELINE_UI>\.visual-candidate\candidate` (9 x 2).
Comparison T038: `<BASELINE_UI>\.visual-compare\latest` with 18 diff images, crops and
`REPORT-T038.md`. Do not overwrite that directory with T044/final output.
