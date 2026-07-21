# Getting Started

This is the canonical installation and first-run guide for the HEYNA REPORT repository.

## Prerequisites

- Node.js 20 or later
- npm
- Git

Verify the runtime:

```bash
node --version
npm --version
```

## Install

```bash
git clone https://github.com/11neuty/heyna-report.git
cd heyna-report
npm install
npx playwright install chromium
```

`npm install` installs Playwright, PDFKit, Allure integration, and the repository's development dependencies. Installing only Chromium is sufficient for the checked-in Playwright project.

## Run the tests and generate reports

Run the complete configured suite:

```bash
npm test
```

The Playwright global teardown generates the PDF and static HTML reports after the run. Focused framework suites are also available:

```bash
npm run test:framework
npm run test:history
npm run test:trends
```

`npm run test:clean` removes known runtime output before testing, but the current clean script uses PowerShell and is therefore Windows-specific.

## Generated files

The default current-run outputs are:

```text
reports/
  HeynaReport.pdf
  TestExecutionReport.pdf
dashboard/
  index.html
test-results/
  execution.json
  metadata.json
evidence/
  <testCase>/
    <timestamp>_<step>.png
    api-log.json
```

The dashboard is generated as a single static HTML file. Open `dashboard/index.html` in a modern browser; it does not require a server. Evidence and trace links may refer to other generated files.

To regenerate both reports from existing `test-results` data:

```bash
node regenerate-report.js
```

## Use the reporting lifecycle

The checked-in [Playwright example](../examples/playwright/login.spec.js) demonstrates the current lifecycle:

1. Call `Heyna.initializeRun(metadata)` once for the run.
2. Call `Heyna.initializeTest(testCase, attemptMetadata)` before each test.
3. Attach automatic action capture with `Heyna.attach(page, testCase)`.
4. Optionally create and save an API logger.
5. Finish with `Heyna.completeTest(...)`, passing `testInfo` when trace detection is required.
6. Let the configured global teardown generate reports and optional history.

The repository's Playwright `testDir` is `tests/`. The example under `examples/playwright/` is reference code and is not automatically discovered by `npm test`.

## Configure HEYNA REPORT

HEYNA REPORT loads project configuration from the repository-root `heyna.config.js`. It is separate from `playwright.config.js`.

See [Configuration](configuration.md) for output roots, auto-capture, screenshots, API logging, and execution-history settings.

## Troubleshooting

### Browser executable is missing

```bash
npx playwright install chromium
```

On Linux CI systems that need browser dependencies:

```bash
npx playwright install --with-deps chromium
```

### Dependencies are inconsistent

Use the committed lockfile for a clean dependency install:

```bash
npm ci
```

### Reports were not generated

Check that `test-results/execution.json` and `test-results/metadata.json` exist, then run:

```bash
node regenerate-report.js
```

If the execution files do not exist, rerun `npm test`.

### Framework tests leave output in the repository

Framework-only commands normally use an isolated temporary artifact root and remove it during teardown. If a run is interrupted, verify `git status --short --ignored` and remove only confirmed generated output directories.
