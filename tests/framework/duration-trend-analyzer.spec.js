const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, expect } = require('@playwright/test');
const DurationTrendAnalyzer = require('../../utils/DurationTrendAnalyzer');
const HistoricalMetricsAggregator = require('../../utils/HistoricalMetricsAggregator');
const HistoryManager = require('../../utils/HistoryManager');
const { mergeHistoryConfig, resolveArtifactPaths } = require('../../utils/ArtifactPaths');

const FIXED_NOW = '2026-08-07T00:00:00.000Z';
const EMPTY_SOURCE = Object.freeze({
    discoveredRunCount: 0,
    validRunCount: 0,
    excludedRunCount: 0,
    aggregationExcludedRunCount: 0,
    matchedRunCount: 0,
    selectedRunCount: 0
});
const roots = new Set();

function tempRoot() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'heyna-duration-trend-'));
    roots.add(root);
    return root;
}

function storedSummary(options = {}) {
    const timestamp = options.timestamp || '2026-07-01T00:00:00.000Z';
    const elapsedDurationMs = options.elapsedDurationMs ?? 1000;
    const statuses = options.statuses || ['PASSED'];
    const count = status => statuses.filter(value => value === status).length;
    const total = statuses.length;
    const migration = options.migration;
    return {
        runId: options.runId || '20260701-000000-000-aaaaaaaa',
        schemaVersion: '1.0.0',
        createdAt: timestamp,
        timestamp,
        startTime: timestamp,
        endTime: new Date(Date.parse(timestamp) + elapsedDurationMs).toISOString(),
        total,
        passed: count('PASSED'),
        failed: count('FAILED'),
        skipped: count('SKIPPED'),
        timedOut: count('TIMEDOUT'),
        interrupted: count('INTERRUPTED'),
        unsuccessful: count('FAILED') + count('TIMEDOUT') + count('INTERRUPTED'),
        passRate: total ? Number(((count('PASSED') / total) * 100).toFixed(2)) : 0,
        totalDuration: options.totalDuration ?? 0,
        averageDuration: options.averageDuration ?? 0,
        project: options.project === undefined ? 'Project A' : options.project,
        feature: options.feature === undefined ? 'Checkout' : options.feature,
        environment: options.environment === undefined ? 'QA' : options.environment,
        browser: options.browser === undefined ? 'chromium' : options.browser,
        executedBy: options.executedBy === undefined ? 'Framework Test' : options.executedBy,
        failureCategoryCounts: {},
        traceReportedCount: 0,
        tracePreservedCount: 0,
        traceAvailableCount: 0,
        reportAvailability: { pdf: false, dashboard: false, evidence: false, traces: false },
        ...(migration ? { migration } : {})
    };
}

function summaries(durations, options = {}) {
    const base = Date.parse(options.start || '2026-07-01T00:00:00.000Z');
    const intervalMs = options.intervalMs || 86400000;
    return durations.map((elapsedDurationMs, index) => {
        const timestamp = new Date(base + index * intervalMs).toISOString();
        return storedSummary({
            ...options,
            runId: `${timestamp.slice(0, 10).replace(/-/g, '')}-000000-000-${index.toString(16).padStart(8, '0')}`,
            timestamp,
            elapsedDurationMs
        });
    });
}

function diagnosticManager(runs = [], diagnostics = []) {
    return {
        async listRunsWithDiagnostics() {
            return {
                runs,
                discoveredRunCount: runs.length + diagnostics.length,
                validRunCount: runs.length,
                excludedRunCount: diagnostics.length,
                diagnostics
            };
        }
    };
}

function analyzerFor(runs = [], diagnostics = []) {
    const historicalMetricsAggregator = new HistoricalMetricsAggregator({
        historyManager: diagnosticManager(runs, diagnostics),
        clock: () => new Date(FIXED_NOW)
    });
    return new DurationTrendAnalyzer({ historicalMetricsAggregator });
}

function fakeRun(runId, timestamp, elapsedDurationMs) {
    return {
        runId,
        timestamp,
        startTime: timestamp,
        endTime: new Date(Date.parse(timestamp) + elapsedDurationMs).toISOString(),
        elapsedDurationMs
    };
}

function normalizedQuery(overrides = {}) {
    return {
        from: null,
        to: null,
        runIds: null,
        project: null,
        feature: null,
        environment: null,
        browser: null,
        executedBy: null,
        schemaVersion: ['1.0.0'],
        includeMigrated: true,
        newestFirst: true,
        limit: null,
        ...overrides
    };
}

