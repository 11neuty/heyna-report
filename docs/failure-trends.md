# Failure Trends and Recurring Issues

HEYNA REPORT `2.4.0-next.0` provides read-only recurring-failure analysis over selected retained history. `HistoricalFailureReader` owns history access and normalization; `FailureTrendAnalyzer` receives its public result and performs recurrence aggregation. The analyzer never reads paths, locks, manifests, migration files, retention state, `latest.json`, or summary internals.

See the [failure-trends ADR](adr/failure-trends.md) for the design decision. The storage and aggregate contracts remain documented in [Execution History Storage](history-storage.md) and [Historical Metrics Aggregation](historical-metrics-aggregation.md).

## Construction and API

```js
const HistoricalFailureReader = require('../utils/HistoricalFailureReader');
const FailureTrendAnalyzer = require('../utils/FailureTrendAnalyzer');

const historicalFailureReader = new HistoricalFailureReader({ historyManager });
const analyzer = new FailureTrendAnalyzer({ historicalFailureReader });

const result = await analyzer.analyze({
  from: null,
  to: null,
  limit: null,
  project: null,
  testKey: null,
  category: null,
  includeMigrated: true,
  minimumOccurrences: 2,
  minimumAffectedRuns: 2,
  includeResolved: true
});
```

`analyze(options)` is the analyzer's only public method. Options are validated before exactly one reader call. Dates are inclusive, filters accept one value or a unique array, and `limit` is applied after filtering to select the newest runs; output is returned chronologically. `query` contains normalized immutable options.

## Immutable failure index

Every newly published enabled-history run contains `failure-index.json`, even when `history.artifacts.execution` is false. New writers use independently versioned schema `2.0.0`; schema `1.0.0` remains readable. The sidecar is built and validated inside the run staging directory and published by the existing atomic rename under the shared history lock. It remains inside the immutable owning run and is deleted only when retention deletes that run. There is no mutable global failure database.

The sidecar records all finalized outcomes, not just failures. Successful outcomes establish known eligible absences. Each v2 outcome also contains either an exact ordered `{ retry, status }` attempt sequence or `attempts: null`; no duration, errors, stacks, traces, evidence, URLs, paths, payloads, or arbitrary attempt metadata is copied. The canonical finalized tuple inside one run is `project + testKey + repeatEachIndex`; duplicate tuples are rejected during construction and independent validation before publication. The optional `summary.json.failureIndex` descriptor contains the sidecar's schema, fixed relative path, size, SHA-256 checksum, and test/failure counts. It does not change history schema or format version and is intentionally not a manifest artifact type.

## Identity and privacy

Test identity version `test-identity/v1` hashes the normalized project-relative file, suite/title path, and title. Line, retry, repeat index, Playwright project, runtime/browser versions, duration, machine paths, and Playwright test ID are excluded from canonical identity. A Playwright test ID may appear only as a SHA-256 provenance fingerprint. If file/title-path data is unavailable, the bounded `testCase` fallback is used only as opaque fingerprint input. A degraded identity publishes `file: null`, an empty `suitePath`, and the fixed title `Unidentified test`; current-execution JSON also uses `Unidentified test` as its top-level `testCase` display value and never publishes the raw fallback under another property. Different degraded tests, projects, retries, and repeat-each executions remain correctly associated through their opaque test and execution identities rather than the shared display label.

Failure signature version `failure-signature/v1` combines category, the existing classifier signature class, normalized error type, normalized message fingerprint, and normalized first user-frame fingerprint. Normalization canonicalizes volatile ISO, numeric locale, and complete calendar-valid English month-name timestamps, UUIDs, request IDs, real network endpoints, durations, URLs, absolute/temp paths, line/column numbers, browser/runtime versions, and long random identifiers. Impossible month/day combinations remain meaningful assertion text, as do isolated month names and ordinary prose such as `May release`. Arbitrary business values such as `account:42` are not treated as network endpoints. Complete messages and stacks, request data, evidence paths, root-cause narratives/confidence, and machine names are not stored in the new index fields.

Project-relative file names and suite/test titles may themselves be sensitive user-controlled metadata. Identity normalization is not a promise to redact every title. Protect and retain the index accordingly. Normalization is versioned because changing its rules can change fingerprints.

## Reader behavior and legacy history

`HistoricalFailureReader` schema `1.1.0` calls `HistoryManager.listRunsWithDiagnostics()` once, performs summary-level filtering, and reads selected runs through `HistoryManager.getRun()`. It adds a tri-state `flakyClassification` to outcomes but does not expose attempt arrays. Complete v2 attempts are flaky only when the final status is `PASSED` after an earlier `FAILED` or `TIMEDOUT`; v1, `attempts: null`, and legacy normalization remain unknown. Retry count and cross-run transitions never prove flakiness. Retention-bounded metadata comes from the additive public listing descriptor; the reader does not inspect `HistoryManager` configuration. A valid declared index is preferred. A legacy run without a descriptor may be normalized in memory from immutable `execution.json`; it is never rewritten, uses opaque fallback identity, and is explicitly marked degraded with fixed warnings. Semantically equivalent legacy retry duplicates may be collapsed deterministically; conflicting duplicate statuses or signatures make that run aggregate-only.

