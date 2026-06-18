# Quick Start

Get HEYNA REPORT running in about 5 minutes.

## 1. Clone Project

```bash
git clone https://github.com/your-username/heyna-report.git
cd heyna-report
```

## 2. Install Dependency

```bash
npm install
```

## 3. Install Playwright Browser

```bash
npx playwright install chromium
```

## 4. Run Test

```bash
npm test
```

For a clean execution:

```bash
npm run test:clean
```

## 5. Open Report

Generated reports:

```text
reports/HeynaReport.pdf
reports/TestExecutionReport.pdf
dashboard/index.html
```

Evidence files:

```text
evidence/
```

Execution data:

```text
test-results/execution.json
test-results/metadata.json
```

## Regenerate Reports Only

```bash
node regenerate-report.js
```

This regenerates the PDF report and HTML dashboard from existing `test-results` data.

## Minimal Test Usage

Place example tests under `tests/examples/` and framework regression tests under `tests/framework/`.

```js
const { test } = require('@playwright/test');
const Heyna = require('../../utils/HeynaReporter');

test('Sample Test', async ({ page }) => {
    const testCase = 'Sample_Test';

    Heyna.initializeTest(testCase);
    Heyna.attach(page, testCase);

    await page.fill('#username', 'admin');
    await page.fill('#password', 'secret');
    await page.click('#login');

    Heyna.completeTest(testCase, 'PASSED', 1000);
});
```

`Heyna.attach(page, testCase)` enables Auto Action Capture for supported actions such as `fill`, `click`, `check`, `uncheck`, `selectOption`, and `press`.
