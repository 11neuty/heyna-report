# ADR: Summary-Only Historical Metrics Aggregation

- Status: Accepted
- Date: 2026-07-20
- Aggregation schema: 1.0.0
- Supported history schema: 1.0.0

## Context

Future historical trend, comparison, dashboard, and quality-report features need consistent selection and rollup semantics. Allowing each feature to enumerate immutable run directories would duplicate filesystem access, corruption handling, date logic, and metric formulas. Existing `HistoryManager.listRuns()` intentionally logs and skips corrupt summaries, but an analytics result must disclose every excluded run to avoid silently partial metrics.

## Decision

Keep filesystem ownership in `HistoryManager` and add the backward-compatible `listRunsWithDiagnostics()` read contract. The method returns supported valid summaries, exact discovery/valid/excluded counters, and JSON-safe diagnostics for missing, corrupt, unsupported, invalid, or unreadable summaries. Existing `listRuns()` remains unchanged.

Create a CommonJS `HistoricalMetricsAggregator` that depends on that diagnostic contract. It performs one summary scan per public query, normalizes immutable run records, applies validated filters before limits, and returns deterministic aggregates or groups. It never enumerates history paths, reads execution artifacts, or writes storage.

Use test-count-weighted pass rate as the canonical metric. Expose average run pass rate separately and only include non-empty runs in that denominator. Recompute derived values from validated base counts and durations. Keep schema `1.0.0` storage validation backward compatible with its original finite numeric contract. Apply stricter aggregation-only validation: safe integer counters and non-negative durations represented as exact `BigInt` thousandths of a millisecond, bounded by `Number.MAX_SAFE_INTEGER` milliseconds and round-trippable to a public `Number`.

Treat the canonical JavaScript string from `String(value)` as the duration precision source. Parse its decimal coefficient and optional exponent, and accept it only when it maps exactly to the fixed scale; never generally round an adjacent IEEE-754 value to a supported thousandth. New summary writes apply that parser to every contribution and accumulate `BigInt` units, so separate `0.1` and `0.2` inputs produce an exact stored `0.3`; a newly supplied computed `0.1 + 0.2` value remains invalid. JavaScript may already have rounded a numeric literal before the API receives it, so the API cannot recover or validate the original source spelling. When converting accumulated units back to a public number, construct the exact decimal millisecond form and require the number to reproduce the identical units through the same parser.

Preserve the original schema `1.0.0` reader contract. A narrow aggregation-only compatibility path recognizes an old writer total only when it is exactly one binary64 neighbor from a fixed-scale value, covers multiple tests, and its legacy stored average agrees before and after normalization. Emit `HEYNA_HISTORICAL_DURATION_NORMALIZED` and leave immutable storage untouched. All other unsupported values remain aggregation exclusions.

Make the diagnostic storage API an unfiltered complete scan whose three count/array invariants are exact; the aggregator owns filters, ordering selection, and limits. Compare result date ranges by parsed epoch milliseconds. Construct UTC bucket boundaries with a year-safe `setUTCFullYear` helper so years `0000` through `0099`, including ISO week-years, retain their intended proleptic Gregorian year.

Storage-valid summaries outside that contract are aggregation exclusions with separate counters and warnings; checked request-time overflow or unrepresentable accumulated output fails atomically with a stable range error. Keep summed test duration separate from elapsed wall-clock duration.

Use UTC day, ISO-week, and month intervals with explicit exclusive ends. Support only dimensions available in summary schema `1.0.0`. Keep status and failure-category values as count projections rather than generic groups.

Return data-quality warnings in results. Invalid queries, impossible timestamps, invalid source-counter relationships, and incomplete root enumeration throw. Individual unusable runs are skipped with explicit sanitized diagnostics and partial-result warnings. Diagnostic fields are allowlisted, unsafe version values become `invalid-version-token`, and fatal root wrappers preserve bounded uppercase native codes while sanitizing their message. Only a missing history root is empty; access and enumeration failures are fatal. A limit warning means actual truncation, while date-range discovery ignores limits by contract.

## Consequences

- Future services share one filtering and aggregation vocabulary.
- Presentation code can consume factual metrics without direct history access.
- Corrupt or unsupported runs cannot silently disappear from analytics.
- Existing storage, large-integer `listRuns()` limits, retention behavior, and schema `1.0.0` migration compatibility are preserved.
- Storage exclusions and aggregation-only exclusions have distinct truthful counters.
- The history summary schema remains `1.0.0`; no migration is needed.
- A full scan and one in-memory sort remain proportional for thousands of summaries; date-range calculation is a one-pass minimum/maximum operation and recursively frozen results remain the immutable API boundary.
- Detailed recurring-failure and test comparison features remain unavailable from summaries alone.

## Rejected alternatives

- Direct filesystem scanning in the aggregator: violates storage ownership and duplicates validation.
- Reusing `listRuns()` alone: cannot disclose corrupt or unsupported exclusions.
- Averaging stored `passRate` or `averageDuration`: compounds rounding and weights small runs incorrectly.
- Adding suite or test summaries now: expands the storage schema beyond issue #22.
- Database, cache, or persistent index: unnecessary operational and invalidation complexity for the current scale.
- Rendering or trend interpretation in the aggregator: mixes factual aggregation with future feature policy.

## Compatibility

The aggregation result has its own `aggregationSchemaVersion: '1.0.0'`. It declares `supportedHistorySchemaVersions: ['1.0.0']`. This version is independent of the package version and the stored summary schema. Unknown requested history schemas are rejected before scanning, and discovered unsupported summaries are excluded with sanitized diagnostics. No storage schema change or migration is introduced by the aggregation precision contract.