function fakeRunResult(runs, overrides = {}) {
    const matchedRunCount = overrides.matchedRunCount ?? runs.length;
    return {
        aggregationSchemaVersion: '1.0.0',
        generatedAt: FIXED_NOW,
        query: normalizedQuery(overrides.query),
        source: {
            ...EMPTY_SOURCE,
            discoveredRunCount: matchedRunCount,
            validRunCount: matchedRunCount,
            matchedRunCount,
            selectedRunCount: runs.length,
            ...overrides.source
        },
        runs,
        warnings: overrides.warnings || []
    };
}

function fakeGroup(key, start, endExclusive, runCount, totalElapsedDurationMs) {
    return {
        key,
        label: key,
        start,
        endExclusive,
        runCount,
        durations: {
            totalElapsedDurationMs,
            averageRunElapsedDurationMs: Number((totalElapsedDurationMs / runCount).toFixed(2))
        }
    };
}

function fakeGroupResult(groups, overrides = {}) {
    const selectedRunCount = groups.reduce((sum, group) => sum + group.runCount, 0);
    const matchedRunCount = overrides.matchedRunCount ?? selectedRunCount;
    return {
        aggregationSchemaVersion: '1.0.0',
        generatedAt: FIXED_NOW,
        query: normalizedQuery(overrides.query),
        source: {
            ...EMPTY_SOURCE,
            discoveredRunCount: matchedRunCount,
            validRunCount: matchedRunCount,
            matchedRunCount,
            selectedRunCount,
            ...overrides.source
        },
        groups,
        warnings: overrides.warnings || []
    };
}

function fakeAnalyzer(result, calls = { query: 0, group: 0 }) {
    const dependency = {
        async queryRuns() { calls.query += 1; return result; },
        async groupBy() { calls.group += 1; return result; }
    };
    return { analyzer: new DurationTrendAnalyzer({ historicalMetricsAggregator: dependency }), calls };
}

function warningCodes(result) {
    return result.warnings.map(item => item.code);
}

async function expectSourceFailure(result, options = { granularity: 'run' }) {
    const before = cloneForComparison(result);
    const fake = fakeAnalyzer(result);
    await expect(fake.analyzer.analyze(options)).rejects.toMatchObject({
        name: 'TypeError',
        code: 'HEYNA_DURATION_TREND_SOURCE_CONTRACT'
    });
    expect(fake.calls).toEqual(options.granularity === 'run' ? { query: 1, group: 0 } : { query: 0, group: 1 });
    expect(cloneForComparison(result)).toBe(before);
}

function cloneForComparison(value) {
    try { return JSON.stringify(value); } catch (error) { return error.name; }
}

test.afterEach(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
    roots.clear();
});

test('empty history and unmatched queries remain distinct and immutable', async () => {
    const empty = await analyzerFor().analyze();
    expect(empty).toMatchObject({
        durationTrendSchemaVersion: '1.0.0', metric: 'elapsedDurationMs', granularity: 'run', pointCount: 0,
        summary: {
            firstKey: null, latestKey: null, averageRunElapsedDurationMs: null,
            minimumPointDurationMs: null, maximumPointDurationMs: null, spikeCount: 0
        }
    });
    expect(warningCodes(empty)).toEqual(['HEYNA_HISTORICAL_EMPTY_HISTORY', 'HEYNA_DURATION_TREND_INSUFFICIENT_DATA']);
    expect(Object.isFrozen(empty)).toBe(true);

    const unmatched = await analyzerFor(summaries([100])).analyze({ project: 'Missing' });
    expect(unmatched.pointCount).toBe(0);
    expect(warningCodes(unmatched)).toContain('HEYNA_HISTORICAL_NO_MATCHING_RUNS');
    expect(warningCodes(unmatched)).not.toContain('HEYNA_HISTORICAL_EMPTY_HISTORY');
});

test('one point reports factual duration without invented comparisons', async () => {
    const result = await analyzerFor(summaries([125])).analyze();
    expect(result.series[0]).toMatchObject({
        runCount: 1,
        totalElapsedDurationMs: 125,
        averageRunElapsedDurationMs: 125,
        previousChangeMs: null,
        previousChangePercent: null,
        spike: false
    });
    expect(result.summary).toMatchObject({
        firstKey: result.series[0].key,
        firstDurationMs: 125,
        previousKey: null,
        previousDurationMs: null,
        latestKey: result.series[0].key,
        latestDurationMs: 125,
        changeFromFirstMs: null,
        changeFromPreviousMs: null,
        averageRunElapsedDurationMs: 125,
        minimumPointDurationMs: 125,
        maximumPointDurationMs: 125
    });
});

