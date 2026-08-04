const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const HistoryManager = require('../../utils/HistoryManager');
const HistoricalFailureReader = require('../../utils/HistoricalFailureReader');
const FailureTrendAnalyzer = require('../../utils/FailureTrendAnalyzer');
const { mergeHistoryConfig, resolveArtifactPaths } = require('../../utils/ArtifactPaths');
const { atomicWriteJson } = require('../../utils/JsonFile');

const roots = new Set();
const FIXED_NOW = '2026-08-03T00:00:00.000Z';

function tempRoot() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'heyna-failure-reader-'));
    roots.add(root);
    return root;
}

function managerFor(root, overrides = {}, options = {}) {
    const history = mergeHistoryConfig({ enabled: true, migration: { enabled: false } }, overrides);
    const paths = resolveArtifactPaths({ projectRoot: path.resolve(__dirname, '..', '..'), artifactRoot: root, config: { history } });
    return new HistoryManager({ paths, history, logger: { log() {}, error() {} }, ...options });
}

function metadata(timestamp = '2026-07-01T00:00:00.000Z', project = 'P') {
    return { project, executionStartTime: timestamp, executionEndTime: timestamp };
}

function outcomes(status = 'FAILED', extra = {}) {
    return [{
        testCase: 'TC_Checkout', status, duration: 10, feature: 'Checkout', traceAvailable: false,
        failureCategory: status === 'FAILED' ? 'ASSERTION_FAILURE' : undefined,
        errorMessage: status === 'FAILED' ? 'expect(page).toHaveURL expected checkout' : undefined,
        ...extra
    }];
}

function readerFor(manager) {
    return new HistoricalFailureReader({ historyManager: manager, clock: () => new Date(FIXED_NOW) });
}

function makeLegacy(manager, persisted, options = {}) {
    const summaryFile = path.join(persisted.directory, 'summary.json');
    const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
    delete summary.failureIndex;
    atomicWriteJson(summaryFile, summary);
    fs.rmSync(path.join(persisted.directory, 'failure-index.json'));
    if (options.aggregateOnly) fs.rmSync(path.join(persisted.directory, 'execution.json'), { force: true });
}

test.afterEach(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
    roots.clear();
});

test('valid immutable indexes are returned chronologically and deeply frozen', async () => {
    const manager = managerFor(tempRoot());
    const second = await manager.persistRun({ execution: outcomes('FAILED'), metadata: metadata('2026-07-02T00:00:00Z') });
    const first = await manager.persistRun({ execution: outcomes('PASSED'), metadata: metadata('2026-07-01T00:00:00Z') });
    const result = await readerFor(manager).read();
    expect(result.generatedAt).toBe(FIXED_NOW);
    expect(result.runs.map(run => run.runId)).toEqual([first.runId, second.runId]);
    expect(result.source).toMatchObject({ indexedRunCount: 2, testOutcomeCount: 2, failureObservationCount: 1 });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.runs[0].testOutcomes)).toBe(true);
    expect(() => JSON.stringify(result)).not.toThrow();
});

test('legacy execution is lazily normalized with degraded identity and fixed warnings', async () => {
    const manager = managerFor(tempRoot());
    const persisted = await manager.persistRun({ execution: outcomes('FAILED'), metadata: metadata() });
    makeLegacy(manager, persisted);
    const result = await readerFor(manager).read();
    expect(result.runs[0].detailStatus).toBe('legacy-normalized');
    expect(result.runs[0].testOutcomes[0].identityQuality).toBe('degraded');
    expect(result.runs[0].testOutcomes[0].failure.signatureQuality).toBe('degraded');
    expect(result.warnings.map(item => item.code)).toEqual(expect.arrayContaining([
        'HEYNA_FAILURE_HISTORY_MISSING_INDEX',
        'HEYNA_FAILURE_HISTORY_LEGACY_EXECUTION_NORMALIZED',
        'HEYNA_FAILURE_HISTORY_DEGRADED_IDENTITY'
    ]));
});

