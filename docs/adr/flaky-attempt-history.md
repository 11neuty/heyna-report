# ADR: Durable Privacy-Reduced Retry Attempt History

- Status: Accepted
- Date: 2026-08-08
- Failure-index writer schema: 2.0.0
- Supported failure-index schemas: 1.0.0, 2.0.0
- Historical failure reader schema: 1.1.0

Public contract: [Durable Flaky Attempt History](../flaky-attempt-history.md)

## Context

Failure-index v1 preserves final status and retry count but not the ordered statuses of every attempt. Retry count cannot prove whether a passed execution previously failed or timed out, and optional raw execution retention cannot be a durable analytics dependency.

## Decision

Add a required `attempts` field to every failure-index v2 outcome. A complete value is a non-empty ordered array containing only `{ retry, status }`; `null` explicitly represents unavailable proof. Strict validation requires contiguous retries starting at zero, agreement with `retryCount`, and final status agreement.

Construct sidecar entries through a passive allowlist projection of reporter attempts. Do not copy duration, timestamps, evidence, trace metadata, errors, paths, URLs, payloads, or arbitrary metadata.

Classify flakiness with a reusable pure helper. A complete execution is flaky only when it ends `PASSED` after an earlier `FAILED` or `TIMEDOUT` attempt. Unavailable history remains unknown and never falls back to retry count or cross-run transitions.

Extend `HistoricalFailureReader` additively to schema `1.1.0` with a tri-state `flakyClassification`, while withholding the attempt sequence from public output. Keep `FailureTrendAnalyzer` compatible with reader schemas `1.0.0` and `1.1.0` by strictly projecting its original recurrence fields.

## Compatibility and persistence

- Keep `summary.json` schema `1.0.0` and the main history format unchanged.
- New sidecars and descriptors use failure-index `2.0.0`.
- Continue exact validation and reading of failure-index `1.0.0`.
- Never rewrite immutable completed history.
- Persist migrated legacy sources as v2 with `attempts: null`.
- Keep lazy legacy normalization unknown.
- Build, checksum, validate, and publish v2 in the existing staging/atomic-rename transaction.
- Retain v2 even when raw execution storage is disabled.
- Preserve `project + testKey + failureSignature` recurrence identity and existing `repeatEach` semantics.

## Consequences

Future execution comparison can consume deterministic known/unknown flaky classification without raw execution artifacts or sensitive retry payloads. Sidecar size grows linearly with observed attempts, and validation/classification use forward linear scans without sorting attempts. This ADR does not implement execution comparison, dashboards, reports, or packaging changes.
