const { test, expect } = require('@playwright/test');
const FailureTrendAnalyzer = require('../../utils/FailureTrendAnalyzer');
const { createFailureIdentity, createTestIdentity } = require('../../utils/FailureIdentity');
const { cloneJsonValue, safeAdd } = require('../../utils/FailureTrendValidation');
const { buildFailureIndex, validateFailureIndex } = require('../../utils/HistoricalFailureValidation');

const GENERATED_AT = '2026-08-03T00:00:00.000Z';

function outcome(testCase, status, options = {}) {
    const identity = createTestIdentity({ testCase, project: options.project || 'P' });
    return {
        testKey: identity.testKey,
        playwrightTestIdFingerprint: null,
        project: identity.project,
        file: null,
        suitePath: [],
        title: identity.title,
        line: null,
        repeatEachIndex: options.repeatEachIndex || 0,
        retryCount: options.retryCount || 0,
        status,
        traceAvailable: options.traceAvailable === true,
        identityQuality: 'degraded',
        failure: ['FAILED', 'TIMEDOUT', 'INTERRUPTED'].includes(status)
            ? createFailureIdentity({
                failureCategory: options.category || 'ASSERTION_FAILURE',
                errorMessage: options.message || 'expect(page).toHaveURL expected checkout',
                stack: options.stack || 'AssertionError\n at submit (tests/checkout.spec.js:10:2)'
            })
            : null
    };
}

function run(day, outcomes, options = {}) {
    const timestamp = `2026-07-${String(day).padStart(2, '0')}T00:00:00.000Z`;
    return {
        runId: `202607${String(day).padStart(2, '0')}-000000-000-${String(day).padStart(8, '0')}`,
        timestamp,
        project: options.project || 'P',
        totalTests: options.totalTests ?? outcomes.length,
        unsuccessfulTests: options.unsuccessfulTests ?? outcomes.filter(item => item.failure).length,
        migrated: options.migrated === true,
        detailStatus: options.detailStatus || 'indexed',
        testOutcomes: outcomes
    };
}

function compareOutcomeOrder(left, right) {
    if (left.project !== right.project) return left.project < right.project ? -1 : 1;
    if (left.testKey !== right.testKey) return left.testKey < right.testKey ? -1 : 1;
    return left.repeatEachIndex - right.repeatEachIndex;
}

function history(runs, options = {}) {
    runs = runs.map(item => ({
        ...item,
        testOutcomes: options.preserveOutcomeOrder
            ? item.testOutcomes.slice()
            : item.testOutcomes.slice().sort(compareOutcomeOrder)
    }));
    const indexedRunCount = runs.filter(item => item.detailStatus === 'indexed').length;
    const legacyNormalizedRunCount = runs.filter(item => item.detailStatus === 'legacy-normalized').length;
    const aggregateOnlyRunCount = runs.filter(item => ['aggregate-only', 'invalid-index'].includes(item.detailStatus)).length;
    const malformedFailureIndexRunCount = runs.filter(item => item.detailStatus === 'invalid-index').length;
    const detailed = runs.filter(item => ['indexed', 'legacy-normalized'].includes(item.detailStatus));
    const testOutcomeCount = detailed.reduce((sum, item) => sum + item.testOutcomes.length, 0);
    const failureObservationCount = detailed.reduce((sum, item) => sum + item.testOutcomes.filter(value => value.failure).length, 0);
    return {
        failureHistorySchemaVersion: '1.0.0',
        generatedAt: GENERATED_AT,
        query: { from: null, to: null, limit: null, project: null, includeMigrated: true },
        source: {
            discoveredRunCount: runs.length,
            validRunCount: runs.length,
            excludedRunCount: 0,
            matchedRunCount: runs.length,
            selectedRunCount: runs.length,
            indexedRunCount,
            legacyNormalizedRunCount,
            aggregateOnlyRunCount,
            malformedFailureIndexRunCount,
            zeroTestRunCount: runs.filter(item => item.totalTests === 0).length,
            testOutcomeCount,
            failureObservationCount
        },
        partial: options.partial === true,
        limited: options.limited === true,
        retentionBounded: options.retentionBounded === true,
        runs,
        warnings: options.warnings || []
    };
}

function executionFromOutcome(item) {
    return {
        testCase: item.title,
        project: item.project,
        testIdentity: {
            testKey: item.testKey,
            playwrightTestIdFingerprint: item.playwrightTestIdFingerprint,
            project: item.project,
            file: item.file,
            suitePath: item.suitePath.slice(),
            title: item.title,
            line: item.line,
            identityQuality: item.identityQuality
        },
        repeatEachIndex: item.repeatEachIndex,
        retryCount: item.retryCount,
        status: item.status,
        traceAvailable: item.traceAvailable,
        ...(item.failure ? {
            failureCategory: item.failure.category,
            failureIdentity: { ...item.failure }
        } : {})
    };
}