test('degraded fallback source is absent from failure index, reader, and analyzer output', async () => {
    const secrets = [
        'C:\\Users\\secret-user\\private.spec.js',
        'C:/Users/secret-user/private.spec.js',
        '/home/private-user/tests/private.spec.js',
        'file:///home/private-user/private.spec.js',
        'https://user:password@example.test/path?token=secret',
        'user@example.test:password',
        'api_key=sk-private-123456789'
    ];
    const manager = managerFor(tempRoot());
    for (let index = 0; index < secrets.length; index += 1) {
        await manager.persistRun({
            execution: outcomes('FAILED', { testCase: secrets[index] }),
            metadata: metadata(`2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`)
        });
    }
    const listing = await manager.listRunsWithDiagnostics();
    for (const summary of listing.runs) {
        const stored = await manager.getRun(summary.runId);
        const serialized = JSON.stringify(stored.failureIndex);
        for (const secret of secrets) expect(serialized).not.toContain(secret);
        expect(stored.failureIndex.testOutcomes[0]).toMatchObject({
            file: null, suitePath: [], title: 'Unidentified test', identityQuality: 'degraded'
        });
    }
    const reader = readerFor(manager);
    const read = await reader.read();
    const analyzed = await new FailureTrendAnalyzer({ historicalFailureReader: reader }).analyze({
        minimumOccurrences: 1, minimumAffectedRuns: 1
    });
    for (const secret of secrets) {
        expect(JSON.stringify(read)).not.toContain(secret);
        expect(JSON.stringify(analyzed)).not.toContain(secret);
    }
});

test('legacy equivalent retry records collapse while conflicting duplicates become aggregate-only', async () => {
    const identicalManager = managerFor(tempRoot());
    const identical = await identicalManager.persistRun({ execution: outcomes('FAILED'), metadata: metadata() });
    makeLegacy(identicalManager, identical);
    const identicalListing = await identicalManager.listRunsWithDiagnostics();
    const identicalStored = await identicalManager.getRun(identical.runId);
    const legacy = identicalStored.execution.map(item => ({ ...item }));
    legacy.push({ ...legacy[0], retryCount: 3, traceAvailable: true });
    const collapsed = await readerFor({
        async listRunsWithDiagnostics() { return identicalListing; },
        async getRun() { return { ...identicalStored, execution: legacy }; }
    }).read();
    expect(collapsed.runs[0]).toMatchObject({ detailStatus: 'legacy-normalized' });
    expect(collapsed.runs[0].testOutcomes).toHaveLength(1);
    expect(collapsed.runs[0].testOutcomes[0]).toMatchObject({ retryCount: 3, traceAvailable: true });
    expect(collapsed.warnings.map(item => item.code)).toContain('HEYNA_FAILURE_HISTORY_LEGACY_DUPLICATE_COLLAPSED');

    for (const conflict of [
        { status: 'PASSED' },
        { status: 'FAILED', failureCategory: 'ASSERTION_FAILURE', errorMessage: 'expected a different result' }
    ]) {
        const manager = managerFor(tempRoot());
        const persisted = await manager.persistRun({ execution: outcomes('FAILED'), metadata: metadata() });
        makeLegacy(manager, persisted);
        const listing = await manager.listRunsWithDiagnostics();
        const stored = await manager.getRun(persisted.runId);
        const records = stored.execution.map(item => ({ ...item }));
        records.push({ ...records[0], ...conflict, retryCount: 1 });
        const result = await readerFor({
            async listRunsWithDiagnostics() { return listing; },
            async getRun() { return { ...stored, execution: records }; }
        }).read();
        expect(result.runs[0]).toMatchObject({ detailStatus: 'aggregate-only', testOutcomes: [] });
        expect(result.warnings.map(item => item.code)).toContain('HEYNA_FAILURE_HISTORY_LEGACY_DUPLICATE_CONFLICT');
    }
});

test('aggregate-only legacy history is unknown rather than zero failures', async () => {
    const manager = managerFor(tempRoot(), { artifacts: { execution: false } });
    const persisted = await manager.persistRun({ execution: outcomes('FAILED'), metadata: metadata() });
    makeLegacy(manager, persisted, { aggregateOnly: true });
    const result = await readerFor(manager).read();
    expect(result.runs[0]).toMatchObject({ detailStatus: 'aggregate-only', unsuccessfulTests: 1, testOutcomes: [] });
    expect(result.source).toMatchObject({ aggregateOnlyRunCount: 1, failureObservationCount: 0 });
    expect(result.partial).toBe(true);
    expect(result.warnings.map(item => item.code)).toContain('HEYNA_FAILURE_HISTORY_AGGREGATE_ONLY_RUN');
});

