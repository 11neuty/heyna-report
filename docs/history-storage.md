# Execution History Storage

HEYNA REPORT v2.4.0-next.0 contains the unreleased execution-history storage contract for the GitHub v2.4.0 milestone. Current-run `test-results/execution.json`, `test-results/metadata.json`, PDF, dashboard, evidence, and trace APIs keep their existing locations and formats.

Architecture rationale is recorded in the [execution-history storage ADR](adr/execution-history-storage.md). Historical consumers should use the [Historical Metrics Aggregation](historical-metrics-aggregation.md) contract rather than reading run directories directly.

## Opt-in configuration

History is disabled by default during the prerelease. Enabling it retains immutable copies of execution data and may retain screenshots, traces, API evidence, and other sensitive material. Storage can grow without bound unless retention or external CI cleanup is configured.

```js
module.exports = {
  history: {
    enabled: true,
    rootDir: 'history',
    runsDir: 'runs',
    tempDir: '.temp',
    latestFile: 'latest.json',
    retention: { enabled: true, maxRuns: 50, maxAgeDays: 30 },
    artifacts: {
      execution: true,
      metadata: true,
      pdf: true,
      dashboard: true,
      evidence: false,
      traces: false
    },
    migration: { enabled: true, stateFile: '.migration-state.json' },
    lock: { file: '.history.lock', retryDelayMs: 50, maxRetries: 100, staleMs: 30000 }
  }
};
```

Partial top-level and nested configuration is deeply merged with the single default in `utils/ArtifactPaths.js`. Set `history.enabled: false` to opt out again. Ordinary `npm test` and `npx playwright test` runs do not create history unless it is explicitly enabled.

`projectRoot` is used for `heyna.config.js`, `package.json`, assets, project metadata, and the HEYNA version. `artifactRoot` is used for current output and history. `HEYNA_PROJECT_ROOT` and `HEYNA_ARTIFACT_ROOT` may set them independently. An isolated artifact root therefore does not hide project configuration or package version information.

`runsDir`, `tempDir`, the latest file, migration state, and lock coordination directory must be relative paths contained by the resolved history root. Absolute paths and traversal are rejected. Staging and completed runs consequently share the history root and filesystem required by atomic directory rename.

## Publication and locking

A run ID has the filesystem-safe form `YYYYMMDD-HHmmss-SSS-random`. Writers coordinate through owner-scoped claims under `history/.history.lock/claims/<pid>-<ownerToken>`. Every acquisition uses a new 96-bit random token whose path is never reused by another owner. Atomic directory creation publishes the claim identity, after which the owner writes immutable owner and Lamport-style ticket files. Missing or partially written tickets represent the bakery algorithm's choosing phase. The lowest `(ticket, token)` tuple enters the protected section; a later contender observes an existing ticket and takes a larger number, while concurrent equal tickets are ordered by token.

Acquisition makes the initial eligibility check plus at most `maxRetries` additional checks, waiting `retryDelayMs` between blocked checks. `maxRetries` must be a safe non-negative integer; `retryDelayMs` and `staleMs` must be finite non-negative numbers. A live owner claim is protected regardless of age. Released claims, dead-process claims, and malformed expired claims are recoverable. Recovery removes only the stale owner's never-reused token directory; it never compares and deletes a shared replaceable active-lock path. A new live owner therefore has a different path and cannot be deleted by stale recovery. The owner removes only its own claim in `finally`.

Atomic directory creation publishes a claim whose name encodes its PID and random token. That identity protects a live claim even if the process stops before completing `owner.json` or `ticket.json`; readers treat incomplete live state as the choosing phase. Once the process dies, the same unique directory becomes recoverable. Recovery does not create a shared quarantine or recovery-owner artifact, so a recovery-process crash leaves the original token-scoped claim recoverable by the next process.

Publication, latest updates, migration state, and retention use this same cross-process lock. A writer stages and validates the complete snapshot under `.temp/<runId>`, then atomically renames it to `runs/<runId>`. Duplicate explicit IDs have one winner. Failed staging is cleaned where possible and never appears as a completed run.

```text
history/
|-- runs/<runId>/
|   |-- summary.json
|   |-- schema.json
|   |-- manifest.json
|   |-- execution.json
|   |-- metadata.json
|   `-- artifacts/
|-- .temp/
|-- .history.lock/
|   `-- claims/<pid>-<ownerToken>/
|       |-- owner.json
|       `-- ticket.json
|-- .migration-state.json
`-- latest.json
```

## Summary contract

Completed history rejects `RUNNING` and unknown statuses. Supported final statuses are `PASSED`, `FAILED`, `SKIPPED`, `TIMEDOUT`, and `INTERRUPTED`.

The required count relationships are:

```text
total = passed + failed + skipped + timedOut + interrupted
unsuccessful = failed + timedOut + interrupted
```

`failed` remains canonical `FAILED` only. Skipped tests are not unsuccessful. `passRate` is the numeric percentage `passed / total * 100`, with zero used for an empty run. Durations are finite non-negative milliseconds. Schema `1.0.0` keeps this original reader contract, including finite integer counts and finite durations that may be outside the stricter metrics-aggregation range; aggregation validation is separate and never rewrites stored summaries. Timestamps are accepted as ISO-8601 timestamps and normalized to UTC before storage; `endTime` cannot precede `startTime`.

`traceReportedCount` counts execution records that reported a trace. `tracePreservedCount` counts trace files actually copied into the completed run. The compatibility field `traceAvailableCount` equals `tracePreservedCount` and never claims a missing source was preserved.

