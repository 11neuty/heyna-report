# HEYNA REPORT v1.0.0

**From Execution to Evidence.**

HEYNA REPORT v1.0.0 introduces an enterprise-style Playwright reporting framework that converts automated test execution into structured PDF evidence.

## Highlights

- Branded PDF report generated with PDFKit
- Screenshot evidence captured per test step
- API activity logging per test case
- Execution summary and test case summary
- Failed test analysis with error message and screenshot
- Reusable CommonJS utility architecture
- GitHub Actions workflow for CI artifacts

## New Features

- `Heyna.step()` wrapper for step execution and screenshot capture
- `Heyna.createApiLogger()` for API tracking
- `Heyna.initializeRun()` for metadata setup
- `Heyna.initializeTest()` for test lifecycle tracking
- `Heyna.completeTest()` for final status persistence
- `Heyna.markRunningTestsAsFailed()` safety mechanism
- `HeynaPdfGenerator.generate()` for custom PDF generation
- Logo support through `assets/heyna-logo.png`
- Footer with `Page X of Y`
- PDF sections:
  - Cover Page
  - Execution Summary
  - Test Case Summary
  - Failed Test Analysis
  - Step Summary
  - Evidence Section
  - API Activity

## Architecture

```text
utils/
├── HeynaReporter.js
└── HeynaPdfGenerator.js
```

`HeynaReporter.js` handles runtime tracking, step evidence, API logs, and JSON result data.

`HeynaPdfGenerator.js` handles the enterprise PDF layout and report rendering.

## Known Limitations

- PDF report is file-based and generated locally.
- Charts are not yet included.
- HTML dashboard is not yet available.
- Multi-project aggregation is not yet supported.
- Video and trace evidence are not yet embedded.

## Roadmap Preview

Next planned improvements:

- Pie chart summary
- Execution trend summary
- Video evidence
- HAR capture
- Trace viewer links
- HTML dashboard
- Theme support
- NPM package distribution

## Upgrade Notes

This is the first public release. No migration is required.

## Author

Ryan Daffa Pratama  
Software Quality Engineer