test('increase, decrease, and unchanged points expose exact adjacent changes', async () => {
    const result = await analyzerFor(summaries([100, 200, 150, 150])).analyze();
    expect(result.series.map(point => [point.previousChangeMs, point.previousChangePercent])).toEqual([
        [null, null], [100, 100], [-50, -25], [0, 0]
    ]);
    expect(result.summary).toMatchObject({
        firstDurationMs: 100,
        previousDurationMs: 150,
        latestDurationMs: 150,
        changeFromFirstMs: 50,
        changeFromFirstPercent: 50,
        changeFromPreviousMs: 0,
        changeFromPreviousPercent: 0,
        averageRunElapsedDurationMs: 150
    });
});

for (const [label, durations, threshold, expectedSpike] of [
    ['exact default threshold', [100, 150], undefined, true],
    ['below default threshold', [100, 149], undefined, false],
    ['above default threshold', [100, 151], undefined, true],
    ['configurable threshold', [100, 125], 25, true],
    ['positive increase with zero threshold', [100, 101], 0, true],
    ['unchanged with zero threshold', [100, 100], 0, false]
]) {
    test(`spike detection handles ${label}`, async () => {
        const options = threshold === undefined ? {} : { spikeThresholdPercent: threshold };
        const result = await analyzerFor(summaries(durations)).analyze(options);
        expect(result.series[1].spike).toBe(expectedSpike);
        expect(result.summary.spikeCount).toBe(expectedSpike ? 1 : 0);
        expect(result.summary.spikeKeys).toEqual(expectedSpike ? [result.series[1].key] : []);
        expect(result.summary).toMatchObject({
            spikeAlgorithm: 'previous-point-percent-increase',
            spikeThresholdPercent: threshold ?? 50
        });
    });
}

for (const [label, currentDurationMs, threshold, expectedPublicPercent, expectedSpike] of [
    ['49.999 percent below 50', 149999, 50, 50, false],
    ['49.995 percent below 50', 149995, 50, 49.99, false],
    ['50.000 percent at 50', 150000, 50, 50, true],
    ['50.001 percent above 50', 150001, 50, 50, true],
    ['49.999 percent above decimal threshold', 149999, 49.998, 50, true],
    ['49.999 percent at decimal threshold', 149999, 49.999, 50, true]
]) {
    test(`spike classification uses unrounded math for ${label}`, async () => {
        const result = await analyzerFor(summaries([100000, currentDurationMs])).analyze({ spikeThresholdPercent: threshold });
        expect(result.series[1].previousChangePercent).toBe(expectedPublicPercent);
        expect(result.series[1].spike).toBe(expectedSpike);
        expect(result.summary).toMatchObject({
            firstKey: result.series[0].key,
            previousKey: result.series[0].key,
            latestKey: result.series[1].key,
            changeFromFirstPercent: expectedPublicPercent,
            changeFromPreviousPercent: expectedPublicPercent,
            spikeCount: expectedSpike ? 1 : 0
        });
    });
}

for (const [label, durations, expectedPercent, expectedSpike] of [
    ['zero to zero', [0, 0], null, false],
    ['zero to positive', [0, 100], null, false],
    ['positive to zero', [100, 0], -100, false]
]) {
    test(`zero baseline semantics handle ${label}`, async () => {
        const result = await analyzerFor(summaries(durations)).analyze();
        expect(result.series[1].previousChangePercent).toBe(expectedPercent);
        expect(result.series[1].spike).toBe(expectedSpike);
        expect(JSON.stringify(result)).not.toMatch(/Infinity|NaN/);
        const undefinedWarnings = result.warnings.filter(item => item.code === 'HEYNA_DURATION_TREND_UNDEFINED_PERCENT_CHANGE');
        expect(undefinedWarnings).toHaveLength(durations[0] === 0 ? 1 : 0);
        expect(warningCodes(result)).toContain('HEYNA_DURATION_TREND_ZERO_DURATION_POINT');
    });
}

test('first-to-latest and previous-to-latest comparisons stay separate', async () => {
    const result = await analyzerFor(summaries([100, 250, 200])).analyze();
    expect(result.summary).toMatchObject({
        firstKey: result.series[0].key,
        previousKey: result.series[1].key,
        latestKey: result.series[2].key,
        changeFromFirstMs: 100,
        changeFromFirstPercent: 100,
        changeFromPreviousMs: -50,
        changeFromPreviousPercent: -20
    });
    expect(result.summary.spikeKeys).toEqual([result.series[1].key]);
});