function analyzerFor(result, calls = { count: 0, options: null }) {
    const historicalFailureReader = {
        async read(options) { calls.count += 1; calls.options = options; return result; }
    };
    return { analyzer: new FailureTrendAnalyzer({ historicalFailureReader }), calls };
}

test('first occurrence is ranked but is not recurring under defaults', async () => {
    const result = await analyzerFor(history([run(1, [outcome('TC', 'FAILED')])])).analyzer.analyze();
    expect(result.summary).toMatchObject({ occurrenceCount: 1, failureGroupCount: 1, recurringFailureCount: 0 });
    expect(result.recurringFailures).toEqual([]);
    expect(result.mostCommonFailures).toHaveLength(1);
    expect(result.mostCommonFailures[0]).not.toHaveProperty('state');

    const admitted = await analyzerFor(history([run(1, [outcome('TC', 'FAILED')])])).analyzer.analyze({
        minimumOccurrences: 1, minimumAffectedRuns: 1
    });
    expect(admitted.recurringFailures[0].frequency).toMatchObject({
        runFrequencyPercent: 100, testFrequencyPercent: 100, recurrenceRatePercent: null
    });
});

test('consecutive recurrence is active with exact frequencies', async () => {
    const result = await analyzerFor(history([
        run(1, [outcome('TC', 'FAILED')]),
        run(2, [outcome('TC', 'FAILED')])
    ])).analyzer.analyze();
    expect(result.recurringFailures[0]).toMatchObject({
        occurrenceCount: 2, affectedRunCount: 2, eligibleRunCount: 2,
        state: 'active', pattern: 'consecutive', maximumConsecutiveRunCount: 2,
        frequency: { runFrequencyPercent: 100, testFrequencyPercent: 100, recurrenceRatePercent: 100 }
    });
});

test('known absence distinguishes reappeared and resolved failures', async () => {
    const reappeared = await analyzerFor(history([
        run(1, [outcome('TC', 'FAILED')]), run(2, [outcome('TC', 'PASSED')]), run(3, [outcome('TC', 'FAILED')])
    ])).analyzer.analyze();
    expect(reappeared.recurringFailures[0]).toMatchObject({ state: 'active', pattern: 'non-consecutive', reappeared: true });
    expect(reappeared.summary.reappearedFailureCount).toBe(1);

    const resolved = await analyzerFor(history([
        run(1, [outcome('TC', 'FAILED')]), run(2, [outcome('TC', 'FAILED')]), run(3, [outcome('TC', 'PASSED')])
    ])).analyzer.analyze();
    expect(resolved.recurringFailures[0]).toMatchObject({ state: 'resolved', pattern: 'consecutive' });
    const excluded = await analyzerFor(history([
        run(1, [outcome('TC', 'FAILED')]), run(2, [outcome('TC', 'FAILED')]), run(3, [outcome('TC', 'PASSED')])
    ])).analyzer.analyze({ includeResolved: false });
    expect(excluded.recurringFailures).toEqual([]);
});

test('only complete executable outcomes prove absence or resolution', async () => {
    for (const status of ['SKIPPED', 'INTERRUPTED']) {
        const result = await analyzerFor(history([
            run(1, [outcome('TC', 'FAILED')]),
            run(2, [outcome('TC', status)])
        ])).analyzer.analyze({ minimumOccurrences: 1, minimumAffectedRuns: 1 });
        expect(result.recurringFailures[0]).toMatchObject({
            eligibleRunCount: 1,
            eligibleTestExecutionCount: 1,
            state: 'indeterminate'
        });
    }

    const passed = await analyzerFor(history([
        run(1, [outcome('TC', 'FAILED')]),
        run(2, [outcome('TC', 'PASSED')])
    ])).analyzer.analyze({ minimumOccurrences: 1, minimumAffectedRuns: 1 });
    expect(passed.recurringFailures[0]).toMatchObject({ state: 'resolved', eligibleRunCount: 2 });

    for (const replacement of [
        outcome('TC', 'FAILED', { message: 'expect(value).toBe("signature B")' }),
        outcome('TC', 'TIMEDOUT', { category: 'TIMEOUT_FAILURE', message: 'Timeout 9000ms waiting for checkout' })
    ]) {
        const first = outcome('TC', 'FAILED', { message: 'expect(value).toBe("signature A")' });
        const result = await analyzerFor(history([run(1, [first]), run(2, [replacement])])).analyzer.analyze({
            minimumOccurrences: 1, minimumAffectedRuns: 1
        });
        const prior = result.recurringFailures.find(item => item.failure.signature === first.failure.signature);
        expect(prior).toMatchObject({ state: 'resolved', eligibleRunCount: 2 });
    }

    for (const gap of [
        run(2, [], { detailStatus: 'aggregate-only', totalTests: 1, unsuccessfulTests: 1 }),
        run(2, [], { detailStatus: 'invalid-index', totalTests: 1, unsuccessfulTests: 1 })
    ]) {
        const result = await analyzerFor(history([
            run(1, [outcome('TC', 'FAILED')]), gap, run(3, [outcome('TC', 'PASSED')])
        ], { partial: true })).analyzer.analyze({ minimumOccurrences: 1, minimumAffectedRuns: 1 });
        expect(result.recurringFailures[0].state).toBe('indeterminate');
    }

    const trailingUnknown = await analyzerFor(history([
        run(1, [outcome('TC', 'FAILED')]),
        run(2, [outcome('TC', 'FAILED')]),
        run(3, [outcome('TC', 'SKIPPED')])
    ])).analyzer.analyze();
    expect(trailingUnknown.recurringFailures[0]).toMatchObject({ state: 'indeterminate', pattern: 'consecutive' });
});

