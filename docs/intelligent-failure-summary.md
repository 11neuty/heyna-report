# Intelligent Failure Summary

Version: HEYNA REPORT v2.3.0-004

The Intelligent Failure Summary analyzes failed test cases and generates human-readable explanations of what went wrong and why.

## Features

### Automated Error Analysis

For each failed test, the system:
1. Captures the error message and stack trace
2. Identifies the failing action or assertion
3. Extracts relevant context (locator, expected vs actual values, page state)
4. Generates a concise failure description

### Root Cause Suggestions

When patterns are recognized, the system suggests probable root causes:

- **Locator Issues**: "Element not found — the page may have changed or the locator is stale"
- **Timeout Issues**: "Page or element did not load within the expected timeframe — consider increasing timeout or checking network latency"
- **Assertion Failures**: "Expected value did not match actual — verify application state or test data"
- **Network Issues**: "API request failed — check server availability or endpoint URL"

### Failure Context Enrichment

Each failure summary includes:
- The exact line of code that failed
- The action being performed
- The element locator (if applicable)
- Screenshot at time of failure
- Page URL at time of failure
- Browser console logs (when available)

### Summary Report

At the end of execution, a consolidated summary is produced:

```text
Failures: 3
  TC001_Login_Error — Assertion Failure: expected URL to contain 'inventory' but got 'login'
  TC005_Checkout_Fail — Timeout: waitForSelector '#checkout-summary' exceeded 30000ms
  TC012_Search_Empty — Element Not Found: locator '.search-results' did not exist
```

## Output

Failure summaries are stored in `test-results/execution.json` as part of each failed test case entry. The PDF report includes the summary in the Failure Analysis section.
