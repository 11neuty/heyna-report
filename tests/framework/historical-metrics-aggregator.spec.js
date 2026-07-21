const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const HistoryManager = require('../../utils/HistoryManager');
const HistoricalMetricsAggregator = require('../../utils/HistoricalMetricsAggregator');
const { mergeHistoryConfig, resolveArtifactPaths } = require('../../utils/ArtifactPaths');
const { atomicWriteJson } = require('../../utils/JsonFile');
const {
    assertSafeNumbers,
    durationFromUnits,
    durationToUnits,
    safeAddDurationUnits,
    timeBucket
} = require('../../utils/HistoricalMetricsValidation');

const FIXED_NOW = '2026-07-20T12:00:00.000Z';
const SYNTHETIC_SUMMARY_COUNT = 5000;
const roots = new Set();

function tempRoot() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'heyna-historical-metrics-'));
    roots.add(root);
    return root;
}

function historyConfig(overrides = {}) {
    return mergeHistoryConfig({ enabled: true, migration: { enabled: false } }, overrides);
}

function managerFor(root, overrides = {}, options = {}) {
    const history = historyConfig(overrides);
    const paths = resolveArtifactPaths({ artifactRoot: root, config: { history } });
    return new HistoryManager({ paths, history, logger: { log() {}, error() {} }, ...options });
}

function aggregatorFor(historyManager) {
    return new HistoricalMetricsAggregator({ historyManager, clock: () => new Date(FIXED_NOW) });
}

function metadata(timestamp = '2026-07-01T00:00:00.000Z', values = {}) {
    return {
        project: 'Project A',
        feature: 'Checkout',
        environment: 'QA',
        browser: 'chromium',
        executedBy: 'Framework Test',
        executionStartTime: timestamp,
        executionEndTime: new Date(Date.parse(timestamp) + (values.elapsedDurationMs ?? 1000)).toISOString(),
        ...values
    };
}

function items(statuses, durations = []) {
    return statuses.map((status, index) => ({
        testCase: `TC_${index}_${status}`,
        status,
        duration: durations[index] ?? 100,
        failureCategory: ['FAILED', 'TIMEDOUT', 'INTERRUPTED'].includes(status)
            ? (status === 'TIMEDOUT' ? 'TIMEOUT_FAILURE' : 'ASSERTION_FAILURE')
            : undefined,
        traceAvailable: false
    }));
}

function summary(options = {}) {
    const statuses = options.statuses || ['PASSED'];
    const durations = options.durations || statuses.map(() => 100);
    const counts = status => statuses.filter(value => value === status).length;
    const total = statuses.length;
    const totalDuration = durations.reduce((sum, value) => sum + value, 0);
    const timestamp = options.timestamp || '2026-07-01T00:00:00.000Z';
    const failureCategoryCounts = options.failureCategoryCounts || {};
    return {
        runId: options.runId || '20260701-000000-000-aaaaaaaa',
        schemaVersion: options.schemaVersion || '1.0.0',
        createdAt: timestamp,
        timestamp,
        startTime: timestamp,
        endTime: new Date(Date.parse(timestamp) + (options.elapsedDurationMs ?? 1000)).toISOString(),
        total,
        passed: counts('PASSED'),
        failed: counts('FAILED'),
        skipped: counts('SKIPPED'),
        timedOut: counts('TIMEDOUT'),
        interrupted: counts('INTERRUPTED'),
        unsuccessful: counts('FAILED') + counts('TIMEDOUT') + counts('INTERRUPTED'),
        passRate: options.passRate ?? (total ? Number(((counts('PASSED') / total) * 100).toFixed(2)) : 0),
        totalDuration,
        averageDuration: options.averageDuration ?? (total ? Number((totalDuration / total).toFixed(2)) : 0),
        project: Object.prototype.hasOwnProperty.call(options, 'project') ? options.project : 'Project A',
        feature: Object.prototype.hasOwnProperty.call(options, 'feature') ? options.feature : 'Checkout',
        environment: Object.prototype.hasOwnProperty.call(options, 'environment') ? options.environment : 'QA',
        browser: Object.prototype.hasOwnProperty.call(options, 'browser') ? options.browser : 'chromium',
        executedBy: Object.prototype.hasOwnProperty.call(options, 'executedBy') ? options.executedBy : 'Framework Test',
        failureCategoryCounts,
        traceReportedCount: options.traceReportedCount || 0,
        tracePreservedCount: options.tracePreservedCount || 0,
        traceAvailableCount: options.tracePreservedCount || 0,
        reportAvailability: options.reportAvailability || { pdf: false, dashboard: false, evidence: false, traces: false },
        ...(options.migration ? { migration: options.migration } : {})
    };
}

function diagnosticManager(summaries, diagnostics = []) {
    return {
        async listRunsWithDiagnostics() {
            return {
                runs: summaries,
                discoveredRunCount: summaries.length + diagnostics.length,
                validRunCount: summaries.length,
                excludedRunCount: diagnostics.length,
                diagnostics
            };
        }
    };
}

test.afterEach(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
    roots.clear();
});

test('empty history returns a stable empty aggregate and no matching history is distinct', async () => {
    const manager = managerFor(tempRoot());
    const aggregator = aggregatorFor(manager);
    const empty = await aggregator.aggregate();
    expect(empty.source).toEqual({
        discoveredRunCount: 0,
        validRunCount: 0,
        excludedRunCount: 0,
        aggregationExcludedRunCount: 0,
        matchedRunCount: 0,
        selectedRunCount: 0
    });
    expect(empty.runCount).toBe(0);
    expect(empty.rates.weightedPassRate).toBeNull();
    expect(empty.warnings.map(item => item.code)).toEqual(['HEYNA_HISTORICAL_EMPTY_HISTORY']);

    await manager.persistRun({ execution: items(['PASSED']), metadata: metadata() });
    const noMatch = await aggregator.aggregate({ project: 'Other' });
    expect(noMatch.source).toMatchObject({ discoveredRunCount: 1, validRunCount: 1, matchedRunCount: 0, selectedRunCount: 0 });
    expect(noMatch.warnings.map(item => item.code)).toContain('HEYNA_HISTORICAL_NO_MATCHING_RUNS');
    expect(noMatch.warnings.map(item => item.code)).not.toContain('HEYNA_HISTORICAL_EMPTY_HISTORY');
});

test('single run is normalized, immutable, and returned as a fresh object', async () => {
    const manager = managerFor(tempRoot());
    const persisted = await manager.persistRun({ execution: items(['PASSED'], [125]), metadata: metadata() });
    const aggregator = aggregatorFor(manager);
    const first = await aggregator.queryRuns();
    const second = await aggregator.queryRuns();
    expect(first.generatedAt).toBe(FIXED_NOW);
    expect(first.runs[0]).toMatchObject({
        runId: persisted.runId,
        historySchemaVersion: '1.0.0',
        total: 1,
        passed: 1,
        passRate: 100,
        totalTestDurationMs: 125,
        averageTestDurationMs: 125,
        elapsedDurationMs: 1000
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.runs[0])).toBe(true);
    expect(first).not.toBe(second);
    expect(first.runs[0]).not.toBe(second.runs[0]);
});

