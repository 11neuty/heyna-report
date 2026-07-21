const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const HistoricalMetricsAggregator = require('../../utils/HistoricalMetricsAggregator');
const PassRateTrendAnalyzer = require('../../utils/PassRateTrendAnalyzer');
const { safeSubtractCount } = require('../../utils/PassRateTrendValidation');

const FIXED_NOW = '2026-07-21T00:00:00.000Z';
const EMPTY_SOURCE = Object.freeze({
    discoveredRunCount: 0,
    validRunCount: 0,
    excludedRunCount: 0,
    aggregationExcludedRunCount: 0,
    matchedRunCount: 0,
    selectedRunCount: 0
});

function storedSummary(options = {}) {
    const timestamp = options.timestamp || '2026-07-01T00:00:00.000Z';
    const counts = {
        passed: options.passed ?? 8,
        failed: options.failed ?? 2,
        skipped: options.skipped ?? 0,
        timedOut: options.timedOut ?? 0,
        interrupted: options.interrupted ?? 0
    };
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    const summary = {
        runId: options.runId || '20260701-000000-000-aaaaaaaa',
        schemaVersion: '1.0.0',
        createdAt: timestamp,
        timestamp,
        startTime: timestamp,
        endTime: options.endTime || new Date(Date.parse(timestamp) + 1000).toISOString(),
        total,
        ...counts,
        unsuccessful: counts.failed + counts.timedOut + counts.interrupted,
        passRate: total ? Number(((counts.passed / total) * 100).toFixed(2)) : 0,
        totalDuration: options.totalDuration ?? 0,
        averageDuration: options.averageDuration ?? 0,
        project: options.project === undefined ? 'Project' : options.project,
        feature: options.feature === undefined ? 'Feature' : options.feature,
        environment: options.environment === undefined ? 'QA' : options.environment,
        browser: options.browser === undefined ? 'chromium' : options.browser,
        executedBy: options.executedBy === undefined ? 'Tester' : options.executedBy,
        failureCategoryCounts: {},
        traceReportedCount: 0,
        tracePreservedCount: 0,
        traceAvailableCount: 0,
        reportAvailability: { pdf: false, dashboard: false, evidence: false, traces: false }
    };
    if (options.migration) summary.migration = options.migration;
    return summary;
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
    return new PassRateTrendAnalyzer({ historicalMetricsAggregator });
}

function days(values) {
    return values.map((passed, index) => storedSummary({
        runId: `202607${String(index + 1).padStart(2, '0')}-000000-000-${index.toString(16).padStart(8, '0')}`,
        timestamp: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
        passed,
        failed: 100 - passed
    }));
}

function warningCodes(result) {
    return result.warnings.map(item => item.code);
}

function fakeRun(runId, timestamp, total, passed) {
    const failed = total - passed;
    return {
        runId,
        timestamp,
        total,
        passed,
        failed,
        skipped: 0,
        timedOut: 0,
        interrupted: 0,
        unsuccessful: failed,
        passRate: total ? Number(((passed / total) * 100).toFixed(2)) : null
    };
}

function exactRateSummaries(rates) {
    return rates.map((rate, index) => {
        const total = 10000;
        const passed = Math.round(rate * 100);
        return storedSummary({
            runId: `202607${String(index + 1).padStart(2, '0')}-000000-000-${index.toString(16).padStart(8, '0')}`,
            timestamp: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
            passed,
            failed: total - passed
        });
    });
}

function fakeRunResult(runs, overrides = {}) {
    const matchedRunCount = overrides.matchedRunCount ?? runs.length;
    return {
        aggregationSchemaVersion: '1.0.0',
        generatedAt: FIXED_NOW,
        query: { newestFirst: true, limit: null },
        source: {
            ...EMPTY_SOURCE,
            discoveredRunCount: runs.length,
            validRunCount: runs.length,
            matchedRunCount,
            selectedRunCount: runs.length,
            ...overrides.source
        },
        runs,
        warnings: overrides.warnings || []
    };
}

function fakeAnalyzer(result, calls = { query: 0, group: 0 }) {
    const historicalMetricsAggregator = {
        async queryRuns() { calls.query += 1; return result; },
        async groupBy() { calls.group += 1; return result; }
    };
    return { analyzer: new PassRateTrendAnalyzer({ historicalMetricsAggregator }), calls };
}

function fakeGroup(key, start, endExclusive, runCount, totalTests, passed) {
    const weightedPassRate = totalTests ? Number(((passed / totalTests) * 100).toFixed(2)) : null;
    return {
        key,
        label: key,
        start,
        endExclusive,
        runCount,
        totals: { tests: totalTests, passed },
        rates: { weightedPassRate, averageRunPassRate: weightedPassRate }
    };
}

