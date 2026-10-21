# Final portability report

T044 intentionally skipped an intermediate capture. T058 later captured the frozen
snapshot 394cd73; see `REPORT-FINAL.md`. T-038 baseline/candidate artifacts and 18 diff
images remain untouched.

## Harness portability

- `run-visual.ps1`: `AppRoot` is required; no sibling/worktree or `C:\Users\...` default.
  Default output is ignored `tests/visual/.output/<mode>`. Explicit `-OutputDir` is
  recommended and may point outside the repo.
- `run-candidate.ps1`: `AppRoot` is required; default `BaseUrl` is 4611. `-StartApp`
  launches hidden Next dev with an owned PID; otherwise it refuses to test a stale app.
- Playwright CLI auto-detects `tests/visual/node_modules` then validation `node_modules`.
  Clone setup: `npm ci` in the validation worktree (required for test imports);
  `-PlaywrightCli` only overrides the CLI binary.
- Baseline setup is documented as a portable worktree from `8ed4a3d` + `npm ci` + explicit
  `-AppRoot`; no dependency on a pre-existing `baseline-ui` sibling.
- `compare.mjs` and `crop-evidence.mjs`: `--baseline`, `--candidate`, `--out` are required.
  No absolute or current-machine defaults remain.
- README has the reproducible clone/worktree/capture/compare commands and the full default
  list. No thresholds changed.

## T043 source closure

At T044 freeze, two source files in the maintenance worktree matched root commit
`683899b` byte-for-byte. T058 confirmed the same hashes in snapshot `394cd73` and current
root `c9f6ef2`:

| File | SHA-256 | Root match |
|---|---|---|
| `src/app/page.tsx` | `F17B2B2B7EE0D30652E45C3B31BDA199580DDC02D4CE49853F9D25107C5BB083` | yes |
| `src/lib/translations.ts` | `3C54DE87EE92E95DA7F3074AC1F16605392996D11E8F3AA49257A664693B051B` | yes |

The fixes are `formatPercent(null) -> —` (no fake values) and lowercase Spanish
`dashboard.totalRecords`. Visual closure of both defects is **pending the final capture**;
the T-038 REVIEW evidence is not rewritten or claimed as fixed by source inspection alone.

## Final capture contract (when integrator gives root AppRoot)

- Use the integrated root app path and its own deps; do not use the intermediate
  maintenance tree. Do not run Next dev on 4630 (T037 backend).
- Capture into a new directory (for example `<OUTSIDE_REPO>\final\candidate`); never
  overwrite `.visual-candidate/candidate` (T038) or `.visual-compare/latest`.
- Compare against the unchanged T-038 baseline at `<BASELINE_UI>\.visual-baseline\baseline`.
- Expected checks: home desktop height delta 0, data copy exact (lowercase), no new admin/
  database regressions beyond expected content/contract deltas.
- T052 logo check: `next/image` logos on login/home/nav must preserve dimensions, classes,
  `alt`, and exact source across 1440x900 and 375x812. The harness captures image boxes,
  classes and DOM; inspect logo crops before any visual PASS claim.
- Mechanical REVIEW stays REVIEW until triage. Do not lower thresholds or call zero diff
  equivalence without both screenshots.

## Retained evidence

- Baseline: `<BASELINE_UI>\.visual-baseline\baseline` (9 pages x 2 viewports).
- T038 candidate: `<BASELINE_UI>\.visual-candidate\candidate` (9 x 2).
- T038 compare: `<BASELINE_UI>\.visual-compare\latest` (18 diffs, crops, evidence,
  `REPORT-T038.md`).
- Harness: `tests/visual/**`. No product source, maintenance worktree or root checkout was
  modified. No commits.
