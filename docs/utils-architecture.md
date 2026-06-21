# Utils Architecture Review

Review date: 2026-06-21
Scope: Analysis only — no files were modified.

## File Inventory

| File | Lines | KB | Dependencies (internal) |
|---|---|---|---|
| HeynaReporter.js | 1026 | 37.8 | FailureClassifier |
| HeynaPdfGenerator.js | 872 | 34.2 | HeynaReporter, FailureGrouping, FailureSummaryEngine, RootCauseClusterer |
| HeynaHtmlDashboardGenerator.js | 703 | 40.9 | HeynaReporter, FailureGrouping, FailureSummaryEngine, RootCauseClusterer |
| FailureClassifier.js | 494 | 13.8 | (none — root dependency) |
| RootCauseClusterer.js | 298 | 12.0 | FailureClassifier |
| FailureSummaryEngine.js | 159 | 5.8 | FailureClassifier |
| FailureGrouping.js | 46 | 1.3 | FailureClassifier |

## Dependency Graph

```
FailureClassifier  ←  FailureGrouping, FailureSummaryEngine, RootCauseClusterer, HeynaReporter
                  ←  HeynaHtmlDashboardGenerator, HeynaPdfGenerator (via mid-level modules)
```

No circular dependencies. Clean layered architecture.

## Refactoring Candidates (future, not in scope)

| File | Issue | Recommendation |
|---|---|---|
| HeynaReporter.js (1026 lines) | God-object: lifecycle, config, locks, evidence, API logging | Extract ApiLogger, config, lock, evidence into separate modules |
| HeynaPdfGenerator.js / HeynaHtmlDashboardGenerator.js | Duplicated formatDuration/formatDate | Extract shared formatting helpers to utils/formatting.js |
| HeynaHtmlDashboardGenerator.js | Massive inline HTML/CSS/JS strings | Extract templates to external files |
| FailureClassifier.js | Rules and signature rules in one file | Split rules into separate modules |
| All | FAILURE_CATEGORIES imported from multiple files | Extract to utils/constants.js |

## Key Takeaway

The architecture is well-layered with clean dependency direction. `HeynaReporter.js` is the primary candidate for modularization at 1026 lines with 5+ distinct responsibilities.