function fakeGroupResult(groups, overrides = {}) {
    const selectedRunCount = groups.reduce((sum, group) => sum + group.runCount, 0);
    const matchedRunCount = overrides.matchedRunCount ?? selectedRunCount;
    return {
        aggregationSchemaVersion: '1.0.0',
        generatedAt: FIXED_NOW,
        query: { newestFirst: true, limit: null },
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

async function expectSourceContractFailure(result, options = { granularity: 'run' }) {
    const before = JSON.stringify(result);
    const fake = fakeAnalyzer(result);
    await expect(fake.analyzer.analyze(options)).rejects.toMatchObject({
        name: 'TypeError',
        code: 'HEYNA_PASS_RATE_TREND_SOURCE_CONTRACT'
    });
    expect(fake.calls).toEqual(options.granularity === 'run' ? { query: 1, group: 0 } : { query: 0, group: 1 });
    expect(JSON.stringify(result)).toBe(before);
}

function warningWithDetails(details) {
    return {
        code: 'HEYNA_HISTORICAL_TEST_WARNING',
        severity: 'warning',
        message: 'test warning',
        runId: null,
        field: null,
        details
    };
}

test('empty history preserves upstream warning and adds insufficient data', async () => {
    const result = await analyzerFor().analyze();
    expect(result).toMatchObject({ pointCount: 0, analyzablePointCount: 0, series: [] });
    expect(result.summary).toMatchObject({ firstRate: null, latestRate: null, direction: 'insufficient-data', partial: false, limited: false });
    expect(warningCodes(result)).toEqual(['HEYNA_HISTORICAL_EMPTY_HISTORY', 'HEYNA_PASS_RATE_TREND_INSUFFICIENT_DATA']);
});

test('no matching runs remains distinct from empty history', async () => {
    const result = await analyzerFor(days([80])).analyze({ project: 'Missing' });
    expect(result.series).toEqual([]);
    expect(warningCodes(result)).toContain('HEYNA_HISTORICAL_NO_MATCHING_RUNS');
    expect(warningCodes(result)).not.toContain('HEYNA_HISTORICAL_EMPTY_HISTORY');
});

test('single rate-bearing point is insufficient without inventing changes', async () => {
    const result = await analyzerFor(days([80])).analyze();
    expect(result.summary).toMatchObject({ firstRate: 80, latestRate: 80, percentagePointChange: null, relativePercentChange: null, direction: 'insufficient-data' });
});

for (const [name, rates, expected] of [
    ['improving', [80, 85], { change: 5, relative: 6.25, direction: 'improving' }],
    ['declining', [90, 80], { change: -10, relative: -11.11, direction: 'declining' }],
    ['stable', [80, 80], { change: 0, relative: 0, direction: 'stable' }]
]) {
    test(`${name} direction uses first-to-latest weighted rates`, async () => {
        const result = await analyzerFor(days(rates)).analyze();
        expect(result.summary).toMatchObject({
            percentagePointChange: expected.change,
            relativePercentChange: expected.relative,
            direction: expected.direction
        });
    });
}

test('stability threshold boundaries are inclusive and configurable', async () => {
    const stable = await analyzerFor(days([80, 81])).analyze({ stableThresholdPoints: 1 });
    const improving = await analyzerFor(days([80, 81])).analyze({ stableThresholdPoints: 0.99 });
    expect(stable.summary.direction).toBe('stable');
    expect(improving.summary.direction).toBe('improving');
});

for (const [name, rates, expectedDirection] of [
    ['exact negative threshold', [80, 79], 'stable'],
    ['just beyond positive threshold', [80, 81.01], 'improving'],
    ['just beyond negative threshold', [80, 78.99], 'declining']
]) {
    test(`${name} has an explicit classification`, async () => {
        const result = await analyzerFor(exactRateSummaries(rates)).analyze({ stableThresholdPoints: 1 });
        expect(result.summary.percentagePointChange).toBe(Number((rates[1] - rates[0]).toFixed(2)));
        expect(result.summary.direction).toBe(expectedDirection);
    });
}

for (const [from, to, expectedPoints, expectedRelative, expectedDirection] of [
    [1, 2, 1, 100, 'improving'],
    [2, 1, -1, -50, 'declining'],
    [0, 50, 50, null, 'improving'],
    [50, 0, -50, -100, 'declining'],
    [99.99, 100, 0.01, 0.01, 'stable'],
    [100, 99.99, -0.01, -0.01, 'stable']
]) {
    test(`rate change ${from} to ${to} keeps percentage-point and relative semantics`, async () => {
        const result = await analyzerFor(exactRateSummaries([from, to])).analyze();
        expect(result.summary.percentagePointChange).toBe(expectedPoints);
        expect(result.summary.relativePercentChange).toBe(expectedRelative);
        expect(result.summary.direction).toBe(expectedDirection);
    });
}

test('minimumPoints controls classification without hiding factual change', async () => {
    const result = await analyzerFor(days([80, 85])).analyze({ minimumPoints: 3 });
    expect(result.summary).toMatchObject({ percentagePointChange: 5, direction: 'insufficient-data', minimumPoints: 3 });
});

test('zero baseline keeps point change, nulls relative change, and warns once for duplicate comparisons', async () => {
    const result = await analyzerFor(days([0, 50])).analyze();
    expect(result.summary).toMatchObject({ percentagePointChange: 50, relativePercentChange: null, previousRelativePercentChange: null, direction: 'improving' });
    expect(result.warnings.filter(item => item.code === 'HEYNA_PASS_RATE_TREND_UNDEFINED_RELATIVE_CHANGE')).toHaveLength(1);
});

test('distinct first and previous zero baselines produce distinct structured warnings', async () => {
    const result = await analyzerFor(days([0, 0, 50])).analyze();
    const warnings = result.warnings.filter(item => item.code === 'HEYNA_PASS_RATE_TREND_UNDEFINED_RELATIVE_CHANGE');
    expect(warnings).toHaveLength(2);
    expect(warnings.map(item => item.details.comparison)).toEqual(['first-to-latest', 'previous-to-latest']);
    expect(warnings.map(item => item.details.baselineKey)).toEqual(['2026-07-01', '2026-07-02']);
});

test('previous-to-latest comparison is separate from canonical direction', async () => {
    const result = await analyzerFor(days([50, 90, 80])).analyze();
    expect(result.summary).toMatchObject({
        firstRate: 50,
        previousRate: 90,
        latestRate: 80,
        percentagePointChange: 30,
        previousPercentagePointChange: -10,
        direction: 'improving'
    });
});

test('run granularity uses queryRuns and deterministic timestamp/runId ordering', async () => {
    const timestamp = '2026-07-01T00:00:00.000Z';
    const runs = [
        storedSummary({ runId: '20260701-000000-000-cccccccc', timestamp, passed: 70, failed: 30 }),
        storedSummary({ runId: '20260701-000000-000-aaaaaaaa', timestamp, passed: 80, failed: 20 }),
        storedSummary({ runId: '20260701-000000-000-bbbbbbbb', timestamp, passed: 90, failed: 10 })
    ];
    const result = await analyzerFor(runs).analyze({ granularity: 'run' });
    expect(result.series.map(point => point.key)).toEqual([
        '20260701-000000-000-aaaaaaaa',
        '20260701-000000-000-bbbbbbbb',
        '20260701-000000-000-cccccccc'
    ]);
    expect(result.series.every(point => point.endExclusive === null && point.runCount === 1)).toBe(true);
});

for (const [granularity, runs, keys, boundary] of [
    ['day', [storedSummary({ timestamp: '2026-07-02T12:00:00.000Z', runId: '20260702-120000-000-aaaaaaaa' })], ['2026-07-02'], '2026-07-03T00:00:00.000Z'],
    ['week', [storedSummary({ timestamp: '2021-01-01T12:00:00.000Z', runId: '20210101-120000-000-aaaaaaaa' })], ['2020-W53'], '2021-01-04T00:00:00.000Z'],
    ['month', [storedSummary({ timestamp: '2026-07-20T12:00:00.000Z', runId: '20260720-120000-000-aaaaaaaa' })], ['2026-07'], '2026-08-01T00:00:00.000Z']
]) {
    test(`${granularity} granularity preserves aggregator UTC boundaries`, async () => {
        const result = await analyzerFor(runs).analyze({ granularity });
        expect(result.series.map(point => point.key)).toEqual(keys);
        expect(result.series[0].endExclusive).toBe(boundary);
    });
}

test('missing periods are omitted rather than synthesized', async () => {
    const result = await analyzerFor([
        storedSummary({ timestamp: '2026-07-01T00:00:00.000Z', runId: '20260701-000000-000-aaaaaaaa' }),
        storedSummary({ timestamp: '2026-07-03T00:00:00.000Z', runId: '20260703-000000-000-bbbbbbbb' })
    ]).analyze();
    expect(result.series.map(point => point.key)).toEqual(['2026-07-01', '2026-07-03']);
});

test('weighted and average-run rates stay explicitly separate for uneven run sizes', async () => {
    const result = await analyzerFor([
        storedSummary({ runId: '20260701-000000-000-aaaaaaaa', passed: 1, failed: 0 }),
        storedSummary({ runId: '20260701-010000-000-bbbbbbbb', timestamp: '2026-07-01T01:00:00.000Z', passed: 0, failed: 99 })
    ]).analyze({ includeAverageRunComparison: true });
    expect(result.series[0]).toMatchObject({ totalTests: 100, passed: 1, weightedPassRate: 1, averageRunPassRate: 50 });
    expect(result.summary.averageRunComparison).toMatchObject({ firstRate: 50, latestRate: 50 });
    expect(result.metric).toBe('weightedPassRate');
});

test('zero-test points remain, are excluded from comparisons, and warn once', async () => {
    const result = await analyzerFor([
        storedSummary({ runId: '20260701-000000-000-aaaaaaaa', passed: 80, failed: 20 }),
        storedSummary({ runId: '20260702-000000-000-bbbbbbbb', timestamp: '2026-07-02T00:00:00.000Z', passed: 0, failed: 0 }),
        storedSummary({ runId: '20260703-000000-000-cccccccc', timestamp: '2026-07-03T00:00:00.000Z', passed: 90, failed: 10 })
    ]).analyze();
    expect(result.series[1]).toMatchObject({ totalTests: 0, weightedPassRate: null, averageRunPassRate: null });
    expect(result).toMatchObject({ pointCount: 3, analyzablePointCount: 2 });
    expect(result.summary).toMatchObject({ firstRate: 80, latestRate: 90 });
    expect(result.warnings.find(item => item.code === 'HEYNA_PASS_RATE_TREND_ZERO_TEST_POINT').details).toEqual({ affectedPointCount: 1 });
});

for (const [position, rates, expectedKeys] of [
    ['start', [null, 80, 90], ['2026-07-02', '2026-07-03']],
    ['end', [80, 90, null], ['2026-07-01', '2026-07-02']]
]) {
    test(`zero-test point at series ${position} is retained but excluded from comparison`, async () => {
        const runs = rates.map((rate, index) => storedSummary({
            runId: `202607${String(index + 1).padStart(2, '0')}-000000-000-${index.toString(16).padStart(8, '0')}`,
            timestamp: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
            passed: rate === null ? 0 : rate,
            failed: rate === null ? 0 : 100 - rate
        }));
        const result = await analyzerFor(runs).analyze();
        expect(result.series).toHaveLength(3);
        expect(result.analyzablePointCount).toBe(2);
        expect([result.summary.firstKey, result.summary.latestKey]).toEqual(expectedKeys);
        expect(result.warnings.find(item => item.code === 'HEYNA_PASS_RATE_TREND_ZERO_TEST_POINT').details).toEqual({ affectedPointCount: 1 });
    });
}

test('all-zero-test series remains visible and is insufficient', async () => {
    const runs = [1, 2].map(day => storedSummary({
        runId: `2026070${day}-000000-000-0000000${day}`,
        timestamp: `2026-07-0${day}T00:00:00.000Z`,
        passed: 0,
        failed: 0
    }));
    const result = await analyzerFor(runs).analyze();
    expect(result).toMatchObject({ pointCount: 2, analyzablePointCount: 0 });
    expect(result.summary).toMatchObject({ firstKey: null, latestKey: null, direction: 'insufficient-data' });
    expect(result.warnings.find(item => item.code === 'HEYNA_PASS_RATE_TREND_ZERO_TEST_POINT').details).toEqual({ affectedPointCount: 2 });
});

test('moving weighted rate requires a full window and combines counts', async () => {
    const result = await analyzerFor([
        storedSummary({ runId: '20260701-000000-000-aaaaaaaa', passed: 1, failed: 0 }),
        storedSummary({ runId: '20260702-000000-000-bbbbbbbb', timestamp: '2026-07-02T00:00:00.000Z', passed: 0, failed: 99 }),
        storedSummary({ runId: '20260703-000000-000-cccccccc', timestamp: '2026-07-03T00:00:00.000Z', passed: 1, failed: 0 })
    ]).analyze({ movingAverageWindow: 2 });
    expect(result.series.map(point => point.movingWeightedPassRate)).toEqual([null, 1, 1]);
});

test('moving windows include zero-test points and null a zero-denominator full window', async () => {
    const result = await analyzerFor([
        storedSummary({ runId: '20260701-000000-000-aaaaaaaa', passed: 0, failed: 0 }),
        storedSummary({ runId: '20260702-000000-000-bbbbbbbb', timestamp: '2026-07-02T00:00:00.000Z', passed: 0, failed: 0 }),
        storedSummary({ runId: '20260703-000000-000-cccccccc', timestamp: '2026-07-03T00:00:00.000Z', passed: 1, failed: 0 })
    ]).analyze({ movingAverageWindow: 2 });
    expect(result.series.map(point => point.movingWeightedPassRate)).toEqual([null, null, 100]);
});

test('rolling arithmetic overflow fails atomically with a stable code', async () => {
    const large = Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1;
    const runs = [
        fakeRun('20260701-000000-000-aaaaaaaa', '2026-07-01T00:00:00.000Z', large, 0),
        fakeRun('20260702-000000-000-bbbbbbbb', '2026-07-02T00:00:00.000Z', large, 0)
    ];
    const { analyzer } = fakeAnalyzer(fakeRunResult(runs));
    await expect(analyzer.analyze({ granularity: 'run', movingAverageWindow: 2 })).rejects.toMatchObject({
        name: 'RangeError', code: 'HEYNA_PASS_RATE_TREND_NUMERIC_RANGE'
    });
});

test('storage exclusions and partial warnings propagate in original order', async () => {
    const diagnostic = {
        code: 'HEYNA_HISTORICAL_CORRUPT_SUMMARY', severity: 'warning', message: 'safe',
        runId: '20260702-000000-000-bbbbbbbb', field: null, details: { file: 'summary.json' }
    };
    const result = await analyzerFor(days([80]), [diagnostic]).analyze();
    expect(warningCodes(result).slice(0, 3)).toEqual([
        'HEYNA_HISTORICAL_CORRUPT_SUMMARY',
        'HEYNA_HISTORICAL_EXCLUDED_RUN',
        'HEYNA_HISTORICAL_PARTIAL_AGGREGATION'
    ]);
    expect(result.summary.partial).toBe(true);
});

test('aggregation exclusions remain visible and mark the trend partial', async () => {
    const unusable = storedSummary({
        runId: '20260702-000000-000-bbbbbbbb', timestamp: '2026-07-02T00:00:00.000Z',
        totalDuration: 0.0001, averageDuration: 0.0001
    });
    const result = await analyzerFor([days([80])[0], unusable]).analyze();
    expect(warningCodes(result)).toContain('HEYNA_HISTORICAL_AGGREGATION_UNUSABLE_SUMMARY');
    expect(result.source.aggregationExcludedRunCount).toBe(1);
    expect(result.summary.partial).toBe(true);
});

test('legacy duration normalization warning propagates without changing trend rates', async () => {
    const legacy = storedSummary({ passed: 2, failed: 0, totalDuration: 0.30000000000000004, averageDuration: 0.15 });
    const result = await analyzerFor([legacy]).analyze();
    expect(warningCodes(result)).toContain('HEYNA_HISTORICAL_DURATION_NORMALIZED');
    expect(result.series[0].weightedPassRate).toBe(100);
});

test('all base filters are delegated and normalized by the aggregator', async () => {
    const migration = { identity: `sha256:${'a'.repeat(64)}`, source: 'legacy.json', sourceChecksum: `sha256:${'b'.repeat(64)}` };
    const run = storedSummary({ project: 'P', feature: 'F', environment: 'QA', browser: 'chromium', executedBy: 'A', migration });
    const options = {
        from: '2026-07-01T00:00:00Z', to: '2026-07-01T23:59:59.999Z', runIds: [run.runId],
        project: ['P'], feature: 'F', environment: 'QA', browser: 'chromium', executedBy: 'A',
        schemaVersion: '1.0.0', includeMigrated: true, limit: 1
    };
    const result = await analyzerFor([run]).analyze(options);
    expect(result.query).toMatchObject({
        from: '2026-07-01T00:00:00.000Z', to: '2026-07-01T23:59:59.999Z', runIds: [run.runId],
        project: ['P'], feature: ['F'], environment: ['QA'], browser: ['chromium'], executedBy: ['A'],
        schemaVersion: ['1.0.0'], includeMigrated: true, newestFirst: true, limit: 1
    });
});

test('limit selects newest matching runs but emits a chronological series', async () => {
    const result = await analyzerFor(days([10, 20, 30, 40])).analyze({ granularity: 'run', limit: 2 });
    expect(result.series.map(point => point.weightedPassRate)).toEqual([30, 40]);
    expect(result.summary.limited).toBe(true);
    expect(warningCodes(result)).toContain('HEYNA_HISTORICAL_LIMIT_APPLIED');
});

test('a non-truncating limit is not reported as limited', async () => {
    const result = await analyzerFor(days([10, 20])).analyze({ limit: 2 });
    expect(result.summary.limited).toBe(false);
    expect(warningCodes(result)).not.toContain('HEYNA_HISTORICAL_LIMIT_APPLIED');
});

function runsAt(timestamps) {
    return timestamps.map((timestamp, index) => {
        const date = new Date(timestamp);
        const compactDate = date.toISOString().slice(0, 10).replace(/-/g, '');
        const compactTime = date.toISOString().slice(11, 19).replace(/:/g, '');
        return storedSummary({
            runId: `${compactDate}-${compactTime}-000-${index.toString(16).padStart(8, '0')}`,
            timestamp,
            passed: 70 + index,
            failed: 30 - index
        });
    });
}

const GROUPED_LIMIT_CASES = [
    {
        granularity: 'day',
        timestamps: [
            '2026-07-01T00:00:00.000Z', '2026-07-02T00:00:00.000Z',
            '2026-07-03T00:00:00.000Z', '2026-07-03T01:00:00.000Z', '2026-07-03T02:00:00.000Z'
        ],
        keys: ['2026-07-01', '2026-07-02', '2026-07-03']
    },
    {
        granularity: 'week',
        timestamps: [
            '2026-01-05T00:00:00.000Z', '2026-01-12T00:00:00.000Z',
            '2026-01-19T00:00:00.000Z', '2026-01-19T01:00:00.000Z', '2026-01-19T02:00:00.000Z'
        ],
        keys: ['2026-W02', '2026-W03', '2026-W04']
    },
    {
        granularity: 'month',
        timestamps: [
            '2026-05-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z',
            '2026-07-01T00:00:00.000Z', '2026-07-01T01:00:00.000Z', '2026-07-01T02:00:00.000Z'
        ],
        keys: ['2026-05', '2026-06', '2026-07']
    }
];

for (const { granularity, timestamps, keys } of GROUPED_LIMIT_CASES) {
    test(`${granularity} limit counts runs and may collapse selected runs into one bucket`, async () => {
        const result = await analyzerFor(runsAt(timestamps)).analyze({ granularity, limit: 2 });
        expect(result.source).toMatchObject({ matchedRunCount: 5, selectedRunCount: 2 });
        expect(result.pointCount).toBe(1);
        expect(result.series.map(point => point.key)).toEqual([keys[2]]);
        expect(result.series[0].runCount).toBe(2);
        expect(result.series.reduce((sum, point) => sum + point.runCount, 0)).toBe(2);
        expect(result.summary.limited).toBe(true);
        expect(warningCodes(result)).toContain('HEYNA_HISTORICAL_LIMIT_APPLIED');
    });

    test(`${granularity} limited grouping spans buckets after newest-run selection`, async () => {
        const result = await analyzerFor(runsAt(timestamps)).analyze({ granularity, limit: 4 });
        expect(result.source).toMatchObject({ matchedRunCount: 5, selectedRunCount: 4 });
        expect(result.pointCount).toBe(2);
        expect(result.series.map(point => point.key)).toEqual([keys[1], keys[2]]);
        expect(result.series.reduce((sum, point) => sum + point.runCount, 0)).toBe(4);
        expect(result.series[0].start < result.series[1].start).toBe(true);
        expect(result.summary.limited).toBe(true);
        expect(warningCodes(result)).toContain('HEYNA_HISTORICAL_LIMIT_APPLIED');
    });

    test(`${granularity} non-truncating grouped limit remains complete`, async () => {
        const result = await analyzerFor(runsAt(timestamps)).analyze({ granularity, limit: 5 });
        expect(result.source).toMatchObject({ matchedRunCount: 5, selectedRunCount: 5 });
        expect(result.pointCount).toBe(3);
        expect(result.series.map(point => point.key)).toEqual(keys);
        expect(result.series.reduce((sum, point) => sum + point.runCount, 0)).toBe(5);
        expect(result.summary.limited).toBe(false);
        expect(warningCodes(result)).not.toContain('HEYNA_HISTORICAL_LIMIT_APPLIED');
    });
}

test('migrated runs are included by default and excluded on request', async () => {
    const migration = { identity: `sha256:${'a'.repeat(64)}`, source: 'legacy.json', sourceChecksum: `sha256:${'b'.repeat(64)}` };
    const runs = [days([80])[0], storedSummary({ runId: '20260702-000000-000-bbbbbbbb', timestamp: '2026-07-02T00:00:00.000Z', migration })];
    expect((await analyzerFor(runs).analyze({ granularity: 'run' })).pointCount).toBe(2);
    expect((await analyzerFor(runs).analyze({ granularity: 'run', includeMigrated: false })).pointCount).toBe(1);
});

test('caller options and filter arrays are not mutated', async () => {
    const projects = ['Project'];
    const from = new Date('2026-07-01T00:00:00Z');
    const options = { granularity: 'run', project: projects, from };
    const before = { projects: projects.slice(), timestamp: from.getTime(), keys: Object.keys(options) };
    await analyzerFor(days([80])).analyze(options);
    expect(projects).toEqual(before.projects);
    expect(from.getTime()).toBe(before.timestamp);
    expect(Object.keys(options)).toEqual(before.keys);
    expect(options).not.toHaveProperty('newestFirst');
});

test('upstream results and warnings remain unchanged', async () => {
    const warning = Object.freeze({ code: 'HEYNA_HISTORICAL_EMPTY_HISTORY', severity: 'warning', message: 'empty', runId: null, field: null, details: Object.freeze({}) });
    const upstream = Object.freeze({ ...fakeRunResult([], { warnings: Object.freeze([warning]) }), warnings: Object.freeze([warning]) });
    const snapshot = JSON.stringify(upstream);
    const { analyzer } = fakeAnalyzer(upstream);
    await analyzer.analyze({ granularity: 'run' });
    expect(JSON.stringify(upstream)).toBe(snapshot);
});

test('outputs are deterministic, fresh, recursively frozen, and JSON-safe', async () => {
    const analyzer = analyzerFor(days([80, 85]));
    const first = await analyzer.analyze();
    const second = await analyzer.analyze();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.series).not.toBe(second.series);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.query)).toBe(true);
    expect(Object.isFrozen(first.query.schemaVersion)).toBe(true);
    expect(Object.isFrozen(first.source)).toBe(true);
    expect(Object.isFrozen(first.summary)).toBe(true);
    expect(Object.isFrozen(first.warnings)).toBe(true);
    expect(first.warnings.every(item => Object.isFrozen(item) && Object.isFrozen(item.details))).toBe(true);
    expect(first.series.every(point => Object.isFrozen(point))).toBe(true);
    expect(() => JSON.stringify(first)).not.toThrow();
});

