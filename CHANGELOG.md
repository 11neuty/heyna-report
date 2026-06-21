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

## v2.3.0

### Added

- Failure Classification Engine in `utils/FailureClassifier.js`
- Automatic failure categorization for test failures
- `failureCategory` field in `execution.json`
- `failureCategories` aggregation in `metadata.json`
- Failure category display in PDF Failed Test Analysis
- Failure category badge in HTML Dashboard failure cards
- Unit tests for all classification categories
- Failure Grouping & Aggregation in `utils/FailureGrouping.js`
- `computeFailureSignature()` normalization in `utils/FailureClassifier.js`
- Failure Group Summary section in PDF report
- Failure Group Summary section in HTML dashboard
- Unit tests for signature normalization and failure grouping
- Intelligent Failure Summaries in `utils/FailureSummaryEngine.js`
- INTELLIGENT FAILURE SUMMARY section in PDF report
- Intelligent Failure Summary panel in HTML dashboard
- Unit tests for health status, distribution, recurring failures, impacted suites, and recommendations
- Root Cause Clustering via `utils/RootCauseClusterer.js`
- ROOT CAUSE ANALYSIS section in PDF report
- Root Cause Analysis panel in HTML dashboard
- Unit tests for clustering, confidence scoring, cross-category merge, and edge cases

### Root Cause Taxonomy (6 categories)

- `AUTH_FLOW_REGRESSION` - Authentication flow failures
- `UI_REGRESSION` - UI/element interaction failures
- `API_REGRESSION` - API endpoint contract failures
- `TIMEOUT_REGRESSION` - Timeout-related failures
- `CONFIGURATION_REGRESSION` - Browser/environment configuration failures
- `UNKNOWN_ROOT_CAUSE` - Unrecognized fallback

### Root Cause Clustering

Groups failures into root-cause clusters by merging `FailureGroup` objects that share the same feature area and have compatible failure patterns (shared stack origin, shared error type, or cross-category merge). Each cluster includes:

- **Root Cause Classification**: One of 6 taxonomy labels, with auth-keyword override
- **Confidence Score**: 0-100 (HIGH ≥80, MEDIUM ≥50, LOW <50) from 5 additive signals
- **Evidence**: List of signatures, features, and error types backing the classification
- **Recommendation**: Actionable guidance specific to the root cause type

Displayed in both PDF and HTML reports as a Root Cause Analysis section.

### Supported Categories

- `ASSERTION_FAILURE` - Playwright assertion failures
- `LOCATOR_FAILURE` - Element/locator not found or interaction failures
- `TIMEOUT_FAILURE` - Timeout-related failures
- `NETWORK_FAILURE` - Network/connectivity failures
- `API_FAILURE` - API request/response failures
- `CONFIGURATION_FAILURE` - Browser/config/environment setup failures
- `UNKNOWN_FAILURE` - Unrecognized failure fallback

### Failure Grouping

Groups similar failures by `failureCategory` + normalized signature. Groups are sorted by frequency descending. Each group shows occurrence count and affected test cases. Displayed in both PDF and HTML reports as a Grouped Failure Summary section.

### Intelligent Failure Summaries

Generates execution intelligence to help QA engineers quickly understand test health:

- **Health Status**: HEALTHY (>95% pass), WARNING (>80%), CRITICAL (<80%)
- **Failure Distribution**: Count and percentage per failure category (sorted descending)
- **Top Recurring Failures**: Most frequent failure signatures (top 5)
- **Impacted Test Suites**: Most affected feature areas (top 5, grouped by `feature` field)
- **Investigation Recommendations**: Actionable guidance based on dominant failure category

Displayed in both PDF and HTML reports as an Intelligent Failure Summary section.

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