test('aggregate-only and malformed gaps make state indeterminate without becoming zero failures', async () => {
    for (const detailStatus of ['aggregate-only', 'invalid-index']) {
        const gap = run(2, [], { detailStatus, totalTests: 1, unsuccessfulTests: 1 });
        const result = await analyzerFor(history([
            run(1, [outcome('TC', 'FAILED')]), gap, run(3, [outcome('TC', 'FAILED')])
        ], { partial: true })).analyzer.analyze();
        expect(result.recurringFailures[0]).toMatchObject({ state: 'indeterminate', pattern: 'indeterminate' });
        expect(result.summary.partial).toBe(true);
        expect(result.timeline[1]).toMatchObject({ detailStatus, totalTests: 1, unsuccessfulTests: 1 });
    }
});

test('retries collapse while repeatEach outcomes remain distinct', async () => {
    const repeatedRun = run(1, [
        outcome('TC', 'FAILED', { retryCount: 3, repeatEachIndex: 0 }),
        outcome('TC', 'FAILED', { retryCount: 1, repeatEachIndex: 1 })
    ]);
    const result = await analyzerFor(history([repeatedRun])).analyzer.analyze({ minimumAffectedRuns: 1 });
    expect(result.summary.occurrenceCount).toBe(2);
    expect(result.recurringFailures[0]).toMatchObject({ occurrenceCount: 2, affectedRunCount: 1, eligibleTestExecutionCount: 2 });
    expect(result.recurringFailures[0].occurrences.map(item => item.retryCount)).toEqual([3, 1]);
    expect((await analyzerFor(history([repeatedRun])).analyzer.analyze()).recurringFailures).toEqual([]);
});

test('known opportunities produce exact two-decimal rates without negative zero', async () => {
    const result = await analyzerFor(history([
        run(1, [outcome('TC', 'FAILED')]),
        run(2, [outcome('TC', 'PASSED')]),
        run(3, [outcome('TC', 'PASSED')])
    ])).analyzer.analyze({ minimumOccurrences: 1, minimumAffectedRuns: 1 });
    expect(result.recurringFailures[0].frequency).toEqual({
        runFrequencyPercent: 33.33,
        testFrequencyPercent: 33.33,
        recurrenceRatePercent: 0
    });
    expect(Object.is(result.recurringFailures[0].frequency.recurrenceRatePercent, -0)).toBe(false);
});

test('same signature across tests is test-specific for recurrence and aggregated for ranking', async () => {
    const first = outcome('A', 'FAILED');
    const second = outcome('B', 'FAILED');
    const result = await analyzerFor(history([
        run(1, [first, second]),
        run(2, [outcome('A', 'FAILED'), outcome('B', 'FAILED')])
    ])).analyzer.analyze();
    expect(result.recurringFailures).toHaveLength(2);
    expect(new Set(result.recurringFailures.map(item => item.test.testKey)).size).toBe(2);
    expect(result.mostCommonFailures[0]).toMatchObject({ occurrenceCount: 4, affectedRunCount: 2, affectedTestCount: 2 });
    expect(result.mostCommonFailures[0]).not.toHaveProperty('active');
});