test('day groups use run-weighted averages and missing periods remain absent', async () => {
    const runs = [
        ...summaries([100, 300], { start: '2026-07-01T01:00:00.000Z', intervalMs: 3600000 }),
        storedSummary({ runId: '20260703-000000-000-cccccccc', timestamp: '2026-07-03T00:00:00.000Z', elapsedDurationMs: 600 })
    ];
    const result = await analyzerFor(runs).analyze({ granularity: 'day' });
    expect(result.series.map(point => point.key)).toEqual(['2026-07-01', '2026-07-03']);
    expect(result.series[0]).toMatchObject({ runCount: 2, totalElapsedDurationMs: 400, averageRunElapsedDurationMs: 200 });
    expect(result.series[1]).toMatchObject({ runCount: 1, totalElapsedDurationMs: 600, averageRunElapsedDurationMs: 600, previousChangePercent: 200, spike: true });
    expect(result.summary.averageRunElapsedDurationMs).toBe(333.33);
});

for (const [granularity, expectedKeys] of [
    ['week', ['2026-W27', '2026-W28']],
    ['month', ['2026-07', '2026-08']]
]) {
    test(`${granularity} grouping preserves chronological UTC buckets`, async () => {
        const runs = granularity === 'week'
            ? [
                storedSummary({ runId: '20260705-000000-000-aaaaaaaa', timestamp: '2026-07-05T00:00:00.000Z', elapsedDurationMs: 100 }),
                storedSummary({ runId: '20260706-000000-000-bbbbbbbb', timestamp: '2026-07-06T00:00:00.000Z', elapsedDurationMs: 200 })
            ]
            : [
                storedSummary({ runId: '20260731-000000-000-aaaaaaaa', timestamp: '2026-07-31T00:00:00.000Z', elapsedDurationMs: 100 }),
                storedSummary({ runId: '20260801-000000-000-bbbbbbbb', timestamp: '2026-08-01T00:00:00.000Z', elapsedDurationMs: 200 })
            ];
        const result = await analyzerFor(runs).analyze({ granularity });
        expect(result.series.map(point => point.key)).toEqual(expectedKeys);
        expect(result.series.every(point => point.endExclusive !== null)).toBe(true);
    });
}

test('run output sorts out-of-order inputs and identical timestamps by run ID', async () => {
    const timestamp = '2026-07-01T00:00:00.000Z';
    const runs = [
        fakeRun('20260702-000000-000-cccccccc', '2026-07-02T00:00:00.000Z', 300),
        fakeRun('20260701-000000-000-bbbbbbbb', timestamp, 200),
        fakeRun('20260701-000000-000-aaaaaaaa', timestamp, 100)
    ];
    const fake = fakeAnalyzer(fakeRunResult(runs));
    const result = await fake.analyzer.analyze();
    expect(result.series.map(point => point.key)).toEqual([
        '20260701-000000-000-aaaaaaaa',
        '20260701-000000-000-bbbbbbbb',
        '20260702-000000-000-cccccccc'
    ]);
    expect(fake.calls).toEqual({ query: 1, group: 0 });
});

test('all filters delegate to the aggregator and limit selects newest runs before chronological output', async () => {
    const migration = {
        identity: `sha256:${'a'.repeat(64)}`,
        source: 'legacy.json',
        sourceChecksum: `sha256:${'b'.repeat(64)}`
    };
    const runs = [
        storedSummary({ runId: '20260701-000000-000-aaaaaaaa', timestamp: '2026-07-01T00:00:00.000Z', elapsedDurationMs: 100, project: 'A', feature: 'F1', environment: 'QA', browser: 'chromium', executedBy: 'Alice' }),
        storedSummary({ runId: '20260702-000000-000-bbbbbbbb', timestamp: '2026-07-02T00:00:00.000Z', elapsedDurationMs: 200, project: 'B', feature: 'F2', environment: 'STAGING', browser: 'firefox', executedBy: 'Bob', migration }),
        storedSummary({ runId: '20260703-000000-000-cccccccc', timestamp: '2026-07-03T00:00:00.000Z', elapsedDurationMs: 300, project: 'A', feature: 'F1', environment: 'QA', browser: 'chromium', executedBy: 'Alice' })
    ];
    const analyzer = analyzerFor(runs);
    const filtered = await analyzer.analyze({
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-07-03T00:00:00.000Z',
        runIds: [runs[0].runId, runs[2].runId],
        project: 'A', feature: 'F1', environment: 'QA', browser: 'chromium', executedBy: 'Alice',
        schemaVersion: '1.0.0', includeMigrated: false
    });
    expect(filtered.series.map(point => point.key)).toEqual([runs[0].runId, runs[2].runId]);
    const limited = await analyzer.analyze({ limit: 2 });
    expect(limited.series.map(point => point.key)).toEqual([runs[1].runId, runs[2].runId]);
    expect(limited.summary.limited).toBe(true);
    expect(warningCodes(limited)).toContain('HEYNA_HISTORICAL_LIMIT_APPLIED');
});

