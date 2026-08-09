const { test, expect } = require('@playwright/test');
const {
    classifyFlakyAttemptHistory,
    extractPersistedAttemptHistory,
    validatePersistedAttemptHistory
} = require('../../utils/FlakyAttemptHistory');
const { buildFailureIndex, validateFailureIndex } = require('../../utils/HistoricalFailureValidation');

function history(statuses) {
    return {
        finalStatus: statuses[statuses.length - 1],
        retryCount: statuses.length - 1,
        attempts: statuses.map((status, retry) => ({ retry, status }))
    };
}

test('approved flaky sequences classify known true', () => {
    for (const statuses of [
        ['FAILED', 'PASSED'],
        ['TIMEDOUT', 'PASSED'],
        ['FAILED', 'TIMEDOUT', 'PASSED'],
        ['FAILED', 'FAILED', 'PASSED']
    ]) {
        expect(classifyFlakyAttemptHistory(history(statuses))).toEqual({
            flakyEligibility: 'known', flaky: true, reasonCode: null
        });
    }
});

test('complete non-flaky sequences classify known false', () => {
    for (const statuses of [
        ['PASSED'], ['FAILED'], ['TIMEDOUT'], ['INTERRUPTED'], ['SKIPPED'],
        ['FAILED', 'FAILED'], ['TIMEDOUT', 'TIMEDOUT'], ['FAILED', 'TIMEDOUT'],
        ['PASSED', 'PASSED'], ['INTERRUPTED', 'PASSED'], ['SKIPPED', 'PASSED']
    ]) {
        expect(classifyFlakyAttemptHistory(history(statuses))).toEqual({
            flakyEligibility: 'known', flaky: false, reasonCode: null
        });
    }
});

test('unpersisted history remains unknown regardless of retryCount', () => {
    for (const retryCount of [0, 1, 99]) {
        expect(classifyFlakyAttemptHistory({ finalStatus: 'PASSED', retryCount, attempts: null })).toEqual({
            flakyEligibility: 'unknown', flaky: null, reasonCode: 'ATTEMPT_HISTORY_NOT_PERSISTED'
        });
        expect(classifyFlakyAttemptHistory({ finalStatus: 'PASSED', retryCount })).toEqual({
            flakyEligibility: 'unknown', flaky: null, reasonCode: 'ATTEMPT_HISTORY_NOT_PERSISTED'
        });
    }
});

test('failure-index v2 requires attempts while the unchanged v1 contract remains readable', () => {
    const value = buildFailureIndex({
        runId: '20260808-000000-000-aaaaaaaa',
        timestamp: '2026-08-08T00:00:00.000Z',
        metadata: { project: 'P' },
        execution: [{
            testCase: 'TC', status: 'PASSED', retryCount: 1,
            attempts: [{ retry: 0, status: 'FAILED' }, { retry: 1, status: 'PASSED' }]
        }]
    });
    expect(value.failureIndexSchemaVersion).toBe('2.0.0');
    const missing = {
        ...value,
        testOutcomes: value.testOutcomes.map(({ attempts, ...outcome }) => outcome)
    };
    expect(() => validateFailureIndex(missing)).toThrow(/unsupported fields/);
    const v1 = { ...missing, failureIndexSchemaVersion: '1.0.0' };
    expect(() => validateFailureIndex(v1)).not.toThrow();
});

test('complete attempt validation rejects malformed ordering, retries, and final state', () => {
    const invalid = [
        { finalStatus: 'PASSED', retryCount: 0, attempts: [] },
        { finalStatus: 'PASSED', retryCount: 1, attempts: [{ retry: 0, status: 'FAILED' }, { retry: 0, status: 'PASSED' }] },
        { finalStatus: 'PASSED', retryCount: 1, attempts: [{ retry: 1, status: 'FAILED' }, { retry: 0, status: 'PASSED' }] },
        { finalStatus: 'PASSED', retryCount: 2, attempts: [{ retry: 0, status: 'FAILED' }, { retry: 2, status: 'PASSED' }] },
        { finalStatus: 'PASSED', retryCount: 1, attempts: [{ retry: -1, status: 'FAILED' }, { retry: 1, status: 'PASSED' }] },
        { finalStatus: 'PASSED', retryCount: 1, attempts: [{ retry: -0, status: 'FAILED' }, { retry: 1, status: 'PASSED' }] },
        { finalStatus: 'PASSED', retryCount: 1, attempts: [{ retry: Number.MAX_SAFE_INTEGER + 1, status: 'FAILED' }, { retry: 1, status: 'PASSED' }] },
        { finalStatus: 'PASSED', retryCount: 1, attempts: [{ retry: '0', status: 'FAILED' }, { retry: 1, status: 'PASSED' }] },
        { finalStatus: 'PASSED', retryCount: 2, attempts: [{ retry: 0, status: 'FAILED' }, { retry: 1, status: 'PASSED' }] },
        { finalStatus: 'PASSED', retryCount: 1, attempts: [{ retry: 0, status: 'FAILED' }, { retry: 1, status: 'FAILED' }] },
        { finalStatus: 'PASSED', retryCount: 0, attempts: [{ retry: 0, status: 'UNKNOWN' }] },
        { finalStatus: 'PASSED', retryCount: 0, attempts: [null] },
        { finalStatus: 'PASSED', retryCount: 0, attempts: [[0, 'PASSED']] },
        { finalStatus: 'PASSED', retryCount: NaN, attempts: [{ retry: 0, status: 'PASSED' }] },
        { finalStatus: 'PASSED', retryCount: Infinity, attempts: [{ retry: 0, status: 'PASSED' }] }
    ];
    const sparse = new Array(1);
    invalid.push({ finalStatus: 'PASSED', retryCount: 0, attempts: sparse });
    for (const value of invalid) expect(() => validatePersistedAttemptHistory(value)).toThrow(TypeError);
});

