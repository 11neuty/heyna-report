const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const HistoryManager = require('../../utils/HistoryManager');
const HistoricalFailureReader = require('../../utils/HistoricalFailureReader');
const HistoricalMetricsAggregator = require('../../utils/HistoricalMetricsAggregator');
const PassRateTrendAnalyzer = require('../../utils/PassRateTrendAnalyzer');
const Heyna = require('../../utils/HeynaReporter');
const { mergeHistoryConfig, resolveArtifactPaths } = require('../../utils/ArtifactPaths');
const { atomicWriteJson } = require('../../utils/JsonFile');
const { validateSummary } = require('../../utils/HistoryValidation');
const { buildFailureIndex, validateFailureIndex } = require('../../utils/HistoricalFailureValidation');
const { runTeardown } = require('../../heyna.global-teardown');

const temporaryRoots = new Set();

function temporaryRoot() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'heyna-history-test-'));
    temporaryRoots.add(root);
    return root;
}

function historyConfig(overrides = {}) {
    return mergeHistoryConfig({ enabled: true, migration: { enabled: false } }, overrides);
}

function managerFor(root, overrides = {}, options = {}) {
    const history = historyConfig(overrides);
    const paths = resolveArtifactPaths({ rootDir: root, config: { history } });
    return new HistoryManager({ paths, history, logger: options.logger || { log() {}, error() {} }, ...options });
}

function execution(status = 'PASSED', duration = 100) {
    return [{ testCase: `TC_${status}`, status, duration, feature: 'Checkout', traceAvailable: false }];
}

function metadata(timestamp = '2026-07-01T10:00:00.000Z') {
    return {
        project: 'HEYNA REPORT',
        feature: 'History',
        environment: 'QA',
        browser: 'chromium',
        executedBy: 'Framework Test',
        executionStartTime: timestamp,
        executionEndTime: new Date(new Date(timestamp).getTime() + 100).toISOString()
    };
}

async function persistReporterExecution(history) {
    const start = Heyna.getMetadata().executionStartTime;
    Heyna.updateMetadata({
        executionEndTime: new Date(Date.parse(start) + 1000).toISOString(),
        runStatus: 'COMPLETED'
    });
    const manager = new HistoryManager({ paths: Heyna.getPaths(), history, logger: { log() {}, error() {} } });
    await manager.initialize();
    const persisted = await manager.persistRun({ execution: Heyna.getExecutionData(), metadata: Heyna.getMetadata() });
    return {
        manager,
        persisted,
        index: JSON.parse(fs.readFileSync(path.join(persisted.directory, 'failure-index.json'), 'utf8'))
    };
}

test.afterEach(() => {
    Heyna.configure({ artifactRoot: process.env.HEYNA_ARTIFACT_ROOT || process.cwd() });
    for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true });
    temporaryRoots.clear();
});

test('first execution is atomically persisted with versioned files', async () => {
    const root = temporaryRoot();
    const manager = managerFor(root);
    await manager.initialize();
    const result = await manager.persistRun({ execution: execution(), metadata: metadata() });

    expect(result.persisted).toBe(true);
    expect(fs.existsSync(path.join(result.directory, 'summary.json'))).toBe(true);
    expect(fs.existsSync(path.join(result.directory, 'schema.json'))).toBe(true);
    expect(fs.existsSync(path.join(result.directory, 'manifest.json'))).toBe(true);
    expect(fs.readdirSync(manager.paths.historyTempDir)).toEqual([]);
});

test('two consecutive executions remain immutable and unique', async () => {
    const manager = managerFor(temporaryRoot());
    await manager.initialize();
    const first = await manager.persistRun({ execution: execution('PASSED'), metadata: metadata('2026-07-01T10:00:00Z') });
    const second = await manager.persistRun({ execution: execution('FAILED'), metadata: metadata('2026-07-02T10:00:00Z') });
    expect(first.runId).not.toBe(second.runId);
    expect((await manager.getRun(first.runId)).execution[0].status).toBe('PASSED');
    expect((await manager.listRuns()).map(run => run.runId)).toEqual([second.runId, first.runId]);
});

test('run IDs are sortable, filesystem-safe, and collision resistant', () => {
    const manager = managerFor(temporaryRoot());
    const ids = new Set(Array.from({ length: 100 }, () => manager.generateRunId(new Date('2026-07-01T10:11:12.123Z'))));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(/^20260701-101112-123-[a-f0-9]{8}$/);
});

test('near-concurrent persistence exposes only complete runs', async () => {
    const manager = managerFor(temporaryRoot());
    await manager.initialize();
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) => manager.persistRun({
        execution: execution(index % 2 ? 'PASSED' : 'FAILED'),
        metadata: metadata(`2026-07-01T10:00:0${index}Z`)
    })));
    expect(new Set(results.map(result => result.runId)).size).toBe(8);
    expect((await manager.listRuns()).length).toBe(8);
    expect(fs.readdirSync(manager.paths.historyTempDir)).toEqual([]);
});

test('disabled history performs no filesystem writes', async () => {
    const root = temporaryRoot();
    const manager = managerFor(root, { enabled: false });
    expect(await manager.initialize()).toEqual({ enabled: false, migrated: [], cleanup: [] });
    expect(await manager.persistRun({ execution: execution(), metadata: metadata() })).toEqual({ persisted: false, reason: 'disabled' });
    expect(fs.existsSync(path.join(root, 'history'))).toBe(false);
});

test('missing optional artifacts do not create misleading manifest entries', async () => {
    const manager = managerFor(temporaryRoot());
    await manager.initialize();
    const result = await manager.persistRun({ execution: execution(), metadata: metadata(), artifacts: { pdf: false, dashboard: false, evidence: false } });
    const manifest = JSON.parse(fs.readFileSync(path.join(result.directory, 'manifest.json')));
    expect(manifest.artifacts.map(item => item.type).sort()).toEqual(['execution', 'metadata']);
    expect(result.summary.reportAvailability).toEqual({ pdf: false, dashboard: false, evidence: false, traces: false });
});

