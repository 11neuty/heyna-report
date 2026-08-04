# ADR: Immutable Per-Run Failure Trends

- Status: Accepted
- Date: 2026-08-03
- Failure index schema: 1.0.0
- Reader schema: 1.0.0
- Trend schema: 1.0.0

Public contract: [Failure Trends and Recurring Issues](../failure-trends.md)

## Context

Historical `summary.json` proves aggregate outcomes but cannot establish that the same logical test and normalized failure recurred. Safe active, resolved, and reappeared conclusions also require successful finalized outcomes so known absences can be distinguished from missing detail.

Scanning current report files or changing aggregate summary schema would couple recurrence to mutable artifacts and risk compatibility with historical metrics and pass-rate trends. A mutable cross-run index would add coordination, repair, and retention consistency problems.

## Decision

Publish an independently versioned, privacy-reduced `failure-index.json` inside every newly enabled immutable run. Build and validate it in the existing staging directory and publish it with the existing shared-lock atomic rename. Store all finalized outcomes. Add only an optional checksummed descriptor to `summary.json`; do not change history schema/format or add an unsupported manifest type.

Use explicit SHA-256 domains and versions. Canonical test identity hashes project-relative file plus suite/title path and title, excluding project and execution volatility. The recurrence key adds project to `testKey` and failure signature. Failure signature combines classifier class, category, error type, normalized message fingerprint, and first user-frame fingerprint. Fallback identities are explicitly degraded and publish only fixed display metadata; raw fallback labels remain opaque fingerprint input.

Place `HistoricalFailureReader` beside `HistoricalMetricsAggregator` as a separate public-boundary consumer of `HistoryManager`. It owns listing, summary filters, newest selection, per-run reads, index validation, legacy execution normalization, and catalog-based sanitized diagnostics. Retention metadata is supplied additively by the public diagnostic listing; the reader does not inspect manager configuration. It does not rewrite history.

Place `FailureTrendAnalyzer` above the reader. Give it one `analyze(options)` method and exactly one reader call per analysis. It owns canonical test-specific recurrence groups, known-opportunity denominators, state, ranking, and immutable output. It reconstructs every public warning from a fixed catalog. Persist failure-index outcomes in canonical project, test-key, and repeat-index order and reject non-canonical reader input. Canonical chronological input permits append-only occurrence processing, and completeness prefix-count structures are constructed once. Range completeness and streak continuity are determined using `O(1)` prefix-count differences. Occurrence-sized per-group sorting and per-occurrence binary search are intentionally prohibited; only final deterministic ranking is sorted. This preserves `O(runs + outcomes + occurrences + groups log groups)` analyzer work. Cross-test signature ranking deliberately omits recurrence state.

This constraint matters because retained histories may contain thousands of runs and one recurring failure may appear in every selected run. Binary searching the run window for every occurrence would introduce an avoidable logarithmic factor. The prefix representation instead preserves conservative unknown-gap semantics while keeping prefix construction at `O(runs + outcomes)`, occurrence and streak processing at `O(occurrences)`, and final group ranking at `O(groups log groups)`.

Treat missing detail as unknown rather than zero. `PASSED`, validated `FAILED`, and validated `TIMEDOUT` outcomes are known opportunities. `SKIPPED` and `INTERRUPTED` outcomes cannot prove absence and do not enter eligible denominators. Keep aggregate-only and zero-test runs in diagnostics/timelines, and make conclusions indeterminate when unknown gaps or retention-bounded input prevent a safe claim. Treat first/last seen as selected retained-window facts only.

Require descriptor-first, accessor-free passive JSON and checked safe-integer arithmetic at failure-index and dependency boundaries. Reject duplicate canonical finalized tuples before publication. Fail closed with stable codes and no partial result on contract or numeric failure. Preserve upstream thrown-error identity.

## Consequences

- New runs can prove known per-test absences even when raw execution preservation is disabled.
- Old summaries remain valid and can be normalized only when immutable legacy execution exists.
- Corrupt sidecars are isolated from summary-only metrics and pass-rate consumers.
- Retention automatically removes sidecars with their owning runs; no cross-run cleanup protocol is needed.
- Project-relative file and title metadata can remain sensitive despite omission of raw messages, stacks, URLs, and machine paths.
- Retry attempts collapse into one finalized outcome; repeat executions remain distinct.
- Conflicting legacy duplicates become aggregate-only; equivalent legacy retry duplicates may be collapsed in memory without rewriting history.
- Normalization and public schemas can evolve through explicit versions.
- Issue #19 does not change PDF/HTML layouts or claim confirmed cause or lifetime recurrence.

## Rejected alternatives

- Infer recurrence from aggregate summaries: cannot identify a test/failure or prove absence.
- Store failures only: makes successful eligible opportunities unknowable.
- Reuse raw `execution.json` for all new analysis: it can be disabled and contains broader sensitive data.
- Add the sidecar as a manifest artifact: the existing closed artifact-type validator would reject it.
- Maintain a mutable global index: complicates atomicity, retention, repair, and concurrency.
- Group canonically by signature across tests: makes active/resolved semantics ambiguous.
- Integrate rendering now: issue #19 establishes the data contract before presentation work.
