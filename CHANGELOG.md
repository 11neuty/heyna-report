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
