# Durable Flaky Attempt History

HEYNA REPORT persists privacy-reduced retry status history so future execution comparison can distinguish proven intra-run flakiness from unavailable evidence. This capability is prerequisite infrastructure only; it does not implement the Execution Comparison Engine or any comparison report.

## Definition

A finalized execution is flaky only when its final attempt is `PASSED` and at least one earlier attempt is `FAILED` or `TIMEDOUT`.

```text
FAILED -> PASSED              flaky
TIMEDOUT -> PASSED            flaky
FAILED -> TIMEDOUT -> PASSED  flaky

FAILED -> FAILED              not flaky
FAILED -> TIMEDOUT            not flaky
PASSED -> PASSED              not flaky
INTERRUPTED -> PASSED         not flaky
SKIPPED -> PASSED             not flaky
```

Retries are attempts within one finalized execution. A failed historical run followed by a passed historical run is cross-run behavior and is not flaky proof. `retryCount > 0` alone is also not proof.

## Known and unknown

Complete validated attempts produce `flakyEligibility: 'known'` and a boolean `flaky`. Unavailable attempts produce:

```js
{
  flakyEligibility: 'unknown',
  flaky: null,
  reasonCode: 'ATTEMPT_HISTORY_NOT_PERSISTED'
}
```

Unknown is not false. Failure-index v1, lazy legacy normalization, migrated legacy sources, aggregate-only runs, and v2 outcomes with `attempts: null` never infer a boolean from retry count.

## Incomplete observation versus malformed history

A legitimate incomplete retry observation does not fail the execution. Persistence records `attempts: null`, flaky classification remains unknown, and HEYNA REPORT does not synthesize missing attempts. In contrast, an explicitly supplied malformed attempt history is rejected and publication aborts; malformed data is never repaired or normalized into an available or complete history.

## Failure-index v2

New immutable sidecars use failure-index schema `2.0.0`. Every outcome contains `attempts`, either `null` or a complete sequence:

```js
attempts: [
  { retry: 0, status: 'FAILED' },
  { retry: 1, status: 'PASSED' }
]
```

Entries contain exactly `retry` and `status`. They exclude duration, timestamps, steps, errors, stacks, screenshots, traces, evidence, URLs, payloads, paths, and Playwright objects. Validation requires dense ordered contiguous retries from zero through `retryCount`, exact canonical statuses, and agreement between the final attempt and finalized outcome.

The sidecar remains available when raw `execution.json` retention is disabled. Existing immutable v1 sidecars remain readable and are never rewritten or backfilled. `summary.json` remains schema `1.0.0`.

## Reader API

`HistoricalFailureReader` output schema `1.1.0` adds `flakyClassification` to each normalized outcome. Attempt arrays are not exposed through this public reader. Results remain fresh, recursively frozen, JSON-safe, ordered, and privacy-reduced.

`FailureTrendAnalyzer` accepts reader schemas `1.0.0` and `1.1.0`, projects only its original recurrence fields, and does not use flaky classification. Issue #19 recurrence identity remains:

```text
project + testKey + failureSignature
```

Retry remains excluded from logical test and recurrence identity. `repeatEach` observations remain separate opportunities.
