# Changelog

All notable changes to HEYNA REPORT will be documented in this file.

## v1.0.0

### Added

- Screenshot Evidence per step
- Auto Action Capture for native Playwright actions
- API Logging
- PDF Report generation with PDFKit
- Execution Summary
- Test Case Summary
- Step Summary
- Failed Test Analysis
- Custom HEYNA branding
- Logo support through `assets/heyna-logo.png`
- Footer with page numbering
- GitHub Actions workflow
- Reusable CommonJS reporting utilities
- `heyna.config.js` for auto-capture configuration

### Changed

- Reorganized Playwright tests into `tests/examples/` for sample usage and `tests/framework/` for framework regression coverage.
- Renamed `pdf-page-management.spec.js` to `pdf-generator.spec.js` under `tests/framework/`.

### Fixed

- Status Handling for `PASSED`, `FAILED`, `SKIPPED`, and `TIMEDOUT`
- Report Generation stability
- Failed test persistence in `execution.json`
- Error message storage for failed tests
- Failed screenshot capture
- Table border consistency
- PDF footer rendering

### Changed

- Consolidated reporting utilities into:
  - `utils/HeynaReporter.js`
  - `utils/HeynaPdfGenerator.js`
- Improved enterprise PDF layout
- Improved evidence card spacing and screenshot placement

## v2.2.0

### Added

- HTML Dashboard Foundation generating `dashboard/index.html`.
- Metadata header, summary cards, test case table, coverage diagnostics, and recent failed tests sections.
- Dashboard generation in global teardown and `regenerate-report.js` while preserving PDF generation.

## v2.1.0

### Added

- Production-ready Auto Action Capture engine
- Support for `getByRole`, `getByText`, `getByLabel`, `getByPlaceholder`, `getByTestId`, `getByAltText`, and `getByTitle`
- Support for locator chaining: `first`, `last`, `nth`, and `filter`
- Support for `dragAndDrop`, `setInputFiles`, `hover`, `dblclick`, `tap`, `focus`, `blur`, `keyboard.press`, and `mouse.click`
- Retry-aware attempt data in `execution.json`
- Auto Capture Coverage diagnostics
- Global teardown report finalization for safer parallel execution

### Fixed

- Reduced race-condition risk during parallel execution
- Prevented per-file `afterAll` report generation from marking other running tests as failed