test('history writer accumulates separate canonical fractional durations exactly', async () => {
    const manager = managerFor(tempRoot());
    const persisted = await manager.persistRun({
        execution: items(['PASSED', 'PASSED'], [0.1, 0.2]),
        metadata: metadata()
    });
    expect(persisted.summary.totalDuration).toBe(0.3);
    expect(String(persisted.summary.totalDuration)).toBe('0.3');

    const result = await aggregatorFor(manager).aggregate();
    expect(result.source).toMatchObject({ aggregationExcludedRunCount: 0, matchedRunCount: 1, selectedRunCount: 1 });
    expect(result.durations.totalTestDurationMs).toBe(0.3);
    expect(result.warnings.map(item => item.code)).not.toContain('HEYNA_HISTORICAL_DURATION_NORMALIZED');
    expect(result.warnings.map(item => item.code)).not.toContain('HEYNA_HISTORICAL_AGGREGATION_UNUSABLE_SUMMARY');

    expect(() => manager.buildSummary(
        '20260701-000000-000-bbbbbbbb',
        items(['PASSED'], [0.1 + 0.2]),
        metadata(),
        '2026-07-01T00:00:00.000Z'
    )).toThrow(expect.objectContaining({ name: 'RangeError', code: 'HEYNA_HISTORICAL_NUMERIC_RANGE' }));
});

test('recognized legacy writer duration artifacts are normalized explicitly without storage corruption', async () => {
    const manager = managerFor(tempRoot());
    const persisted = await manager.persistRun({
        execution: items(['PASSED', 'PASSED'], [0.1, 0.2]),
        metadata: metadata()
    });
    const legacySummary = {
        ...persisted.summary,
        totalDuration: 0.1 + 0.2,
        averageDuration: 0.15
    };
    atomicWriteJson(path.join(manager.paths.historyRunsDir, persisted.runId, 'summary.json'), legacySummary);

    const listing = await manager.listRunsWithDiagnostics();
    expect(listing).toMatchObject({ discoveredRunCount: 1, validRunCount: 1, excludedRunCount: 0, diagnostics: [] });
    expect(listing.runs).toHaveLength(1);
    expect(listing.runs[0].totalDuration).toBe(0.30000000000000004);

    const aggregator = aggregatorFor(manager);
    for (const result of [
        await aggregator.queryRuns(),
        await aggregator.aggregate(),
        await aggregator.groupBy('project'),
        await aggregator.getAvailableDateRange()
    ]) {
        expect(result.source).toMatchObject({ aggregationExcludedRunCount: 0, matchedRunCount: 1, selectedRunCount: 1 });
        const warningCodes = result.warnings.map(item => item.code);
        expect(result.warnings.find(item => item.code === 'HEYNA_HISTORICAL_DURATION_NORMALIZED')).toMatchObject({
            field: 'totalDuration',
            details: { stored: 0.30000000000000004, normalized: 0.3 }
        });
        expect(warningCodes).not.toContain('HEYNA_HISTORICAL_AGGREGATION_UNUSABLE_SUMMARY');
        expect(warningCodes).not.toContain('HEYNA_HISTORICAL_CORRUPT_SUMMARY');
        expect(warningCodes).not.toContain('HEYNA_HISTORICAL_EXCLUDED_RUN');
        expect(warningCodes).not.toContain('HEYNA_HISTORICAL_PARTIAL_AGGREGATION');
    }
    expect((await aggregator.queryRuns()).runs[0].totalTestDurationMs).toBe(0.3);
    expect((await manager.listRunsWithDiagnostics()).runs[0].totalDuration).toBe(0.30000000000000004);
});

test('multiple mixed-status runs use weighted and unweighted pass rates', async () => {
    const runs = [
        summary({ runId: '20260701-000000-000-aaaaaaaa', statuses: ['PASSED'], durations: [100] }),
        summary({
            runId: '20260702-000000-000-bbbbbbbb',
            timestamp: '2026-07-02T00:00:00.000Z',
            statuses: ['PASSED', 'FAILED', 'SKIPPED'],
            durations: [200, 300, 400],
            failureCategoryCounts: { ASSERTION_FAILURE: 1 }
        }),
        summary({
            runId: '20260703-000000-000-cccccccc',
            timestamp: '2026-07-03T00:00:00.000Z',
            statuses: ['TIMEDOUT', 'INTERRUPTED'],
            durations: [500, 600],
            failureCategoryCounts: { TIMEOUT_FAILURE: 1, ASSERTION_FAILURE: 1 }
        })
    ];
    const result = await aggregatorFor(diagnosticManager(runs)).aggregate();
    expect(result.totals).toEqual({ tests: 6, passed: 2, failed: 1, skipped: 1, timedOut: 1, interrupted: 1, unsuccessful: 3 });
    expect(result.rates).toEqual({ weightedPassRate: 33.33, averageRunPassRate: 44.44, unsuccessfulRate: 50, skippedRate: 16.67, ratedRunCount: 3 });
    expect(result.failureCategoryCounts).toEqual({ ASSERTION_FAILURE: 2, TIMEOUT_FAILURE: 1 });
});

test('zero-test runs have null rates and emit a warning', async () => {
    const result = await aggregatorFor(diagnosticManager([summary({ statuses: [], durations: [] })])).aggregate();
    expect(result.runCount).toBe(1);
    expect(result.totals.tests).toBe(0);
    expect(result.rates.weightedPassRate).toBeNull();
    expect(result.rates.averageRunPassRate).toBeNull();
    expect(result.rates.ratedRunCount).toBe(0);
    expect(result.durations.averageTestDurationMs).toBeNull();
    expect(result.warnings.map(item => item.code)).toContain('HEYNA_HISTORICAL_ZERO_TEST_RUN');
});

test('duration, trace, failure, and artifact metrics roll up without mixing elapsed time', async () => {
    const runs = [
        summary({
            runId: '20260701-000000-000-aaaaaaaa',
            statuses: ['PASSED', 'FAILED'],
            durations: [100, 300],
            elapsedDurationMs: 1000,
            failureCategoryCounts: { ASSERTION_FAILURE: 1 },
            traceReportedCount: 2,
            tracePreservedCount: 1,
            reportAvailability: { pdf: true, dashboard: false, evidence: true, traces: true }
        }),
        summary({
            runId: '20260702-000000-000-bbbbbbbb',
            timestamp: '2026-07-02T00:00:00.000Z',
            statuses: ['PASSED'],
            durations: [200],
            elapsedDurationMs: 3000,
            traceReportedCount: 1,
            tracePreservedCount: 0,
            reportAvailability: { pdf: true, dashboard: true, evidence: false, traces: false }
        })
    ];
    const result = await aggregatorFor(diagnosticManager(runs)).aggregate();
    expect(result.durations).toEqual({
        totalTestDurationMs: 600,
        averageRunTestDurationMs: 300,
        averageTestDurationMs: 200,
        totalElapsedDurationMs: 4000,
        averageRunElapsedDurationMs: 2000
    });
    expect(result.traces).toEqual({ reported: 3, preserved: 1 });
    expect(result.artifactAvailabilityCounts).toEqual({ pdf: 2, dashboard: 1, evidence: 1, traces: 1 });
});