for (const status of ['PASSED', 'FAILED', 'TIMEDOUT', 'INTERRUPTED', 'SKIPPED']) {
    test(`${status} runs contribute elapsed duration without status filtering`, async () => {
        const result = await analyzerFor([storedSummary({ statuses: [status], elapsedDurationMs: 321 })]).analyze();
        expect(result.series[0].averageRunElapsedDurationMs).toBe(321);
    });
}

test('zero-test runs remain valid duration points', async () => {
    const result = await analyzerFor([storedSummary({ statuses: [], elapsedDurationMs: 400 })]).analyze();
    expect(result.series[0].averageRunElapsedDurationMs).toBe(400);
    expect(warningCodes(result)).toContain('HEYNA_HISTORICAL_ZERO_TEST_RUN');
});

test('elapsed duration is canonical and summed test or attempt duration is never consulted', async () => {
    const summary = storedSummary({ elapsedDurationMs: 1000, totalDuration: 999999, averageDuration: 999999 });
    const result = await analyzerFor([summary]).analyze();
    expect(result.metric).toBe('elapsedDurationMs');
    expect(result.series[0].averageRunElapsedDurationMs).toBe(1000);
    expect(JSON.stringify(result)).not.toContain('999999');
    const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'utils', 'DurationTrendAnalyzer.js'), 'utf8');
    expect(source).not.toMatch(/attempts|totalTestDurationMs|execution\.json/);
});

test('multiple projects retain existing run-level filtering semantics', async () => {
    const runs = [
        storedSummary({ runId: '20260701-000000-000-aaaaaaaa', project: 'chromium', elapsedDurationMs: 100 }),
        storedSummary({ runId: '20260702-000000-000-bbbbbbbb', timestamp: '2026-07-02T00:00:00.000Z', project: 'webkit', elapsedDurationMs: 200 })
    ];
    const result = await analyzerFor(runs).analyze({ project: 'webkit' });
    expect(result.series).toHaveLength(1);
    expect(result.series[0].averageRunElapsedDurationMs).toBe(200);
});

test('dependency diagnostics are reconstructed from allowlisted fields without paths or stacks', async () => {
    const injectedDiagnostics = [
        'C:\\Users\\user\\repo',
        'D:\\build\\repo',
        'D:/build/repo',
        '\\\\server\\share\\repo',
        '//server/share/repo',
        '/home/user/repo',
        '/tmp/repo',
        '/workspace/repo',
        '/srv/build/repository',
        '/etc/config',
        '/var/lib/project',
        '/opt/project',
        'Error: failure\n    at fn (/srv/build/repository/utils/read.js:10:2)',
        'utils/read.js:10',
        'src\\reader.js:25:4'
    ];
    const diagnostic = {
        code: 'HEYNA_HISTORICAL_CORRUPT_SUMMARY',
        severity: 'warning',
        message: injectedDiagnostics.join(' '),
        runId: null,
        field: null,
        details: {
            file: injectedDiagnostics[1],
            path: injectedDiagnostics[0],
            stack: injectedDiagnostics[12],
            cwd: injectedDiagnostics[8],
            root: injectedDiagnostics[9],
            artifactPath: injectedDiagnostics[10],
            error: { message: injectedDiagnostics[13] },
            nested: { repositoryPath: injectedDiagnostics[14] }
        }
    };
    const run = fakeRun('20260701-000000-000-aaaaaaaa', '2026-07-01T00:00:00.000Z', 100);
    const upstream = fakeRunResult([run], {
        source: { discoveredRunCount: 2, validRunCount: 1, excludedRunCount: 1 },
        warnings: [diagnostic],
        query: { extra: { repositoryPath: injectedDiagnostics[7] } }
    });
    upstream.source.extra = { artifactDirectory: injectedDiagnostics[6] };
    const result = await fakeAnalyzer(upstream).analyzer.analyze();
    expect(result.summary.partial).toBe(true);
    const serialized = JSON.stringify(result);
    for (const injected of injectedDiagnostics) expect(serialized).not.toContain(injected);
    expect(Object.keys(result.query)).toEqual([
        'from', 'to', 'runIds', 'project', 'feature', 'environment', 'browser', 'executedBy',
        'schemaVersion', 'includeMigrated', 'limit', 'granularity', 'spikeThresholdPercent'
    ]);
    expect(Object.keys(result.source)).toEqual([
        'discoveredRunCount', 'validRunCount', 'excludedRunCount', 'aggregationExcludedRunCount',
        'matchedRunCount', 'selectedRunCount'
    ]);
    expect(result.warnings[0]).toMatchObject({
        code: 'HEYNA_HISTORICAL_CORRUPT_SUMMARY',
        message: 'Completed history run contains corrupt summary.json.',
        details: {}
    });
});