test('each granularity performs exactly one matching aggregator call', async () => {
    const runResult = fakeRunResult([fakeRun('20260701-000000-000-aaaaaaaa', '2026-07-01T00:00:00.000Z', 10, 8)]);
    const run = fakeAnalyzer(runResult);
    await run.analyzer.analyze({ granularity: 'run' });
    expect(run.calls).toEqual({ query: 1, group: 0 });

    const grouped = await new HistoricalMetricsAggregator({ historyManager: diagnosticManager(days([80])), clock: () => new Date(FIXED_NOW) }).groupBy('day');
    const day = fakeAnalyzer(grouped);
    await day.analyzer.analyze({ granularity: 'day' });
    expect(day.calls).toEqual({ query: 0, group: 1 });
});

test('invalid analyzer options fail before any aggregator call', async () => {
    const fake = fakeAnalyzer(fakeRunResult([]));
    for (const options of [
        { granularity: 'quarter' }, { metric: 'averageRunPassRate' }, { movingAverageWindow: 1 },
        { stableThresholdPoints: -1 }, { stableThresholdPoints: 101 }, { minimumPoints: 1 },
        { includeAverageRunComparison: 'yes' }, { newestFirst: true }, { trendSlope: true }
    ]) {
        await expect(fake.analyzer.analyze(options)).rejects.toMatchObject({ code: 'HEYNA_PASS_RATE_TREND_INVALID_OPTION' });
    }
    expect(fake.calls).toEqual({ query: 0, group: 0 });
});