test('all metadata, run ID, schema, and migration filters use AND/OR semantics', async () => {
    const migration = {
        identity: `sha256:${'a'.repeat(64)}`,
        source: 'legacy.json',
        sourceChecksum: `sha256:${'b'.repeat(64)}`
    };
    const runs = [
        summary({ runId: '20260701-000000-000-aaaaaaaa', project: 'A', feature: 'F1', environment: 'QA', browser: 'chromium', executedBy: 'Alice' }),
        summary({ runId: '20260702-000000-000-bbbbbbbb', timestamp: '2026-07-02T00:00:00.000Z', project: 'B', feature: 'F2', environment: 'PROD', browser: 'firefox', executedBy: 'Bob', migration }),
        summary({ runId: '20260703-000000-000-cccccccc', timestamp: '2026-07-03T00:00:00.000Z', project: 'C', feature: 'F3', environment: 'QA', browser: 'webkit', executedBy: 'Cara' })
    ];
    const aggregator = aggregatorFor(diagnosticManager(runs));
    expect((await aggregator.queryRuns({ project: ['A', 'B'], environment: 'PROD' })).runs.map(run => run.runId)).toEqual([runs[1].runId]);
    expect((await aggregator.queryRuns({ feature: 'F1' })).runs[0].feature).toBe('F1');
    expect((await aggregator.queryRuns({ browser: 'webkit' })).runs[0].browser).toBe('webkit');
    expect((await aggregator.queryRuns({ executedBy: 'Bob' })).runs[0].executedBy).toBe('Bob');
    expect((await aggregator.queryRuns({ runIds: [runs[0].runId] })).runs[0].runId).toBe(runs[0].runId);
    expect((await aggregator.queryRuns({ schemaVersion: '1.0.0' })).runs).toHaveLength(3);
    expect((await aggregator.queryRuns({ includeMigrated: false })).runs.map(run => run.runId)).not.toContain(runs[1].runId);
    expect((await aggregator.groupBy('schemaVersion')).groups.map(group => group.key)).toEqual(['1.0.0']);
    expect((await aggregator.groupBy('migration')).groups.map(group => group.key)).toEqual(['migrated', 'native']);
});

test('date boundaries are inclusive and invalid queries fail before scanning', async () => {
    let scans = 0;
    const source = diagnosticManager([
        summary({ runId: '20260701-000000-000-aaaaaaaa', timestamp: '2026-07-01T00:00:00.000Z' }),
        summary({ runId: '20260702-000000-000-bbbbbbbb', timestamp: '2026-07-02T00:00:00.000Z' })
    ]);
    const original = source.listRunsWithDiagnostics;
    source.listRunsWithDiagnostics = async () => { scans += 1; return original(); };
    const aggregator = aggregatorFor(source);
    expect((await aggregator.queryRuns({ from: new Date('2026-07-01T00:00:00Z'), to: '2026-07-02T00:00:00Z' })).runs).toHaveLength(2);
    await expect(aggregator.aggregate({ from: 'invalid' })).rejects.toThrow(TypeError);
    await expect(aggregator.aggregate({ from: '2026-07-03T00:00:00Z', to: '2026-07-02T00:00:00Z' })).rejects.toThrow(/must not be later/);
    await expect(aggregator.aggregate({ unknown: true })).rejects.toThrow(/Unsupported/);
    await expect(aggregator.aggregate({ schemaVersion: '2.0.0' })).rejects.toThrow(/Unsupported/);
    await expect(aggregator.aggregate({ runIds: ['bad'] })).rejects.toThrow(/invalid/);
    await expect(aggregator.aggregate({ project: [] })).rejects.toThrow(/empty array/);
    expect(scans).toBe(1);
});

test('filters run before limit and limit warnings report exact counters', async () => {
    const runs = [
        summary({ runId: '20260701-000000-000-aaaaaaaa', project: 'Keep' }),
        summary({ runId: '20260702-000000-000-bbbbbbbb', timestamp: '2026-07-02T00:00:00.000Z', project: 'Drop' }),
        summary({ runId: '20260703-000000-000-cccccccc', timestamp: '2026-07-03T00:00:00.000Z', project: 'Keep' })
    ];
    const result = await aggregatorFor(diagnosticManager(runs)).queryRuns({ project: 'Keep', limit: 1, newestFirst: false });
    expect(result.runs.map(run => run.runId)).toEqual([runs[0].runId]);
    expect(result.source).toMatchObject({ excludedRunCount: 0, matchedRunCount: 2, selectedRunCount: 1 });
    expect(result.warnings.find(item => item.code === 'HEYNA_HISTORICAL_LIMIT_APPLIED').details).toMatchObject({ limit: 1, matchedRunCount: 2, selectedRunCount: 1 });
});

test('day and month groups use UTC boundaries and deterministic chronological order', async () => {
    const runs = [
        summary({ runId: '20240301-000000-000-aaaaaaaa', timestamp: '2024-03-01T00:00:00.000Z' }),
        summary({ runId: '20240229-235959-999-bbbbbbbb', timestamp: '2024-02-29T23:59:59.999Z' }),
        summary({ runId: '20240201-000000-000-cccccccc', timestamp: '2024-02-01T00:00:00.000Z' })
    ];
    const aggregator = aggregatorFor(diagnosticManager(runs));
    const days = await aggregator.groupBy('day');
    expect(days.groups.map(group => group.key)).toEqual(['2024-02-01', '2024-02-29', '2024-03-01']);
    expect(days.groups[1]).toMatchObject({ start: '2024-02-29T00:00:00.000Z', endExclusive: '2024-03-01T00:00:00.000Z' });
    const months = await aggregator.groupBy('month');
    expect(months.groups.map(group => group.key)).toEqual(['2024-02', '2024-03']);
    expect(months.groups[0]).toMatchObject({ start: '2024-02-01T00:00:00.000Z', endExclusive: '2024-03-01T00:00:00.000Z' });
});

