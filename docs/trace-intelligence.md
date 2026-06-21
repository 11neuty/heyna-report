# Playwright Trace Intelligence

Version: HEYNA REPORT v2.3.0-005

Trace Intelligence integrates Playwright Trace Viewer data into the HEYNA REPORT ecosystem. It extracts meaningful insights from Playwright trace files and correlates them with test execution data.

## Features

### Trace Extraction

- Reads Playwright trace files (`.zip` format)
- Extracts actions, network requests, and console messages
- Aligns trace actions with HEYNA REPORT test steps
- Produces structured trace data per test case

### Action Enrichment

Trace data enriches each captured action with:
- Actual vs expected timing
- Network status during the action
- Console warnings or errors near the action timestamp
- Resource size and load time

### Step-Time Analysis

- Tracks how long each Playwright action took
- Identifies slow operations (fills, clicks, navigations)
- Detects network-induced latency on action execution

### Trace Coverage

Calculates how many Playwright actions were captured by the HEYNA REPORT auto-capture system:

```text
Trace Coverage
  Total Playwright Actions: 47
  Captured by HEYNA: 44
  Coverage Rate: 93.6%
  Missed Actions: 3
```

## Data Flow

1. Playwright generates trace files during test execution (when `trace: 'on'` is set)
2. After test completion, the Trace Intelligence module reads the trace files
3. Trace data is merged into the test execution record
4. Reports optionally include trace insights

## Configuration

Enable trace collection in `playwright.config.js`:

```js
use: { trace: 'on' }
```

Trace Intelligence runs automatically when trace files are present in `test-results/traces/`.

## Output

Trace data is stored per test case in `test-results/execution.json` under a `trace` field. The PDF report includes a Trace Intelligence section when trace data is available.