test('malformed dependencies fail during construction', () => {
    for (const dependency of [undefined, {}, { queryRuns() {} }, { groupBy() {} }]) {
        expect(() => new PassRateTrendAnalyzer({ historicalMetricsAggregator: dependency })).toThrow(expect.objectContaining({
            code: 'HEYNA_PASS_RATE_TREND_DEPENDENCY'
        }));
    }
});

test('aggregator filter validation and upstream errors propagate unchanged', async () => {
    await expect(analyzerFor(days([80])).analyze({ from: 'invalid' })).rejects.toThrow(TypeError);
    const expected = Object.assign(new Error('upstream failed'), { code: 'UPSTREAM_FAILURE' });
    const dependency = { queryRuns: async () => { throw expected; }, groupBy: async () => { throw expected; } };
    const analyzer = new PassRateTrendAnalyzer({ historicalMetricsAggregator: dependency });
    await expect(analyzer.analyze()).rejects.toBe(expected);
});

test('native upstream TypeError identity propagates unchanged', async () => {
    const expected = new TypeError('native upstream failure');
    const dependency = { queryRuns: async () => { throw expected; }, groupBy: async () => { throw expected; } };
    const analyzer = new PassRateTrendAnalyzer({ historicalMetricsAggregator: dependency });
    await expect(analyzer.analyze({ granularity: 'run' })).rejects.toBe(expected);
});

