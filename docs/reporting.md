# Reporting and Failure Indicators

HEYNA REPORT builds PDF and static HTML reports from the current execution records in `test-results/`. Report generation is part of global teardown and can also be run manually with `node regenerate-report.js`.

## Current-run data

The reporter maintains:

- `test-results/execution.json` — test status, duration, steps, attempts, evidence paths, failure category, and trace availability
- `test-results/metadata.json` — run metadata, status counts, pass rate, failure-category counts, and auto-capture coverage
- `evidence/<testCase>/` — screenshots and filtered API logs

JSON writes are coordinated and atomic. These current-run files are separate from optional immutable execution history.

Current execution records also receive additive deterministic identity fields when Playwright `testInfo` is available. Project, repeat index, and retry count keep separate finalized executions from overwriting one another; retries for the same repeat execution remain attempts of one outcome. The new fingerprints do not add complete stacks or additional raw-message copies.

## PDF output

PDF generation writes:

- `reports/HeynaReport.pdf`
- `reports/TestExecutionReport.pdf`, a compatibility copy

Depending on the available execution data, the PDF contains execution summaries, test and step detail, failed-test analysis, grouped failures, aggregate failure indicators, deterministic root-cause classifications, trace availability, and evidence references.

## Static HTML dashboard

HTML generation writes one self-contained document:

```text
dashboard/index.html
```

The generator embeds its markup, charts, and styles in that file. It reads the current execution data while generating the document and does not create a separate dashboard data directory. Screenshot and trace links can reference other generated artifacts.

Implemented sections include:

- run metadata and status summary cards
- automation-health and auto-capture coverage indicators
- test-status, coverage, and slowest-test charts
- intelligent failure summary
- deterministic root-cause classifications
- trace availability
- failure-group summary
- test-case table
- per-action coverage diagnostics
- recent failed tests and available failure screenshots

The dashboard is static. It does not implement client-side filtering, sorting, expandable rows, keyboard image navigation, or an interactive failure-group viewer.

## Failure classification

Failed, timed-out, and interrupted test records may contain a `failureCategory` field. Classification uses deterministic error-message patterns and the following constants:

- `ASSERTION_FAILURE`
- `LOCATOR_FAILURE`
- `TIMEOUT_FAILURE`
- `NETWORK_FAILURE`
- `API_FAILURE`
- `CONFIGURATION_FAILURE`
- `UNKNOWN_FAILURE`

The category is an indicator produced by configured rules. It is not a diagnosis of the application.

## In-memory failure grouping

During PDF or HTML generation, `groupFailures()` groups unsuccessful test records by:

```text
failureCategory + normalized failure signature
```

Each group contains its category, normalized signature, occurrence count, and affected test-case names. Groups sort by occurrence count and then deterministic category/signature ordering.

Grouping is computed from the current execution data in memory. It does not write `failure-groups.json`, merge historical runs, or expose a command-line interface.

Historical recurrence is a separate read-only facility based on immutable per-run indexes. See [Failure Trends and Recurring Issues](failure-trends.md). Issue #19 does not add failure-trend sections to the PDF or static HTML dashboard.

## Aggregate failure summary

The failure summary engine derives:

- total unsuccessful tests
- category distribution
- up to five recurring failure groups
- up to five impacted feature areas
- a rule-based investigation recommendation
- a health label based on the current pass rate

Health thresholds are:

- `HEALTHY`: at least 95%, or no tests
- `WARNING`: at least 80% and below 95%
- `CRITICAL`: below 80%

These are report indicators, not quality gates, release decisions, or statistical predictions.

## Root-cause classifications

`clusterRootCauses()` combines current-run failure groups using feature, signature, stack-origin, error-type, category, and keyword signals. It returns clusters with:

- an identifier
- a root-cause classification and label
- a numeric confidence score and `HIGH`, `MEDIUM`, or `LOW` label
- dominant failure category
- occurrence count and percentage
- affected tests and feature areas
- rule-derived evidence strings
- normalized signatures
- a recommended investigation

The classification constants are:

- `AUTH_FLOW_REGRESSION`
- `UI_REGRESSION`
- `API_REGRESSION`
- `TIMEOUT_REGRESSION`
- `CONFIGURATION_REGRESSION`
- `UNKNOWN_ROOT_CAUSE`

Confidence is a deterministic score derived from available cluster signals. It is not a probability, and the root-cause label is not confirmation of the actual cause. Consumers should treat the result as an investigation aid.

## Trace availability

When a test is initialized with Playwright `testInfo`, HEYNA may retain the resolved `trace.zip` locator in a process-memory-only private association with that execution context. The private locator is never serialized or returned through public reporter data.

`traceAvailable: true` means that the trace was detected and inspected. `traceFile` is optional. A relative `traceFile` is serialized only when the trace path is safely contained within the configured artifact root, does not traverse outside that root, and passes sensitive-path suppression. Unsafe, external, credential-like, or token-like trace paths may therefore produce `traceAvailable: true` without `traceFile`. `traceAvailable` does not guarantee a clickable or downloadable link. PDF and HTML trace links or references are rendered only when a safe serialized `traceFile` is available, and unsafe external traces are not copied automatically.

Missing or unreadable trace files produce `traceAvailable: false`. Starting a retry attempt atomically resets the top-level trace state. A later no-trace attempt clears `traceFile`, `traceSize`, and `traceModified`; earlier attempts may retain their own trace metadata when attempt history is preserved.

HEYNA REPORT does not parse trace ZIP contents, enrich individual actions from traces, extract trace network or console events, or calculate trace step-time analysis.

The checked-in Playwright configuration uses `trace: 'on-first-retry'`, so a trace is not expected for every successful first attempt.

## Regeneration

If `test-results/execution.json` and `test-results/metadata.json` already exist:

```bash
node regenerate-report.js
```

This regenerates the PDF and static HTML output without executing tests. It does not create or update immutable history.

## Privacy

Reports and evidence may expose error messages, test data, screenshots, URLs, trace files, and filtered API activity. Failure indexes omit raw messages and stacks, but project-relative file names and user-controlled suite/test titles can still be sensitive and are not guaranteed to be automatically redacted. Treat all generated output as potentially sensitive and apply suitable storage, access, and retention controls.
