# Pass Rate Trends

HEYNA REPORT `2.4.0-next.0` provides a read-only pass-rate trend layer over the public `HistoricalMetricsAggregator` API. It does not scan `history/runs`, read history JSON files, or modify persisted history.

## Construction and API

```js
const HistoricalMetricsAggregator = require('../utils/HistoricalMetricsAggregator');
const PassRateTrendAnalyzer = require('../utils/PassRateTrendAnalyzer');

const historicalMetricsAggregator = new HistoricalMetricsAggregator({ historyManager });
const analyzer = new PassRateTrendAnalyzer({ historicalMetricsAggregator });

const trend = await analyzer.analyze({
  granularity: 'day',
  movingAverageWindow: 3,
  project: 'Checkout'
});
```

`analyze(options)` is the only public method. Each call makes exactly one aggregator call: `queryRuns()` for run granularity or `groupBy()` for day, week, and month granularity. The returned value is a fresh, recursively frozen, JSON-safe object and uses the aggregator result's `generatedAt` timestamp.

### Strict aggregator boundary

The analyzer accepts only historical aggregation schema `1.0.0`. Before constructing any point, it strictly validates and clones the complete aggregator result. The result, query, source, warnings, and selected run or group collection must be dense, accessor-free JSON data made only from null, booleans, strings, finite numbers other than negative zero, dense arrays, and plain objects. Functions, `BigInt`, symbols, undefined values, sparse arrays, cycles, accessors, class instances, `Error`, `Date`, `Map`, `Set`, typed arrays, and other non-JSON prototypes are rejected with `HEYNA_PASS_RATE_TREND_SOURCE_CONTRACT`. Prototype-sensitive data keys are preserved without changing object prototypes.

The source contract requires all six issue #22 counters: `discoveredRunCount`, `validRunCount`, `excludedRunCount`, `aggregationExcludedRunCount`, `matchedRunCount`, and `selectedRunCount`. They must be safe non-negative integers and satisfy the issue #22 source relationships. Run results must contain exactly `selectedRunCount` normalized runs; grouped results must have group `runCount` values that add exactly to `selectedRunCount` using checked arithmetic.

Run status counts must agree with `total`, `passed`, and `unsuccessful`. Run and group weighted rates must equal the aggregator's documented two-decimal rounding of `100 * passed / total`, with null required for a zero denominator. Contradictory rates, malformed UTC boundaries, unsupported schemas, malformed warnings, or invalid counters abort the request without a partial trend and without mutating the aggregator result.

## Options

Trend options and defaults are:

```js
{
  granularity: 'day',
  metric: 'weightedPassRate',
  movingAverageWindow: null,
  stableThresholdPoints: 0.5,
  minimumPoints: 2,
  includeAverageRunComparison: false
}
```

Supported granularities are `run`, `day`, `week`, and `month`. `weightedPassRate` is the only canonical metric. `averageRunPassRate` cannot be selected as the canonical metric but may be returned as an explicitly named diagnostic comparison.

The analyzer passes these filters to the aggregator, which retains ownership of their validation:

- `from`, `to`
- `runIds`
- `project`, `feature`, `environment`, `browser`, `executedBy`
- `schemaVersion`
- `includeMigrated`
- `limit`

`newestFirst` is deliberately not exposed. Trend output is always chronological. `limit` always counts matching runs, not emitted trend points. The aggregator applies it after filtering and before day, week, or month grouping. Multiple selected runs can therefore collapse into one bucket, so `pointCount` may be lower than `source.selectedRunCount`; all source counters remain run counters rather than bucket counters. The analyzer forces newest-first run selection, then returns the resulting points in chronological order. `summary.limited` becomes true only when `selectedRunCount < matchedRunCount`. A non-truncating limit leaves it false, and `HEYNA_HISTORICAL_LIMIT_APPLIED` is propagated only for actual truncation.

## Point model

Every point has the same shape:

```js
{
  key,
  label,
  start,
  endExclusive,
  runCount,
  totalTests,
  passed,
  weightedPassRate,
  averageRunPassRate,
  movingWeightedPassRate
}
```

Run points use the run ID as `key` and `label`, the run timestamp as `start`, `null` as `endExclusive`, and `1` as `runCount`. Equal timestamps use the run ID as a deterministic tie-breaker.

