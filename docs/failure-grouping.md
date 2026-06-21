# Failure Grouping (Root Cause Clustering)

Version: HEYNA REPORT v2.3.0-004

Failure Grouping analyzes execution results and groups failed tests that share the same root cause. This helps identify systemic issues versus isolated failures.

## How It Works

### Clustering Process

1. **Classification**: Each failure is classified (Assertion Failure, Timeout, etc.)
2. **Signature Extraction**: A unique signature is computed from the error message, stack trace, and failure context
3. **Grouping**: Failures with matching signatures are grouped together
4. **Ranking**: Groups are ranked by impact (number of affected tests)

### Signature Components

- Error message (normalized)
- Failure classification
- Stack trace key frames
- Failure context (page URL, action type, locator)

## Output

Results are stored in `test-results/failure-groups.json`:

```json
{
  "groups": [
    {
      "id": "group-001",
      "classification": "Assertion Failure",
      "signature": "expected true but received false",
      "testCases": ["TC001", "TC005", "TC012"],
      "count": 3,
      "rootCause": "Login redirect endpoint changed"
    }
  ],
  "totalFailed": 8,
  "totalGroups": 3,
  "affectedByTopGroup": 3
}
```

## Report Integration

The PDF report includes a Failure Grouping section that lists each group, its affected tests, and the suggested root cause. The HTML dashboard provides an interactive group viewer.

## Merging Multiple Runs

Running the clusterer across multiple execution results merges groups with matching signatures and updates the root cause suggestions.

## CLI Usage

```bash
node utils/heyna-root-cause-clusterer.js [--merge <previous-groups.json>]
```
