# Historical Metrics Aggregation

HEYNA REPORT `2.4.0-next.0` provides a read-only CommonJS aggregation layer over execution-history summary schema `1.0.0`. It does not enumerate `history/runs`, read `execution.json`, or mutate stored history. All storage access and corruption classification remain owned by `HistoryManager`.

See the [historical-metrics aggregation ADR](adr/historical-metrics-aggregation.md) for the decision rationale and [Pass Rate Trends](pass-rate-trends.md) for the current trend consumer.

## Construction and API

```js
const HistoryManager = require('../utils/HistoryManager');
const HistoricalMetricsAggregator = require('../utils/HistoricalMetricsAggregator');

const historyManager = new HistoryManager();
const metrics = new HistoricalMetricsAggregator({ historyManager });

const runs = await metrics.queryRuns({ project: 'Checkout' });
const aggregate = await metrics.aggregate({ from, to });
const byWeek = await metrics.groupBy('week', { environment: ['QA', 'STAGING'] });
const range = await metrics.getAvailableDateRange();
const dimensions = metrics.getAvailableDimensions();
```

`historyManager` is required. `logger` is optional. Tests and embedded consumers may inject `clock`, which defaults to the current time and supplies `generatedAt`.

The public methods are:

- `queryRuns(options)` for immutable normalized run summaries
- `aggregate(options)` for one rollup
- `groupBy(dimension, options)` for rollups sharing the aggregate metric vocabulary
- `getAvailableDimensions()` for supported dimension metadata
- `getAvailableDateRange(options)` for the full matching range before a limit truncates selected runs

Every returned value is a fresh, recursively frozen, JSON-safe object.

## Query filters

Supported options are:

- `from`, `to`: valid `Date` or strict full ISO-8601 timestamp with `Z` or a valid numeric offset and zero to three fractional-second digits; impossible calendar dates are rejected and both boundaries are inclusive
- `runIds`: unique valid history run IDs
- `project`, `feature`, `environment`, `browser`, `executedBy`: a string or a non-empty unique string array
- `schemaVersion`: supported string or non-empty unique array
- `includeMigrated`: defaults to `true`
- `newestFirst`: defaults to `true`
- `limit`: `null` or a non-negative safe integer; `0` deliberately selects no runs

Array values use OR semantics. Different fields use AND semantics. All filters are applied before ordering and limiting. Metadata comparisons are exact and case-sensitive. Unknown options, invalid values, reversed dates, and unsupported schema requests throw `TypeError` before history is scanned.

`HEYNA_HISTORICAL_LIMIT_APPLIED` is emitted only when the limit reduces selected runs. `getAvailableDateRange()` ignores `limit`, reports it as `null` in the normalized query, and computes the full matching valid range before truncation.

The source counters have fixed meanings:

```js
{
  discoveredRunCount, // completed run directories found by HistoryManager
  validRunCount,      // supported valid summaries
  excludedRunCount,              // storage-invalid summaries, never user-filter misses
  aggregationExcludedRunCount,   // storage-valid summaries outside the aggregation numeric contract
  matchedRunCount,               // aggregatable runs matching filters before limit
  selectedRunCount    // runs remaining after limit
}
```

The storage diagnostic source contract is a complete unfiltered scan and is validated before normalization: `discovered = valid + excluded`, `runs.length = valid`, and `diagnostics.length = excluded`. `listRunsWithDiagnostics()` does not accept filtering, ordering, or limit semantics; the aggregator owns all such selection after the scan. Aggregation-only exclusions remain part of `validRunCount`, are counted separately by `aggregationExcludedRunCount`, and do not alter the storage equality. Violations throw `TypeError` with code `HEYNA_HISTORICAL_SOURCE_CONTRACT`; no metrics are returned.

## Normalized runs

`queryRuns()` returns run identity and timestamps, elapsed duration, canonical status counts, recomputed pass rate, test-duration values, five optional metadata dimensions, failure-category counts, trace counts, artifact availability, and optional migration identity.

Missing optional metadata becomes `null`. Invalid optional metadata also becomes `null` and produces a warning. Storage schema `1.0.0` retains its original reader contract: finite non-negative integer counts and finite non-negative durations. Aggregation applies a separate stricter contract without rewriting storage: count-like values must be safe non-negative integers, and durations must be non-negative, no greater than `Number.MAX_SAFE_INTEGER` milliseconds, and representable to at most three decimal places. Storage-valid runs outside that aggregation contract are excluded with `HEYNA_HISTORICAL_AGGREGATION_UNUSABLE_SUMMARY` and partial-result warnings.