test('ISO week grouping handles the week-year boundary in UTC', async () => {
    const runs = [
        summary({ runId: '20201231-120000-000-aaaaaaaa', timestamp: '2020-12-31T12:00:00.000Z' }),
        summary({ runId: '20210101-120000-000-bbbbbbbb', timestamp: '2021-01-01T12:00:00.000Z' }),
        summary({ runId: '20210104-000000-000-cccccccc', timestamp: '2021-01-04T00:00:00.000Z' })
    ];
    const result = await aggregatorFor(diagnosticManager(runs)).groupBy('week');
    expect(result.groups.map(group => group.key)).toEqual(['2020-W53', '2021-W01']);
    expect(result.groups[0]).toMatchObject({ start: '2020-12-28T00:00:00.000Z', endExclusive: '2021-01-04T00:00:00.000Z', runCount: 2 });
    expect(result.groups[1]).toMatchObject({ start: '2021-01-04T00:00:00.000Z', endExclusive: '2021-01-11T00:00:00.000Z', runCount: 1 });
});

test('UTC day, month, and ISO-week buckets preserve years 0000 through 0099', () => {
    expect(timeBucket('day', '0001-01-01T12:34:56.789Z')).toMatchObject({
        key: '0001-01-01',
        start: '0001-01-01T00:00:00.000Z',
        endExclusive: '0001-01-02T00:00:00.000Z'
    });
    expect(timeBucket('month', '0000-12-31T23:59:59.999Z')).toMatchObject({
        key: '0000-12',
        start: '0000-12-01T00:00:00.000Z',
        endExclusive: '0001-01-01T00:00:00.000Z'
    });
    expect(timeBucket('week', '0100-01-01T00:00:00.000Z')).toMatchObject({
        key: '0099-W53',
        start: '0099-12-28T00:00:00.000Z',
        endExclusive: '0100-01-04T00:00:00.000Z'
    });
});

test('metadata groups are deterministic and place Unknown last', async () => {
    const runs = [
        summary({ runId: '20260701-000000-000-aaaaaaaa', project: 'beta' }),
        summary({ runId: '20260702-000000-000-bbbbbbbb', timestamp: '2026-07-02T00:00:00.000Z', project: null }),
        summary({ runId: '20260703-000000-000-cccccccc', timestamp: '2026-07-03T00:00:00.000Z', project: 'Alpha' })
    ];
    const aggregator = aggregatorFor(diagnosticManager(runs));
    const result = await aggregator.groupBy('project');
    expect(result.groups.map(group => ({ key: group.key, label: group.label }))).toEqual([
        { key: 'Alpha', label: 'Alpha' },
        { key: 'beta', label: 'beta' },
        { key: null, label: 'Unknown' }
    ]);
    expect(result.warnings.find(item => item.code === 'HEYNA_HISTORICAL_MISSING_METADATA')).toMatchObject({ field: 'project', details: { affectedRunCount: 1 } });
    await expect(aggregator.groupBy('suite')).rejects.toThrow(/Unsupported/);
    expect(aggregator.getAvailableDimensions().map(item => item.name)).not.toContain('suite');
});

test('invalid optional metadata is normalized to Unknown with a structured warning', async () => {
    const invalid = summary({ browser: { name: 'chromium' } });
    const aggregator = aggregatorFor(diagnosticManager([invalid]));
    const queried = await aggregator.queryRuns();
    expect(queried.runs[0].browser).toBeNull();
    expect(queried.warnings).toContainEqual(expect.objectContaining({
        code: 'HEYNA_HISTORICAL_INVALID_METADATA',
        field: 'browser',
        details: { affectedRunCount: 1 }
    }));
});

test('diagnostic exclusions produce structured partial aggregation warnings', async () => {
    const root = tempRoot();
    const manager = managerFor(root);
    const valid = await manager.persistRun({ execution: items(['PASSED']), metadata: metadata() });
    const corruptId = '20260701-010000-000-bbbbbbbb';
    const unsupportedId = '20260701-020000-000-cccccccc';
    const invalidId = '20260701-030000-000-dddddddd';
    for (const runId of [corruptId, unsupportedId, invalidId]) {
        fs.mkdirSync(path.join(manager.paths.historyRunsDir, runId), { recursive: true });
    }
    fs.writeFileSync(path.join(manager.paths.historyRunsDir, corruptId, 'summary.json'), '{ broken');
    atomicWriteJson(path.join(manager.paths.historyRunsDir, unsupportedId, 'summary.json'), { ...valid.summary, runId: unsupportedId, schemaVersion: '2.0.0' });
    atomicWriteJson(path.join(manager.paths.historyRunsDir, invalidId, 'summary.json'), { ...valid.summary, runId: invalidId, total: 2 });
    const result = await aggregatorFor(manager).aggregate();
    expect(result.source).toEqual({ discoveredRunCount: 4, validRunCount: 1, excludedRunCount: 3, aggregationExcludedRunCount: 0, matchedRunCount: 1, selectedRunCount: 1 });
    const codes = result.warnings.map(item => item.code);
    expect(codes).toContain('HEYNA_HISTORICAL_CORRUPT_SUMMARY');
    expect(codes).toContain('HEYNA_HISTORICAL_UNSUPPORTED_SCHEMA');
    expect(codes).toContain('HEYNA_HISTORICAL_INVALID_SUMMARY');
    expect(codes).toContain('HEYNA_HISTORICAL_EXCLUDED_RUN');
    expect(codes).toContain('HEYNA_HISTORICAL_PARTIAL_AGGREGATION');
});

test('missing metadata is coalesced and derived metric mismatches are recomputed', async () => {
    const runs = [
        summary({ runId: '20260701-000000-000-aaaaaaaa', project: null, feature: null, passRate: 12, averageDuration: 99 }),
        summary({ runId: '20260702-000000-000-bbbbbbbb', timestamp: '2026-07-02T00:00:00.000Z', project: null, feature: null })
    ];
    const result = await aggregatorFor(diagnosticManager(runs)).queryRuns();
    expect(result.runs[1].passRate).toBe(100);
    expect(result.warnings.filter(item => item.code === 'HEYNA_HISTORICAL_MISSING_METADATA' && item.field === 'project')).toEqual([
        expect.objectContaining({ details: { affectedRunCount: 2 } })
    ]);
    expect(result.warnings.filter(item => item.code === 'HEYNA_HISTORICAL_DERIVED_METRIC_MISMATCH').map(item => item.field).sort()).toEqual(['averageDuration', 'passRate']);
});

test('available date range ignores limit while reporting selected source counters', async () => {
    const runs = [
        summary({ runId: '20260701-000000-000-aaaaaaaa', timestamp: '2026-07-01T00:00:00.000Z' }),
        summary({ runId: '20260703-000000-000-bbbbbbbb', timestamp: '2026-07-03T00:00:00.000Z' })
    ];
    const result = await aggregatorFor(diagnosticManager(runs)).getAvailableDateRange({ limit: 1 });
    expect(result.dateRange).toEqual({ from: '2026-07-01T00:00:00.000Z', to: '2026-07-03T00:00:00.000Z' });
    expect(result.source).toMatchObject({ matchedRunCount: 2, selectedRunCount: 2 });
    expect(result.query.limit).toBeNull();
    expect(result.warnings.map(item => item.code)).not.toContain('HEYNA_HISTORICAL_LIMIT_APPLIED');
});

