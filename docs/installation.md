# Installation Guide

This guide explains how to install and verify HEYNA REPORT locally.

## Prerequisites

Install Node.js LTS:

- Recommended: Node.js 20 or later
- Download: https://nodejs.org

Verify Node.js and npm:

```bash
node --version
npm --version
```

## 1. Clone Repository

```bash
git clone https://github.com/your-username/heyna-report.git
cd heyna-report
```

## 2. Install Dependencies

```bash
npm install
```

This installs:

- Playwright test runner
- PDFKit
- Allure Playwright integration
- Node.js type definitions

## 3. Install Playwright Browsers

```bash
npx playwright install
```

To install only Chromium:

```bash
npx playwright install chromium
```

## 4. Verify Installation

Run the test suite:

```bash
npm test
```

Run from a clean state:

```bash
npm run test:clean
```

Expected generated folders:

```text
evidence/
reports/
test-results/
allure-results/
```

Expected report:

```text
reports/HeynaReport.pdf
```

## 5. Regenerate Report

If test data already exists, regenerate the PDF without rerunning tests:

```bash
node regenerate-report.js
```

## Troubleshooting

### Playwright Browser Missing

Run:

```bash
npx playwright install
```

### Dependency Issue

Remove dependencies and reinstall:

```bash
rm -rf node_modules package-lock.json
npm install
npx playwright install
```

On Windows PowerShell:

```powershell
Remove-Item node_modules,package-lock.json -Recurse -Force -ErrorAction SilentlyContinue
npm install
npx playwright install
```

### Report Not Generated

Check these files:

```text
test-results/execution.json
test-results/metadata.json
```

Then regenerate:

```bash
node regenerate-report.js
```