test('rolling subtraction rejects invariant drift with the trend numeric-range code', () => {
    expect(() => safeSubtractCount(1, 2, 'moving total tests')).toThrow(expect.objectContaining({
        name: 'RangeError', code: 'HEYNA_PASS_RATE_TREND_NUMERIC_RANGE'
    }));
});

test('thousands of runs produce deterministic chronological points', async () => {
    const runs = Array.from({ length: 5000 }, (_, index) => storedSummary({
        runId: `20260701-000000-000-${index.toString(16).padStart(8, '0')}`,
        timestamp: new Date(Date.parse('2026-01-01T00:00:00.000Z') + index * 60000).toISOString(),
        passed: index % 101,
        failed: 100 - (index % 101)
    }));
    const result = await analyzerFor(runs).analyze({ granularity: 'run', movingAverageWindow: 50 });
    expect(result.pointCount).toBe(5000);
    expect(result.series[0].key).toBe(runs[0].runId);
    expect(result.series[4999].key).toBe(runs[4999].runId);
    expect(result.series[48].movingWeightedPassRate).toBeNull();
    expect(result.series[49].movingWeightedPassRate).toBe(24.5);
});

function validMockRunResult() {
    return fakeRunResult([
        fakeRun('20260701-000000-000-aaaaaaaa', '2026-07-01T00:00:00.000Z', 10, 8)
    ]);
}