test('corrupted current execution JSON is reported and never overwritten', async () => {
    const root = temporaryRoot();
    const manager = managerFor(root);
    fs.mkdirSync(manager.paths.resultDir, { recursive: true });
    fs.writeFileSync(manager.paths.executionFile, '{ broken');
    atomicWriteJson(manager.paths.metadataFile, metadata());
    await manager.initialize();
    await expect(manager.persistRun()).rejects.toThrow(/Corrupt JSON file/);
    expect(fs.readFileSync(manager.paths.executionFile, 'utf8')).toBe('{ broken');
    expect(await manager.listRuns()).toEqual([]);
});

test('stale interrupted temporary runs are removed without touching fresh ones', async () => {
    const manager = managerFor(temporaryRoot(), {}, { staleTemporaryAgeMs: 1000 });
    fs.mkdirSync(path.join(manager.paths.historyTempDir, '20260701-100000-000-aaaaaaaa'), { recursive: true });
    fs.mkdirSync(path.join(manager.paths.historyTempDir, '20260701-100001-000-bbbbbbbb'), { recursive: true });
    const old = new Date(Date.now() - 5000);
    fs.utimesSync(path.join(manager.paths.historyTempDir, '20260701-100000-000-aaaaaaaa'), old, old);
    const removed = await manager.cleanupStaleTemporaryRuns();
    expect(removed).toEqual(['20260701-100000-000-aaaaaaaa']);
    expect(fs.existsSync(path.join(manager.paths.historyTempDir, '20260701-100001-000-bbbbbbbb'))).toBe(true);
});

function fakeReporter(root) {
    const paths = resolveArtifactPaths({ rootDir: root, config: { history: historyConfig({ enabled: false }) } });
    return {
        paths,
        configure() {},
        getPaths: () => paths,
        markRunningTestsAsFailed() {},
        printAutoCaptureCoverage() {},
        updateMetadata() {},
        completeRun() {}
    };
}

test('PDF failure does not prevent HTML generation or history persistence', async () => {
    const root = temporaryRoot();
    const reporter = fakeReporter(root);
    let htmlCalled = false;
    let historyCalled = false;
    const result = await runTeardown({
        reporter,
        pdfGenerator: { generate: async () => { throw new Error('pdf failed'); } },
        htmlGenerator: { generate: async () => { htmlCalled = true; return reporter.paths.dashboardFile; } },
        historyManager: { initialize: async () => {}, persistRun: async () => { historyCalled = true; return { persisted: true }; } },
        logger: { error() {} },
        throwOnError: false
    });
    expect(htmlCalled).toBe(true);
    expect(historyCalled).toBe(true);
    expect(result.failures.map(item => item.label)).toEqual(['PDF generation']);
});

test('HTML failure does not prevent history persistence', async () => {
    const reporter = fakeReporter(temporaryRoot());
    let historyCalled = false;
    const result = await runTeardown({
        reporter,
        pdfGenerator: { generate: async () => reporter.paths.reportFile },
        htmlGenerator: { generate: async () => { throw new Error('html failed'); } },
        historyManager: { initialize: async () => {}, persistRun: async () => { historyCalled = true; } },
        logger: { error() {} },
        throwOnError: false
    });
    expect(historyCalled).toBe(true);
    expect(result.failures.map(item => item.label)).toEqual(['HTML dashboard generation']);
});

test('history failure leaves current-run output intact', async () => {
    const root = temporaryRoot();
    const reporter = fakeReporter(root);
    fs.mkdirSync(reporter.paths.resultDir, { recursive: true });
    fs.writeFileSync(reporter.paths.executionFile, 'current output');
    const result = await runTeardown({
        reporter,
        pdfGenerator: { generate: async () => false },
        htmlGenerator: { generate: async () => false },
        historyManager: { initialize: async () => {}, persistRun: async () => { throw new Error('history failed'); } },
        logger: { error() {} },
        throwOnError: false
    });
    expect(result.failures.map(item => item.label)).toEqual(['history persistence']);
    expect(fs.readFileSync(reporter.paths.executionFile, 'utf8')).toBe('current output');
});

test('global teardown logs structured latest-pointer warnings', async () => {
    const reporter = fakeReporter(temporaryRoot());
    const messages = [];
    const result = await runTeardown({
        reporter,
        pdfGenerator: { generate: async () => false },
        htmlGenerator: { generate: async () => false },
        historyManager: {
            initialize: async () => {},
            persistRun: async () => ({ persisted: true, warnings: [{ code: 'HEYNA_LATEST_UPDATE_FAILED', message: 'injected' }] })
        },
        logger: { error(message) { messages.push(message); } },
        throwOnError: false
    });
    expect(result.failures).toEqual([]);
    expect(messages).toContain('[HEYNA TEARDOWN] history warning HEYNA_LATEST_UPDATE_FAILED: injected');
});

test('retention by count deterministically keeps newest completed runs', async () => {
    const manager = managerFor(temporaryRoot(), { retention: { enabled: true, maxRuns: 2 } });
    await manager.initialize();
    const runs = [];
    for (let day = 1; day <= 3; day += 1) runs.push(await manager.persistRun({ execution: execution(), metadata: metadata(`2026-07-0${day}T10:00:00Z`) }));
    expect((await manager.listRuns()).map(item => item.runId)).toEqual([runs[2].runId, runs[1].runId]);
    expect((await manager.getLatestRun()).runId).toBe(runs[2].runId);
});

test('retention by age deletes old completed runs only', async () => {
    const manager = managerFor(temporaryRoot(), { retention: { enabled: false } });
    await manager.initialize();
    const old = await manager.persistRun({ execution: execution(), metadata: metadata('2020-01-01T00:00:00Z') });
    const current = await manager.persistRun({ execution: execution(), metadata: metadata(new Date().toISOString()) });
    manager.config.retention = { enabled: true, maxAgeDays: 30, maxRuns: null };
    const result = await manager.enforceRetention();
    expect(result.deletedRunIds).toEqual([old.runId]);
    expect((await manager.getLatestRun()).runId).toBe(current.runId);
});

