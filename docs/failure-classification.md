# Failure Classification

Version: HEYNA REPORT v2.3.0

Failure Classification analyzes test failures and assigns a structured category to each one. This enables trend analysis, root cause grouping, and intelligent reporting.

## Classification Categories

### Assertion Failures

Failures caused by `expect()` statements or value comparisons. These are the most common category and typically indicate application behavior changes.

Examples:
- `expect(value).toBe(expected)` mismatch
- Element state assertion failed
- Text content does not match

### Timeout Failures

Failures caused by Playwright waiting for elements or conditions that did not appear within the timeout window.

Examples:
- `waitForSelector` timed out
- `waitForNavigation` timed out
- `waitForLoadState` timed out

### Element Not Found

The target element does not exist in the DOM. Common when locators are stale or the page structure changed.

Examples:
- `locator.click()` — element not found
- `locator.fill()` — no element
- Page navigation to a different route than expected

### Browser / Page Crash

The browser tab crashed, was closed unexpectedly, or encountered a fatal error.

Examples:
- Page crashed
- Browser disconnected
- Navigation aborted

### Network Failures

Failures related to API calls, network requests, or server connectivity.

Examples:
- API response status not as expected
- Network request failed
- Response data mismatch

### Unknown

Failures that do not match any predefined category. These are flagged for manual review.

## Classification Algorithm

1. Parse the error message and stack trace
2. Match against known patterns for each category
3. If no pattern matches, classify as Unknown
4. Store classification in `test-results/execution.json`

## Output

Each test case in `execution.json` includes a `classification` field:

```json
{
  "testCase": "TC001_Login_Success",
  "status": "FAILED",
  "classification": "Assertion Failure",
  "error": "expect(received).toBe(expected)"
}
```

## Usage with Reports

The PDF report includes classification badges on failed tests. The HTML dashboard provides filtering by classification category.