test('selected and available date ranges compare timestamp epochs rather than timestamp strings', async () => {
    const withoutMilliseconds = summary({
        runId: '20260720-000000-000-aaaaaaaa',
        timestamp: '2026-07-20T00:00:00Z'
    });
    const withMilliseconds = summary({
        runId: '20260720-000000-001-bbbbbbbb',
        timestamp: '2026-07-20T00:00:00.001Z'
    });
    const aggregator = aggregatorFor(diagnosticManager([withMilliseconds, withoutMilliseconds]));
    const expected = { from: withoutMilliseconds.timestamp, to: withMilliseconds.timestamp };
    expect((await aggregator.aggregate()).dateRange).toEqual(expected);
    expect((await aggregator.getAvailableDateRange()).dateRange).toEqual(expected);
});

test('diagnostic listing is a complete unfiltered scan with exact source invariants', async () => {
    const manager = managerFor(tempRoot());
    await manager.persistRun({
        runId: '20260701-000000-000-aaaaaaaa',
        execution: items(['PASSED']),
        metadata: metadata('2026-07-01T00:00:00.000Z')
    });
    await manager.persistRun({
        runId: '20260702-000000-000-bbbbbbbb',
        execution: items(['PASSED']),
        metadata: metadata('2026-07-02T00:00:00.000Z')
    });
    const corruptRunId = '20260703-000000-000-cccccccc';
    const corruptRunDir = path.join(manager.paths.historyRunsDir, corruptRunId);
    fs.mkdirSync(corruptRunDir, { recursive: true });
    fs.writeFileSync(path.join(corruptRunDir, 'summary.json'), '{ broken');

    const result = await manager.listRunsWithDiagnostics({
        from: '2099-01-01T00:00:00.000Z',
        newestFirst: false,
        limit: 0
    });
    expect(result.runs.map(run => run.runId)).toEqual([
        '20260702-000000-000-bbbbbbbb',
        '20260701-000000-000-aaaaaaaa'
    ]);
    expect(result).toMatchObject({ discoveredRunCount: 3, validRunCount: 2, excludedRunCount: 1 });
    expect(result.diagnostics.map(item => item.code)).toEqual(['HEYNA_HISTORICAL_CORRUPT_SUMMARY']);
    expect(result.discoveredRunCount).toBe(result.validRunCount + result.excludedRunCount);
    expect(result.runs).toHaveLength(result.validRunCount);
    expect(result.diagnostics).toHaveLength(result.excludedRunCount);
});

test('one source scan supports thousands of synthetic summaries deterministically', async () => {
    const summaries = Array.from({ length: SYNTHETIC_SUMMARY_COUNT }, (_, index) => {
        const day = 1 + (index % 28);
        return summary({
            runId: `20260101-000000-000-${index.toString(16).padStart(8, '0')}`,
            timestamp: `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`,
            project: index % 2 ? 'Odd' : 'Even',
            statuses: index % 3 ? ['PASSED'] : ['FAILED']
        });
    });
    let scans = 0;
    const source = diagnosticManager(summaries);
    const list = source.listRunsWithDiagnostics;
    source.listRunsWithDiagnostics = async () => { scans += 1; return list(); };
    const result = await aggregatorFor(source).groupBy('day', { project: 'Even' });
    expect(scans).toBe(1);
    expect(result.source).toMatchObject({ discoveredRunCount: SYNTHETIC_SUMMARY_COUNT, validRunCount: SYNTHETIC_SUMMARY_COUNT, matchedRunCount: SYNTHETIC_SUMMARY_COUNT / 2 });
    expect(result.groups).toHaveLength(14);
    expect(result.groups.map(group => group.key)).toEqual([...result.groups.map(group => group.key)].sort());
});

test('query inputs are not mutated and returned objects cannot mutate source summaries', async () => {
    const stored = summary();
    const project = Object.freeze(['Project A']);
    const runIds = Object.freeze([stored.runId]);
    const options = Object.freeze({ project, runIds, newestFirst: false });
    const aggregator = aggregatorFor(diagnosticManager([stored]));
    const result = await aggregator.queryRuns(options);
    expect(options).toEqual({ project: ['Project A'], runIds: [stored.runId], newestFirst: false });
    expect(Object.isFrozen(result.query.project)).toBe(true);
    try { result.runs[0].project = 'Mutated'; } catch (error) {}
    expect(stored.project).toBe('Project A');
    expect((await aggregator.queryRuns()).runs[0].project).toBe('Project A');
});

test('history disabled still permits read-only access to existing summaries', async () => {
    const root = tempRoot();
    const writer = managerFor(root);
    const persisted = await writer.persistRun({ execution: items(['PASSED']), metadata: metadata() });
    const reader = managerFor(root, { enabled: false });
    const result = await aggregatorFor(reader).queryRuns();
    expect(result.runs.map(run => run.runId)).toEqual([persisted.runId]);
    expect(result.source.selectedRunCount).toBe(1);
});

test('all filesystem-backed tests use temporary artifact roots outside repository history', () => {
    const root = tempRoot();
    const manager = managerFor(root);
    expect(manager.paths.historyRoot.startsWith(root)).toBe(true);
    expect(manager.paths.historyRoot).not.toBe(path.resolve(__dirname, '..', '..', 'history'));
});
const { execFileSync } = require('child_process');

function assertJsonSafeNumbers(value) {
    const pending = [value];
    while (pending.length) {
        const current = pending.pop();
        if (typeof current === 'number') {
            expect(Number.isFinite(current)).toBe(true);
            expect(Object.is(current, -0)).toBe(false);
            if (Number.isInteger(current)) expect(Number.isSafeInteger(current)).toBe(true);
        } else if (current && typeof current === 'object') {
            pending.push(...Object.values(current));
        }
    }
    expect(() => JSON.stringify(value)).not.toThrow();
}

function adjacentNumber(value, direction) {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setFloat64(0, value, false);
    const bits = view.getBigUint64(0, false) + BigInt(direction);
    view.setBigUint64(0, bits, false);
    return view.getFloat64(0, false);
}

