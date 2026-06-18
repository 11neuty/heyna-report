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
✓ Fill Username
✓ Fill Password
✓ Click Login
```

No manual reporting steps required.

---

## Project Structure

```text
.
├── assets/
│   └── heyna-logo.png
│
├── pages/
│   ├── BasePage.js
│   └── LoginPage.js
│
├── tests/
│   ├── examples/
│   │   └── login.spec.js
│   │
│   └── framework/
│       ├── auto-capture.spec.js
│       └── pdf-generator.spec.js
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
├── package.json
└── README.md
```

### Core Components

| Component                | Description                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| HeynaReporter.js         | Runtime reporting facade for screenshots, steps, metadata, retries, and execution tracking |
| HeynaPdfGenerator.js     | PDFKit-based enterprise report renderer                                                    |
| heyna.config.js          | Auto-capture and reporting configuration                                                   |
| heyna.global-teardown.js | Generates report once after all Playwright workers complete                                |
| regenerate-report.js     | Regenerates PDF from existing execution data                                               |
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

* INSTALLATION.md
* QUICK_START.md
* SAMPLE_PROJECT.md
* AUTO_ACTION_CAPTURE.md
* CHANGELOG.md
* ROADMAP.md
* CONTRIBUTING.md

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

See ROADMAP.md for complete roadmap.

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
