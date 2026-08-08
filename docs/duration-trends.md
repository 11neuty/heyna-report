# Execution Duration Trends

HEYNA REPORT `2.4.0-next.0` provides read-only execution duration trends over the public `HistoricalMetricsAggregator` API. The result is visualization-ready data; this feature does not add a dashboard chart or an HTTP server.

See the [duration trends ADR](adr/duration-trends.md) and [Historical Metrics Aggregation](historical-metrics-aggregation.md).

## Construction and API

```js
const HistoryManager = require('../utils/HistoryManager');
const HistoricalMetricsAggregator = require('../utils/HistoricalMetricsAggregator');
const DurationTrendAnalyzer = require('../utils/DurationTrendAnalyzer');

const historyManager = new HistoryManager();
const historicalMetricsAggregator = new HistoricalMetricsAggregator({ historyManager });
const analyzer = new DurationTrendAnalyzer({ historicalMetricsAggregator });

const trend = await analyzer.analyze({
  granularity: 'run',
  spikeThresholdPercent: 50,
  project: 'Checkout'
});
```

`analyze(options)` is the only public method. It calls `queryRuns()` once for run granularity or `groupBy()` once for day, week, or month granularity. Output is always chronological, fresh, recursively frozen, deterministic for the same dependency snapshot, and JSON-safe.

## Canonical duration metric

The canonical metric is wall-clock elapsed run duration:

```text
elapsedDurationMs = endTime - startTime
```

It measures the execution interval recorded by the reporter and therefore includes retry, scheduling, setup, fixture, and multi-project overhead within that interval. It deliberately differs from `totalTestDurationMs`, which sums finalized top-level test durations and is retained as a separate historical aggregation metric.

For day, ISO-week, and month points, the comparable value is:

```text
averageRunElapsedDurationMs = totalElapsedDurationMs / runCount
```

Grouped totals are exposed for factual context but are not compared for spikes because buckets can contain different numbers of runs. The result-level average is also run-weighted: total elapsed duration divided by selected run count.

## Options

```js
{
  granularity: 'run',
  spikeThresholdPercent: 50,
  from,
  to,
  runIds,
  project,
  feature,
  environment,
  browser,
  executedBy,
  schemaVersion,
  includeMigrated,
  limit
}
```

Supported granularities are `run`, `day`, `week`, and `month`; `run` is the default. The analyzer delegates all filters to `HistoricalMetricsAggregator`, including inclusive date boundaries, exact metadata matching, migration selection, and filtering before limits.

`newestFirst` is not a public option. When a limit is present, the newest matching runs are selected and the resulting series is then returned chronologically. `metric`, moving-average options, and minimum-point options are not part of schema v1.

## Spike semantics

Each point after the first is compared with the immediately previous emitted point:

```text
increaseMs = currentAverageRunElapsedDurationMs
           - previousAverageRunElapsedDurationMs

increasePercent = 100 * increaseMs
                / previousAverageRunElapsedDurationMs

spike = increaseMs > 0
     && increasePercent >= spikeThresholdPercent
```

The default threshold is 50 percent and the public algorithm identifier is `previous-point-percent-increase`. The threshold boundary is inclusive.

Spike classification uses the unrounded percentage increase. Public percentage fields are rounded to the existing two-decimal representation, but that display rounding never moves a point across the configured spike threshold.

When the previous duration is zero, `previousChangePercent` is `null`, `spike` is `false`, and `HEYNA_DURATION_TREND_UNDEFINED_PERCENT_CHANGE` is emitted. Zero-duration points remain valid and also produce one coalesced zero-duration warning. Infinity and `NaN` are never returned.

## Result schema

```js
{
  durationTrendSchemaVersion: '1.0.0',
  generatedAt,
  metric: 'elapsedDurationMs',
  granularity,
  query,
  source,
  pointCount,
  series: [{
    key,
    label,
    start,
    endExclusive,
    runCount,
    totalElapsedDurationMs,
    averageRunElapsedDurationMs,
    previousChangeMs,
    previousChangePercent,
    spike
  }],
  summary: {
    firstKey,
    firstDurationMs,
    previousKey,
    previousDurationMs,
    latestKey,
    latestDurationMs,
    changeFromFirstMs,
    changeFromFirstPercent,
    changeFromPreviousMs,
    changeFromPreviousPercent,
    averageRunElapsedDurationMs,
    minimumPointDurationMs,
    maximumPointDurationMs,
    spikeCount,
    spikeKeys,
    spikeAlgorithm: 'previous-point-percent-increase',
    spikeThresholdPercent,
    partial,
    limited
  },
  warnings
}
```

Run points use the run ID as `key` and `label`, the run timestamp as `start`, `null` as `endExclusive`, and `1` as `runCount`. Equal timestamps use run ID as a deterministic tie-breaker. Time groups preserve the aggregator's UTC `[start, endExclusive)` boundaries. Missing periods are not synthesized.

With no points, duration summary values are `null`, spike collections are empty, and an insufficient-data warning is returned. With one point, factual average/minimum/maximum values are returned but comparison values remain `null`.

## Warnings and failures

Recognized historical aggregation warnings are validated, canonicalized from fixed messages and allowlisted scalar details, and propagated before duration-specific warnings. Unsupported diagnostic fields such as stacks, native filenames, working directories, roots, and nested error objects are not copied. Storage or aggregation exclusions make `summary.partial` true. Actual limit truncation makes `summary.limited` true.

Duration-specific warnings are:

- `HEYNA_DURATION_TREND_INSUFFICIENT_DATA`
- `HEYNA_DURATION_TREND_UNDEFINED_PERCENT_CHANGE`
- `HEYNA_DURATION_TREND_ZERO_DURATION_POINT`

Invalid options, dependencies, source results, and checked numeric ranges fail with:

- `HEYNA_DURATION_TREND_INVALID_OPTION`
- `HEYNA_DURATION_TREND_DEPENDENCY`
- `HEYNA_DURATION_TREND_SOURCE_CONTRACT`
- `HEYNA_DURATION_TREND_NUMERIC_RANGE`

Dependency data is inspected passively as strict JSON. Accessors, cycles, executable values, unsupported prototypes, sparse arrays, non-finite values, negative zero, contradictory elapsed durations, and unsafe counters fail without a partial trend. Public `query` and `source` objects are reconstructed from their approved fields, time-group labels are reconstructed from validated bucket keys, and internal/native dependency filesystem diagnostics are not included in successful output.

Supported metadata filters remain intentional consumer data. Their normalized values are echoed in `query`, even when a caller deliberately supplies a metadata value that syntactically resembles a filesystem path; the privacy boundary prevents HEYNA or dependency-internal diagnostics from introducing such paths on the caller's behalf.

An undefined-percentage warning is emitted for each distinct zero-baseline comparison pair. Adjacent, first-to-latest, and previous-to-latest comparisons that refer to the same pair are de-duplicated; genuinely different comparison pairs remain separately visible.

## Scope

This API supplies factual points and spike indicators for programmatic consumers. It does not persist trends, scan history files, read attempts, classify statistical anomalies, forecast durations, render PDF/HTML charts, add a dashboard view, or expose HTTP endpoints. Historical dashboard visualization is deferred to later dashboard work.