test('strict timestamp validation rejects impossible dates and accepts valid offsets', async () => {
    const aggregator = aggregatorFor(diagnosticManager([]));
    for (const value of [
        '2026-02-30T00:00:00Z',
        '2025-02-29T00:00:00Z',
        '2026-01-01T24:00:00Z',
        '2026-01-01T00:00:00+24:00',
        '2026-01-01T00:00:00+12:60',
        '2026-01-01T00:00:00.1234Z',
        '2026-01-01T00:00:00.Z',
        '2026-01-01T00:00:00.1.2Z'
    ]) {
        await expect(aggregator.queryRuns({ from: value })).rejects.toThrow(TypeError);
    }
    await expect(aggregator.queryRuns({ from: new Date(Number.NaN) })).rejects.toThrow(TypeError);
    expect((await aggregator.queryRuns({ from: '2024-02-29T00:00:00Z' })).query.from).toBe('2024-02-29T00:00:00.000Z');
    expect((await aggregator.queryRuns({ from: '2026-01-01T00:00:00.1Z' })).query.from).toBe('2026-01-01T00:00:00.100Z');
    expect((await aggregator.queryRuns({ from: '2026-01-01T00:00:00.12Z' })).query.from).toBe('2026-01-01T00:00:00.120Z');
    expect((await aggregator.queryRuns({ from: '2026-01-01T00:00:00.123Z' })).query.from).toBe('2026-01-01T00:00:00.123Z');
    expect((await aggregator.queryRuns({ from: '2026-01-01T00:30:00+07:00' })).query.from).toBe('2025-12-31T17:30:00.000Z');
    expect((await aggregator.queryRuns({ from: '2026-01-01T23:30:00-02:00' })).query.from).toBe('2026-01-02T01:30:00.000Z');
});

test('numeric safety rejects invalid sources and checked aggregate overflow', async () => {
    const base = summary();
    const aggregate = value => aggregatorFor(diagnosticManager([value])).aggregate();
    for (const unsafeStorageValid of [
        { ...base, totalDuration: Number.MAX_VALUE, averageDuration: Number.MAX_VALUE },
        { ...base, totalDuration: 0.0001, averageDuration: 0.0001 },
        { ...base, total: Number.MAX_SAFE_INTEGER + 1, passed: Number.MAX_SAFE_INTEGER + 1 },
        { ...base, failureCategoryCounts: { ASSERTION_FAILURE: Number.MAX_SAFE_INTEGER + 1 } },
        {
            ...base,
            traceReportedCount: Number.MAX_SAFE_INTEGER + 1,
            tracePreservedCount: Number.MAX_SAFE_INTEGER + 1,
            traceAvailableCount: Number.MAX_SAFE_INTEGER + 1
        }
    ]) {
        const result = await aggregate(unsafeStorageValid);
        expect(result.source).toMatchObject({
            discoveredRunCount: 1,
            validRunCount: 1,
            excludedRunCount: 0,
            aggregationExcludedRunCount: 1,
            matchedRunCount: 0,
            selectedRunCount: 0
        });
        expect(result.warnings.map(item => item.code)).toContain('HEYNA_HISTORICAL_AGGREGATION_UNUSABLE_SUMMARY');
    }
    await expect(aggregate({ ...base, totalDuration: Number.NaN, averageDuration: Number.NaN })).rejects.toThrow(TypeError);
    await expect(aggregate({ ...base, totalDuration: Number.POSITIVE_INFINITY, averageDuration: Number.POSITIVE_INFINITY })).rejects.toThrow(TypeError);

    const largeDuration = Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1;
    const durationRuns = [
        { ...summary({ runId: '20260701-000000-000-aaaaaaaa' }), totalDuration: largeDuration, averageDuration: largeDuration },
        { ...summary({ runId: '20260702-000000-000-bbbbbbbb', timestamp: '2026-07-02T00:00:00.000Z' }), totalDuration: largeDuration, averageDuration: largeDuration }
    ];
    await expect(aggregatorFor(diagnosticManager(durationRuns)).aggregate()).rejects.toMatchObject({ name: 'RangeError', code: 'HEYNA_HISTORICAL_NUMERIC_RANGE' });

    const largeCount = Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1;
    const countRuns = [
        { ...summary({ runId: '20260701-000000-000-aaaaaaaa' }), total: largeCount, passed: largeCount, totalDuration: 0, averageDuration: 0 },
        { ...summary({ runId: '20260702-000000-000-bbbbbbbb', timestamp: '2026-07-02T00:00:00.000Z' }), total: largeCount, passed: largeCount, totalDuration: 0, averageDuration: 0 }
    ];
    await expect(aggregatorFor(diagnosticManager(countRuns)).aggregate()).rejects.toMatchObject({ name: 'RangeError', code: 'HEYNA_HISTORICAL_NUMERIC_RANGE' });

    const safeRuns = [
        { ...summary({ runId: '20260701-000000-000-aaaaaaaa' }), totalDuration: 4_000_000_000_000, averageDuration: 4_000_000_000_000 },
        { ...summary({ runId: '20260702-000000-000-bbbbbbbb', timestamp: '2026-07-02T00:00:00.000Z' }), totalDuration: 4_000_000_000_000, averageDuration: 4_000_000_000_000 }
    ];
    const safeResult = await aggregatorFor(diagnosticManager(safeRuns)).aggregate();
    expect(safeResult.durations.totalTestDurationMs).toBe(8_000_000_000_000);
    assertJsonSafeNumbers(safeResult);
});


test('fixed-scale duration arithmetic preserves thousandths or fails atomically', () => {
    const add = (...values) => {
        let units = 0n;
        values.forEach(value => { units = safeAddDurationUnits(units, value, 'test duration'); });
        return durationFromUnits(units, 'test duration');
    };

    expect(add(0.1, 0.2)).toBe(0.3);
    expect(add(Number.MAX_SAFE_INTEGER, 0)).toBe(Number.MAX_SAFE_INTEGER);
    for (const values of [
        [Number.MAX_SAFE_INTEGER - 1, 0.5],
        [8_000_000_000_000_000, 0.001],
        [8_000_000_000_000_000, 1.5],
        [Number.MAX_SAFE_INTEGER, 0.001],
        [1, 0.0001]
    ]) {
        expect(() => add(...values)).toThrow(expect.objectContaining({
            name: 'RangeError',
            code: 'HEYNA_HISTORICAL_NUMERIC_RANGE'
        }));
    }
    const result = { total: add(0.1, 0.2), rounded: 0 };
    expect(assertSafeNumbers(result)).toBe(result);
    expect(() => assertSafeNumbers({ nested: { value: Number.POSITIVE_INFINITY } })).toThrow(/numeric range/);
    expect(() => assertSafeNumbers({ nested: { value: -0 } })).toThrow(/numeric range/);
    expect(Object.is(result.total, -0)).toBe(false);
    expect(Object.is(result.rounded, -0)).toBe(false);
    expect(JSON.stringify(result)).toBe('{"total":0.3,"rounded":0}');
});

test('canonical duration parsing accepts exact thousandths and rejects nearby IEEE-754 values', () => {
    const accepted = new Map([
        [0, 0n],
        [0.1, 100n],
        [0.12, 120n],
        [0.123, 123n],
        [0.001, 1n],
        [1.001, 1001n],
        [2.002, 2002n],
        [0.3, 300n],
        [1e-3, 1n],
        [1e3, 1_000_000n]
    ]);
    for (const [value, units] of accepted) expect(durationToUnits(value, 'test duration')).toBe(units);

    const adjacentValues = [0.001, 1.001, 1000.001]
        .flatMap(value => [adjacentNumber(value, -1), adjacentNumber(value, 1)]);
    const rejected = [
        0.0001,
        1e-7,
        1.0009999999999997,
        1.0010000000000001,
        0.1 + 0.2,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        -0,
        -0.001,
        ...adjacentValues
    ];
    for (const value of rejected) {
        expect(() => durationToUnits(value, 'test duration')).toThrow(expect.objectContaining({
            name: 'RangeError',
            code: 'HEYNA_HISTORICAL_NUMERIC_RANGE'
        }));
    }

    expect(String(0.3)).toBe('0.3');
    expect(String(0.1 + 0.2)).toBe('0.30000000000000004');
});

