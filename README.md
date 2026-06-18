<<<<<<< HEAD
# HEYNA REPORT
=======
﻿# HEYNA REPORT
<img width="1920" height="1080" alt="demo" src="https://github.com/user-attachments/assets/8710e36e-e140-41c8-8a8e-38fdd207a9c9" />
>>>>>>> 9a5d1c3 (refactor: separate example and framework test suites)

<p align="center">
  <img src="https://github.com/user-attachments/assets/8710e36e-e140-41c8-8a8e-38fdd207a9c9" alt="HEYNA REPORT Demo">
</p>

<p align="center">

From Execution to Evidence.

</p>

<p align="center">

Zero-Boilerplate Playwright Reporting Framework

Automatically captures Playwright actions and transforms test execution into structured evidence reports.

</p>

<p align="center">

![Version](https://img.shields.io/badge/version-v2.1.0-blue)
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

Automatically captures native Playwright actions without manual reporting code.

Supported actions:

| Action           | Supported |
| ---------------- | --------- |
| fill()           | ✅         |
| click()          | ✅         |
| check()          | ✅         |
| uncheck()        | ✅         |
| selectOption()   | ✅         |
| press()          | ✅         |
| hover()          | ✅         |
| dblclick()       | ✅         |
| dragAndDrop()    | ✅         |
| setInputFiles()  | ✅         |
| tap()            | ✅         |
| focus()          | ✅         |
| blur()           | ✅         |
| keyboard.press() | ✅         |
| mouse.click()    | ✅         |

---

### Modern Playwright Locator Support

| Locator API        | Supported |
| ------------------ | --------- |
| locator()          | ✅         |
| getByRole()        | ✅         |
| getByText()        | ✅         |
| getByLabel()       | ✅         |
| getByPlaceholder() | ✅         |
| getByTestId()      | ✅         |
| getByAltText()     | ✅         |
| getByTitle()       | ✅         |

---

### Reporting Features

* Screenshot Evidence
* Auto Action Capture
* API Logging
* Execution Summary
* Test Case Summary
* Step Summary
* Failed Test Analysis
* Retry Tracking
* Coverage Diagnostics
* PDF Report Generation
* Custom Branding
* Enterprise Report Layout
* GitHub Actions Integration

---

## Sample Report

<img width="480" src="https://github.com/user-attachments/assets/cc7d438e-893f-44fc-8e36-553f5f22e713" alt="Sample Report">

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
✓ Fill Username
✓ Fill Password
✓ Click Login
```

No manual reporting steps required.

---

## Architecture

```text
.
<<<<<<< HEAD
├── assets/
│   └── heyna-logo.png
│
├── pages/
│   ├── BasePage.js
│   └── LoginPage.js
│
├── tests/
│   ├── login.spec.js
│   └── auto-capture.spec.js
│
├── utils/
│   ├── HeynaReporter.js
│   └── HeynaPdfGenerator.js
│
├── reports/
│   └── HeynaReport.pdf
│
├── evidence/
│   └── <test-case>/
│
├── test-results/
│   ├── execution.json
│   └── metadata.json
│
├── playwright.config.js
├── heyna.config.js
├── heyna.global-teardown.js
├── regenerate-report.js
└── package.json
```

---
=======
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
|-- reports/
|   |-- HeynaReport.pdf
|-- evidence/
|   |-- <test-case>/
|-- test-results/
|   |-- execution.json
|   |-- metadata.json
|-- playwright.config.js
|-- regenerate-report.js
|-- package.json
```

Core components:

- `utils/HeynaReporter.js`: Runtime reporting facade for steps, screenshots, API logs, metadata, and execution results.
- `utils/HeynaPdfGenerator.js`: PDFKit-based report renderer for HEYNA REPORT.
- `heyna.config.js`: Auto-capture, screenshot, action, and API logging configuration.
- `assets/heyna-logo.png`: Optional logo used automatically on the cover page.
- `test-results/execution.json`: Structured execution data used by the PDF generator.
- `evidence/`: Screenshot and API log storage per test case.
- `tests/examples/`: Sample usage tests that demonstrate HEYNA REPORT integration.
- `tests/framework/`: Framework regression tests for auto-capture and PDF generation behavior.
>>>>>>> 9a5d1c3 (refactor: separate example and framework test suites)

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

Initialize HEYNA REPORT:

<<<<<<< HEAD
```javascript
const Heyna = require('../utils/HeynaReporter');
=======
```bash
npm test
```

Run from a clean state:

```bash
npm run test:clean
```

Regenerate the PDF report from existing test result data:

```bash
node regenerate-report.js
```

For a 5-minute walkthrough, see [QUICK_START.md](QUICK_START.md).

## Auto Action Capture

HEYNA REPORT v2.0 can capture supported Playwright actions automatically. Tests can keep native Playwright syntax:

```js
await page.fill('#username', 'admin');
await page.fill('#password', 'secret');
await page.click('#login');
```

HEYNA REPORT records readable steps such as:

```text
Fill Username
Fill Password
Click Login
```

Enable auto-capture once per test after `initializeTest()`:

```js
Heyna.attach(page, currentTC);
```

Manual reporting is still supported:

```js
await Heyna.step(page, currentTC, 'Custom Business Step', async () => {
    await page.click('#submit');
});
```

## Generate Report

HEYNA REPORT is generated automatically in `test.afterAll()`:

```js
const { HeynaPdfGenerator } = require('../../utils/HeynaPdfGenerator');

test.afterAll(async () => {
    Heyna.markRunningTestsAsFailed();
    await HeynaPdfGenerator.generate();
});
```

Output files:

```text
reports/HeynaReport.pdf
reports/TestExecutionReport.pdf
```

`TestExecutionReport.pdf` is kept as a legacy-compatible copy.

## Configuration

Configure project metadata in your test setup:

```js
const Heyna = require('../../utils/HeynaReporter');
>>>>>>> 9a5d1c3 (refactor: separate example and framework test suites)

test.beforeAll(async () => {

    Heyna.initializeRun({
        project: 'SauceDemo',
        feature: 'Login & Authentication',
        environment: 'QA',
        browser: 'chromium'
    });

});
```

Attach Auto Capture:

```javascript
test.beforeEach(async ({ page }) => {

    Heyna.initializeTest(currentTC);

    Heyna.attach(page, currentTC);

});
```

Write native Playwright tests:

```javascript
await page.fill('#user-name', 'standard_user');
await page.fill('#password', 'secret_sauce');
await page.click('#login');
```

Run tests:

```bash
npx playwright test
```

---

## Auto Capture Coverage

HEYNA REPORT automatically validates capture quality.

Example:

```text
Auto Capture Coverage

Detected Actions: 26
Captured Actions: 26
Missed Actions: 0
```

This helps ensure reporting accuracy.

---

## Screenshot Modes

Configure screenshot behavior:

```javascript
module.exports = {

    screenshotMode: 'failure-only'

};
```

Available modes:

| Mode              | Description                    |
| ----------------- | ------------------------------ |
| off               | Disable screenshots            |
| failure-only      | Capture only failed actions    |
| all               | Capture every action           |
| important-actions | Capture important user actions |

---

## Configuration

Example configuration:

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

## Parallel Execution Support

HEYNA REPORT supports:

```bash
npx playwright test --workers=4
```

Features:

* Worker-safe execution aggregation
* Retry-aware reporting
* Stale lock cleanup
* Single report generation

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

## Generate Report Manually

Regenerate report from existing execution data:

```bash
node regenerate-report.js
```

Output:

```text
reports/HeynaReport.pdf
```

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

See ROADMAP.md for details.

---

## Documentation

* INSTALLATION.md
* QUICK_START.md
* CHANGELOG.md
* ROADMAP.md
* CONTRIBUTING.md

---

## Contributing

Contributions are welcome.

Please read CONTRIBUTING.md before submitting a pull request.

---

## License

MIT License

See LICENSE for details.

---

## Author

Ryan Daffa Pratama

Software Quality Engineer

GitHub: https://github.com/11neuty