## Metric semantics

The canonical historical pass rate is weighted by test count:

```text
weightedPassRate = 100 * sum(passed) / sum(total)
```

The diagnostic unweighted rate is:

```text
averageRunPassRate = average(100 * run.passed / run.total)
```

Only runs with at least one test contribute to `averageRunPassRate`; `ratedRunCount` states that denominator. Skipped tests remain in `total`, matching history schema `1.0.0`. `unsuccessful` is always `failed + timedOut + interrupted`.

Duration metrics deliberately separate test-duration sums from wall-clock elapsed time:

- `totalTestDurationMs`: sum of run `totalDuration`
- `averageRunTestDurationMs`: total test duration divided by run count
- `averageTestDurationMs`: total test duration divided by total test count
- `totalElapsedDurationMs`: sum of `endTime - startTime`
- `averageRunElapsedDurationMs`: total elapsed duration divided by run count

Test durations use fixed-scale integer arithmetic at 1,000 units per millisecond (one microsecond, or three decimal-place milliseconds). New history summaries convert each Playwright duration contribution through the strict canonical parser and accumulate exact `BigInt` units before writing the public `Number`. Separate `0.1` and `0.2` millisecond contributions therefore persist as `0.3`, not the binary addition artifact `0.30000000000000004`. A newly supplied single duration whose canonical string requires more than three fractional digits remains invalid and is not rounded.

The precision source is the canonical JavaScript `Number` string returned by `String(value)`. Decimal and exponent forms are parsed into a decimal coefficient and exponent, then converted to exact `BigInt` units only when the coefficient is exactly divisible at the fixed scale. No nearby IEEE-754 value is rounded to a supported thousandth: for example, `1.001` is accepted, while its adjacent representable values and the canonical values `1.0009999999999997` and `1.0010000000000001` are rejected. Zero, one, two, or three effective fractional decimal places are supported; any canonical number requiring more precision is rejected.

This makes source-number construction observable. Literal `0.3` is accepted because `String(0.3)` is `"0.3"`, while a newly supplied computed `0.1 + 0.2` value is rejected because its canonical string is `"0.30000000000000004"`. JavaScript can round a numeric literal before the API receives it, so the contract can validate only the resulting `Number` and its canonical string, not the original source text.

Schema `1.0.0` summaries written before fixed-scale accumulation remain storage-valid. Aggregation has one explicit compatibility path for a recognized old-writer total: it must be an immediately neighboring binary64 value of an exact thousandth, represent at least two tests, and agree with both the stored legacy average and the normalized average. Such a total is normalized without mutating storage and emits `HEYNA_HISTORICAL_DURATION_NORMALIZED` with stored and normalized values. Values that do not satisfy that complete signature remain strict aggregation exclusions; no general nearby-value rounding is performed.

Each accepted contribution is accumulated as exact `BigInt` units. To produce a public duration, the implementation constructs the exact decimal millisecond representation, converts it to `Number`, reparses that number through the same canonical conversion, and requires identical units. Unsupported precision, totals above `Number.MAX_SAFE_INTEGER` milliseconds, or totals that cannot round-trip through a public `Number` at that scale throw `RangeError` with code `HEYNA_HISTORICAL_NUMERIC_RANGE`. No partial aggregate or group is returned after such a failure.

Count and elapsed-millisecond additions remain checked safe-integer operations. Every public result is recursively checked for non-finite numbers, unsafe integer values, and negative zero before it is frozen and returned. Final rates and averages are rounded to two decimal places with JavaScript `Number.toFixed(2)` and converted back to numbers. Metrics with no denominator are `null`, not zero.

## Grouping and UTC buckets

Supported dimensions are:

- Time: `day`, `week`, `month`
- Metadata: `project`, `feature`, `environment`, `browser`, `executedBy`
- Contract: `schemaVersion`, `migration`

Suite, test, status, and failure category are not generic group dimensions. Status and failure categories remain count projections because assigning complete run metrics to them would double count or misattribute durations.

Time buckets use `summary.timestamp` in UTC and intervals `[start, endExclusive)`:

- Day key: `YYYY-MM-DD`
- ISO week key: `YYYY-Www`, Monday start with ISO week-year rules
- Month key: `YYYY-MM`