test('duration reconstruction enforces the exact maximum and public Number round trip', () => {
    const maximumUnits = BigInt(Number.MAX_SAFE_INTEGER) * 1000n;
    expect(durationToUnits(Number.MAX_SAFE_INTEGER, 'test duration')).toBe(maximumUnits);
    expect(durationFromUnits(maximumUnits, 'test duration')).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => durationFromUnits(maximumUnits + 1n, 'test duration')).toThrow(expect.objectContaining({
        name: 'RangeError',
        code: 'HEYNA_HISTORICAL_NUMERIC_RANGE'
    }));
    expect(() => durationFromUnits(maximumUnits - 1n, 'test duration')).toThrow(expect.objectContaining({
        name: 'RangeError',
        code: 'HEYNA_HISTORICAL_NUMERIC_RANGE'
    }));
});

test('every public history query reports storage-valid aggregation-unusable summaries safely', async () => {
    const valid = summary();
    const unusable = {
        ...summary({ runId: '20260702-000000-000-bbbbbbbb', timestamp: '2026-07-02T00:00:00.000Z' }),
        totalDuration: 1.0009999999999997,
        averageDuration: 1.0009999999999997
    };
    const aggregator = aggregatorFor(diagnosticManager([valid, unusable]));
    const results = [
        await aggregator.queryRuns(),
        await aggregator.aggregate(),
        await aggregator.groupBy('project'),
        await aggregator.getAvailableDateRange()
    ];

    for (const result of results) {
        expect(result.source).toMatchObject({
            discoveredRunCount: 2,
            validRunCount: 2,
            excludedRunCount: 0,
            aggregationExcludedRunCount: 1,
            matchedRunCount: 1,
            selectedRunCount: 1
        });
        expect(result.warnings.map(item => item.code)).toContain('HEYNA_HISTORICAL_AGGREGATION_UNUSABLE_SUMMARY');
        expect(result.warnings.map(item => item.code)).toContain('HEYNA_HISTORICAL_PARTIAL_AGGREGATION');
        assertJsonSafeNumbers(result);
    }
    expect(results[0].runs.map(run => run.runId)).toEqual([valid.runId]);
    expect(results[1].runCount).toBe(1);
    expect(results[2].groups).toHaveLength(1);
    expect(results[3].dateRange).toEqual({ from: valid.timestamp, to: valid.timestamp });
});

test('duration overflow inside one group aborts the whole grouping request', async () => {
    const largeDuration = Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1;
    const runs = [
        { ...summary({ runId: '20260701-000000-000-aaaaaaaa', project: 'Overflow' }), totalDuration: largeDuration, averageDuration: largeDuration },
        { ...summary({ runId: '20260702-000000-000-bbbbbbbb', timestamp: '2026-07-02T00:00:00.000Z', project: 'Overflow' }), totalDuration: largeDuration, averageDuration: largeDuration },
        summary({ runId: '20260703-000000-000-cccccccc', timestamp: '2026-07-03T00:00:00.000Z', project: 'Safe' })
    ];
    await expect(aggregatorFor(diagnosticManager(runs)).groupBy('project')).rejects.toMatchObject({
        name: 'RangeError',
        code: 'HEYNA_HISTORICAL_NUMERIC_RANGE'
    });
});

test('prototype-sensitive category overflow fails atomically without pollution', async () => {
    const categories = Object.create(null);
    Object.defineProperty(categories, '__proto__', { value: Number.MAX_SAFE_INTEGER, enumerable: true });
    const runs = [
        summary({ runId: '20260701-000000-000-aaaaaaaa', failureCategoryCounts: categories }),
        summary({ runId: '20260702-000000-000-bbbbbbbb', timestamp: '2026-07-02T00:00:00.000Z', failureCategoryCounts: categories })
    ];
    await expect(aggregatorFor(diagnosticManager(runs)).aggregate()).rejects.toMatchObject({
        name: 'RangeError',
        code: 'HEYNA_HISTORICAL_NUMERIC_RANGE'
    });
    expect(({}).polluted).toBeUndefined();
});

test('limit warnings are emitted only when selection is truncated', async () => {
    const runs = [
        summary({ runId: '20260701-000000-000-aaaaaaaa' }),
        summary({ runId: '20260702-000000-000-bbbbbbbb', timestamp: '2026-07-02T00:00:00.000Z' }),
        summary({ runId: '20260703-000000-000-cccccccc', timestamp: '2026-07-03T00:00:00.000Z' })
    ];
    const aggregator = aggregatorFor(diagnosticManager(runs));
    const hasLimitWarning = result => result.warnings.some(item => item.code === 'HEYNA_HISTORICAL_LIMIT_APPLIED');
    expect(hasLimitWarning(await aggregator.aggregate({ limit: 5 }))).toBe(false);
    expect(hasLimitWarning(await aggregator.aggregate({ limit: 3 }))).toBe(false);
    expect(hasLimitWarning(await aggregator.aggregate({ limit: 2 }))).toBe(true);
    expect(hasLimitWarning(await aggregator.aggregate({ limit: 0 }))).toBe(true);
    expect(hasLimitWarning(await aggregator.aggregate({ project: 'Missing', limit: 0 }))).toBe(false);
    expect(hasLimitWarning(await aggregatorFor(diagnosticManager([])).aggregate({ limit: 5 }))).toBe(false);
});

test('source contract invariants reject malformed manager responses', async () => {
    const validRun = summary();
    const valid = { runs: [validRun], diagnostics: [], discoveredRunCount: 1, validRunCount: 1, excludedRunCount: 0 };
    const cases = [
        { ...valid, runs: null },
        { ...valid, diagnostics: null },
        { ...valid, discoveredRunCount: -1 },
        { ...valid, discoveredRunCount: Number.MAX_SAFE_INTEGER + 1 },
        { ...valid, discoveredRunCount: 3 },
        { ...valid, validRunCount: 0 },
        { ...valid, diagnostics: [{ code: 'HEYNA_HISTORICAL_INVALID_SUMMARY' }] }
    ];
    for (const response of cases) {
        const manager = { async listRunsWithDiagnostics() { return response; } };
        await expect(aggregatorFor(manager).aggregate()).rejects.toMatchObject({ name: 'TypeError', code: 'HEYNA_HISTORICAL_SOURCE_CONTRACT' });
    }
});

