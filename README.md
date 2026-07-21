# HEYNA REPORT

<p align="center">
  <img src="https://github.com/user-attachments/assets/8710e36e-e140-41c8-8a8e-38fdd207a9c9" alt="HEYNA REPORT Demo">
</p>

<p align="center">

**From Execution to Evidence.**

</p>

<p align="center">

Zero-Boilerplate Playwright Reporting Framework
Automatically captures Playwright actions and transforms test execution into structured evidence reports.

</p>

<p align="center">

![Version](https://img.shields.io/badge/version-v2.4.0--next.0-blue)
![Playwright](https://img.shields.io/badge/Playwright-supported-green)
![License](https://img.shields.io/badge/license-MIT-orange)
![Node.js](https://img.shields.io/badge/node-%3E=20-brightgreen)

</p>

---

## Quick Start

```bash
# Clone
git clone <repository-url>
cd heyna-report

# Install
npm install
npx playwright install chromium

# Run tests
npm test

# Open reports
# PDF: reports/HeynaReport.pdf
# HTML: dashboard/index.html
```

---

## Project Structure

```text
.
|-- assets/
|   |-- heyna-logo.png
|-- pages/
|   |-- BasePage.js
|   |-- LoginPage.js
|-- examples/
|   |-- playwright/
|       |-- login.spec.js
|-- tests/
|   |-- framework/
|       |-- auto-capture.spec.js
|       |-- pdf-generator.spec.js
|-- utils/
|   |-- HeynaReporter.js
|   |-- HeynaPdfGenerator.js
|   |-- HeynaHtmlDashboardGenerator.js
|   |-- HistoryManager.js
|   |-- ArtifactPaths.js
|   |-- FailureClassifier.js
|   |-- FailureGrouping.js
|   |-- FailureSummaryEngine.js
|-- reports/
|-- dashboard/
|-- evidence/
|-- test-results/
|-- history/
|   |-- runs/
|   |-- .temp/
|   `-- latest.json
|-- docs/
|-- playwright.config.js
|-- heyna.config.js
|-- heyna.global-teardown.js
|-- regenerate-report.js
|-- package.json
```

---

## Features

- **Auto Action Capture** — Native Playwright actions (fill, click, check, etc.) recorded automatically
- **PDF Report** — Enterprise-style PDF with execution summary, test cases, failure analysis, evidence
- **HTML Dashboard** — Interactive browser-based report with filtering, sorting, screenshot viewer
- **Failure Classification** — Automated categorization of test failures (assertion, timeout, locator, etc.)
- **Failure Grouping** — Clusters similar failures by root cause to reduce noise
- **Intelligent Failure Summaries** — Human-readable analysis with health status and recommendations
- **Root Cause Analysis** — Cross-group clustering with confidence scoring
- **Trace Intelligence** — Playwright Trace Viewer integration for action enrichment
- **API Logging** — Automatic Playwright API request/response capture
- **Retry-Aware** — Per-test retry history preserved across attempts
- **Parallel Execution** — Worker-safe reporting for concurrent test runs
- **Durable Execution History (opt-in prerelease)** — Immutable, versioned run snapshots with atomic publication, retrieval, retention, and legacy migration. Disabled by default; review evidence privacy and retention before enabling it.
- **Historical Metrics Aggregation** - Read-only normalized queries, exact three-decimal-millisecond rollups, truthful aggregation-only exclusions, and UTC grouping over backward-compatible schema `1.0.0` run summaries.
- **Pass Rate Trends** - Chronological run and UTC bucket series with weighted changes, deterministic direction, moving weighted rates, and explicit data-quality warnings.

---

## Documentation

| Guide | Description |
|-------|-------------|
| [Getting Started](docs/getting-started.md) | First run walkthrough and core concepts |
| [Installation](docs/installation.md) | Full installation guide |
| [Quick Start](docs/quick-start.md) | 5-minute quick start |
| [Sample Project](docs/sample-project.md) | Complete example with Page Object Model |
| [Auto Action Capture](docs/auto-action-capture.md) | Auto capture reference |
| [HTML Dashboard](docs/html-dashboard.md) | Dashboard features and usage |
| [Failure Classification](docs/failure-classification.md) | Failure category reference |
| [Failure Grouping](docs/failure-grouping.md) | Root cause clustering |
| [Intelligent Failure Summary](docs/intelligent-failure-summary.md) | Failure analysis engine |
| [Root Cause Analysis](docs/root-cause-analysis.md) | Cross-group analysis |
| [Trace Intelligence](docs/trace-intelligence.md) | Playwright Trace integration |
| [Execution History Storage](docs/history-storage.md) | Configuration, storage format, retrieval, retention, and migration |
| [Historical Metrics Aggregation](docs/historical-metrics-aggregation.md) | Query filters, metric semantics, grouping, and warnings |
| [Pass Rate Trends](docs/pass-rate-trends.md) | Weighted pass-rate series, changes, classification, moving rates, and warnings |
| [Roadmap](docs/roadmap.md) | Planned features |
| [Release History](docs/release-history.md) | Version changelog |

---

## Quick Example

```javascript
// Native Playwright code
await page.fill('#username', 'admin');
await page.fill('#password', 'secret');
await page.click('#login');
```

Automatically generates: Fill Username, Fill Password, Click Login — no manual reporting code needed.

See [`examples/playwright/login.spec.js`](examples/playwright/login.spec.js) for a complete working example.

---

## CI/CD

See [`.github/workflows/heyna-report.yml`](.github/workflows/heyna-report.yml) for GitHub Actions integration.

---

## License

MIT License. See [LICENSE](LICENSE) for details.