A run with no usable detailed artifact remains in source counters and timelines as aggregate-only. Its unsuccessful aggregate is not converted to zero failures, and it is excluded from per-test denominators. Missing, malformed, unsupported, unreadable, and checksum-invalid indexes produce warnings from one fixed code/message/severity/detail catalog. The analyzer reconstructs catalog messages and rejects unknown codes, severity mismatches, and unexpected details, so dependency-supplied native filesystem text, URLs, stacks, paths, or raw values cannot cross its public boundary. Invalid sidecars do not make a valid summary disappear from historical metrics or pass-rate trends.

Failure-index, reader, and analyzer dependency boundaries inspect descriptors before values and accept only passive JSON data: null, booleans, strings, finite numbers except negative zero, dense ordinary arrays, and plain or null-prototype objects. Accessors are never executed. Symbols, extra or non-enumerable properties, executable values, cycles, sparse or subclassed arrays, proxies that cannot be safely inspected, special objects, unsupported prototypes, and unsafe counts fail closed with stable contract codes. Derived counts use checked addition and overflow raises `HEYNA_FAILURE_TREND_NUMERIC_RANGE` without a partial result. Successful results are fresh clones, deterministic, serializable, recursively frozen, and prototype-safe; upstream objects are not mutated or frozen.

## Recurrence semantics

Schema `1.0.0` always groups recurrence by:

```text
project + testKey + failureSignature
```

`FailureTrendAnalyzer` accepts reader schemas `1.0.0` and `1.1.0`, strictly projects these original recurrence fields, and ignores flaky classification. Its trend schema and recurrence results remain unchanged. See [Durable Flaky Attempt History](flaky-attempt-history.md) for the separate prerequisite contract.

One occurrence is one validated `FAILED` or `TIMEDOUT` `(runId, project, testKey, repeatEachIndex, failureSignature)` outcome. Retries do not add occurrences; separate `repeatEach` outcomes do. Opportunity status is explicit:

- `PASSED` is eligible and proves absence of every failure signature for that test opportunity.
- Validated `FAILED` and `TIMEDOUT` outcomes are eligible, prove their own signature, and prove absence of a different signature.
- `SKIPPED` and `INTERRUPTED` are not eligible, do not enter eligible denominators, and cannot prove absence or resolution.
- Filtered, aggregate-only, malformed, missing-detail, and otherwise unknown observations never prove absence or increase eligible denominators.

- Consecutive: at least two occurrences in adjacent known eligible opportunities with no known absence between first and last.
- Non-consecutive: at least two occurrences with a known eligible absence between them.
- Reappeared: an occurrence, then a known eligible absence, then another occurrence.
- Active: the failure occurs in the latest known eligible opportunity.
- Resolved: the failure met both recurrence thresholds and a later known eligible execution lacks it.
- Indeterminate: incomplete or retention-bounded data prevents a safe state conclusion.

`firstSeen` and `lastSeen` refer only to the selected retained query window; they are not lifetime claims. Unknown gaps between known observations block consecutive and reappeared claims; unknown trailing observations block active and resolved claims. Aggregate-only, malformed, missing-detail, interrupted, skipped, and retention-bounded windows therefore use indeterminate semantics rather than inventing absences. `limit` truncation is separately exposed as `limited`.

## Frequencies and ranking

```text
runFrequencyPercent = affectedRunCount / eligibleRunCount * 100
testFrequencyPercent = occurrenceCount / eligibleTestExecutionCount * 100
recurrenceRatePercent = repeated affected opportunities after first seen
                        / subsequent known eligible opportunities * 100
```

A missing denominator returns `null`. Percentages are numbers rounded to two decimals with negative zero normalized to zero.

`recurringFailures` contains only test-specific groups meeting both thresholds. `mostCommonFailures` may aggregate the same signature across tests and includes single occurrences, but it never claims active, resolved, reappeared, consecutive, or non-consecutive state. Ranking is occurrence count, affected-run count, affected-test count, latest selected-window occurrence, then key in code-point order.

The result schema is independently versioned as `1.0.0` and contains `query`, source counters, summary counts, test-specific recurrence groups, cross-test signature ranking, a diagnostic timeline, and stable warnings. Failure indexes use canonical project, test-key, and repeat-index order, and reader output is validated chronologically. Analysis therefore appends and deduplicates per-group occurrences and positions in one pass. Completeness information is converted into prefix-count structures once during chronological analysis: one run-detail incompleteness prefix is built for the selected run window, and per-test opportunity completeness prefixes are built once. Streak and range-completeness queries use `O(1)` prefix-count differences. No binary search is performed per occurrence, no recurrence group rescans the complete run timeline, and no per-group occurrence or position sorting is performed. Only final presentation rankings require sorting.

The analyzer-side bound is `O(runs + outcomes + occurrences + groups log groups)`: prefix construction is `O(runs + outcomes)`, occurrence and streak processing is `O(occurrences)`, and final group ranking is `O(groups log groups)`. Timeline rendering visits only keys observed in each run instead of rescanning every group. The timeline retains aggregate-only and zero-test entries.

## Scope

Failure trends are factual recurrence indicators, not confirmed causal diagnosis. Issue #19 adds no PDF or HTML integration, dashboard, CLI, HTTP endpoint, or persistence outside immutable per-run indexes.