test('only corrupt or unsupported history remains visible as partial aggregation', async () => {
    for (const diagnostic of [
        { code: 'HEYNA_HISTORICAL_CORRUPT_SUMMARY', severity: 'warning', runId: '20260701-000000-000-aaaaaaaa', message: 'unsafe', details: { file: 'summary.json' } },
        { code: 'HEYNA_HISTORICAL_UNSUPPORTED_SCHEMA', severity: 'warning', runId: '20260701-000000-000-aaaaaaaa', message: 'unsafe', field: 'schemaVersion', details: { schemaVersion: '2.0.0' } }
    ]) {
        const result = await aggregatorFor(diagnosticManager([], [diagnostic])).aggregate();
        expect(result.source).toEqual({ discoveredRunCount: 1, validRunCount: 0, excludedRunCount: 1, aggregationExcludedRunCount: 0, matchedRunCount: 0, selectedRunCount: 0 });
        expect(result.warnings.map(item => item.code)).toContain(diagnostic.code);
        expect(result.warnings.map(item => item.code)).toContain('HEYNA_HISTORICAL_PARTIAL_AGGREGATION');
        expect(result.warnings.map(item => item.code)).not.toContain('HEYNA_HISTORICAL_EMPTY_HISTORY');
    }
});


test('public diagnostics sanitize every copied field and nested detail', async () => {
    const windowsPath = 'C:\\Users\\someone\\private\\summary.json';
    const posixPath = '/home/runner/work/private/summary.json';
    const diagnostic = {
        code: windowsPath,
        severity: posixPath,
        runId: windowsPath,
        field: posixPath,
        message: `${windowsPath} ${posixPath}`,
        details: {
            file: 'summary.json',
            schemaVersion: windowsPath,
            errorCode: posixPath,
            nested: { value: windowsPath },
            path: posixPath
        }
    };
    const result = await aggregatorFor(diagnosticManager([], [diagnostic])).aggregate();
    expect(result.warnings[0]).toEqual({
        code: 'HEYNA_HISTORICAL_INVALID_SUMMARY',
        severity: 'warning',
        message: 'Completed history run contains an invalid summary.',
        runId: null,
        field: null,
        details: { file: 'summary.json', schemaVersion: 'invalid-version-token' }
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(windowsPath);
    expect(serialized).not.toContain(posixPath);
});

test('mixed zero-test and non-zero-test runs preserve denominators and averages', async () => {
    const result = await aggregatorFor(diagnosticManager([
        summary({ runId: '20260701-000000-000-aaaaaaaa', statuses: [], durations: [] }),
        summary({ runId: '20260702-000000-000-bbbbbbbb', timestamp: '2026-07-02T00:00:00.000Z', statuses: ['PASSED'], durations: [100] })
    ])).aggregate();
    expect(result.rates).toMatchObject({ weightedPassRate: 100, averageRunPassRate: 100, ratedRunCount: 1 });
    expect(result.durations).toMatchObject({ totalTestDurationMs: 100, averageRunTestDurationMs: 50, averageTestDurationMs: 100 });
});

test('prototype-sensitive failure categories are preserved without pollution', async () => {
    const categories = JSON.parse('{"__proto__":1,"constructor":2,"prototype":3}');
    const result = await aggregatorFor(diagnosticManager([summary({ failureCategoryCounts: categories })])).aggregate();
    expect(Object.keys(result.failureCategoryCounts)).toEqual(['__proto__', 'constructor', 'prototype']);
    expect(result.failureCategoryCounts.__proto__).toBe(1);
    expect(result.failureCategoryCounts.constructor).toBe(2);
    expect(result.failureCategoryCounts.prototype).toBe(3);
    expect({}.polluted).toBeUndefined();
});

test('ordering tie-breakers and selected date ranges are deterministic in both directions', async () => {
    const timestamp = '2026-07-02T00:00:00.000Z';
    const runs = [
        summary({ runId: '20260702-000000-000-cccccccc', timestamp }),
        summary({ runId: '20260702-000000-000-aaaaaaaa', timestamp }),
        summary({ runId: '20260702-000000-000-bbbbbbbb', timestamp }),
        summary({ runId: '20260701-000000-000-dddddddd', timestamp: '2026-07-01T00:00:00.000Z' }),
        summary({ runId: '20260703-000000-000-eeeeeeee', timestamp: '2026-07-03T00:00:00.000Z' })
    ];
    const aggregator = aggregatorFor(diagnosticManager(runs));
    const ascending = await aggregator.queryRuns({ newestFirst: false });
    expect(ascending.runs.slice(1, 4).map(run => run.runId)).toEqual([
        '20260702-000000-000-aaaaaaaa',
        '20260702-000000-000-bbbbbbbb',
        '20260702-000000-000-cccccccc'
    ]);
    const newest = await aggregator.aggregate({ newestFirst: true, limit: 2 });
    expect(newest.dateRange).toEqual({ from: timestamp, to: '2026-07-03T00:00:00.000Z' });
    const oldest = await aggregator.aggregate({ newestFirst: false, limit: 2 });
    expect(oldest.dateRange).toEqual({ from: '2026-07-01T00:00:00.000Z', to: timestamp });
});

test('every supported group family reuses the exact aggregate metric vocabulary', async () => {
    const aggregator = aggregatorFor(diagnosticManager([summary()]));
    const aggregate = await aggregator.aggregate();
    const metricFields = ['runCount', 'totals', 'rates', 'durations', 'traces', 'failureCategoryCounts', 'artifactAvailabilityCounts'];
    for (const dimension of aggregator.getAvailableDimensions().map(item => item.name)) {
        const grouped = await aggregator.groupBy(dimension);
        expect(grouped.groups).toHaveLength(1);
        for (const field of metricFields) expect(grouped.groups[0][field]).toEqual(aggregate[field]);
    }
});

test('UTC bucket output is identical under UTC, New York, and Jakarta host timezones', () => {
    const modulePath = path.resolve(__dirname, '..', '..', 'utils', 'HistoricalMetricsValidation.js');
    const script = `
        const { timeBucket } = require(${JSON.stringify(modulePath)});
        const dates = ['0001-01-01T00:00:00.000Z','0099-12-31T00:00:00.000Z','0100-01-01T00:00:00.000Z','2020-12-28T00:00:00.000Z','2021-01-01T00:00:00.000Z','2021-01-04T00:00:00.000Z','2024-02-29T23:59:59.999Z','2026-12-31T12:00:00.000Z','2027-01-01T12:00:00.000Z'];
        process.stdout.write(JSON.stringify(dates.flatMap(date => ['day','week','month'].map(dimension => timeBucket(dimension, date)))));
    `;
    const outputs = ['UTC', 'America/New_York', 'Asia/Jakarta'].map(TZ => execFileSync(process.execPath, ['-e', script], {
        env: { ...process.env, TZ },
        encoding: 'utf8'
    }));
    expect(outputs[1]).toBe(outputs[0]);
    expect(outputs[2]).toBe(outputs[0]);
});