test('legacy migration is safe and represented as a valid run', async () => {
    const root = temporaryRoot();
    const manager = managerFor(root, { migration: { enabled: true } });
    fs.mkdirSync(manager.paths.legacyExecutionsDir, { recursive: true });
    fs.writeFileSync(path.join(manager.paths.legacyExecutionsDir, 'legacy.json'), JSON.stringify({ execution: execution(), metadata: metadata() }));
    const result = await manager.initialize();
    expect(result.migrated[0].migrated).toBe(true);
    expect(fs.existsSync(path.join(manager.paths.legacyExecutionsDir, 'legacy.json'))).toBe(true);
    expect((await manager.listRuns()).length).toBe(1);
});

test('legacy migration is idempotent and malformed sources are preserved', async () => {
    const manager = managerFor(temporaryRoot(), { migration: { enabled: true } });
    fs.mkdirSync(manager.paths.legacyExecutionsDir, { recursive: true });
    fs.writeFileSync(path.join(manager.paths.legacyExecutionsDir, 'valid.json'), JSON.stringify(execution()));
    fs.writeFileSync(path.join(manager.paths.legacyExecutionsDir, 'broken.json'), '{ nope');
    await manager.initialize();
    const count = (await manager.listRuns()).length;
    const second = await manager.migrateLegacyIfNeeded();
    expect((await manager.listRuns()).length).toBe(count);
    expect(second.some(item => item.source === 'broken.json' && !item.migrated)).toBe(true);
    expect(fs.existsSync(path.join(manager.paths.legacyExecutionsDir, 'broken.json'))).toBe(true);
});


test('schema 1.0.0 legacy numeric summaries remain readable but are excluded from aggregation', async () => {
    const manager = managerFor(temporaryRoot());
    await manager.initialize();
    const persisted = await manager.persistRun({ execution: execution(), metadata: metadata() });
    const unsafeCount = Number.MAX_SAFE_INTEGER + 1;
    const legacy = {
        ...persisted.summary,
        total: unsafeCount,
        passed: unsafeCount,
        failed: 0,
        skipped: 0,
        timedOut: 0,
        interrupted: 0,
        unsuccessful: 0,
        passRate: 100,
        totalDuration: Number.MAX_VALUE,
        averageDuration: Number.MAX_VALUE
    };
    atomicWriteJson(path.join(manager.paths.historyRunsDir, persisted.runId, 'summary.json'), legacy);

    expect(validateSummary({ ...legacy, totalDuration: -0, averageDuration: -0 }).totalDuration).toBe(-0);
    expect(await manager.getRunSummary(persisted.runId)).toMatchObject({ total: unsafeCount, totalDuration: Number.MAX_VALUE });
    expect((await manager.listRuns()).map(item => item.runId)).toEqual([persisted.runId]);
    const diagnosticListing = await manager.listRunsWithDiagnostics();
    expect(diagnosticListing).toMatchObject({ discoveredRunCount: 1, validRunCount: 1, excludedRunCount: 0, diagnostics: [] });

    const aggregate = await new HistoricalMetricsAggregator({
        historyManager: manager,
        clock: () => new Date('2026-07-20T00:00:00.000Z')
    }).aggregate();
    expect(aggregate.source).toEqual({
        discoveredRunCount: 1,
        validRunCount: 1,
        excludedRunCount: 0,
        aggregationExcludedRunCount: 1,
        matchedRunCount: 0,
        selectedRunCount: 0
    });
    expect(aggregate.warnings.map(item => item.code)).toContain('HEYNA_HISTORICAL_AGGREGATION_UNUSABLE_SUMMARY');
});

test('legacy migration keeps schema 1.0.0 readable when its duration exceeds aggregation range', async () => {
    const manager = managerFor(temporaryRoot(), { migration: { enabled: true } });
    fs.mkdirSync(manager.paths.legacyExecutionsDir, { recursive: true });
    fs.writeFileSync(path.join(manager.paths.legacyExecutionsDir, 'legacy-large.json'), JSON.stringify({
        execution: execution('PASSED', Number.MAX_VALUE),
        metadata: metadata()
    }));
    const initialized = await manager.initialize();
    expect(initialized.migrated).toHaveLength(1);
    expect(initialized.migrated[0].migrated).toBe(true);
    const listing = await manager.listRunsWithDiagnostics();
    expect(listing).toMatchObject({ discoveredRunCount: 1, validRunCount: 1, excludedRunCount: 0, diagnostics: [] });
    expect(listing.runs[0]).toMatchObject({ schemaVersion: '1.0.0', totalDuration: Number.MAX_VALUE });
    const aggregate = await new HistoricalMetricsAggregator({ historyManager: manager }).aggregate();
    expect(aggregate.source.aggregationExcludedRunCount).toBe(1);
    expect(aggregate.runCount).toBe(0);
});

test('date-range queries and limits use summaries in deterministic order', async () => {
    const manager = managerFor(temporaryRoot());
    await manager.initialize();
    for (let day = 1; day <= 3; day += 1) await manager.persistRun({ execution: execution(), metadata: metadata(`2026-07-0${day}T10:00:00Z`) });
    const range = await manager.queryRunsByDateRange('2026-07-01T23:59:59Z', '2026-07-03T00:00:00Z');
    expect(range.length).toBe(1);
    expect((await manager.listRuns({ limit: 2, newestFirst: false })).length).toBe(2);
});

