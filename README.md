# HEYNA REPORT

HEYNA REPORT is a CommonJS reporting framework for Playwright that turns test execution into PDF and static HTML reports, structured execution data, screenshots, failure indicators, and optional immutable history.

> **Development status:** this branch reports version `2.4.0-next.0` for the unreleased v2.4.0 milestone. The latest stable Git tag is `v2.3.1`.

## Requirements

- Node.js 20 or later
- npm

## Get started

```bash
git clone https://github.com/11neuty/heyna-report.git
cd heyna-report
npm install
npx playwright install chromium
npm test
```

The full suite uses the repository's Playwright configuration and generates the current-run report artifacts during global teardown.

## Generated output

Default output locations are:

- `reports/HeynaReport.pdf` — primary PDF report
- `reports/TestExecutionReport.pdf` — compatibility copy of the PDF report
- `dashboard/index.html` — single-file static HTML dashboard
- `test-results/execution.json` — per-test execution records
- `test-results/metadata.json` — run metadata and auto-capture coverage
- `evidence/<testCase>/` — screenshots and API logs

Existing execution data can be rendered again with:

```bash
node regenerate-report.js
```

## Verified capabilities

- Automatic capture of supported Playwright page, locator, keyboard, and mouse actions
- Configurable screenshot capture and per-test evidence
- PDF and static HTML reporting
- Failure classification, signature grouping, summary indicators, and deterministic root-cause classifications
- Trace-file availability, path, and size reporting
- Retry-aware execution records and isolated framework-test artifacts
- Opt-in immutable execution history with retention and migration support
- Read-only historical metrics aggregation
- Weighted pass-rate trend analysis

## Documentation

- [Getting started](docs/getting-started.md)
- [Configuration](docs/configuration.md)
- [Reporting and failure indicators](docs/reporting.md)
- [Auto Action Capture](docs/auto-action-capture.md)
- [Execution history storage](docs/history-storage.md)
- [Historical metrics aggregation](docs/historical-metrics-aggregation.md)
- [Pass-rate trends](docs/pass-rate-trends.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)

## CI

The checked-in [GitHub Actions workflow](.github/workflows/heyna-report.yml) installs Node 20 and Chromium, runs the test suite, regenerates reports, and uploads report artifacts.

## Privacy and retention

Screenshots, traces, API logs, execution data, and retained history may contain credentials, page content, network details, or personal data. History is disabled by default. Review [history configuration and retention](docs/history-storage.md) before enabling it, and apply appropriate CI artifact retention and access controls.

## License

HEYNA REPORT is available under the [MIT License](LICENSE).