test('time-group labels are reconstructed from validated bucket keys', async () => {
    const internalPath = '/srv/build/repository';
    const group = fakeGroup('2026-07-01', '2026-07-01T00:00:00.000Z', '2026-07-02T00:00:00.000Z', 1, 100);
    group.label = internalPath;
    const result = await fakeAnalyzer(fakeGroupResult([group])).analyzer.analyze({ granularity: 'day' });
    expect(result.series[0].label).toBe('2026-07-01');
    expect(JSON.stringify(result)).not.toContain(internalPath);
});

test('supported caller metadata is preserved even when it resembles a path', async () => {
    const intentionalProject = '/srv/build/repository';
    const result = await analyzerFor(summaries([100], { project: intentionalProject })).analyze({ project: intentionalProject });
    expect(result.query.project).toEqual([intentionalProject]);
    expect(result.series).toHaveLength(1);
});

test('dependency query cannot introduce supported metadata the caller did not request', async () => {
    const internalProject = '/srv/build/repository';
    const upstream = fakeRunResult([
        fakeRun('20260701-000000-000-aaaaaaaa', '2026-07-01T00:00:00.000Z', 100)
    ], { query: { project: [internalProject] } });
    await expect(fakeAnalyzer(upstream).analyzer.analyze()).rejects.toMatchObject({
        name: 'TypeError', code: 'HEYNA_DURATION_TREND_SOURCE_CONTRACT'
    });
});

test('options and dependency results are not mutated; outputs are fresh, deeply frozen, and JSON-safe', async () => {
    const runIds = ['20260701-000000-000-aaaaaaaa'];
    const options = { runIds, spikeThresholdPercent: 25 };
    const upstream = fakeRunResult(
        [fakeRun(runIds[0], '2026-07-01T00:00:00.000Z', 100)],
        { query: { runIds } }
    );
    const before = JSON.stringify(upstream);
    const fake = fakeAnalyzer(upstream);
    const first = await fake.analyzer.analyze(options);
    const second = await fake.analyzer.analyze(options);
    expect(runIds).toEqual(['20260701-000000-000-aaaaaaaa']);
    expect(options).toEqual({ runIds, spikeThresholdPercent: 25 });
    expect(JSON.stringify(upstream)).toBe(before);
    expect(first).not.toBe(second);
    expect(first.series[0]).not.toBe(second.series[0]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.query)).toBe(true);
    expect(Object.isFrozen(first.source)).toBe(true);
    expect(Object.isFrozen(first.series)).toBe(true);
    expect(Object.isFrozen(first.series[0])).toBe(true);
    expect(Object.isFrozen(first.summary)).toBe(true);
    expect(Object.isFrozen(first.summary.spikeKeys)).toBe(true);
    expect(Object.isFrozen(first.warnings)).toBe(true);
    expect(Object.isFrozen(first.warnings[0])).toBe(true);
    expect(Object.isFrozen(first.warnings[0].details)).toBe(true);
    expect(() => JSON.stringify(first)).not.toThrow();
});

test('invalid options fail before any dependency operation', async () => {
    for (const options of [
        null, [], { granularity: 'year' }, { spikeThresholdPercent: -1 },
        { spikeThresholdPercent: Number.NaN }, { spikeThresholdPercent: Number.POSITIVE_INFINITY },
        { metric: 'totalTestDurationMs' }, { movingAverageWindow: 2 }, { minimumPoints: 2 }, { newestFirst: false }
    ]) {
        const fake = fakeAnalyzer(fakeRunResult([]));
        await expect(fake.analyzer.analyze(options)).rejects.toMatchObject({
            name: 'TypeError', code: 'HEYNA_DURATION_TREND_INVALID_OPTION'
        });
        expect(fake.calls).toEqual({ query: 0, group: 0 });
    }
});

test('constructor validates the public aggregator dependency', () => {
    for (const dependency of [null, {}, { queryRuns() {} }, { groupBy() {} }]) {
        expect(() => new DurationTrendAnalyzer({ historicalMetricsAggregator: dependency })).toThrow(expect.objectContaining({
            name: 'TypeError', code: 'HEYNA_DURATION_TREND_DEPENDENCY'
        }));
    }
});

function validMockRunResult() {
    return fakeRunResult([fakeRun('20260701-000000-000-aaaaaaaa', '2026-07-01T00:00:00.000Z', 100)]);
}

