# HTML Dashboard

Version: HEYNA REPORT v2.3.0

The HTML dashboard provides an interactive, browser-based view of test execution results. It is generated alongside the PDF report and is available at `dashboard/index.html`.

## Features

### Test Status Summary

Overview cards showing:
- Total tests
- Passed / Failed / Skipped
- Pass rate percentage
- Total execution duration

### Filtering

Filter tests by:
- Status (All, Passed, Failed, Skipped)
- Feature name
- Test case name (text search)

### Interactive Tables

- Sortable columns: Test Case, Status, Duration, Feature
- Expandable rows showing step details
- Color-coded status indicators (green for pass, red for fail, yellow for skip)

### Step Details

Each test case row can be expanded to reveal:
- Step name
- Step status (PASS / FAIL)
- Step mode (AUTO or MANUAL)
- Screenshot thumbnails for each step

### Screenshot Viewer

Click any step thumbnail to open a full-size screenshot overlay. Navigate between screenshots within the same test case using keyboard arrows or on-screen controls.

### Failure Analysis

Failed tests include:
- Error message display
- Failure screenshot
- Root cause classification (when available)
- Suggested fix or action

### Responsive Design

The dashboard adapts to desktop and tablet viewports. Not optimized for mobile.

## Requirements

- A modern browser (Chrome, Firefox, Edge, Safari)
- JavaScript enabled
- No server required — open `dashboard/index.html` directly

## Output Location

```text
dashboard/
|-- index.html
|-- data/
|   |-- execution.json
|-- screenshots/
|   |-- <testCase>/
|       |-- <timestamp>_<stepName>.png
```

## Regeneration

Run without re-executing tests:

```bash
node regenerate-report.js
```

This regenerates both the PDF report and HTML dashboard from existing `test-results/` data.