function validMockGroupResult() {
    return fakeGroupResult([
        fakeGroup('2026-07-01', '2026-07-01T00:00:00.000Z', '2026-07-02T00:00:00.000Z', 1, 10, 8)
    ]);
}

for (const [name, mutate] of [
    ['contradictory run rate and counts', result => { result.runs[0].passRate = 5; }],
    ['missing source counter', result => { delete result.source.selectedRunCount; }],
    ['string source counter', result => { result.source.selectedRunCount = '1'; }],
    ['negative source counter', result => { result.source.excludedRunCount = -1; }],
    ['unsafe source counter', result => { result.source.validRunCount = Number.MAX_SAFE_INTEGER + 1; }],
    ['discovered count relationship', result => { result.source.discoveredRunCount = 2; }],
    ['aggregation exclusions exceeding valid runs', result => { result.source.aggregationExcludedRunCount = 2; }],
    ['selected count exceeding matched runs', result => { result.source.selectedRunCount = 2; }],
    ['matched count exceeding aggregatable valid runs', result => { result.source.aggregationExcludedRunCount = 1; }],
    ['run collection length mismatch', result => { result.source.selectedRunCount = 0; }],
    ['unknown aggregation schema', result => { result.aggregationSchemaVersion = '2.0.0'; }],
    ['missing aggregation schema', result => { delete result.aggregationSchemaVersion; }],
    ['invalid generatedAt', result => { result.generatedAt = 'not-a-timestamp'; }],
    ['missing runs collection', result => { delete result.runs; }],
    ['non-array runs collection', result => { result.runs = {}; }],
    ['empty run ID', result => { result.runs[0].runId = ''; }],
    ['invalid run timestamp', result => { result.runs[0].timestamp = '2026-02-30T00:00:00.000Z'; }],
    ['passed count exceeding total', result => { result.runs[0].passed = 11; }],
    ['status counts not summing to total', result => { result.runs[0].failed = 1; }],
    ['unsuccessful count contradiction', result => { result.runs[0].unsuccessful = 0; }],
    ['null pass rate with non-zero total', result => { result.runs[0].passRate = null; }],
    ['invalid optional average-run rate', result => { result.runs[0].averageRunPassRate = 101; }],
    ['numeric pass rate with zero total', result => {
        result.runs[0] = fakeRun('20260701-000000-000-aaaaaaaa', '2026-07-01T00:00:00.000Z', 0, 0);
        result.runs[0].passRate = 0;
    }]
]) {
    test(`source contract rejects ${name}`, async () => {
        const result = validMockRunResult();
        mutate(result);
        await expectSourceContractFailure(result);
    });
}