test('diagnostic run listing distinguishes missing, corrupt, unsupported, and invalid summaries', async () => {
    const root = temporaryRoot();
    const manager = managerFor(root);
    await manager.initialize();
    const valid = await manager.persistRun({ execution: execution(), metadata: metadata() });
    const cases = [
        ['20260701-110000-000-aaaaaaaa', 'missing'],
        ['20260701-110001-000-bbbbbbbb', 'corrupt'],
        ['20260701-110002-000-cccccccc', 'unsupported'],
        ['20260701-110003-000-dddddddd', 'invalid']
    ];

    for (const [runId, kind] of cases) {
        const directory = path.join(manager.paths.historyRunsDir, runId);
        fs.mkdirSync(directory, { recursive: true });
        if (kind === 'corrupt') fs.writeFileSync(path.join(directory, 'summary.json'), '{ broken');
        if (kind === 'unsupported') atomicWriteJson(path.join(directory, 'summary.json'), {
            ...valid.summary,
            runId,
            schemaVersion: '2.0.0'
        });
        if (kind === 'invalid') atomicWriteJson(path.join(directory, 'summary.json'), {
            ...valid.summary,
            runId,
            total: valid.summary.total + 1
        });
    }

    const result = await manager.listRunsWithDiagnostics();
    expect(result.runs.map(run => run.runId)).toEqual([valid.runId]);
    expect(result).toMatchObject({ discoveredRunCount: 5, validRunCount: 1, excludedRunCount: 4 });
    expect(result.diagnostics.map(item => item.code).sort()).toEqual([
        'HEYNA_HISTORICAL_CORRUPT_SUMMARY',
        'HEYNA_HISTORICAL_INVALID_SUMMARY',
        'HEYNA_HISTORICAL_MISSING_SUMMARY',
        'HEYNA_HISTORICAL_UNSUPPORTED_SCHEMA'
    ]);
    expect(() => JSON.stringify(result)).not.toThrow();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(root);
    expect(serialized).not.toMatch(/[A-Za-z]:\\|\/home\//);
    expect(await manager.listRuns()).toEqual([valid.summary]);
});

test('diagnostic run listing distinguishes an unreadable completed run', async () => {
    const root = temporaryRoot();
    const base = managerFor(root);
    const runId = '20260701-110004-000-eeeeeeee';
    const summaryFile = path.join(base.paths.historyRunsDir, runId, 'summary.json');
    fs.mkdirSync(path.dirname(summaryFile), { recursive: true });
    fs.writeFileSync(summaryFile, '{}');
    const injected = Object.assign(Object.create(fs), {
        readFileSync(file, ...args) {
            if (file === summaryFile) {
                const error = new Error('access denied C:\\Users\\someone\\private\\history\\runs\\x\\summary.json /home/runner/work/private/history/runs/x/summary.json');
                error.code = 'EACCES';
                throw error;
            }
            return fs.readFileSync(file, ...args);
        }
    });
    const result = await managerFor(root, {}, { fileSystem: injected }).listRunsWithDiagnostics();
    expect(result).toMatchObject({ discoveredRunCount: 1, validRunCount: 0, excludedRunCount: 1 });
    expect(result.diagnostics[0]).toMatchObject({ code: 'HEYNA_HISTORICAL_UNREADABLE_RUN', severity: 'warning', runId });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('C:\\Users\\someone\\private');
    expect(serialized).not.toContain('/home/runner/work/private');
    expect(result.diagnostics[0].details).toEqual({ file: 'summary.json', errorCode: 'EACCES' });
});

test('latest pointer is portable JSON and resolves the latest run', async () => {
    const manager = managerFor(temporaryRoot());
    await manager.initialize();
    const result = await manager.persistRun({ execution: execution(), metadata: metadata() });
    const pointer = JSON.parse(fs.readFileSync(manager.paths.historyLatestFile));
    expect(pointer).toEqual({ runId: result.runId, relativePath: `runs/${result.runId}`, timestamp: result.summary.timestamp, schemaVersion: '1.0.0' });
    expect((await manager.getLatestRun()).runId).toBe(result.runId);
});

test('TIMEDOUT remains canonical while unsuccessful compatibility counts stay explicit', async () => {
    const manager = managerFor(temporaryRoot());
    await manager.initialize();
    const result = await manager.persistRun({ execution: execution('TIMEDOUT'), metadata: metadata() });
    expect(result.summary).toMatchObject({ failed: 0, timedOut: 1, interrupted: 0, passRate: 0 });
    expect((await manager.getRun(result.runId)).execution[0].status).toBe('TIMEDOUT');
});

test('INTERRUPTED remains canonical in reporter and history summaries', async () => {
    const manager = managerFor(temporaryRoot());
    await manager.initialize();
    const result = await manager.persistRun({ execution: execution('INTERRUPTED'), metadata: metadata() });
    expect(HistoryManager.canonicalStatus('interrupted')).toBe('INTERRUPTED');
    expect(Heyna.normalizeStatus('interrupted')).toBe('INTERRUPTED');
    expect(result.summary).toMatchObject({ failed: 0, timedOut: 0, interrupted: 1 });
});

test('reporter artifact roots are runtime-resolved and isolated', () => {
    const root = temporaryRoot();
    Heyna.configure({ artifactRoot: root });
    Heyna.initializeRun({ reset: true, project: 'Isolated' });
    Heyna.initializeTest('TC_Isolated');
    Heyna.completeTest('TC_Isolated', 'PASSED', 1);
    expect(Heyna.getPaths().executionFile.startsWith(root)).toBe(true);
    expect(fs.existsSync(path.join(root, 'test-results', 'execution.json'))).toBe(true);
});

test('reporter refuses to overwrite corrupt current execution data', () => {
    const root = temporaryRoot();
    Heyna.configure({ artifactRoot: root });
    fs.mkdirSync(Heyna.getPaths().resultDir, { recursive: true });
    fs.writeFileSync(Heyna.getPaths().executionFile, '{ corrupt');
    expect(() => Heyna.initializeTest('TC_Corrupt')).toThrow(/Corrupt JSON file/);
    expect(fs.readFileSync(Heyna.getPaths().executionFile, 'utf8')).toBe('{ corrupt');
});

test('completeRun always removes the run lock', () => {
    const root = temporaryRoot();
    Heyna.configure({ artifactRoot: root });
    Heyna.initializeRun({ reset: true });
    expect(fs.existsSync(Heyna.getPaths().runLockFile)).toBe(true);
    Heyna.completeRun();
    expect(fs.existsSync(Heyna.getPaths().runLockFile)).toBe(false);
});

test('missing history root is empty for both listing APIs', async () => {
    const manager = managerFor(temporaryRoot());
    expect(fs.existsSync(manager.paths.historyRunsDir)).toBe(false);
    expect(await manager.listRuns()).toEqual([]);
    expect(await manager.listRunsWithDiagnostics()).toEqual({
        runs: [],
        discoveredRunCount: 0,
        validRunCount: 0,
        excludedRunCount: 0,
        diagnostics: [],
        retention: { enabled: false, maxRuns: null, maxAgeDays: null }
    });
});


test('unsupported schema diagnostics redact path-shaped version values', async () => {
    for (const unsafeVersion of ['C:\\Users\\someone\\private\\summary.json', '/home/runner/work/private/summary.json']) {
        const manager = managerFor(temporaryRoot());
        const runId = '20260701-120000-000-aaaaaaaa';
        const directory = path.join(manager.paths.historyRunsDir, runId);
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify({ schemaVersion: unsafeVersion }));
        const result = await manager.listRunsWithDiagnostics();
        expect(result).toMatchObject({ discoveredRunCount: 1, validRunCount: 0, excludedRunCount: 1 });
        expect(result.diagnostics[0]).toEqual({
            code: 'HEYNA_HISTORICAL_UNSUPPORTED_SCHEMA',
            severity: 'warning',
            message: 'Completed history run uses an unsupported summary schema.',
            runId,
            field: 'schemaVersion',
            details: { schemaVersion: 'invalid-version-token' }
        });
        expect(JSON.stringify(result)).not.toContain(unsafeVersion);
    }
});

