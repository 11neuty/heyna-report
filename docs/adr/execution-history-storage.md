# ADR: Immutable Filesystem Execution History

- Status: Accepted
- Date: 2026-07-16
- Storage schema: 1.0.0
- Development version: HEYNA REPORT 2.4.0-next.0; stable target: v2.4.0 milestone

## Context

HEYNA REPORT previously retained only mutable current-run files and flat copies under `history/executions`. Direct writes, import-time paths, and a single teardown failure chain made those files unsuitable as a durable historical contract.

## Decision

Use a CommonJS `HistoryManager` backed by one immutable directory per run. Resolve project and artifact roots independently. Stage on the same filesystem, validate JSON and required files, and atomically rename the directory into `history/runs`. Coordinate publication, latest, migration, and retention with owner-scoped, never-reused lock claims ordered by Lamport bakery tickets. Stale recovery removes only the dead owner's token directory and never deletes a shared replaceable active-lock path. Maintain an atomic JSON latest pointer instead of a symbolic link. Store a lightweight summary, an independently versioned schema description, and a relative-path artifact manifest. Keep history disabled by default during the prerelease.

Keep current-run output independent. Teardown attempts PDF, HTML, and history stages separately, reports all failures, and always releases the run lock. History failure never rolls back or deletes current-run artifacts.

## Consequences

- Complete runs are visible only after successful publication.
- Run directories can be copied or archived without a database.
- Summary-only retrieval is cheap enough for future aggregation work.
- Retention and migration can operate deterministically with explicit failures.
- A live replacement claim has a different random-token path, so stale recovery cannot delete it at a compare/delete boundary.
- A crashed owner or recovery process leaves only token-scoped state that another contender can recover without a shared recovery lock.
- Filesystem rename atomicity requires the temporary and completed directories to share a filesystem; the resolver enforces this by placing both beneath the configured history root.
- Mutual exclusion assumes atomic claim-directory creation, exclusive immutable ticket creation, and coherent directory enumeration on local Windows and Linux filesystems. Incomplete live tickets remain in the choosing state and block entry.
- Checksums are included for files but not directories.
- Network filesystems with nonstandard rename semantics are not guaranteed.

## Rejected alternatives

- Flat append-only JSON: difficult to publish atomically and recover after interruption.
- Database storage: unnecessary operational dependency for this milestone.
- Symbolic latest link: inconsistent portability and permissions on Windows.
- Release version as schema version: couples storage compatibility to unrelated product releases.
