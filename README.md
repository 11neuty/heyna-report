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

![Version](https://img.shields.io/badge/version-v2.1.1-blue)
![Playwright](https://img.shields.io/badge/Playwright-supported-green)
![License](https://img.shields.io/badge/license-MIT-orange)
![Node.js](https://img.shields.io/badge/node-%3E=18-brightgreen)

</p>

---

## Why HEYNA REPORT?

Most Playwright reporting solutions focus on test results.

HEYNA REPORT focuses on evidence.

Instead of manually collecting:

* Screenshots
* API Activity
* Execution Results
* Failure Analysis
* Test Evidence

HEYNA REPORT automatically generates a structured evidence report ready for:

* QA Teams
* Stakeholders
* Auditors
* Portfolio Demonstrations
* CI/CD Artifacts

---

## Features

### Auto Action Capture

Automatically captures native Playwright actions without requiring manual reporting code.

Supported Actions:

| Action           | Supported |
| ---------------- | --------- |
| fill()           | Yes       |
| click()          | Yes       |
| check()          | Yes       |
| uncheck()        | Yes       |
| selectOption()   | Yes       |
| press()          | Yes       |
| hover()          | Yes       |
| dblclick()       | Yes       |
| dragAndDrop()    | Yes       |
| setInputFiles()  | Yes       |
| tap()            | Yes       |
| focus()          | Yes       |
| blur()           | Yes       |
| keyboard.press() | Yes       |
| mouse.click()    | Yes       |

### Modern Playwright Locator Support

| Locator API        | Supported |
| ------------------ | --------- |
| locator()          | Yes       |
| getByRole()        | Yes       |
| getByText()        | Yes       |
| getByLabel()       | Yes       |
| getByPlaceholder() | Yes       |
| getByTestId()      | Yes       |
| getByAltText()     | Yes       |
| getByTitle()       | Yes       |

### Reporting Capabilities

* Screenshot Evidence
* API Logging
* Execution Summary
* Test Case Summary
* Step Summary
* Failed Test Analysis
* Failure Classification Engine
* Failure Grouping & Aggregation
* Retry Tracking
* Coverage Diagnostics
* Parallel Execution Support

### Output Formats

#### PDF Report

Enterprise-style PDF report containing:

* Cover Page
* Execution Summary
* Test Case Summary
* Failed Test Analysis
* Retry Summary
* Evidence Section
* API Activity
* Coverage Diagnostics

#### HTML Dashboard

Browser-based dashboard containing:

* Metadata Header
* Summary Cards
* Test Case Table
* Coverage Diagnostics
* Recent Failed Tests

### Framework Features

* Playwright Page Object Model Support
* Retry-Aware Reporting
* Worker-Safe Parallel Execution
* Global Teardown Report Generation
* Custom Branding Support
* GitHub Actions Integration
* Zero-Boilerplate Reporting

---

## Sample Report

<p align="center">
  <img width="480" src="https://github.com/user-attachments/assets/cc7d438e-893f-44fc-8e36-553f5f22e713" alt="Sample Report">
</p>

---

## Example

Native Playwright code:

```javascript
await page.fill('#username', 'admin');
await page.fill('#password', 'secret');
await page.click('#login');
```

Automatically generates:

```text
âœ“ Fill Username
âœ“ Fill Password
âœ“ Click Login
```

No manual reporting steps required.

---

## Project Structure

```text
.
|-- assets/
|   |-- heyna-logo.png
|-- pages/
|   |-- BasePage.js
|   |-- LoginPage.js
|-- tests/
|   |-- examples/
|   |   |-- login.spec.js
|   |-- framework/
|   |   |-- auto-capture.spec.js
|   |   |-- pdf-generator.spec.js
|-- utils/
|   |-- HeynaReporter.js
|   |-- HeynaPdfGenerator.js
|   |-- HeynaHtmlDashboardGenerator.js
|   |-- FailureClassifier.js
|   |-- FailureGrouping.js
|   |-- FailureSummaryEngine.js
|-- reports/
|   |-- HeynaReport.pdf
|   |-- TestExecutionReport.pdf
|-- dashboard/
|   |-- index.html
|-- evidence/
|   |-- <test-case>/
|-- test-results/
|   |-- execution.json
|   |-- metadata.json
|-- docs/
|   |-- auto-action-capture.md
|   |-- installation.md
|   |-- quick-start.md
|   |-- sample-project.md
|   |-- roadmap.md
|-- playwright.config.js
|-- heyna.config.js
|-- heyna.global-teardown.js
|-- regenerate-report.js
|-- package.json
|-- CHANGELOG.md
|-- CONTRIBUTING.md
|-- LICENSE
|-- README.md
```

### Core Components

| Component                | Description                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| HeynaReporter.js         | Runtime reporting facade for screenshots, steps, metadata, retries, and execution tracking |
| HeynaPdfGenerator.js     | PDFKit-based enterprise report renderer                                                    |
| HeynaHtmlDashboardGenerator.js | Static HTML dashboard renderer for metadata, summaries, test cases, coverage, and failures |
| heyna.config.js          | Auto-capture and reporting configuration                                                   |
| heyna.global-teardown.js | Generates report once after all Playwright workers complete                                |
| regenerate-report.js     | Regenerates PDF and dashboard from existing execution data                                 |
| tests/examples           | Example implementations for users                                                          |
| tests/framework          | Internal regression tests for framework validation                                         |

---

## Installation

Clone repository:

```bash
git clone https://github.com/11neuty/heyna-report.git

cd heyna-report
```

Install dependencies:

```bash
npm install
```

Install Playwright browsers:

```bash
npx playwright install
```

---

## Quick Start

Run all tests:

```bash
npm test
```

Run with Playwright directly:

```bash
npx playwright test
```

Run from clean state:

```bash
npm run clean

npx playwright test
```

Generated outputs:

```text
reports/HeynaReport.pdf
reports/TestExecutionReport.pdf
dashboard/index.html

evidence/

test-results/
```

---

## Auto Action Capture

Enable auto-capture:

```javascript
Heyna.initializeTest(currentTC);

Heyna.attach(page, currentTC);
```

Then write native Playwright code:

```javascript
await page.fill('#user-name', 'standard_user');

await page.fill('#password', 'secret_sauce');

await page.click('#login-button');
```

Generated report steps:

```text
Fill Username
Fill Password
Click Login
```

Manual reporting remains available:

```javascript
await Heyna.step(
    page,
    currentTC,
    'Submit Order',
    async () => {

        await page.click('#submit');

    }
);
```

---

## Configuration

Example:

```javascript
module.exports = {

    autoCapture: true,

    screenshotMode: 'failure-only',

    autoActions: [
        'fill',
        'click',
        'check',
        'uncheck',
        'selectOption',
        'press'
    ],

    apiLogging: {

        include: [
            '/api/'
        ]

    }

};
```

### Screenshot Modes

| Mode              | Description                    |
| ----------------- | ------------------------------ |
| off               | Disable screenshots            |
| failure-only      | Capture failed actions only    |
| all               | Capture all actions            |
| important-actions | Capture important user actions |

---

## Failure Grouping & Aggregation

Groups similar failures by category and normalized error signature to reduce report noise.

### How It Works

1. Failed test cases are classified by the Failure Classification Engine
2. Error messages are normalized into stable signatures (e.g. `EXPECT_TO_HAVE_URL`, `TIMEOUT`, `LOCATOR_NOT_FOUND`)
3. Failures with the same `failureCategory` + `signature` are grouped together
4. Groups are sorted by occurrence count (most frequent first)
5. Each group displays occurrence count and affected test case names

### Group Display

- **PDF Report**: Grouped Failure Summary section with table (Category, Signature, Occurrences, Affected Tests)
- **HTML Dashboard**: Failure Group Summary panel with table and category badges

## Intelligent Failure Summaries

Generates execution intelligence after each test run to help QA engineers quickly understand test health and prioritise investigation.

### Health Status

| Pass Rate | Status |
|---|---|
| >= 95% | HEALTHY |
| >= 80% | WARNING |
| < 80% | CRITICAL |

### Failure Distribution

Counts and percentages per failure category, computed directly from `executionData`. Categories with zero failures are hidden.

### Top Recurring Failures

Top 5 failure signatures by occurrence count, sourced from the Failure Group Summary.

### Impacted Test Suites

Top 5 most affected feature areas, grouped by the `feature` field on each test case.

### Investigation Recommendations

When a single failure category exceeds 40% of total failures, a targeted recommendation is shown:

| Dominant Category | Recommendation |
|---|---|
| ASSERTION_FAILURE | Review business rules and expected outcomes. |
| LOCATOR_FAILURE | Review selectors and recent UI changes. |
| TIMEOUT_FAILURE | Review application response times and waiting strategy. |
| NETWORK_FAILURE | Review environment stability and API availability. |
| API_FAILURE | Review API contracts, status codes, and endpoint health. |
| CONFIGURATION_FAILURE | Review browser configuration, environment setup, and test dependencies. |
| UNKNOWN_FAILURE | Review raw error messages and extend classification rules. |

If no category exceeds 40%, a combined recommendation is displayed.

### Report Integration

- **PDF Report**: INTELLIGENT FAILURE SUMMARY section (after Execution Summary)
- **HTML Dashboard**: Intelligent Failure Summary panel (after Automation Health)

## Failure Classification Engine

Automatically categorizes test failures into predefined categories.

### Supported Categories

| Category | Description |
| -------- | ----------- |
| ASSERTION_FAILURE | Playwright assertion failures (expect, toBe, toEqual, etc.) |
| LOCATOR_FAILURE | Element not found, strict mode violations, locator interaction failures |
| TIMEOUT_FAILURE | Timeout exceeded, waiting failures |
| NETWORK_FAILURE | Network connectivity errors, DNS failures, connection refused |
| API_FAILURE | API request/response failures, non-2xx status codes |
| CONFIGURATION_FAILURE | Browser launch failures, fixture errors, environment setup failures |
| UNKNOWN_FAILURE | Fallback for unclassified failures |

The classification result is stored in `execution.json` as `failureCategory` on each failed test case, aggregated in `metadata.json` under `failureCategories`, and displayed in both PDF and HTML reports.

## Auto Capture Coverage

HEYNA REPORT validates capture quality automatically.

Example:

```text
Auto Capture Coverage

Detected Actions: 26
Captured Actions: 26
Missed Actions: 0
```

---

## Retry-Aware Reporting

Example:

```text
TC001_Login

Attempt 1
FAILED

Attempt 2
PASSED

Final Result
PASSED
```

Execution history is preserved and included in report data.

---

## Parallel Execution Support

Supported:

```bash
npx playwright test --workers=4
```

Features:

* Worker-safe execution aggregation
* Retry-aware reporting
* Stale lock cleanup
* Single report generation
* Global teardown report generation

---

## Generate Report Manually

Regenerate PDF without running tests:

```bash
node regenerate-report.js
```

Output:

```text
reports/HeynaReport.pdf
```

---

## Report Sections

Generated PDF includes:

* Cover Page
* Execution Summary
* Test Case Summary
* Failed Test Analysis
* Retry Summary
* Step Summary
* Evidence Section
* API Activity
* Coverage Diagnostics

---

## CI/CD Integration

Example GitHub Actions:

```yaml
- name: Run Playwright Tests
  run: npx playwright test

- name: Upload Report
  uses: actions/upload-artifact@v4
  with:
    name: heyna-report
    path: reports/
```

---

## Documentation

* [Installation](docs/installation.md)
* [Quick Start](docs/quick-start.md)
* [Sample Project](docs/sample-project.md)
* [Auto Action Capture](docs/auto-action-capture.md)
* [Changelog](CHANGELOG.md)
* [Roadmap](docs/roadmap.md)
* [Contributing](CONTRIBUTING.md)

---

## Roadmap

### v2.2

* HTML Dashboard
* Interactive Report Viewer
* Enhanced Charts

### v3.0

* Video Evidence
* HAR Capture
* Trace Viewer Integration

### v4.0

* Multi Project Reporting
* Theme Support
* Report Templates

### v5.0

* NPM Package Distribution
* Plugin Ecosystem
* AI Failure Analysis

See [docs/roadmap.md](docs/roadmap.md) for complete roadmap.

---

## Contributing

Contributions are welcome.

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a pull request.

---

## License

MIT License

See [LICENSE](LICENSE) for details.

---

## Author

Ryan Daffa Pratama

Software Quality Engineer

GitHub: https://github.com/11neuty