Missing time periods are not synthesized. Time groups sort chronologically ascending. Other groups sort by code-point key order with the `Unknown` (`key: null`) group last.

UTC boundary construction uses `setUTCFullYear` semantics rather than the legacy `Date.UTC` interpretation of years `0` through `99`. Day, month, and ISO-week buckets therefore preserve four-digit early years, including an ISO week whose week-year is `0099`. Selected and available date ranges compare parsed epoch milliseconds; the original valid timestamp spelling is returned and is never ordered lexicographically.

Every group contains:

```js
{
  key,
  label,
  start,
  endExclusive,
  runCount,
  totals,
  rates,
  durations,
  traces,
  failureCategoryCounts,
  artifactAvailabilityCounts
}
```

`start` and `endExclusive` are `null` for non-time dimensions.

## Warnings and partial results

Warnings are always returned and have this JSON-safe form:

```js
{
  code: 'HEYNA_HISTORICAL_CORRUPT_SUMMARY',
  severity: 'warning',
  message: '...',
  runId: null,
  field: null,
  details: {}
}
```

The contract includes:

- `HEYNA_HISTORICAL_CORRUPT_SUMMARY`
- `HEYNA_HISTORICAL_MISSING_SUMMARY`
- `HEYNA_HISTORICAL_UNREADABLE_RUN`
- `HEYNA_HISTORICAL_UNSUPPORTED_SCHEMA`
- `HEYNA_HISTORICAL_INVALID_SUMMARY`
- `HEYNA_HISTORICAL_AGGREGATION_UNUSABLE_SUMMARY`
- `HEYNA_HISTORICAL_DURATION_NORMALIZED`
- `HEYNA_HISTORICAL_DERIVED_METRIC_MISMATCH`
- `HEYNA_HISTORICAL_MISSING_METADATA`
- `HEYNA_HISTORICAL_INVALID_METADATA`
- `HEYNA_HISTORICAL_EXCLUDED_RUN`
- `HEYNA_HISTORICAL_PARTIAL_AGGREGATION`
- `HEYNA_HISTORICAL_EMPTY_HISTORY`
- `HEYNA_HISTORICAL_NO_MATCHING_RUNS`
- `HEYNA_HISTORICAL_ZERO_TEST_RUN`
- `HEYNA_HISTORICAL_LIMIT_APPLIED`

Repeated missing or invalid metadata warnings are coalesced per field. `EMPTY_HISTORY` means no completed directory was discovered. `NO_MATCHING_RUNS` means valid history exists but filters matched none. Storage and aggregation-only exclusions produce their specific diagnostic plus explicit excluded/partial warnings. Public diagnostics use fixed messages and allowlisted codes, severity, run IDs, fields, and detail values. Unsafe schema versions become `invalid-version-token`; native error text, arbitrary nested details, and absolute paths are not exposed.

Invalid queries and unsupported dimensions throw. A missing history root is empty history. Any other root enumeration failure throws a sanitized error with any bounded uppercase native code preserved (otherwise `UNKNOWN`), `heynaCode: 'HEYNA_HISTORY_ENUMERATION_FAILED'`, and the original error as `cause`, because result completeness cannot be established.

## Migrated runs

Migrated summaries are included by default and use the same metric formulas. They remain readable under the original schema `1.0.0` storage contract; a migrated run outside the aggregation numeric contract is reported as an aggregation-only exclusion. Set `includeMigrated: false` to exclude them. The `migration` grouping separates `Migrated` and `Native` runs. The aggregator does not perform or modify migration.

## Performance scope

Each storage-backed public call performs exactly one `HistoryManager.listRunsWithDiagnostics()` scan, followed by in-memory filtering, one deterministic ordering pass, and aggregation. Date ranges use one-pass minimum/maximum selection rather than a second sort. Complexity is `O(n log n)` with `O(n + groups)` memory. Recursive freezing remains enabled; the deterministic 5,000-summary regression exercises that boundary without a brittle timing threshold. The service does not read execution artifacts and adds no cache, index, database, streaming parser, pagination, worker, or HTTP layer.

## Non-goals

This service does not itself calculate trends, slopes, regressions, recurring failures, execution comparisons, narratives, dashboards, PDFs, HTML reports, quality evolution, suite/test expansions, retention, or migration. Pass-rate trends are implemented separately by `PassRateTrendAnalyzer`; other consumers remain outside this aggregation contract.