test('existing list and retention APIs retain large finite integer compatibility', async () => {
    const hugeInteger = Number.MAX_SAFE_INTEGER + 1;
    const root = temporaryRoot();
    const manager = managerFor(root, { retention: { enabled: true, maxRuns: hugeInteger, maxAgeDays: null } });
    await manager.initialize();
    const persisted = await manager.persistRun({ execution: execution(), metadata: metadata() });
    expect((await manager.listRuns({ limit: hugeInteger })).map(item => item.runId)).toEqual([persisted.runId]);
    const retention = await manager.enforceRetention();
    expect(retention).toMatchObject({ deletedRunIds: [], skippedCorruptRunIds: [] });
    expect((await manager.listRuns()).map(item => item.runId)).toEqual([persisted.runId]);
});

test('root enumeration failures preserve safe native codes and sanitize malformed codes', async () => {
    const cases = [
        ['EACCES', 'EACCES'],
        ['EPERM', 'EPERM'],
        ['EIO', 'EIO'],
        ['EMFILE', 'EMFILE'],
        ['ENFILE', 'ENFILE'],
        ['ENOSPC', 'ENOSPC'],
        ['UNEXPECTED', 'UNEXPECTED'],
        ['C:\\Users\\someone\\private', 'UNKNOWN'],
        [undefined, 'UNKNOWN']
    ];
    for (const [suppliedCode, expectedCode] of cases) {
        const root = temporaryRoot();
        const base = managerFor(root);
        const privateWindowsPath = 'C:\\Users\\someone\\private\\history\\runs';
        const privatePosixPath = '/home/runner/work/private/history/runs';
        const injected = Object.assign(Object.create(fs), {
            readdirSync(target, ...args) {
                if (target === base.paths.historyRunsDir) {
                    const error = new Error(`cannot enumerate ${privateWindowsPath} ${privatePosixPath}`);
                    if (suppliedCode !== undefined) error.code = suppliedCode;
                    throw error;
                }
                return fs.readdirSync(target, ...args);
            }
        });
        const manager = managerFor(root, {}, { fileSystem: injected });
        for (const operation of [() => manager.listRuns(), () => manager.listRunsWithDiagnostics()]) {
            try {
                await operation();
                throw new Error('Expected history enumeration to fail.');
            } catch (error) {
                expect(error.code).toBe(expectedCode);
                expect(error.heynaCode).toBe('HEYNA_HISTORY_ENUMERATION_FAILED');
                expect(error.cause).toBeTruthy();
                expect(error.message).toBe(`Could not enumerate completed history runs (${expectedCode}).`);
                expect(error.message).not.toContain(privateWindowsPath);
                expect(error.message).not.toContain(privatePosixPath);
            }
        }
    }
});