The current-run `HeynaReporter.getSummary()` remains compatible: its `passRate` is a two-decimal string, while historical `summary.json` uses a number. Both expose the canonical status fields and `unsuccessful`. Consumers migrating to history should parse current-run `passRate` or use the numeric historical value.

## Manifest contract

Every completed run contains `manifest.json`, including `{ "artifacts": [] }` when nothing is copied. Entries use supported artifact types, relative non-traversing paths, boolean availability, and verified sizes. Available paths must exist inside the run. File entries have a verified `sha256:<64 lowercase hex>` checksum. Directory entries report the aggregate byte size of contained files and intentionally have no directory checksum.

## Latest pointer, recovery, and retention

`latest.json` is selected from the valid completed summary with the newest `timestamp`; a run-ID tie-break makes ordering deterministic. Publication order does not decide latest. If writing latest fails after publication, the completed run remains immutable and persistence returns a structured `HEYNA_LATEST_UPDATE_FAILED` warning. Global teardown logs these warnings.

`getLatestRun()` scans valid summaries when the pointer is missing, corrupt, stale, or points to a missing run. `repairLatestPointer()` performs a locked atomic repair. Retention invalidates a pointer to a deleted run before attempting its replacement, so an update failure leaves a missing recoverable pointer rather than a dangling one. Retention deletion failures are returned as structured warnings and do not claim deletion succeeded.

Date ranges use inclusive start and inclusive end boundaries: `[from, to]`. Both boundaries must be valid ISO-8601 values, and `from` cannot be later than `to`. Results are newest-first by normalized timestamp and then run ID. Corrupt completed summaries are logged and skipped.

## Migration, CI, privacy, and cleanup

Legacy JSON sources under `history/executions` are checksum-tracked, migrated under the shared lock, and never deleted. Each migrated summary records a deterministic identity derived from the source name and checksum. If publishing succeeds but migration-state persistence fails, the next attempt reconciles that identity with the completed run and repairs state instead of publishing a duplicate. Malformed or failed sources remain available for recovery. For the default `history` root, runtime runs, latest state, migration state, temporary data, and lock files are ignored by Git; documentation, ADRs, and `.gitkeep` scaffolding remain trackable. If `history.rootDir` points to a custom location inside a repository, add that custom runtime path to the repository's own `.gitignore`.

For CI, enable history only in jobs that intentionally upload or retain it, choose conservative artifact settings, and apply retention or delete the job workspace afterward. Evidence and traces may contain credentials, user data, page contents, network details, and other private information. `cleanupStaleTemporaryRuns()` removes expired staging directories; it does not delete valid completed runs. Retention remains disabled until explicitly enabled.

The lock protocol assumes local Windows or Linux filesystem semantics: atomic directory creation, exclusive file creation, coherent directory enumeration, and failure of empty-directory removal when another entry exists. Process liveness uses `process.kill(pid, 0)`; an unrelated process reusing a dead owner's PID can conservatively delay recovery but cannot cause deletion of another token's claim. Network filesystems that weaken these semantics are outside the storage contract.

## CommonJS API

```js
const HistoryManager = require('./utils/HistoryManager');

const history = new HistoryManager();
await history.initialize();
const persisted = await history.persistRun();
const runs = await history.listRuns({ limit: 10 });
const diagnosticRuns = await history.listRunsWithDiagnostics();
const latest = await history.getLatestRun();
await history.repairLatestPointer();
const inclusiveRange = await history.queryRunsByDateRange(
  '2026-07-01T00:00:00Z',
  '2026-07-31T23:59:59.999Z'
);
```

`listRunsWithDiagnostics()` preserves the summary-only read boundary while reporting completed directories that cannot be used. It is always a complete, newest-first, unfiltered scan; filtering and limits belong to `HistoricalMetricsAggregator`, while the existing `listRuns()` retains its selection options. The diagnostic result returns `runs`, `discoveredRunCount`, `validRunCount`, `excludedRunCount`, and JSON-safe diagnostics that distinguish missing summary files, corrupt JSON, unsupported schemas, invalid summary contracts, and unreadable runs. Its invariants are `discoveredRunCount === validRunCount + excludedRunCount`, `runs.length === validRunCount`, and `diagnostics.length === excludedRunCount`. Diagnostics contain stable messages, relative `summary.json` references, and whitelisted I/O codes rather than native error text or absolute paths. A missing history root returns an empty list; any other root enumeration failure throws with its native code preserved, `heynaCode: 'HEYNA_HISTORY_ENUMERATION_FAILED'`, and the original error as `cause`. Existing `listRuns()` normal-path behavior, return type, finite non-negative integer limit compatibility, and retention `maxRuns` compatibility are unchanged.

New summary writes accumulate each canonical duration as exact thousandth-millisecond `BigInt` units before converting the total back to a public number. The stored schema remains `1.0.0`; its reader still accepts the original finite non-negative numeric contract. Historical floating-point totals are not rewritten or classified as corrupt. The aggregation layer may recognize and explicitly normalize the narrow old-writer artifact signature, accompanied by `HEYNA_HISTORICAL_DURATION_NORMALIZED`.

Historical metrics consumers should use `HistoricalMetricsAggregator` rather than scanning `history/runs` or averaging stored derived values. See [Historical Metrics Aggregation](historical-metrics-aggregation.md).

This storage component stores immutable runs and does not aggregate them itself. The separate `HistoricalMetricsAggregator` provides summary-only factual aggregation; trends, comparisons, dashboards, databases, HTTP endpoints, and module-system migrations remain out of scope.