test('different signatures, categories, projects, filters, and thresholds stay separate', async () => {
    const runs = [
        run(1, [outcome('TC', 'FAILED', { project: 'A', message: 'expect(page).toHaveURL expected x' })]),
        run(2, [outcome('TC', 'FAILED', { project: 'A', category: 'TIMEOUT_FAILURE', message: 'Timeout 5000ms exceeded' })]),
        run(3, [outcome('TC', 'FAILED', { project: 'B', message: 'expect(page).toHaveURL expected x' })], { project: 'B' })
    ];
    const result = await analyzerFor(history(runs)).analyzer.analyze({ minimumOccurrences: 1, minimumAffectedRuns: 1 });
    expect(result.summary.failureGroupCount).toBe(3);
    const onlyTimeout = await analyzerFor(history(runs)).analyzer.analyze({
        category: 'TIMEOUT_FAILURE', minimumOccurrences: 1, minimumAffectedRuns: 1
    });
    expect(onlyTimeout.summary).toMatchObject({ occurrenceCount: 1, failureGroupCount: 1 });
});

test('options validate before exactly one reader call and are normalized', async () => {
    const fake = analyzerFor(history([]));
    await expect(fake.analyzer.analyze({ minimumOccurrences: 0 })).rejects.toMatchObject({ code: 'HEYNA_FAILURE_TREND_INVALID_OPTION' });
    expect(fake.calls.count).toBe(0);
    await fake.analyzer.analyze({ from: '2026-07-01T00:00:00Z', project: 'P', limit: 1 });
    expect(fake.calls.count).toBe(1);
    expect(fake.calls.options).toEqual({
        from: '2026-07-01T00:00:00.000Z', to: null, limit: 1,
        project: ['P'], includeMigrated: true
    });
});