for (const [name, mutate] of [
    ['contradictory grouped weighted rate', result => { result.groups[0].rates.weightedPassRate = 5; }],
    ['group passed count exceeding tests', result => { result.groups[0].totals.passed = 11; }],
    ['group invalid average-run rate', result => { result.groups[0].rates.averageRunPassRate = 101; }],
    ['group reversed UTC boundaries', result => { result.groups[0].endExclusive = result.groups[0].start; }],
    ['group run-count total mismatch', result => { result.groups[0].runCount = 2; }],
    ['missing groups collection', result => { delete result.groups; }],
    ['non-array groups collection', result => { result.groups = {}; }]
]) {
    test(`source contract rejects ${name}`, async () => {
        const result = validMockGroupResult();
        mutate(result);
        await expectSourceContractFailure(result, { granularity: 'day' });
    });
}

class ForbiddenJsonClass {
    constructor() { this.value = 'class-instance'; }
}

const FORBIDDEN_JSON_FACTORIES = [
    ['function', () => ({ value: () => 'forbidden' })],
    ['BigInt', () => ({ value: 1n })],
    ['undefined', () => ({ value: undefined })],
    ['sparse array', () => {
        const value = new Array(2);
        value[1] = 'present';
        return { value };
    }],
    ['symbol', () => ({ value: Symbol('forbidden') })],
    ['Error', () => ({ value: new Error('forbidden') })],
    ['Date', () => ({ value: new Date(FIXED_NOW) })],
    ['Map', () => ({ value: new Map([['key', 'value']]) })],
    ['Set', () => ({ value: new Set(['value']) })],
    ['RegExp', () => ({ value: /forbidden/ })],
    ['typed array', () => ({ value: new Uint8Array([1, 2]) })],
    ['Promise', () => ({ value: Promise.resolve('forbidden') })],
    ['class instance', () => ({ value: new ForbiddenJsonClass() })],
    ['cyclic object', () => {
        const value = {};
        value.self = value;
        return { value };
    }],
    ['accessor property', () => {
        let reads = 0;
        const value = {};
        Object.defineProperty(value, 'secret', {
            enumerable: true,
            get() { reads += 1; return 'forbidden'; }
        });
        return { value, verify: () => expect(reads).toBe(0) };
    }]
];