Day, ISO-week, and month points preserve the aggregator's UTC `[start, endExclusive)` boundaries. Empty periods are omitted rather than invented. Gap filling belongs to future presentation consumers.

A zero-test point remains in the series with null weighted, average-run, and zero-denominator moving rates. It does not participate in first/latest comparison selection.

## Canonical metric

The canonical pass rate is weighted by test count:

```text
weightedPassRate = 100 * sum(passed) / sum(totalTests)
```

`averageRunPassRate` is a separate diagnostic: the average of non-empty run pass rates. It can differ materially from the canonical rate when run sizes differ. The analyzer never uses it for canonical direction.

## Changes and comparisons

The canonical comparison uses the first and latest rate-bearing points:

```text
percentagePointChange = latestRate - firstRate
relativePercentChange = 100 * (latestRate - firstRate) / firstRate
```

For a change from 80% to 85%, the percentage-point change is `5`, while the relative percentage change is `6.25`. It must not be described merely as a five-percent increase.

The last two rate-bearing points also produce separately named previous-to-latest changes. They do not control the canonical direction.

If a comparison baseline is zero, percentage-point change remains valid, relative change is null, and `HEYNA_PASS_RATE_TREND_UNDEFINED_RELATIVE_CHANGE` is emitted. Public rates and changes are rounded to two decimals, and negative zero is normalized to zero.

## Classification

Direction is deterministic:

```text
analyzablePointCount < minimumPoints
    => insufficient-data

percentagePointChange > stableThresholdPoints
    => improving

percentagePointChange < -stableThresholdPoints
    => declining

otherwise
    => stable
```

Threshold boundaries are stable. `stableThresholdPoints` must be finite from 0 through 100. `minimumPoints` must be a safe integer of at least 2. Factual changes may still be returned when a higher configured minimum makes classification insufficient.

No slope, regression, forecasting, confidence score, or statistical narrative is calculated.

## Moving weighted rate

`movingAverageWindow: null` disables moving rates. An enabled window must be a safe integer of at least 2 and requires a complete window; earlier points return null.

The analyzer recomputes each moving rate from counts:

```text
movingWeightedPassRate = 100 * sum(window.passed) / sum(window.totalTests)
```

It never averages point percentages. Windows cover emitted points, including zero-test points, rather than missing calendar periods. A complete zero-denominator window returns null. Rolling counts use checked safe-integer arithmetic; overflow fails atomically with `HEYNA_PASS_RATE_TREND_NUMERIC_RANGE`.

## Warnings and partial data

Aggregator warnings are cloned and preserved in their original order. This includes empty or unmatched history, corrupt or unsupported summaries, storage and aggregation exclusions, partial aggregation, limits, missing metadata, zero-test runs, and explicit legacy-duration normalization.

The analyzer appends:

- `HEYNA_PASS_RATE_TREND_INSUFFICIENT_DATA`
- `HEYNA_PASS_RATE_TREND_ZERO_TEST_POINT`
- `HEYNA_PASS_RATE_TREND_UNDEFINED_RELATIVE_CHANGE`

Zero-test points are coalesced into one trend warning. Equivalent zero-baseline comparisons do not create duplicate warnings.

`summary.partial` is true when storage exclusions, aggregation-only exclusions, or the upstream partial warning are present. Classification then describes the available selected data and must be interpreted with the warnings. `summary.limited` reports actual truncation, not merely a configured limit.

## Result summary

```js
{
  firstKey,
  firstRate,
  previousKey,
  previousRate,
  latestKey,
  latestRate,
  percentagePointChange,
  relativePercentChange,
  previousPercentagePointChange,
  previousRelativePercentChange,
  direction,
  comparison: 'first-to-latest',
  stableThresholdPoints,
  minimumPoints,
  partial,
  limited,
  averageRunComparison
}
```

`averageRunComparison` is null by default. When requested, it is an explicitly named diagnostic comparison and does not include or replace canonical direction.

## Non-goals

This module does not implement duration trends, recurring failures, execution comparison, quality narratives, dashboards, PDF or HTML integration, HTTP APIs, databases, forecasting, regression, missing-period interpolation, storage, retention, or migration.