test('persisted attempt validation rejects accessors, executable values, symbols, and exotic objects passively', () => {
    let getterCalls = 0;
    const accessor = { status: 'PASSED' };
    Object.defineProperty(accessor, 'retry', {
        enumerable: true,
        get() { getterCalls += 1; return 0; }
    });
    const custom = Object.assign(Object.create({ inherited: true }), { retry: 0, status: 'PASSED' });
    const symbol = { retry: 0, status: 'PASSED' };
    symbol[Symbol('private')] = true;
    const cycle = { retry: 0, status: 'PASSED' };
    cycle.self = cycle;
    for (const attempt of [
        accessor,
        { retry: 0, status: () => 'PASSED' },
        symbol,
        new Date(),
        new Map(),
        new Set(),
        custom,
        cycle,
        { retry: NaN, status: 'PASSED' },
        { retry: Infinity, status: 'PASSED' }
    ]) {
        expect(() => validatePersistedAttemptHistory({
            finalStatus: 'PASSED', retryCount: 0, attempts: [attempt]
        })).toThrow(TypeError);
    }
    expect(getterCalls).toBe(0);
});

test('public attempt helpers reject top-level accessors without executing them', () => {
    for (const field of ['attempts', 'retryCount', 'finalStatus']) {
        let getterCalls = 0;
        const input = history(['PASSED']);
        Object.defineProperty(input, field, {
            enumerable: true,
            configurable: true,
            get() {
                getterCalls += 1;
                throw new Error(`executed ${field} getter`);
            }
        });
        expect(() => validatePersistedAttemptHistory(input)).toThrow(TypeError);
        expect(() => classifyFlakyAttemptHistory(input)).toThrow(TypeError);
        expect(getterCalls).toBe(0);
    }
});

test('public attempt helpers reject combined throwing getters without executing any getter', () => {
    const getterCalls = { attempts: 0, retryCount: 0, finalStatus: 0 };
    const input = {};
    for (const field of Object.keys(getterCalls)) {
        Object.defineProperty(input, field, {
            enumerable: true,
            get() {
                getterCalls[field] += 1;
                throw new Error(`executed ${field} getter`);
            }
        });
    }
    expect(() => validatePersistedAttemptHistory(input)).toThrow(TypeError);
    expect(() => classifyFlakyAttemptHistory(input)).toThrow(TypeError);
    expect(getterCalls).toEqual({ attempts: 0, retryCount: 0, finalStatus: 0 });
});

test('reporter-shaped source attempts are passively allowlisted without mutation or privacy leakage', () => {
    let extraGetterCalls = 0;
    const attempts = [
        {
            retry: 0,
            status: 'FAILED',
            error: 'private error',
            stack: 'C:\\Users\\private\\test.spec.js',
            path: '/home/private/test.spec.js',
            url: 'https://secret.example/token',
            artifactPath: 'C:\\artifacts\\failure.png',
            tracePath: '/tmp/private/trace.zip',
            cwd: 'C:\\private repo',
            metadata: { token: 'secret' },
            payload: { password: 'secret' }
        },
        { retry: 1, status: 'PASSED', duration: 10, steps: [] }
    ];
    Object.defineProperty(attempts[0], 'ignoredAccessor', {
        enumerable: true,
        get() { extraGetterCalls += 1; return 'private'; }
    });
    const source = { retryCount: 1, status: 'PASSED', attempts };
    const beforeRetry = attempts.map(item => item.retry);
    const extracted = extractPersistedAttemptHistory(source, {
        finalStatus: source.status,
        retryCount: source.retryCount
    });
    expect(extracted).toEqual([
        { retry: 0, status: 'FAILED' },
        { retry: 1, status: 'PASSED' }
    ]);
    expect(extracted.every(item => Reflect.ownKeys(item).sort().join(',') === 'retry,status')).toBe(true);
    expect(JSON.stringify(extracted)).not.toContain('private');
    expect(attempts.map(item => item.retry)).toEqual(beforeRetry);
    expect(extraGetterCalls).toBe(0);
});

test('source attempt property accessors and explicitly malformed histories are rejected without execution', () => {
    let getterCalls = 0;
    const source = {};
    Object.defineProperty(source, 'attempts', {
        enumerable: true,
        get() { getterCalls += 1; return history(['PASSED']).attempts; }
    });
    expect(() => extractPersistedAttemptHistory(source, { finalStatus: 'PASSED', retryCount: 0 })).toThrow(TypeError);
    expect(getterCalls).toBe(0);
    expect(() => extractPersistedAttemptHistory({ attempts: null }, { finalStatus: 'PASSED', retryCount: 0 })).toThrow(TypeError);
    expect(extractPersistedAttemptHistory({}, { finalStatus: 'PASSED', retryCount: 3 })).toBeNull();
});

test('large attempt histories classify deterministically without sorting', () => {
    const attemptCount = 10000;
    const input = history(Array.from({ length: attemptCount }, (_, index) => index === 0 ? 'FAILED' : 'PASSED'));
    const originalSort = Array.prototype.sort;
    Array.prototype.sort = function forbiddenSort() { throw new Error('attempt sorting is forbidden'); };
    try {
        expect(classifyFlakyAttemptHistory(input)).toEqual({
            flakyEligibility: 'known', flaky: true, reasonCode: null
        });
    } finally {
        Array.prototype.sort = originalSort;
    }
});
