# ADR: Wall-Clock Execution Duration Trends

- Status: Accepted
- Date: 2026-08-07
- Duration trend schema: 1.0.0
- Aggregation dependency: Historical metrics aggregation schema 1.0.0

Public contract: [Duration Trends](../duration-trends.md)

## Context

HEYNA REPORT already persists immutable execution start and end timestamps and exposes their difference as `elapsedDurationMs` through `HistoricalMetricsAggregator`. It also stores summed final test duration, but that value is not equivalent to execution wall time: retries retain attempt detail while only the final attempt remains at the top level, and parallel or multi-project work can make summed test time diverge from elapsed time.

Issue #20 needs comparable duration points, averages, and deterministic spike indicators without adding another history store, changing summary schema `1.0.0`, or duplicating history filtering and corruption handling.

## Decision

Add a read-only `DurationTrendAnalyzer` above the public `HistoricalMetricsAggregator` contract. Its only public method is `analyze(options)`. Each invocation makes exactly one aggregator call: `queryRuns()` for run granularity or `groupBy()` for day, ISO week, and month granularities.

Use wall-clock `elapsedDurationMs = endTime - startTime` as the only canonical v1 metric. A run point uses its elapsed duration. A grouped point uses `averageRunElapsedDurationMs = totalElapsedDurationMs / runCount`; grouped totals are never compared because bucket run counts may differ.

Use the immediately previous emitted point as the spike baseline. A point is a spike when its duration increased and the unrounded percentage increase is greater than or equal to the configurable threshold, which defaults to 50 percent. The public percentage remains rounded to two decimals for representation, but display rounding does not control classification. The algorithm identifier is `previous-point-percent-increase`. When the previous duration is zero, percentage change is undefined: return `null`, emit a warning, and do not classify a percentage-based spike.

Force newest-first selection when a limit is supplied, then return points chronologically. Preserve the aggregator's filters, source counters, UTC buckets, warnings, exclusions, and limit semantics. Compute overall average duration by total elapsed duration divided by total selected runs, not by averaging point averages.

Strictly validate and clone the complete dependency result as passive JSON data. Validate aggregation schema, source-counter relationships, timestamps, run elapsed-duration identity, grouped duration averages, warning shapes, and collection counts. Reject malformed dependency data with a stable source-contract error. Use checked arithmetic and fail atomically on unsafe values or overflow.

Return a fresh, recursively frozen, JSON-safe duration trend schema `1.0.0` result. Reconstruct public query and source objects from their approved fields, reconstruct dependency warning messages from a fixed catalog, and copy only allowlisted scalar warning details. Unsupported diagnostic fields, stacks, and native dependency paths are not propagated. Supported caller-provided metadata remains intentional query data even when its value happens to resemble a path. Do not mutate caller options or dependency objects.

## Consequences

- No history schema, reporter lifecycle, migration, retention, or storage changes are required.
- Retry, scheduling, fixture, and project overhead present in the run interval contributes to the canonical metric.
- Summed final test duration remains available through historical metrics but is not used for duration trend comparisons.
- Failed, timed-out, interrupted, skipped, and zero-test runs remain factual elapsed-duration observations when their summaries are valid.
- Missing calendar periods remain absent.
- Migrated runs with a zero-length fallback interval remain valid and use conservative zero-baseline semantics.
- Consumers receive visualization-ready points, but Issue #20 adds no PDF, HTML, dashboard chart, HTTP server, database, forecasting, or statistical anomaly model.

## Rejected alternatives

- Persist another elapsed-duration field: duplicates mandatory timestamps and can drift from them.
- Use summed test duration: omits earlier retry attempts at the top-level history summary and does not represent wall time under parallel execution.
- Compare grouped total duration: confounds performance with bucket run volume.
- Use a full-history mean baseline: a spike influences its own baseline and selected-window changes alter classification.
- Use a rolling baseline by default: adds window-size and minimum-history policy not required for the v1 contract.
- Scan history directly: duplicates `HistoryManager` and aggregator ownership of validation, filtering, ordering, and diagnostics.

## Compatibility

The result uses independent `durationTrendSchemaVersion: '1.0.0'` and accepts historical aggregation schema `1.0.0`. Existing history and aggregation schemas remain unchanged. The CommonJS module follows the existing direct `utils/*` programmatic API convention; no root package-entrypoint or packaging work is included.