test('checksum mismatch and unsupported descriptor are sanitized malformed-index diagnostics', async () => {
    for (const kind of ['checksum', 'unsupported']) {
        const root = tempRoot();
        const manager = managerFor(root);
        const persisted = await manager.persistRun({ execution: outcomes('FAILED'), metadata: metadata() });
        if (kind === 'checksum') fs.appendFileSync(path.join(persisted.directory, 'failure-index.json'), '\n');
        else {
            const file = path.join(persisted.directory, 'summary.json');
            const summary = JSON.parse(fs.readFileSync(file, 'utf8'));
            summary.failureIndex.schemaVersion = '2.0.0';
            atomicWriteJson(file, summary);
        }
        const result = await readerFor(manager).read();
        expect(result.runs[0].detailStatus).toBe('invalid-index');
        expect(result.source).toMatchObject({ malformedFailureIndexRunCount: 1, aggregateOnlyRunCount: 1 });
        expect(JSON.stringify(result)).not.toContain(root);
        expect(result.warnings.map(item => item.code)).toContain(kind === 'unsupported'
            ? 'HEYNA_FAILURE_HISTORY_UNSUPPORTED_INDEX_SCHEMA'
            : 'HEYNA_FAILURE_HISTORY_INVALID_INDEX');
    }
});

test('unreadable indexes and unsafe index fields become sanitized diagnostics', async () => {
    const root = tempRoot();
    const manager = managerFor(root);
    const persisted = await manager.persistRun({ execution: outcomes('FAILED'), metadata: metadata() });
    const listing = await manager.listRunsWithDiagnostics();
    const stored = await manager.getRun(persisted.runId);

    const cases = [
        {
            expectedCode: 'HEYNA_FAILURE_HISTORY_UNREADABLE_INDEX',
            getRun: async () => ({
                failureIndexDiagnostic: {
                    code: 'HEYNA_FAILURE_HISTORY_UNREADABLE_INDEX',
                    message: `EACCES at ${root}`
                }
            })
        },
        {
            expectedCode: 'HEYNA_FAILURE_HISTORY_INVALID_INDEX',
            getRun: async () => ({ failureIndex: { ...stored.failureIndex, rawMessage: `secret ${root}` } })
        },
        {
            expectedCode: 'HEYNA_FAILURE_HISTORY_INVALID_INDEX',
            getRun: async () => ({
                failureIndex: {
                    ...stored.failureIndex,
                    testOutcomes: stored.failureIndex.testOutcomes.map(item => ({ ...item, file: '../outside.spec.js' }))
                }
            })
        },
        {
            expectedCode: 'HEYNA_FAILURE_HISTORY_INVALID_INDEX',
            getRun: async () => ({
                failureIndex: {
                    ...stored.failureIndex,
                    testOutcomes: stored.failureIndex.testOutcomes.map(item => ({ ...item, file: path.join(root, 'secret.spec.js') }))
                }
            })
        }
    ];

    for (const item of cases) {
        const boundary = {
            async listRunsWithDiagnostics() { return listing; },
            getRun: item.getRun
        };
        const result = await readerFor(boundary).read();
        expect(result.runs[0].detailStatus).toBe('invalid-index');
        expect(result.warnings.map(value => value.code)).toContain(item.expectedCode);
        expect(JSON.stringify(result)).not.toContain(root);
        expect(JSON.stringify(result)).not.toContain('secret');
        expect(JSON.stringify(result)).not.toContain('EACCES');
    }
});

test('date, project, migration, and newest-run limit filters are deterministic', async () => {
    const manager = managerFor(tempRoot());
    await manager.persistRun({ execution: outcomes('FAILED'), metadata: metadata('2026-07-01T00:00:00Z', 'A') });
    const middle = await manager.persistRun({ execution: outcomes('FAILED'), metadata: metadata('2026-07-02T00:00:00Z', 'B') });
    const latest = await manager.persistRun({ execution: outcomes('FAILED'), metadata: metadata('2026-07-03T00:00:00Z', 'B') });
    const result = await readerFor(manager).read({
        from: '2026-07-02T00:00:00Z', to: '2026-07-03T00:00:00Z', project: 'B', limit: 1
    });
    expect(result.runs.map(run => run.runId)).toEqual([latest.runId]);
    expect(result.runs.map(run => run.runId)).not.toContain(middle.runId);
    expect(result.source).toMatchObject({ matchedRunCount: 2, selectedRunCount: 1 });
    expect(result.limited).toBe(true);
});