async function expectForbiddenJsonValue(location, factory) {
    const created = factory();
    const value = created.value;
    let result;
    let carrier;
    let options = { granularity: 'run' };
    if (location === 'warning') {
        result = validMockRunResult();
        carrier = { bad: value };
        result.warnings = [warningWithDetails(carrier)];
    } else if (location === 'query') {
        result = validMockRunResult();
        carrier = result.query;
        carrier.bad = value;
    } else if (location === 'run') {
        result = validMockRunResult();
        carrier = { bad: value };
        result.runs[0].nestedContractProbe = carrier;
    } else {
        result = validMockGroupResult();
        carrier = { bad: value };
        result.groups[0].nestedContractProbe = carrier;
        options = { granularity: 'day' };
    }

    const fake = fakeAnalyzer(result);
    await expect(fake.analyzer.analyze(options)).rejects.toMatchObject({
        name: 'TypeError',
        code: 'HEYNA_PASS_RATE_TREND_SOURCE_CONTRACT'
    });
    expect(fake.calls).toEqual(location === 'group' ? { query: 0, group: 1 } : { query: 1, group: 0 });
    expect(Object.getOwnPropertyDescriptor(carrier, 'bad').value).toBe(value);
    if (created.verify) created.verify();
}

for (const [forbiddenName, factory] of FORBIDDEN_JSON_FACTORIES) {
    for (const location of ['warning', 'query', 'run', 'group']) {
        test(`strict JSON boundary rejects ${forbiddenName} in ${location} data`, async () => {
            await expectForbiddenJsonValue(location, factory);
        });
    }
}

test('strict warning validation rejects null and malformed warning entries', async () => {
    for (const warning of [
        null,
        { code: 'bad code', severity: 'warning', message: 'bad', details: {} },
        { code: 'HEYNA_TEST', severity: 'fatal', message: 'bad', details: {} },
        { code: 'HEYNA_TEST', severity: 'warning', message: 1, details: {} }
    ]) {
        const result = validMockRunResult();
        result.warnings = [warning];
        await expectSourceContractFailure(result);
    }
});

test('valid nested warning details are safely cloned, frozen, and prototype resistant', async () => {
    const details = Object.create(null);
    Object.defineProperty(details, '__proto__', {
        value: { polluted: true }, enumerable: true, configurable: true, writable: true
    });
    Object.defineProperty(details, 'constructor', {
        value: { safe: ['nested', { value: 1 }] }, enumerable: true, configurable: true, writable: true
    });
    Object.defineProperty(details, 'prototype', {
        value: { safe: true }, enumerable: true, configurable: true, writable: true
    });
    const upstream = validMockRunResult();
    upstream.warnings = [warningWithDetails(details)];
    const fake = fakeAnalyzer(upstream);
    const result = await fake.analyzer.analyze({ granularity: 'run' });
    const copied = result.warnings[0].details;

    expect(copied).not.toBe(details);
    expect(Object.prototype.hasOwnProperty.call(copied, '__proto__')).toBe(true);
    expect(copied.__proto__).toEqual({ polluted: true });
    expect(copied.constructor).toEqual({ safe: ['nested', { value: 1 }] });
    expect(copied.prototype).toEqual({ safe: true });
    expect(Object.prototype.polluted).toBeUndefined();
    expect(Object.isFrozen(copied)).toBe(true);
    expect(Object.isFrozen(copied.constructor.safe[1])).toBe(true);
    expect(Object.isFrozen(details)).toBe(false);
    expect(() => JSON.stringify(result)).not.toThrow();
});

test('analyzer source has no storage or filesystem dependency', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'utils', 'PassRateTrendAnalyzer.js'), 'utf8');
    expect(source).not.toMatch(/require\(['"](?:fs|path|\.\/HistoryManager|\.\/HistoricalMetricsValidation)['"]\)/);
    expect(source).not.toMatch(/history[\\/]runs|summary\.json|execution\.json/);
    expect(Object.getOwnPropertyNames(PassRateTrendAnalyzer.prototype).sort()).toEqual(['analyze', 'constructor']);
});