test('results are fresh, deeply frozen, deterministic, and prototype-safe', async () => {
    const special = outcome('__proto__', 'FAILED', { project: 'constructor' });
    Object.assign(special, {
        file: 'tests/prototype.spec.js', suitePath: ['constructor', 'prototype'],
        title: '__proto__', identityQuality: 'strong'
    });
    const source = history([run(1, [special], { project: 'constructor' })]);
    const fake = analyzerFor(source);
    const first = await fake.analyzer.analyze({ minimumOccurrences: 1, minimumAffectedRuns: 1 });
    const second = await fake.analyzer.analyze({ minimumOccurrences: 1, minimumAffectedRuns: 1 });
    expect(first).not.toBe(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(Object.isFrozen(first.recurringFailures[0].occurrences)).toBe(true);
    expect(first.recurringFailures[0].test.title).toBe('__proto__');
    expect({}.polluted).toBeUndefined();
    const serialized = JSON.stringify(first);
    expect(serialized).not.toMatch(/https?:\/\//);
    expect(serialized).not.toMatch(/[A-Za-z]:\\|\/(?:tmp|home|users?)\//i);
    expect(serialized).not.toContain(' at submit ');
});

test('warning catalog reconstructs messages and rejects malformed diagnostics', async () => {
    const sensitiveMessages = [
        'C:\\Users\\secret\\failure-index.json',
        '/home/secret/failure-index.json',
        'https://user:password@example.test/path?token=secret',
        'EPERM: operation not permitted, unlink private path',
        new Error('private stack value').stack
    ];
    for (const message of sensitiveMessages) {
        const source = history([], { warnings: [{
            code: 'HEYNA_FAILURE_HISTORY_RETENTION_WINDOW',
            severity: 'warning', message, runId: null, field: null, details: {}
        }] });
        const result = await analyzerFor(source).analyzer.analyze();
        expect(result.warnings[0].message).toBe('Failure analysis is limited to the currently retained history window.');
        expect(JSON.stringify(result)).not.toContain(message);
    }

    const malformed = [
        { code: 'HEYNA_UNKNOWN_WARNING', severity: 'warning', message: 'x', runId: null, field: null, details: {} },
        { code: 'HEYNA_FAILURE_HISTORY_RETENTION_WINDOW', severity: 'error', message: 'x', runId: null, field: null, details: {} },
        { code: 'HEYNA_FAILURE_HISTORY_RETENTION_WINDOW', severity: 'warning', message: 'x', runId: null, field: null, details: { path: 'secret' } }
    ];
    for (const item of malformed) {
        await expect(analyzerFor(history([], { warnings: [item] })).analyzer.analyze())
            .rejects.toMatchObject({ code: 'HEYNA_FAILURE_TREND_SOURCE_CONTRACT' });
    }
});

test('passive JSON boundary rejects exotic data without executing accessors', async () => {
    let getterCalls = 0;
    const getterSource = history([]);
    Object.defineProperty(getterSource.source, 'validRunCount', {
        enumerable: true,
        get() { getterCalls += 1; return 0; }
    });
    await expect(analyzerFor(getterSource).analyzer.analyze()).rejects.toMatchObject({ code: 'HEYNA_FAILURE_TREND_SOURCE_CONTRACT' });
    expect(getterCalls).toBe(0);

    const invalidValues = [];
    const sparse = history([]); sparse.runs = new Array(1); invalidValues.push(sparse);
    const undefinedElement = history([]); undefinedElement.runs = [undefined]; invalidValues.push(undefinedElement);
    class Runs extends Array {} const subclass = history([]); subclass.runs = new Runs(); invalidValues.push(subclass);
    const arraySymbol = history([]); arraySymbol.runs[Symbol('private')] = 'x'; invalidValues.push(arraySymbol);
    const arrayHidden = history([]); Object.defineProperty(arrayHidden.runs, 'hidden', { value: 'x' }); invalidValues.push(arrayHidden);
    const objectSymbol = history([]); objectSymbol.source[Symbol('private')] = 'x'; invalidValues.push(objectSymbol);
    const hidden = history([]); Object.defineProperty(hidden.source, 'hidden', { value: 'x' }); invalidValues.push(hidden);
    const cyclicArray = history([]); cyclicArray.runs.push(cyclicArray.runs); invalidValues.push(cyclicArray);
    const cyclicObject = history([]); cyclicObject.source.self = cyclicObject.source; invalidValues.push(cyclicObject);
    const setter = history([]); Object.defineProperty(setter.source, 'extra', { enumerable: true, set() {} }); invalidValues.push(setter);
    const ownKeysProxy = history([]); ownKeysProxy.source = new Proxy({}, { ownKeys() { throw new Error('private ownKeys'); } }); invalidValues.push(ownKeysProxy);
    const descriptorProxy = history([]); descriptorProxy.source = new Proxy({}, { ownKeys() { return ['x']; }, getOwnPropertyDescriptor() { throw new Error('private descriptor'); } }); invalidValues.push(descriptorProxy);
    class PrivateValue {}
    for (const forbidden of [
        undefined, () => {}, 1n, Symbol('private'), NaN, Infinity, -Infinity, -0,
        new Error('private'), new Date(), new Map(), new Set(), /private/, new Uint8Array([1]),
        Promise.resolve('private'), new PrivateValue()
    ]) {
        const source = history([]);
        source.source.extra = forbidden;
        invalidValues.push(source);
    }
    for (const value of invalidValues) {
        await expect(analyzerFor(value).analyzer.analyze()).rejects.toMatchObject({ code: 'HEYNA_FAILURE_TREND_SOURCE_CONTRACT' });
    }

    const nullPrototype = history([]);
    nullPrototype.query = Object.assign(Object.create(null), nullPrototype.query);
    nullPrototype.source = Object.assign(Object.create(null), nullPrototype.source);
    await expect(analyzerFor(nullPrototype).analyzer.analyze()).resolves.toMatchObject({ summary: { occurrenceCount: 0 } });
    expect({}.polluted).toBeUndefined();
    expect(() => cloneJsonValue({ __proto__: null, constructor: 'safe', prototype: 'safe' })).not.toThrow();
});

test('ranking uses last-seen then code-point key tie breakers deterministically', async () => {
    const lastSeen = await analyzerFor(history([
        run(1, [outcome('A', 'FAILED', { message: 'expect(x).toHaveURL first' })]),
        run(2, [outcome('B', 'FAILED', { message: 'Timeout 5000ms exceeded', category: 'TIMEOUT_FAILURE' })])
    ])).analyzer.analyze({ minimumOccurrences: 1, minimumAffectedRuns: 1 });
    expect(lastSeen.mostCommonFailures[0].lastSeen).toBe('2026-07-02T00:00:00.000Z');

    const tied = await analyzerFor(history([run(1, [
        outcome('A', 'FAILED', { message: 'expect(x).toHaveURL first' }),
        outcome('B', 'FAILED', { message: 'Timeout 5000ms exceeded', category: 'TIMEOUT_FAILURE' })
    ])])).analyzer.analyze({ minimumOccurrences: 1, minimumAffectedRuns: 1 });
    const keys = tied.mostCommonFailures.map(item => item.key);
    expect(keys).toEqual(keys.slice().sort());
});

test('retention-bounded results propagate warnings and keep recurrence state indeterminate', async () => {
    const retained = history([
        run(1, [outcome('TC', 'FAILED')]), run(2, [outcome('TC', 'FAILED')])
    ], {
        partial: true,
        retentionBounded: true,
        warnings: [{
            code: 'HEYNA_FAILURE_HISTORY_RETENTION_WINDOW', severity: 'warning',
            message: 'Failure analysis is limited to the currently retained history window.',
            runId: null, field: null, details: {}
        }]
    });
    const result = await analyzerFor(retained).analyzer.analyze();
    expect(result.recurringFailures[0]).toMatchObject({ state: 'indeterminate', pattern: 'indeterminate' });
    expect(result.warnings.map(item => item.code)).toContain('HEYNA_FAILURE_HISTORY_RETENTION_WINDOW');
});

test('zero failures and zero-test runs return null-safe empty metrics', async () => {
    const result = await analyzerFor(history([run(1, [], { totalTests: 0, unsuccessfulTests: 0 })])).analyzer.analyze();
    expect(result.summary).toMatchObject({ occurrenceCount: 0, recurringFailureCount: 0, mostCommonFailureKey: null });
    expect(result.timeline[0]).toMatchObject({ totalTests: 0, failureObservationCount: 0 });
});

test('strict source contract and upstream errors fail without partial results', async () => {
    const invalid = history([run(1, [outcome('TC', 'FAILED')])]);
    invalid.source.failureObservationCount = 2;
    await expect(analyzerFor(invalid).analyzer.analyze()).rejects.toMatchObject({ code: 'HEYNA_FAILURE_TREND_SOURCE_CONTRACT' });
    const unsafeWarning = history([]);
    unsafeWarning.warnings.push({
        code: 'HEYNA_FAILURE_HISTORY_INVALID_INDEX', severity: 'warning', message: 'unsafe',
        runId: null, field: null, details: { path: 'C:\\private\\index.json' }
    });
    await expect(analyzerFor(unsafeWarning).analyzer.analyze()).rejects.toMatchObject({ code: 'HEYNA_FAILURE_TREND_SOURCE_CONTRACT' });
    expect(() => safeAdd(Number.MAX_SAFE_INTEGER, 1, 'injected overflow')).toThrow(expect.objectContaining({ code: 'HEYNA_FAILURE_TREND_NUMERIC_RANGE' }));
    const expected = new Error('upstream failed');
    const analyzer = new FailureTrendAnalyzer({ historicalFailureReader: { async read() { throw expected; } } });
    await expect(analyzer.analyze()).rejects.toBe(expected);
});

test('5,000-run analysis is deterministic with one reader call and no pairwise dependency calls', async () => {
    const runs = Array.from({ length: 5000 }, (_, index) => {
        const day = index + 1;
        const date = new Date(Date.UTC(2020, 0, day));
        const timestamp = date.toISOString();
        const testOutcome = outcome('TC_Performance', 'FAILED');
        return {
            runId: `${timestamp.slice(0, 10).replace(/-/g, '')}-000000-000-${index.toString(16).padStart(8, '0')}`,
            timestamp,
            project: 'P', totalTests: 1, unsuccessfulTests: 1, migrated: false,
            detailStatus: 'indexed', testOutcomes: [testOutcome]
        };
    });
    const fake = analyzerFor(history(runs));
    const result = await fake.analyzer.analyze();
    expect(fake.calls.count).toBe(1);
    expect(result.recurringFailures[0]).toMatchObject({ occurrenceCount: 5000, affectedRunCount: 5000 });
    expect(result.timeline).toHaveLength(5000);
});

test('high-cardinality analysis visits runs, outcomes, groups, and timeline keys linearly', async () => {
    const runCount = 1200;
    const outcomesPerRun = 5;
    const runs = Array.from({ length: runCount }, (_, runIndex) => {
        const timestamp = new Date(Date.UTC(2021, 0, runIndex + 1)).toISOString();
        const values = Array.from({ length: outcomesPerRun }, (_, testIndex) => outcome(
            `TC_${testIndex}`,
            'FAILED',
            { message: `expect(value).toBe("run-${runIndex}-test-${testIndex}")` }
        ));
        return {
            runId: `${timestamp.slice(0, 10).replace(/-/g, '')}-000000-000-${runIndex.toString(16).padStart(8, '0')}`,
            timestamp, project: 'P', totalTests: values.length, unsuccessfulTests: values.length,
            migrated: false, detailStatus: 'indexed', testOutcomes: values
        };
    });
    let observed;
    const reader = { async read() { return history(runs); } };
    const analyzer = new FailureTrendAnalyzer({ historicalFailureReader: reader, operationObserver(value) { observed = value; } });
    const first = await analyzer.analyze();
    const second = await analyzer.analyze();
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(observed).toEqual({
        runVisits: runCount,
        outcomeVisits: runCount * outcomesPerRun,
        occurrenceVisits: runCount * outcomesPerRun,
        occurrenceOrderChecks: runCount * outcomesPerRun,
        positionOrderChecks: runCount * outcomesPerRun * 2,
        completenessPrefixBuildVisits: runCount,
        opportunityCompletenessBuildVisits: runCount * outcomesPerRun,
        completenessRangeChecks: first.summary.failureGroupCount + runCount * outcomesPerRun,
        streakOccurrenceVisits: runCount * outcomesPerRun,
        groupVisits: first.summary.failureGroupCount,
        timelineKeyVisits: runCount * outcomesPerRun
    });
    expect(observed.groupVisits).toBeGreaterThan(4000);
});

test('canonical source ordering is enforced before linear occurrence processing', async () => {
    const privateProject = 'private-noncanonical-project';
    const source = history([run(1, [
        outcome('TC_Canonical_A', 'FAILED', { project: privateProject }),
        outcome('TC_Canonical_B', 'FAILED', { project: privateProject })
    ])]);
    source.runs[0].testOutcomes.reverse();
    const before = JSON.stringify(source);
    const calls = { count: 0 };
    let observerCalled = false;
    let result;
    let thrown;
    const analyzer = new FailureTrendAnalyzer({
        historicalFailureReader: { async read() { calls.count += 1; return source; } },
        operationObserver() { observerCalled = true; }
    });
    try { result = await analyzer.analyze(); } catch (error) { thrown = error; }
    expect(result).toBeUndefined();
    expect(thrown).toMatchObject({ code: 'HEYNA_FAILURE_TREND_SOURCE_CONTRACT' });
    expect(thrown.message).toContain('invalid finalized outcomes');
    expect(thrown.message).not.toContain(privateProject);
    for (const item of source.runs[0].testOutcomes) expect(thrown.message).not.toContain(item.testKey);
    expect(calls.count).toBe(1);
    expect(observerCalled).toBe(false);
    expect(JSON.stringify(source)).toBe(before);
});

test('all-runs recurrence uses constant-time completeness queries at growing input sizes', async () => {
    for (const runCount of [100, 500, 1000, 2000]) {
        const runs = Array.from({ length: runCount }, (_, runIndex) => {
            const timestamp = new Date(Date.UTC(2020, 0, runIndex + 1)).toISOString();
            return {
                runId: `${timestamp.slice(0, 10).replace(/-/g, '')}-000000-000-${runIndex.toString(16).padStart(8, '0')}`,
                timestamp,
                project: 'P',
                totalTests: 1,
                unsuccessfulTests: 1,
                migrated: false,
                detailStatus: 'indexed',
                testOutcomes: [outcome('TC_Constant_Completeness', 'FAILED')]
            };
        });
        const analyses = [];
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const calls = { count: 0 };
            let operations;
            const analyzer = new FailureTrendAnalyzer({
                historicalFailureReader: {
                    async read() { calls.count += 1; return history(runs); }
                },
                operationObserver(value) { operations = value; }
            });
            const result = await analyzer.analyze();
            expect(calls.count).toBe(1);
            expect(result.recurringFailures[0]).toMatchObject({
                occurrenceCount: runCount,
                affectedRunCount: runCount,
                state: 'active',
                pattern: 'consecutive',
                reappeared: false,
                currentConsecutiveRunCount: runCount,
                maximumConsecutiveRunCount: runCount
            });
            expect(operations).toMatchObject({
                completenessPrefixBuildVisits: runCount,
                opportunityCompletenessBuildVisits: runCount,
                completenessRangeChecks: runCount + 1,
                streakOccurrenceVisits: runCount
            });
            expect(operations.completenessPrefixBuildVisits).toBeLessThanOrEqual(result.source.selectedRunCount);
            expect(operations.streakOccurrenceVisits).toBeLessThanOrEqual(result.summary.occurrenceCount);
            expect(operations.completenessRangeChecks).toBeLessThanOrEqual(operations.streakOccurrenceVisits + 2);
            expect(Object.keys(operations).some(key => /binary|lowerBound|upperBound/i.test(key))).toBe(false);
            expect(operations.completenessPrefixBuildVisits
                + operations.opportunityCompletenessBuildVisits
                + operations.completenessRangeChecks
                + operations.streakOccurrenceVisits).toBe(runCount * 4 + 1);
            analyses.push({ result, operations });
        }
        expect(JSON.stringify(analyses[0])).toBe(JSON.stringify(analyses[1]));
    }
});

test('adversarial high-cardinality repeats are canonicalized by index construction and analyze deterministically', async () => {
    const runCount = 120;
    const identityCount = 12;
    const repeatCount = 6;
    const buildRuns = variant => Array.from({ length: runCount }, (_, runIndex) => {
        const timestamp = new Date(Date.UTC(2022, 0, runIndex + 1)).toISOString();
        const execution = [];
        if (variant === 'reverse') {
            for (let identityIndex = identityCount - 1; identityIndex >= 0; identityIndex -= 1) {
                for (let repeatEachIndex = repeatCount - 1; repeatEachIndex >= 0; repeatEachIndex -= 1) {
                    execution.push(executionFromOutcome(outcome(`TC_Adversarial_${identityIndex}`, 'FAILED', {
                        repeatEachIndex,
                        message: 'expect(value).toBe(expected)'
                    })));
                }
            }
        } else {
            for (let repeatEachIndex = 0; repeatEachIndex < repeatCount; repeatEachIndex += 1) {
                for (let identityIndex = 0; identityIndex < identityCount; identityIndex += 1) {
                    execution.push(executionFromOutcome(outcome(`TC_Adversarial_${identityIndex}`, 'FAILED', {
                        repeatEachIndex,
                        message: 'expect(value).toBe(expected)'
                    })));
                }
            }
        }
        const runId = `${timestamp.slice(0, 10).replace(/-/g, '')}-000000-000-${runIndex.toString(16).padStart(8, '0')}`;
        const index = buildFailureIndex({ execution, metadata: { project: 'P' }, runId, timestamp });
        validateFailureIndex(index, { expectedRunId: runId, expectedTimestamp: timestamp });
        return {
            runId,
            timestamp,
            project: 'P',
            totalTests: index.testOutcomes.length,
            unsuccessfulTests: index.testOutcomes.length,
            migrated: false,
            detailStatus: 'indexed',
            testOutcomes: index.testOutcomes
        };
    });
    const sources = [
        history(buildRuns('reverse'), { preserveOutcomeOrder: true }),
        history(buildRuns('interleaved'), { preserveOutcomeOrder: true })
    ];
    const originalSort = Array.prototype.sort;
    const sortLengths = [];
    Array.prototype.sort = function observedSort(...arguments_) {
        sortLengths.push(this.length);
        return Reflect.apply(originalSort, this, arguments_);
    };
    const analyses = [];
    try {
        for (const source of sources) {
            const calls = { count: 0 };
            let operations;
            const analyzer = new FailureTrendAnalyzer({
                historicalFailureReader: { async read() { calls.count += 1; return source; } },
                operationObserver(value) { operations = value; }
            });
            const result = await analyzer.analyze();
            analyses.push({ result, operations });
            expect(calls.count).toBe(1);
        }
    } finally {
        Array.prototype.sort = originalSort;
    }
    const occurrenceCount = runCount * identityCount * repeatCount;
    expect(JSON.stringify(analyses[0])).toBe(JSON.stringify(analyses[1]));
    const { result, operations } = analyses[0];
    expect(result.summary).toMatchObject({ occurrenceCount, failureGroupCount: identityCount });
    expect(result.recurringFailures).toHaveLength(identityCount);
    expect(new Set(result.recurringFailures.map(group => group.test.testKey)).size).toBe(identityCount);
    for (const group of result.recurringFailures) {
        expect(group).toMatchObject({ occurrenceCount: runCount * repeatCount, affectedRunCount: runCount });
        expect(new Set(group.occurrences.map(item => item.repeatEachIndex))).toEqual(new Set([0, 1, 2, 3, 4, 5]));
        for (let repeatEachIndex = 0; repeatEachIndex < repeatCount; repeatEachIndex += 1) {
            expect(group.occurrences.filter(item => item.repeatEachIndex === repeatEachIndex)).toHaveLength(runCount);
        }
    }
    expect(result.mostCommonFailures).toHaveLength(1);
    expect(result.mostCommonFailures[0]).toMatchObject({
        occurrenceCount,
        affectedRunCount: runCount,
        affectedTestCount: identityCount
    });
    expect(result.timeline).toHaveLength(runCount);
    expect(result.timeline.every(item => item.failureObservationCount === identityCount * repeatCount
        && item.recurringFailureKeys.length === identityCount)).toBe(true);
    expect(operations).toEqual({
        runVisits: runCount,
        outcomeVisits: occurrenceCount,
        occurrenceVisits: occurrenceCount,
        occurrenceOrderChecks: occurrenceCount,
        positionOrderChecks: occurrenceCount * 2,
        completenessPrefixBuildVisits: runCount,
        opportunityCompletenessBuildVisits: runCount * identityCount,
        completenessRangeChecks: identityCount * 2 + identityCount * (runCount - 1),
        streakOccurrenceVisits: runCount * identityCount,
        groupVisits: identityCount,
        timelineKeyVisits: runCount * identityCount
    });
    expect(Math.max(0, ...sortLengths)).toBeLessThan(runCount);
    expect(sortLengths).not.toContain(occurrenceCount);
});
