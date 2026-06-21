# Root Cause Analysis

Version: HEYNA REPORT v2.3.0-004

Root Cause Analysis connects individual test failures to underlying systemic issues. It combines failure classification, grouping, and intelligent summaries to identify the true source of failures.

## Analysis Pipeline

### 1. Classification

Each failure is classified into a category (Assertion Failure, Timeout, Element Not Found, etc.). See [failure-classification.md](failure-classification.md).

### 2. Grouping

Failures with matching error signatures are grouped together. See [failure-grouping.md](failure-grouping.md).

### 3. Root Cause Inference

Groups are analyzed to infer the underlying cause:

| Signal | Inferred Root Cause |
|--------|-------------------|
| Multiple tests fail with same assertion error | Application behavior changed |
| All tests in a feature fail | Feature-level regression |
| Tests fail with timeout across features | Environment or infrastructure issue |
| Single test fails, others pass | Isolated test issue or flakiness |
| Tests fail at the same action (e.g., login) | Shared component or service failure |

### 4. Impact Assessment

For each inferred root cause:
- Number of affected tests
- Severity (systemic vs isolated)
- Recommended action

## Output

The analysis result appears in the PDF report and HTML dashboard as a Root Cause Analysis section:

```text
Root Cause Analysis
  Group: Assertion Failure (3 tests)
    Root Cause: Login redirect URL changed from /inventory to /dashboard
    Impact: All login-related tests fail
    Recommendation: Update LoginPage expectation or verify redirect logic

  Group: Timeout (2 tests)
    Root Cause: Test environment response time degraded
    Impact: Tests in slow network conditions
    Recommendation: Increase timeouts or check server health
```