for (const [name, mutate] of [
    ['missing duration', result => { delete result.runs[0].elapsedDurationMs; }],
    ['string duration', result => { result.runs[0].elapsedDurationMs = '100'; }],
    ['negative duration', result => { result.runs[0].elapsedDurationMs = -1; }],
    ['non-integer elapsed duration', result => { result.runs[0].elapsedDurationMs = 1.5; }],
    ['unsafe duration', result => { result.runs[0].elapsedDurationMs = Number.MAX_SAFE_INTEGER + 1; }],
    ['contradictory elapsed duration', result => { result.runs[0].elapsedDurationMs = 99; }],
    ['missing source counter', result => { delete result.source.selectedRunCount; }],
    ['string source counter', result => { result.source.selectedRunCount = '1'; }],
    ['invalid source relationship', result => { result.source.discoveredRunCount = 2; }],
    ['unknown aggregation schema', result => { result.aggregationSchemaVersion = '2.0.0'; }],
    ['invalid generatedAt', result => { result.generatedAt = 'invalid'; }],
    ['invalid timestamp', result => { result.runs[0].timestamp = '2026-02-30T00:00:00.000Z'; }],
    ['duplicate run ID', result => { result.runs.push({ ...result.runs[0] }); result.source = { ...result.source, discoveredRunCount: 2, validRunCount: 2, matchedRunCount: 2, selectedRunCount: 2 }; }],
    ['run collection mismatch', result => { result.source.selectedRunCount = 0; }]
]) {
    test(`source contract rejects ${name}`, async () => {
        const result = validMockRunResult();
        mutate(result);
        await expectSourceFailure(result);
    });
}

test('strict JSON boundary rejects NaN, Infinity, negative zero, exotic prototypes, cycles, and accessors passively', async () => {
    const factories = [
        () => Number.NaN,
        () => Number.POSITIVE_INFINITY,
        () => -0,
        () => new Date(FIXED_NOW),
        () => new Map([['key', 'value']]),
        () => {
            const value = {};
            value.self = value;
            return value;
        }
    ];
    for (const factory of factories) {
        const result = validMockRunResult();
        result.query.probe = factory();
        await expectSourceFailure(result);
    }

    let reads = 0;
    const result = validMockRunResult();
    Object.defineProperty(result.query, 'secret', {
        enumerable: true,
        get() { reads += 1; return 'private'; }
    });
    const fake = fakeAnalyzer(result);
    await expect(fake.analyzer.analyze()).rejects.toMatchObject({
        name: 'TypeError', code: 'HEYNA_DURATION_TREND_SOURCE_CONTRACT'
    });
    expect(reads).toBe(0);
});

test('group source contract rejects malformed duration aggregates', async () => {
    for (const mutate of [
        result => { delete result.groups[0].durations; },
        result => { result.groups[0].durations.totalElapsedDurationMs = '100'; },
        result => { result.groups[0].durations.totalElapsedDurationMs = -1; },
        result => { result.groups[0].durations.averageRunElapsedDurationMs = 99; },
        result => { result.groups[0].runCount = 0; },
        result => { result.groups[0].endExclusive = result.groups[0].start; }
    ]) {
        const result = fakeGroupResult([
            fakeGroup('2026-07-01', '2026-07-01T00:00:00.000Z', '2026-07-02T00:00:00.000Z', 1, 100)
        ]);
        mutate(result);
        await expectSourceFailure(result, { granularity: 'day' });
    }
});

test('checked summary arithmetic fails atomically on elapsed-duration overflow', async () => {
    const timestamp = '2026-07-01T00:00:00.000Z';
    const runs = Array.from({ length: 40 }, (_, index) => {
        const run = fakeRun(`20260701-000000-000-${index.toString(16).padStart(8, '0')}`, timestamp, 0);
        run.endTime = '9999-12-31T23:59:59.999Z';
        run.elapsedDurationMs = Date.parse(run.endTime) - Date.parse(run.startTime);
        return run;
    });
    const fake = fakeAnalyzer(fakeRunResult(runs));
    await expect(fake.analyzer.analyze()).rejects.toMatchObject({
        name: 'RangeError', code: 'HEYNA_DURATION_TREND_NUMERIC_RANGE'
    });
});

test('5,000 runs are deterministic with one dependency call and no pairwise processing', async () => {
    const start = Date.parse('2026-01-01T00:00:00.000Z');
    const runs = Array.from({ length: 5000 }, (_, index) => {
        const timestamp = new Date(start + index * 60000).toISOString();
        return fakeRun(`20260101-000000-000-${index.toString(16).padStart(8, '0')}`, timestamp, index % 1000);
    }).reverse();
    const fake = fakeAnalyzer(fakeRunResult(runs));
    const first = await fake.analyzer.analyze();
    expect(first.pointCount).toBe(5000);
    expect(first.series[0].averageRunElapsedDurationMs).toBe(0);
    expect(first.series[4999].averageRunElapsedDurationMs).toBe(999);
    expect(fake.calls).toEqual({ query: 1, group: 0 });
});

