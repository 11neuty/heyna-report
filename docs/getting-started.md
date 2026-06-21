# Getting Started

This guide walks you through your first HEYNA REPORT run and explains the core concepts.

## Overview

HEYNA REPORT is a Playwright-native test reporting framework. Write standard Playwright tests and get a professional PDF report, HTML dashboard, structured failure analysis, and trace-based debugging.

## Prerequisites

- Node.js 20+
- npm

## Quick Install

```bash
git clone <repository-url>
cd heyna-report
npm install
npx playwright install chromium
```

## Your First Run

```bash
npm test
```

After execution, check:

- `reports/HeynaReport.pdf` — full PDF report
- `dashboard/index.html` — interactive HTML dashboard
- `evidence/` — per-test-case screenshots and logs

## Core Concepts

### Test Lifecycle

1. **Initialize Run**: `Heyna.initializeRun()` in `beforeAll`
2. **Initialize Test**: `Heyna.initializeTest()` in `beforeEach`
3. **Attach Auto Capture**: `Heyna.attach(page, testCase)` in `beforeEach`
4. **Complete Test**: `Heyna.completeTest()` in `afterEach`
5. **Generate Report**: `HeynaPdfGenerator.generate()` in `afterAll`

### Auto Action Capture

Call `Heyna.attach(page, testCase)` once per test. Every `click`, `fill`, `check`, and supported action is automatically recorded as a step with screenshots. No manual step logging needed.

### API Logging

Call `Heyna.createApiLogger(page, testCase)` to intercept all Playwright API requests and responses. Saved as `api-log.json` in the test case evidence folder.

## Example Test

See `examples/playwright/login.spec.js` for a working example with Page Object Model, auto capture, and API logging.

## Configuration

See `playwright.config.js` for Playwright settings. HEYNA REPORT custom options are passed via the `heyna` property in the config.
