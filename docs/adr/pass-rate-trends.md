# ADR: Public-Aggregator Pass Rate Trends

- Status: Accepted
- Date: 2026-07-21
- Trend schema: 1.0.0
- Aggregation dependency: Historical metrics aggregation schema 1.0.0

## Context

Pass-rate evolution is the first consumer of the historical metrics foundation. It needs chronological run and UTC bucket series, explicit change semantics, stable classification, and data-quality warnings without duplicating filesystem access, history validation, or aggregation formulas.

A trend service that scans history files would split corruption handling and filtering semantics between components. A trend service that averages bucket percentages would also produce incorrect results for differently sized runs or buckets.

## Decision

Add a read-only `PassRateTrendAnalyzer` above `HistoricalMetricsAggregator`. Inject the aggregator and expose one asynchronous `analyze(options)` method. Each request makes exactly one public aggregator call: `queryRuns()` for run points or `groupBy()` for UTC day, ISO-week, and month points.

Keep weighted pass rate as the only canonical metric. Preserve average-run pass rate only as explicitly named diagnostic data. Compute canonical direction from the first and latest rate-bearing points, while returning previous-to-latest changes separately.

Use percentage points for absolute rate differences and relative percentage for proportional change. A zero baseline makes relative change undefined, represented by null plus a structured warning rather than infinity.

Classify as improving, declining, stable, or insufficient-data using configurable `stableThresholdPoints` and `minimumPoints`. Threshold boundaries are stable. Do not add slope, regression, forecasting, or statistical confidence in v2.4.0.

Support an optional complete-window moving rate. Recompute it from summed passed and total counts with checked safe-integer arithmetic rather than averaging percentages. Moving windows cover emitted points; missing calendar periods remain absent.

Force newest-first aggregator selection when a limit is present, then return points chronologically. A limit counts filtered runs and is applied before time grouping, so selected runs may collapse into fewer emitted points; source counters remain run counters. Preserve the aggregator's truncation-only limit warning and expose truthful `limited` and `partial` summary flags.

Accept only historical aggregation schema `1.0.0`. Strictly validate all six source counters and their relationships, normalized run status and rate invariants, grouped run-count totals, weighted-rate/count agreement, time boundaries, and warning shapes before constructing points. Reject malformed or contradictory dependency results with `HEYNA_PASS_RATE_TREND_SOURCE_CONTRACT` rather than coercing counters or returning a partial trend.

Strictly validate and clone the complete dependency result as dense, accessor-free JSON data. Reject unsupported prototypes, executable values, cycles, sparse arrays, non-finite numbers, and negative zero without reading accessors. Preserve valid prototype-sensitive data keys safely, never reuse or freeze upstream references, and append only trend-specific insufficient-data, coalesced zero-test-point, and undefined-relative-change warnings.

Return a fresh, recursively frozen, JSON-safe trend schema `1.0.0` result using the aggregator's `generatedAt` value.

## Consequences

- History storage and validation remain owned by `HistoryManager` and `HistoricalMetricsAggregator`.
- Pass-rate trends inherit the established filter, UTC bucket, warning, exclusion, and limit semantics.
- Run/day/week/month trends need no aggregation contract extension.
- Presentation consumers receive factual points and classifications without direct storage access.
- Partial and limited inputs remain visible rather than silently appearing complete.
- Dependency contract drift fails closed before any trend is returned.
- Grouped `pointCount` may be smaller than `selectedRunCount` because limits select runs before grouping.
- Zero-test observations remain visible but do not become artificial zero-percent rates.
- Moving rates remain mathematically weighted across unequal point sizes.
- Issue #18 does not implement duration trends, recurring failures, execution comparison, rendering, narratives, or persistence.

## Rejected alternatives

- Directly scan `history/runs`: duplicates storage ownership and corruption handling.
- Import internal aggregation validation helpers: couples the trend layer to non-public implementation details.
- Use average-run pass rate as the canonical metric: gives equal influence to differently sized runs.
- Average bucket percentages for moving rates: produces incorrect weighted results.
- Fill missing periods with zeroes: invents observations and changes trend direction.
- Suppress classification for every partial result: discards useful factual comparisons; warnings and `partial` preserve the qualification.
- Add separate series and comparison methods: duplicates work and can produce inconsistent snapshots.
- Add regression or forecasting: outside the factual v2.4.0 trend scope.
