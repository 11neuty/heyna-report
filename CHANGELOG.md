# Changelog

Notable HEYNA REPORT changes are recorded here in reverse chronological order. Released headings correspond to Git tags; development milestones are described only under **Unreleased**.

## Unreleased — 2.4.0-next.0

Development work for the v2.4.0 milestone. No stable `v2.4.0` tag exists.

### Added

- Opt-in immutable execution history with atomic publication, latest-pointer recovery, retention, migration, and artifact manifests.
- Summary diagnostics that distinguish missing, corrupt, invalid, unsupported, and unreadable historical runs.
- Read-only historical metric queries and aggregation with weighted pass rates, exact fixed-scale duration arithmetic, UTC grouping, and partial-result warnings.
- Read-only run/day/week/month pass-rate trends with chronological series, explicit comparisons, deterministic classification, moving weighted rates, and propagated data-quality warnings.
- Isolated project and artifact roots for framework tests and embedded consumers.

### Changed

- Global teardown attempts PDF, HTML, and history stages independently and always releases the current-run lock.
- Current-run JSON writes are atomic and report corrupt existing data instead of silently replacing it.
- `TIMEDOUT` and `INTERRUPTED` remain distinct canonical statuses; `unsuccessful` is `failed + timedOut + interrupted`.
- Package metadata identifies the CommonJS development version as `heyna-report@2.4.0-next.0` with Node 20 or later required.

### Compatibility

- Existing current-run JSON, PDF, dashboard, and evidence locations remain unchanged.
- Execution history and retention are disabled by default.
- History, aggregation, and trend schemas are independently versioned at `1.0.0`.

## v2.3.1 — 2026-06-21

- Prepared the repository and package metadata for private beta.
- Retained the reporting, failure-analysis, and trace-availability features introduced in v2.3.0.

## v2.3.0 — 2026-06-21

- Added deterministic failure classification and normalized failure signatures.
- Added in-memory failure grouping and aggregate failure summaries.
- Added deterministic root-cause clusters with confidence, evidence, and recommendations.
- Added Playwright trace-file detection and trace availability in PDF and HTML reports.

## v2.2.0 — 2026-06-19

- Added the static HTML dashboard at `dashboard/index.html`.
- Added execution analytics, summary cards, charts, coverage diagnostics, failure indicators, and dashboard report generation.

## v2.2.0-beta.2 — 2026-06-19

- Expanded the HTML dashboard with execution analytics during beta development.

## v2.2.0-beta.1 — 2026-06-18

- Introduced the initial HTML dashboard foundation.

## v2.1.0 — 2026-06-17

- Added automatic capture for supported Playwright page, locator, keyboard, and mouse actions.
- Added modern locator factories and locator chaining.
- Added configurable screenshot modes, coverage diagnostics, retry-aware execution records, and safer global teardown finalization.

## v1.0.0 — 2026-06-11

- Added Playwright execution reporting, screenshot evidence, filtered API logging, and PDF generation.
- Added execution, test-case, step, and failed-test summaries.
- Added HEYNA branding, project configuration, and the initial GitHub Actions workflow.