test('results are timezone-independent', () => {
    const analyzerPath = path.resolve(__dirname, '..', '..', 'utils', 'DurationTrendAnalyzer.js');
    const script = `
        const DurationTrendAnalyzer = require(${JSON.stringify(analyzerPath)});
        const runs = [
          {runId:'20260701-000000-000-aaaaaaaa',timestamp:'2026-07-01T00:00:00.000Z',startTime:'2026-07-01T00:00:00.000Z',endTime:'2026-07-01T00:00:00.100Z',elapsedDurationMs:100},
          {runId:'20260702-000000-000-bbbbbbbb',timestamp:'2026-07-02T00:00:00.000Z',startTime:'2026-07-02T00:00:00.000Z',endTime:'2026-07-02T00:00:00.200Z',elapsedDurationMs:200}
        ];
        const source={discoveredRunCount:2,validRunCount:2,excludedRunCount:0,aggregationExcludedRunCount:0,matchedRunCount:2,selectedRunCount:2};
        const query={from:null,to:null,runIds:null,project:null,feature:null,environment:null,browser:null,executedBy:null,schemaVersion:['1.0.0'],includeMigrated:true,newestFirst:true,limit:null};
        const result={aggregationSchemaVersion:'1.0.0',generatedAt:'2026-08-07T00:00:00.000Z',query,source,runs,warnings:[]};
        const dependency={async queryRuns(){return result},async groupBy(){return result}};
        new DurationTrendAnalyzer({historicalMetricsAggregator:dependency}).analyze().then(value=>process.stdout.write(JSON.stringify(value)));
    `;
    const outputs = ['UTC', 'America/New_York', 'Asia/Jakarta'].map(TZ => execFileSync(process.execPath, ['-e', script], {
        env: { ...process.env, TZ }, encoding: 'utf8'
    }));
    expect(outputs[1]).toBe(outputs[0]);
    expect(outputs[2]).toBe(outputs[0]);
});

test('HistoryManager to aggregator to duration analyzer integrates without a history schema change', async () => {
    const root = tempRoot();
    const history = mergeHistoryConfig({ enabled: true, migration: { enabled: false } });
    const paths = resolveArtifactPaths({ artifactRoot: root, config: { history } });
    const manager = new HistoryManager({ paths, history, logger: { log() {}, error() {} } });
    await manager.initialize();
    const persist = async (runId, timestamp, elapsedDurationMs, duration) => manager.persistRun({
        runId,
        createdAt: timestamp,
        execution: [{ testCase: runId, status: 'PASSED', duration, traceAvailable: false }],
        metadata: {
            project: 'Integration', feature: 'Duration', environment: 'QA', browser: 'chromium', executedBy: 'Test',
            executionStartTime: timestamp,
            executionEndTime: new Date(Date.parse(timestamp) + elapsedDurationMs).toISOString()
        }
    });
    const first = await persist('20260701-000000-000-aaaaaaaa', '2026-07-01T00:00:00.000Z', 100, 900);
    const second = await persist('20260702-000000-000-bbbbbbbb', '2026-07-02T00:00:00.000Z', 200, 1);
    expect(first.summary.schemaVersion).toBe('1.0.0');
    expect(second.summary.schemaVersion).toBe('1.0.0');

    const aggregator = new HistoricalMetricsAggregator({ historyManager: manager, clock: () => new Date(FIXED_NOW) });
    const result = await new DurationTrendAnalyzer({ historicalMetricsAggregator: aggregator }).analyze();
    expect(result.series.map(point => point.averageRunElapsedDurationMs)).toEqual([100, 200]);
    expect(result.summary).toMatchObject({ averageRunElapsedDurationMs: 150, spikeCount: 1 });
    expect(HistoryManager.SCHEMA_VERSION).toBe('1.0.0');
});

test('analyzer source has no storage, reporter, dashboard, or filesystem dependency', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'utils', 'DurationTrendAnalyzer.js'), 'utf8');
    expect(source).not.toMatch(/require\(['"](?:fs|path|\.\/HistoryManager|\.\/HeynaReporter|\.\/HeynaHtmlDashboardGenerator|\.\/HistoricalMetricsValidation)['"]\)/);
    expect(source).not.toMatch(/history[\\/]runs|readFileSync|readdirSync|execution\.json/);
    expect(Object.getOwnPropertyNames(DurationTrendAnalyzer.prototype).sort()).toEqual(['analyze', 'constructor']);
});