test('failure index is an independently checksummed core sidecar and survives disabled raw execution storage', async () => {
    const manager = managerFor(temporaryRoot(), { artifacts: { execution: false, metadata: false, pdf: false, dashboard: false, evidence: false, traces: false } });
    const result = await manager.persistRun({
        execution: [{
            testCase: 'TC_Failure', status: 'FAILED', duration: 10, traceAvailable: false,
            failureCategory: 'ASSERTION_FAILURE', errorMessage: 'expect(page).toHaveURL expected checkout'
        }],
        metadata: metadata()
    });
    const indexFile = path.join(result.directory, 'failure-index.json');
    const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    const summary = JSON.parse(fs.readFileSync(path.join(result.directory, 'summary.json'), 'utf8'));
    const manifest = JSON.parse(fs.readFileSync(path.join(result.directory, 'manifest.json'), 'utf8'));
    expect(fs.existsSync(path.join(result.directory, 'execution.json'))).toBe(false);
    expect(index).toMatchObject({ failureIndexSchemaVersion: '2.0.0', counts: { indexedTests: 1, indexedFailures: 1 } });
    expect(index.testOutcomes[0].attempts).toBeNull();
    expect(summary.schemaVersion).toBe('1.0.0');
    expect(summary.failureIndex).toMatchObject({
        schemaVersion: '2.0.0', path: 'failure-index.json',
        size: fs.statSync(indexFile).size, indexedTestCount: 1, indexedFailureCount: 1
    });
    expect(summary.failureIndex.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(manifest.artifacts.some(item => item.path === 'failure-index.json')).toBe(false);
    expect((await manager.getRun(result.runId)).failureIndex.counts.indexedFailures).toBe(1);
});

test('duplicate finalized tuples fail before publication while project and repeatEach remain distinct', async () => {
    const failed = {
        testCase: 'TC_Duplicate', project: 'A', repeatEachIndex: 0, retryCount: 2,
        status: 'FAILED', duration: 10, traceAvailable: false,
        failureCategory: 'ASSERTION_FAILURE', errorMessage: 'expected checkout'
    };
    for (const duplicate of [
        { ...failed },
        { ...failed, status: 'PASSED', failureCategory: undefined, errorMessage: undefined }
    ]) {
        const manager = managerFor(temporaryRoot());
        await expect(manager.persistRun({ execution: [failed, duplicate], metadata: metadata() }))
            .rejects.toMatchObject({ code: 'HEYNA_FAILURE_HISTORY_DUPLICATE_OUTCOME' });
        expect(fs.existsSync(manager.paths.historyRunsDir) ? fs.readdirSync(manager.paths.historyRunsDir) : []).toEqual([]);
        expect(fs.existsSync(manager.paths.historyTempDir) ? fs.readdirSync(manager.paths.historyTempDir) : []).toEqual([]);
    }

    const manager = managerFor(temporaryRoot());
    const persisted = await manager.persistRun({
        execution: [
            failed,
            { ...failed, repeatEachIndex: 1 },
            { ...failed, project: 'B' }
        ],
        metadata: metadata()
    });
    const index = (await manager.getRun(persisted.runId)).failureIndex;
    expect(index.counts).toEqual({ indexedTests: 3, indexedFailures: 3 });
    expect(new Set(index.testOutcomes.map(item => `${item.project}:${item.repeatEachIndex}`))).toEqual(new Set(['A:0', 'A:1', 'B:0']));
});

test('failure-index validation is descriptor-first and independently rejects duplicate and exotic data', () => {
    const value = buildFailureIndex({
        runId: '20260701-000000-000-aaaaaaaa',
        timestamp: '2026-07-01T00:00:00.000Z',
        execution: [{ testCase: 'TC', status: 'PASSED', traceAvailable: false }],
        metadata: { project: 'P' }
    });
    const duplicate = { ...value, testOutcomes: [value.testOutcomes[0], { ...value.testOutcomes[0] }], counts: { indexedTests: 2, indexedFailures: 0 } };
    expect(() => validateFailureIndex(duplicate)).toThrow(expect.objectContaining({ code: 'HEYNA_FAILURE_HISTORY_DUPLICATE_OUTCOME' }));

    let getterCalls = 0;
    const getterCounts = {};
    Object.defineProperties(getterCounts, {
        indexedTests: { enumerable: true, get() { getterCalls += 1; return 1; } },
        indexedFailures: { enumerable: true, value: 0 }
    });
    expect(() => validateFailureIndex({ ...value, counts: getterCounts })).toThrow(expect.objectContaining({ code: 'HEYNA_FAILURE_HISTORY_INVALID_INDEX' }));
    expect(getterCalls).toBe(0);

    const sparse = new Array(1);
    expect(() => validateFailureIndex({ ...value, testOutcomes: sparse, counts: { indexedTests: 1, indexedFailures: 0 } }))
        .toThrow(expect.objectContaining({ code: 'HEYNA_FAILURE_HISTORY_INVALID_INDEX' }));
    class Outcomes extends Array {}
    expect(() => validateFailureIndex({ ...value, testOutcomes: new Outcomes(value.testOutcomes[0]) }))
        .toThrow(expect.objectContaining({ code: 'HEYNA_FAILURE_HISTORY_INVALID_INDEX' }));
});

test('failure-index construction canonicalizes adversarial outcome order for linear readers', () => {
    const execution = [
        { testCase: 'TC_Canonical_Z', project: 'P', repeatEachIndex: 2, status: 'PASSED', traceAvailable: false },
        { testCase: 'TC_Canonical_A', project: 'P', repeatEachIndex: 1, status: 'PASSED', traceAvailable: false },
        { testCase: 'TC_Canonical_A', project: 'P', repeatEachIndex: 0, status: 'PASSED', traceAvailable: false }
    ];
    const value = buildFailureIndex({
        runId: '20260701-000000-000-c0decafe',
        timestamp: '2026-07-01T00:00:00.000Z',
        execution,
        metadata: { project: 'P' }
    });
    const tuples = value.testOutcomes.map(item => `${item.project}\0${item.testKey}\0${item.repeatEachIndex}`);
    expect(tuples).toEqual(tuples.slice().sort());
    const reversed = { ...value, testOutcomes: value.testOutcomes.slice().reverse() };
    expect(() => validateFailureIndex(reversed)).toThrow(/canonical project, testKey, and repeatEachIndex order/);
});

test('new failure descriptor remains compatible with history, metrics, and pass-rate trend schema 1.0.0 readers', async () => {
    const manager = managerFor(temporaryRoot());
    const persisted = await manager.persistRun({ execution: execution('FAILED'), metadata: metadata() });
    expect(validateSummary(persisted.summary).failureIndex).toBeTruthy();
    const aggregator = new HistoricalMetricsAggregator({ historyManager: manager, clock: () => new Date('2026-07-21T00:00:00Z') });
    const aggregate = await aggregator.aggregate();
    expect(aggregate).toMatchObject({ aggregationSchemaVersion: '1.0.0', runCount: 1 });
    const trend = await new PassRateTrendAnalyzer({ historicalMetricsAggregator: aggregator }).analyze({ granularity: 'run' });
    expect(trend).toMatchObject({ trendSchemaVersion: '1.0.0', pointCount: 1 });

    fs.appendFileSync(path.join(persisted.directory, 'failure-index.json'), '\ncorrupt');
    expect((await manager.listRunsWithDiagnostics()).runs).toHaveLength(1);
    expect((await aggregator.aggregate()).runCount).toBe(1);
    expect((await new PassRateTrendAnalyzer({ historicalMetricsAggregator: aggregator }).analyze({ granularity: 'run' })).pointCount).toBe(1);
    expect((await manager.getRun(persisted.runId)).failureIndexDiagnostic.code).toBe('HEYNA_FAILURE_HISTORY_INVALID_INDEX');
});

test('failure index publication is atomic, latest-neutral, and retention removes it only with its run', async () => {
    const manager = managerFor(temporaryRoot(), { retention: { enabled: false } });
    const first = await manager.persistRun({ execution: execution('FAILED'), metadata: metadata('2026-07-01T00:00:00Z') });
    const second = await manager.persistRun({ execution: execution('PASSED'), metadata: metadata('2026-07-02T00:00:00Z') });
    expect(fs.readdirSync(manager.paths.historyTempDir)).toEqual([]);
    expect((await manager.getLatestRun()).runId).toBe(second.runId);
    expect(fs.existsSync(path.join(first.directory, 'failure-index.json'))).toBe(true);
    manager.config.retention = { enabled: true, maxRuns: 1, maxAgeDays: null };
    await manager.enforceRetention();
    expect(fs.existsSync(first.directory)).toBe(false);
    expect(fs.existsSync(path.join(second.directory, 'failure-index.json'))).toBe(true);
    expect((await manager.getLatestRun()).runId).toBe(second.runId);
});

test('reporter separates project, repeatEach, and colliding labels while collapsing retries', () => {
    const root = temporaryRoot();
    Heyna.configure({ artifactRoot: root });
    Heyna.initializeRun({ reset: true, project: 'Reporter Identity' });
    const fileA = path.join(process.cwd(), 'tests', 'a.spec.js');
    const fileB = path.join(process.cwd(), 'tests', 'b.spec.js');
    const info = (project, file, repeatEachIndex, retry = 0) => ({
        project: { name: project }, file, title: 'same title', titlePath: [path.basename(file), 'Suite', 'same title'],
        line: 10, testId: `${project}-${path.basename(file)}`, repeatEachIndex, retry,
        outputDir: path.join(root, 'outputs', `${project}-${repeatEachIndex}-${retry}`), error: undefined
    });
    const execute = (testInfo, status = 'PASSED') => {
        Heyna.initializeTest('same_title', { testInfo, retry: testInfo.retry, repeatEachIndex: testInfo.repeatEachIndex });
        Heyna.completeTest('same_title', status, 1, status === 'FAILED' ? 'expect(page).toHaveURL expected x' : undefined, { testInfo });
    };
    execute(info('A', fileA, 0), 'FAILED');
    execute(info('A', fileA, 0, 1), 'PASSED');
    execute(info('A', fileA, 1));
    execute(info('B', fileA, 0));
    execute(info('A', fileB, 0));
    const data = Heyna.getExecutionData();
    expect(data).toHaveLength(4);
    const retried = data.find(item => item.project === 'A' && item.testIdentity.file === 'tests/a.spec.js' && item.repeatEachIndex === 0);
    expect(retried).toMatchObject({ status: 'PASSED', retryCount: 1 });
    expect(retried.attempts).toHaveLength(2);
    expect(new Set(data.map(item => item.executionKey)).size).toBe(4);
    expect(data.every(item => item.testIdentity && item.executionKey)).toBe(true);
});

test('reporter retry history persists privately in v2 and classifies without raw execution retention', async () => {
    const root = temporaryRoot();
    const history = historyConfig({
        artifacts: { execution: false, metadata: false, pdf: false, dashboard: false, evidence: false, traces: false }
    });
    Heyna.configure({ projectRoot: process.cwd(), artifactRoot: root, history });
    Heyna.initializeRun({ reset: true, project: 'Retry Project' });

    Heyna.initializeTest('TC_Flaky', { project: 'Retry Project', retry: 0, repeatEachIndex: 0 });
    Heyna.completeTest('TC_Flaky', 'FAILED', 5, 'private failure at C:\\Users\\private\\test.spec.js', {
        project: 'Retry Project', retry: 0, repeatEachIndex: 0,
        failureScreenshot: 'C:\\private\\failure.png'
    });
    Heyna.initializeTest('TC_Flaky', { project: 'Retry Project', retry: 1, repeatEachIndex: 0 });
    Heyna.completeTest('TC_Flaky', 'PASSED', 3, undefined, {
        project: 'Retry Project', retry: 1, repeatEachIndex: 0
    });

    const execution = Heyna.getExecutionData();
    const before = JSON.stringify(execution);
    const start = Heyna.getMetadata().executionStartTime;
    Heyna.updateMetadata({ executionEndTime: new Date(Date.parse(start) + 1000).toISOString(), runStatus: 'COMPLETED' });
    const manager = new HistoryManager({ paths: Heyna.getPaths(), history, logger: { log() {}, error() {} } });
    await manager.initialize();
    const persisted = await manager.persistRun({ execution, metadata: Heyna.getMetadata() });

    expect(fs.existsSync(path.join(persisted.directory, 'execution.json'))).toBe(false);
    const indexFile = path.join(persisted.directory, 'failure-index.json');
    const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    expect(index.failureIndexSchemaVersion).toBe('2.0.0');
    expect(index.testOutcomes[0].attempts).toEqual([
        { retry: 0, status: 'FAILED' },
        { retry: 1, status: 'PASSED' }
    ]);
    expect(index.testOutcomes[0].attempts.every(item => Reflect.ownKeys(item).sort().join(',') === 'retry,status')).toBe(true);
    expect(JSON.stringify(index.testOutcomes[0].attempts)).not.toContain('private');
    expect(persisted.summary).toMatchObject({
        schemaVersion: '1.0.0',
        failureIndex: { schemaVersion: '2.0.0', size: fs.statSync(indexFile).size }
    });
    expect(JSON.stringify(execution)).toBe(before);

    const reader = new HistoricalFailureReader({ historyManager: manager, clock: () => new Date('2026-08-08T00:00:00Z') });
    const firstRead = await reader.read();
    const secondRead = await reader.read();
    expect(firstRead.failureHistorySchemaVersion).toBe('1.1.0');
    expect(firstRead.runs[0].testOutcomes[0]).not.toHaveProperty('attempts');
    expect(firstRead.runs[0].testOutcomes[0].flakyClassification).toEqual({
        flakyEligibility: 'known', flaky: true, reasonCode: null
    });
    expect(Object.isFrozen(firstRead.runs[0].testOutcomes[0].flakyClassification)).toBe(true);
    expect(firstRead).not.toBe(secondRead);
    expect(() => JSON.stringify(firstRead)).not.toThrow();
});

test('reporter persists a complete observed retry 0 through 2 sequence', async () => {
    const root = temporaryRoot();
    const history = historyConfig({
        artifacts: { execution: false, metadata: false, pdf: false, dashboard: false, evidence: false, traces: false }
    });
    Heyna.configure({ projectRoot: process.cwd(), artifactRoot: root, history });
    Heyna.initializeRun({ reset: true, project: 'Complete Retry Project' });
    for (const [retry, status] of ['FAILED', 'TIMEDOUT', 'PASSED'].entries()) {
        Heyna.initializeTest('TC_Complete_Retries', { project: 'Complete Retry Project', retry });
        Heyna.completeTest('TC_Complete_Retries', status, 1, status === 'PASSED' ? undefined : 'expected failure', {
            project: 'Complete Retry Project', retry
        });
    }
    const { index } = await persistReporterExecution(history);
    expect(index.testOutcomes[0].attempts).toEqual([
        { retry: 0, status: 'FAILED' },
        { retry: 1, status: 'TIMEDOUT' },
        { retry: 2, status: 'PASSED' }
    ]);
});

test('first observed initializeTest retries persist unavailable history without aborting', async () => {
    for (const retry of [1, 2]) {
        const root = temporaryRoot();
        const history = historyConfig({ artifacts: { execution: false, metadata: false } });
        Heyna.configure({ projectRoot: process.cwd(), artifactRoot: root, history });
        Heyna.initializeRun({ reset: true, project: `First Retry ${retry}` });
        expect(() => Heyna.initializeTest('TC_First_Observed', { project: `First Retry ${retry}`, retry })).not.toThrow();
        Heyna.completeTest('TC_First_Observed', 'PASSED', 1, undefined, { project: `First Retry ${retry}`, retry });
        const execution = Heyna.getExecutionData()[0];
        expect(execution).toMatchObject({ status: 'PASSED', retryCount: retry });
        expect(execution).not.toHaveProperty('attempts');
        const { index } = await persistReporterExecution(history);
        expect(index.testOutcomes[0].attempts).toBeNull();
    }
});

test('a later retry after a RUNNING attempt degrades history and preserves the final outcome', async () => {
    const root = temporaryRoot();
    const history = historyConfig({ artifacts: { execution: false, metadata: false } });
    Heyna.configure({ projectRoot: process.cwd(), artifactRoot: root, history });
    Heyna.initializeRun({ reset: true, project: 'Recovery Project' });
    Heyna.initializeTest('TC_Recovery', { project: 'Recovery Project', retry: 0 });
    expect(() => Heyna.initializeTest('TC_Recovery', { project: 'Recovery Project', retry: 1 })).not.toThrow();
    const running = Heyna.getExecutionData()[0];
    expect(running).toMatchObject({ status: 'RUNNING', retryCount: 1 });
    expect(running).not.toHaveProperty('attempts');
    Heyna.completeTest('TC_Recovery', 'PASSED', 1, undefined, { project: 'Recovery Project', retry: 1 });

    const { manager, index } = await persistReporterExecution(history);
    expect(index.testOutcomes[0]).toMatchObject({ status: 'PASSED', retryCount: 1, attempts: null });
    const read = await new HistoricalFailureReader({
        historyManager: manager,
        clock: () => new Date('2026-08-08T00:00:00Z')
    }).read();
    expect(read.runs[0].testOutcomes[0].flakyClassification).toEqual({
        flakyEligibility: 'unknown', flaky: null, reasonCode: 'ATTEMPT_HISTORY_NOT_PERSISTED'
    });
});

test('completeTest first observed on a non-zero retry remains backward compatible', async () => {
    for (const retry of [1, 2]) {
        const root = temporaryRoot();
        const history = historyConfig({ artifacts: { execution: false, metadata: false } });
        Heyna.configure({ projectRoot: process.cwd(), artifactRoot: root, history });
        Heyna.initializeRun({ reset: true, project: `Completion Retry ${retry}` });
        expect(() => Heyna.completeTest('TC_Completion_Only', 'PASSED', 1, undefined, {
            project: `Completion Retry ${retry}`, retry
        })).not.toThrow();
        const { index } = await persistReporterExecution(history);
        expect(index.testOutcomes[0]).toMatchObject({ status: 'PASSED', retryCount: retry, attempts: null });
    }
});

test('degraded attempt history stays unavailable across later retries', async () => {
    const root = temporaryRoot();
    const history = historyConfig({ artifacts: { execution: false, metadata: false } });
    Heyna.configure({ projectRoot: process.cwd(), artifactRoot: root, history });
    Heyna.initializeRun({ reset: true, project: 'Sticky Unknown Project' });
    for (const [retry, status] of [[1, 'FAILED'], [2, 'TIMEDOUT'], [3, 'PASSED']]) {
        Heyna.initializeTest('TC_Sticky_Unknown', { project: 'Sticky Unknown Project', retry });
        Heyna.completeTest('TC_Sticky_Unknown', status, 1, status === 'PASSED' ? undefined : 'expected failure', {
            project: 'Sticky Unknown Project', retry
        });
        expect(Heyna.getExecutionData()[0]).not.toHaveProperty('attempts');
    }
    const { manager, index } = await persistReporterExecution(history);
    expect(index.testOutcomes[0]).toMatchObject({ status: 'PASSED', retryCount: 3, attempts: null });
    const read = await new HistoricalFailureReader({
        historyManager: manager,
        clock: () => new Date('2026-08-08T00:00:00Z')
    }).read();
    expect(read.runs[0].testOutcomes[0].flakyClassification).toEqual({
        flakyEligibility: 'unknown', flaky: null, reasonCode: 'ATTEMPT_HISTORY_NOT_PERSISTED'
    });
});

test('reporter rejects duplicate, decreasing, and mismatched retry lifecycle data without mutation', () => {
    const root = temporaryRoot();
    Heyna.configure({ projectRoot: process.cwd(), artifactRoot: root, history: { enabled: false } });
    Heyna.initializeRun({ reset: true, project: 'Retry Guard' });
    Heyna.initializeTest('TC_Retry_Guard', { project: 'Retry Guard', retry: 0 });
    Heyna.completeTest('TC_Retry_Guard', 'FAILED', 1, 'expected failure', { project: 'Retry Guard', retry: 0 });
    const before = JSON.stringify(Heyna.getExecutionData());
    for (const retry of [0, -1, -0, '1', Number.MAX_SAFE_INTEGER + 1]) {
        expect(() => Heyna.initializeTest('TC_Retry_Guard', { project: 'Retry Guard', retry })).toThrow();
        expect(JSON.stringify(Heyna.getExecutionData())).toBe(before);
    }
    Heyna.initializeTest('TC_Retry_Guard', { project: 'Retry Guard', retry: 1 });
    const running = JSON.stringify(Heyna.getExecutionData());
    expect(() => Heyna.completeTest('TC_Retry_Guard', 'PASSED', 1, undefined, { project: 'Retry Guard', retry: 0 })).toThrow();
    expect(JSON.stringify(Heyna.getExecutionData())).toBe(running);
});