test('migrated history is included by default and can be excluded explicitly', async () => {
    const manager = managerFor(tempRoot());
    const fingerprint = `sha256:${'a'.repeat(64)}`;
    await manager.persistRun({
        execution: outcomes('FAILED'),
        metadata: metadata(),
        migration: { identity: fingerprint, source: 'legacy.json', sourceChecksum: fingerprint }
    });
    expect((await readerFor(manager).read()).runs).toHaveLength(1);
    const excluded = await readerFor(manager).read({ includeMigrated: false });
    expect(excluded.runs).toEqual([]);
    expect(excluded.source).toMatchObject({ matchedRunCount: 0, selectedRunCount: 0 });
});

test('zero-test run stays in timeline diagnostics and not outcome counts', async () => {
    const manager = managerFor(tempRoot());
    await manager.persistRun({ execution: [], metadata: metadata() });
    const result = await readerFor(manager).read();
    expect(result.runs[0]).toMatchObject({ totalTests: 0, testOutcomes: [] });
    expect(result.source.zeroTestRunCount).toBe(1);
    expect(result.warnings.map(item => item.code)).toContain('HEYNA_FAILURE_HISTORY_ZERO_TEST_RUN');
});

test('duplicate upstream run IDs and forbidden JSON values fail the source contract', async () => {
    const summary = {
        runId: '20260701-000000-000-aaaaaaaa', timestamp: '2026-07-01T00:00:00.000Z',
        total: 0, unsuccessful: 0, project: 'P'
    };
    const duplicateManager = {
        async listRunsWithDiagnostics() {
            return { runs: [summary, { ...summary }], discoveredRunCount: 2, validRunCount: 2, excludedRunCount: 0, diagnostics: [] };
        },
        async getRun() { return null; }
    };
    await expect(readerFor(duplicateManager).read()).rejects.toMatchObject({ code: 'HEYNA_FAILURE_TREND_SOURCE_CONTRACT' });

    const classManager = {
        async listRunsWithDiagnostics() {
            return Object.assign(Object.create(class Bad {}.prototype), { runs: [], discoveredRunCount: 0, validRunCount: 0, excludedRunCount: 0, diagnostics: [] });
        },
        async getRun() { return null; }
    };
    await expect(readerFor(classManager).read()).rejects.toMatchObject({ code: 'HEYNA_FAILURE_TREND_SOURCE_CONTRACT' });
});

test('upstream thrown error identity is preserved and listing is called once', async () => {
    const expected = new Error('injected upstream failure');
    let calls = 0;
    const manager = {
        async listRunsWithDiagnostics() { calls += 1; throw expected; },
        async getRun() { throw new Error('not reached'); }
    };
    await expect(readerFor(manager).read()).rejects.toBe(expected);
    expect(calls).toBe(1);
});

test('reader uses only the documented manager boundary and inspects returned runs passively', async () => {
    const manager = managerFor(tempRoot());
    const persisted = await manager.persistRun({ execution: outcomes('FAILED'), metadata: metadata() });
    const listing = await manager.listRunsWithDiagnostics();
    const stored = await manager.getRun(persisted.runId);
    const { retention, ...legacyCompatibleListing } = listing;
    let listingCalls = 0;
    const boundary = {
        async listRunsWithDiagnostics() { listingCalls += 1; return legacyCompatibleListing; },
        async getRun() { return stored; }
    };
    expect(Object.prototype.hasOwnProperty.call(boundary, 'config')).toBe(false);
    const result = await readerFor(boundary).read();
    expect(result.source.indexedRunCount).toBe(1);
    expect(result.retentionBounded).toBe(false);
    expect(listingCalls).toBe(1);

    let getterCalls = 0;
    const unsafeRun = {};
    Object.defineProperty(unsafeRun, 'failureIndex', {
        enumerable: true,
        get() { getterCalls += 1; return stored.failureIndex; }
    });
    await expect(readerFor({
        async listRunsWithDiagnostics() { return listing; },
        async getRun() { return unsafeRun; }
    }).read()).rejects.toMatchObject({ code: 'HEYNA_FAILURE_TREND_SOURCE_CONTRACT' });
    expect(getterCalls).toBe(0);
});
