const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const Heyna = require('../../utils/HeynaReporter');
const HistoryManager = require('../../utils/HistoryManager');
const HeynaPdfGenerator = require('../../utils/HeynaPdfGenerator');
const HeynaHtmlDashboardGenerator = require('../../utils/HeynaHtmlDashboardGenerator');
const HistoricalFailureReader = require('../../utils/HistoricalFailureReader');
const FailureTrendAnalyzer = require('../../utils/FailureTrendAnalyzer');
const { mergeHistoryConfig } = require('../../utils/ArtifactPaths');
const {
    createFailureIdentity,
    createRecurrenceKey,
    createTestIdentity,
    normalizeVolatileText
} = require('../../utils/FailureIdentity');

const projectRoot = path.resolve(__dirname, '..', '..');

function info(values = {}) {
    return {
        file: path.join(projectRoot, 'tests', 'checkout.spec.js'),
        title: 'submits café order',
        titlePath: ['checkout.spec.js', 'Checkout', 'submits café order'],
        line: 42,
        testId: 'private-playwright-id',
        project: { name: 'chromium' },
        ...values
    };
}

test('strong identity is project-relative, Unicode-normalized, and project-independent', () => {
    const composed = createTestIdentity({ projectRoot, testInfo: info() });
    const decomposed = createTestIdentity({
        projectRoot,
        testInfo: info({ title: 'submits cafe\u0301 order', titlePath: ['checkout.spec.js', 'Checkout', 'submits cafe\u0301 order'], project: { name: 'firefox' } })
    });
    expect(composed).toMatchObject({
        project: 'chromium', file: 'tests/checkout.spec.js', suitePath: ['Checkout'],
        title: 'submits café order', line: 42, identityQuality: 'strong'
    });
    expect(composed.testKey).toBe(decomposed.testKey);
    expect(composed.playwrightTestIdFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(composed)).not.toContain('private-playwright-id');
});

test('path separators normalize and traversal is rejected', () => {
    const windows = createTestIdentity({ projectRoot, testInfo: info({ file: 'tests\\checkout.spec.js' }) });
    const portable = createTestIdentity({ projectRoot, testInfo: info({ file: 'tests/checkout.spec.js' }) });
    expect(windows.testKey).toBe(portable.testKey);
    expect(windows.file).toBe('tests/checkout.spec.js');
    expect(portable.file).toBe('tests/checkout.spec.js');

    const nested = [
        'tests\\checkout\\payment.spec.js',
        'tests/checkout/payment.spec.js',
        'tests\\checkout/payment.spec.js'
    ].map(file => createTestIdentity({ projectRoot, testInfo: info({ file }) }));
    expect(new Set(nested.map(identity => identity.testKey)).size).toBe(1);
    for (const identity of nested) expect(identity.file).toBe('tests/checkout/payment.spec.js');

    const repeated = [
        'tests//checkout.spec.js',
        'tests\\\\checkout.spec.js',
        'tests\\/checkout.spec.js'
    ].map(file => createTestIdentity({ projectRoot, testInfo: info({ file }) }));
    expect(new Set(repeated.map(identity => identity.testKey)).size).toBe(1);
    for (const identity of repeated) expect(identity.file).toBe('tests/checkout.spec.js');

    for (const file of [
        '../outside.spec.js',
        '..\\outside.spec.js',
        'tests/../../outside.spec.js',
        'tests\\..\\..\\outside.spec.js',
        'tests\\checkout/../../../outside.spec.js',
        path.resolve(projectRoot, '..', 'outside.spec.js')
    ]) {
        expect(() => createTestIdentity({ projectRoot, testInfo: info({ file }) })).toThrow(/inside projectRoot/);
    }

    for (const file of ['', '   ', 0, false, {}, []]) {
        expect(() => createTestIdentity({ projectRoot, testInfo: info({ file }) })).toThrow(/test file/);
    }
});

test('equivalent separator inputs preserve lifecycle execution identity', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'heyna separator identity '));
    const testCase = 'separator lifecycle identity';
    const backslashInfo = info({ file: 'tests\\checkout.spec.js' });
    const portableInfo = info({ file: 'tests/checkout.spec.js' });

    try {
        Heyna.configure({ projectRoot, artifactRoot: root, history: { enabled: false } });
        Heyna.initializeRun({ reset: true, project: 'Separator identity' });
        Heyna.initializeTest(testCase, { testInfo: backslashInfo });
        const initialized = Heyna.getExecutionData();
        expect(initialized).toHaveLength(1);
        const executionKey = initialized[0].executionKey;
        const testKey = initialized[0].testIdentity.testKey;

        Heyna.completeTest(testCase, 'PASSED', 1, undefined, { testInfo: portableInfo });
        const completed = Heyna.getExecutionData();
        expect(completed).toHaveLength(1);
        expect(completed[0]).toMatchObject({
            executionKey,
            testIdentity: { testKey, file: 'tests/checkout.spec.js' }
        });
    } finally {
        Heyna.completeRun();
        Heyna.configure({ projectRoot, artifactRoot: process.env.HEYNA_ARTIFACT_ROOT || projectRoot });
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('fallback identity is deterministic and explicitly degraded', () => {
    const first = createTestIdentity({ projectRoot, testCase: 'TC_Fallback', project: 'P' });
    const second = createTestIdentity({ projectRoot, testCase: 'TC_Fallback', project: 'P' });
    expect(first).toMatchObject({ file: null, suitePath: [], title: 'Unidentified test', identityQuality: 'degraded' });
    expect(first.testKey).toBe(second.testKey);
});

test('degraded identity never publishes path, URL, or credential-like fallback input', () => {
    const secrets = [
        'C:\\Users\\secret-user\\private.spec.js',
        'C:/Users/secret-user/private.spec.js',
        '/home/private-user/tests/private.spec.js',
        'file:///home/private-user/private.spec.js',
        'https://user:password@example.test/path?token=secret',
        'user@example.test:password',
        'api_key=sk-private-123456789'
    ];
    for (const secret of secrets) {
        const identity = createTestIdentity({ projectRoot, testCase: secret, project: 'P' });
        expect(identity).toMatchObject({ file: null, suitePath: [], title: 'Unidentified test', identityQuality: 'degraded' });
        expect(JSON.stringify(identity)).not.toContain(secret);
        expect(identity.testKey).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
    expect(createTestIdentity({ testCase: secrets[0] }).testKey).not.toBe(createTestIdentity({ testCase: secrets[1] }).testKey);
});

test('reporter lifecycle keeps degraded execution and failure-index artifacts opaque and distinct', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'heyna degraded privacy '));
    const secrets = [
        'C:\\Users\\secret-user\\private.spec.js',
        'C:/Users/secret-user/private.spec.js',
        '/home/secret-user/private.spec.js',
        'file:///home/secret-user/private.spec.js',
        'https://user:password@example.test/path?token=secret',
        'user@example.test:password',
        'api_key=sk-private-123456789'
    ];
    const history = mergeHistoryConfig({
        enabled: true,
        migration: { enabled: false },
        artifacts: { pdf: false, dashboard: false, evidence: false, traces: false }
    });

    try {
        Heyna.configure({ projectRoot, artifactRoot: root, history });
        Heyna.initializeRun({ reset: true, project: 'P', feature: 'Privacy' });
        for (const secret of secrets) {
            Heyna.initializeTest(secret, { project: 'P' });
            Heyna.completeTest(secret, 'FAILED', 1, 'expect(value).toBe(expected)', { project: 'P' });
        }

        const firstKey = Heyna.getExecutionData()[0].testIdentity.testKey;
        Heyna.initializeTest(secrets[0], { project: 'P', retry: 1 });
        Heyna.completeTest(secrets[0], 'PASSED', 1, undefined, { project: 'P', retry: 1 });
        Heyna.initializeTest(secrets[0], { project: 'P', repeatEachIndex: 1 });
        Heyna.completeTest(secrets[0], 'PASSED', 1, undefined, { project: 'P', repeatEachIndex: 1 });
        Heyna.initializeTest(secrets[0], { project: 'Q' });
        Heyna.completeTest(secrets[0], 'PASSED', 1, undefined, { project: 'Q' });

        const execution = JSON.parse(fs.readFileSync(Heyna.getPaths().executionFile, 'utf8'));
        expect(execution).toHaveLength(secrets.length + 2);
        expect(execution.every(item => item.testCase === 'Unidentified test')).toBe(true);
        expect(execution.every(item => item.testIdentity.identityQuality === 'degraded')).toBe(true);
        expect(new Set(execution.map(item => item.executionKey)).size).toBe(execution.length);
        expect(execution[0].testIdentity.testKey).toBe(firstKey);
        expect(execution.filter(item => item.testIdentity.testKey === firstKey)).toHaveLength(3);

        const serializedExecution = JSON.stringify(execution);
        for (const secret of secrets) {
            expect(serializedExecution).not.toContain(JSON.stringify(secret).slice(1, -1));
            expect(JSON.stringify(execution)).not.toContain(secret);
        }

        const manager = new HistoryManager({ paths: Heyna.getPaths(), history, logger: { log() {}, error() {} } });
        await manager.initialize();
        const persisted = await manager.persistRun({
            execution,
            metadata: {
                project: 'P', feature: 'Privacy', environment: 'QA', browser: 'chromium', executedBy: 'Test',
                executionStartTime: '2026-08-03T10:00:00.000Z', executionEndTime: '2026-08-03T10:00:01.000Z'
            },
            artifacts: { pdf: false, dashboard: false, evidence: false }
        });
        const failureIndex = fs.readFileSync(path.join(persisted.directory, 'failure-index.json'), 'utf8');
        for (const secret of secrets) expect(failureIndex).not.toContain(JSON.stringify(secret).slice(1, -1));
    } finally {
        Heyna.completeRun();
        Heyna.configure({ projectRoot, artifactRoot: process.env.HEYNA_ARTIFACT_ROOT || projectRoot });
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('direct API and evidence capture before initialization uses only deterministic degraded directories', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'heyna direct artifact privacy '));
    const secrets = [
        'C:\\Users\\secret-user\\private.spec.js',
        'C:/Users/secret-user/private.spec.js',
        '/home/secret-user/private.spec.js',
        'file:///home/secret-user/private.spec.js',
        'https://user:password@example.test/path?token=secret',
        'user@example.test:credential-secret',
        'api_key=sk-private-123456789',
        'arbitrary sensitive label 9182'
    ];
    const consoleOutput = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...values) => consoleOutput.push(values.join(' '));
    console.error = (...values) => consoleOutput.push(values.join(' '));

    try {
        Heyna.configure({ projectRoot, artifactRoot: root, history: { enabled: false } });
        Heyna.initializeRun({ reset: true });
        const returnedPaths = [];
        const names = [];
        for (const secret of secrets) {
            Heyna.saveApiLogs(secret, []);
            const screenshot = await Heyna.captureEvidence({
                async screenshot(options) { fs.writeFileSync(options.path, 'screenshot'); }
            }, secret, 'Direct evidence', 'FAILED');
            returnedPaths.push(screenshot);
            const name = Heyna.artifactTestCaseName(secret);
            names.push(name);
            expect(name).toMatch(/^unidentified-[a-f0-9]{24}$/);
            expect(Heyna.artifactTestCaseName(secret)).toBe(name);

            let thrown;
            try {
                await Heyna.captureEvidence({ async screenshot() { throw new Error('fixed screenshot failure'); } }, secret, 'Failure');
            } catch (error) {
                thrown = error;
            }
            expect(thrown.message).toBe('fixed screenshot failure');
            expect(thrown.message).not.toContain(secret);
        }
        expect(new Set(names).size).toBe(secrets.length);
        const serialized = JSON.stringify({
            names: fs.readdirSync(Heyna.getPaths().evidenceDir),
            returnedPaths,
            consoleOutput
        });
        for (const secret of secrets) {
            expect(serialized).not.toContain(secret);
            expect(serialized).not.toContain(JSON.stringify(secret).slice(1, -1));
        }
    } finally {
        console.log = originalLog;
        console.error = originalError;
        Heyna.completeRun();
        Heyna.configure({ projectRoot, artifactRoot: process.env.HEYNA_ARTIFACT_ROOT || projectRoot });
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('strong identity survives testCase-only lifecycle calls, reports, and history publication', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'heyna strong lifecycle '));
    const history = mergeHistoryConfig({
        enabled: true,
        migration: { enabled: false },
        artifacts: { pdf: true, dashboard: true, evidence: true, traces: true }
    });
    const outputDir = path.join(root, 'playwright-output', 'strong-lifecycle');
    fs.mkdirSync(outputDir, { recursive: true });
    const traceBytes = Buffer.from('strong lifecycle trace');
    fs.writeFileSync(path.join(outputDir, 'trace.zip'), traceBytes);
    const testInfo = info({
        title: 'Strong lifecycle title',
        titlePath: ['checkout.spec.js', 'Lifecycle', 'Strong lifecycle title'],
        project: { name: 'webkit' },
        repeatEachIndex: 1,
        retry: 0,
        outputDir
    });

    try {
        Heyna.configure({ projectRoot, artifactRoot: root, history });
        Heyna.initializeRun({ reset: true, project: 'Lifecycle' });
        Heyna.initializeTest('legacy lifecycle label', { testInfo, repeatEachIndex: 1 });
        Heyna.addStep('legacy lifecycle label', { name: 'Step', status: 'PASS', duration: 1 });
        const evidence = await Heyna.captureEvidence({
            async screenshot(options) { fs.writeFileSync(options.path, 'screenshot'); }
        }, 'legacy lifecycle label', 'Strong evidence', 'FAILED');
        Heyna.saveApiLogs('legacy lifecycle label', []);
        Heyna.completeTest('legacy lifecycle label', 'FAILED', 10, 'expect(value).toBe(expected)');
        const executionStartTime = Heyna.getMetadata().executionStartTime;
        Heyna.updateMetadata({
            executionEndTime: new Date(Date.parse(executionStartTime) + 1000).toISOString(),
            runStatus: 'COMPLETED'
        });

        const execution = Heyna.getExecutionData();
        expect(execution).toHaveLength(1);
        expect(execution[0]).toMatchObject({
            testCase: 'Strong lifecycle title', project: 'webkit', repeatEachIndex: 1,
            status: 'FAILED', executionKey: expect.stringMatching(/^sha256:/),
            testIdentity: {
                title: 'Strong lifecycle title', file: 'tests/checkout.spec.js', suitePath: ['Lifecycle'],
                project: 'webkit', identityQuality: 'strong'
            }
        });
        expect(execution[0].steps).toHaveLength(1);
        expect(evidence.replace(/\\/g, '/')).toContain('evidence/Strong_lifecycle_title/');
        expect(execution[0]).toMatchObject({
            traceAvailable: true,
            traceFile: expect.stringMatching(/trace\.zip$/),
            traceSize: traceBytes.length,
            traceModified: expect.any(String)
        });
        expect(execution[0].attempts[0]).toMatchObject({
            traceAvailable: true,
            traceFile: execution[0].traceFile,
            traceSize: traceBytes.length
        });
        expect(JSON.stringify(execution)).not.toContain(outputDir);

        const paths = Heyna.getPaths();
        const pdf = await HeynaPdfGenerator.generate({ paths });
        const dashboard = await HeynaHtmlDashboardGenerator.generate({ paths });
        expect(fs.existsSync(pdf)).toBe(true);
        expect(fs.existsSync(dashboard)).toBe(true);

        const manager = new HistoryManager({ paths, history, logger: { log() {}, error() {} } });
        await manager.initialize();
        const persisted = await manager.persistRun({
            execution,
            metadata: Heyna.getMetadata(),
            artifacts: { pdf, dashboard: paths.dashboardDir, evidence: paths.evidenceDir }
        });
        const index = JSON.parse(fs.readFileSync(path.join(persisted.directory, 'failure-index.json'), 'utf8'));
        expect(index.testOutcomes).toHaveLength(1);
        expect(index.testOutcomes[0]).toMatchObject({
            testKey: execution[0].testIdentity.testKey,
            project: 'webkit', repeatEachIndex: 1, title: 'Strong lifecycle title', identityQuality: 'strong',
            traceAvailable: true
        });
        const historicalExecution = JSON.parse(fs.readFileSync(path.join(persisted.directory, 'execution.json'), 'utf8'));
        expect(historicalExecution).toHaveLength(1);
        expect(historicalExecution[0]).toMatchObject({ traceAvailable: true, traceFile: execution[0].traceFile });
        expect(JSON.stringify(historicalExecution)).not.toContain(outputDir);

        const beforeConflict = JSON.stringify(Heyna.getExecutionData());
        const conflicts = [
            { label: 'private-project-conflict', extra: { testInfo: info({ ...testInfo, project: { name: 'chromium' } }) } },
            { label: 'private-repeat-conflict', extra: { testInfo: info({ ...testInfo, repeatEachIndex: 2 }), repeatEachIndex: 2 } },
            { label: 'private-title-conflict', extra: { testInfo: info({ ...testInfo, title: 'Different private title', titlePath: ['checkout.spec.js', 'Lifecycle', 'Different private title'] }) } },
            { label: 'private-file-conflict', extra: { testInfo: info({ ...testInfo, file: path.join(projectRoot, 'tests', 'other.spec.js') }) } },
            { label: 'private-key-conflict', extra: { testInfo: info({ ...testInfo, titlePath: ['checkout.spec.js', 'Different private suite', testInfo.title] }) } }
        ];
        for (const conflict of conflicts) {
            let thrown;
            try { Heyna.completeTest('legacy lifecycle label', 'PASSED', 1, undefined, conflict.extra); } catch (error) { thrown = error; }
            expect(thrown).toMatchObject({
                code: 'HEYNA_EXECUTION_CONTEXT_CONFLICT',
                message: 'HEYNA test lifecycle metadata conflicts with the initialized execution context.'
            });
            expect(thrown.message).not.toContain(conflict.label);
            expect(JSON.stringify(Heyna.getExecutionData())).toBe(beforeConflict);
        }
    } finally {
        Heyna.completeRun();
        Heyna.configure({ projectRoot, artifactRoot: process.env.HEYNA_ARTIFACT_ROOT || projectRoot });
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('retry trace state is cleared and replaced without top-level contradictions', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'heyna retry trace lifecycle '));
    const firstOutput = path.join(root, 'playwright-output', 'first');
    const missingOutput = path.join(root, 'playwright-output', 'missing');
    const replacementOutput = path.join(root, 'playwright-output', 'replacement');
    fs.mkdirSync(firstOutput, { recursive: true });
    fs.mkdirSync(missingOutput, { recursive: true });
    fs.mkdirSync(replacementOutput, { recursive: true });
    fs.writeFileSync(path.join(firstOutput, 'trace.zip'), 'trace-a');
    fs.writeFileSync(path.join(replacementOutput, 'trace.zip'), 'replacement-trace-b');
    const base = info({ title: 'Retry trace lifecycle', titlePath: ['checkout.spec.js', 'Retry trace lifecycle'] });

    try {
        Heyna.configure({ projectRoot, artifactRoot: root, history: { enabled: false } });
        Heyna.initializeRun({ reset: true });
        Heyna.initializeTest('retry trace legacy label', { testInfo: { ...base, retry: 0, outputDir: firstOutput }, retry: 0 });
        Heyna.completeTest('retry trace legacy label', 'PASSED', 1, undefined);

        Heyna.initializeTest('retry trace legacy label', { testInfo: { ...base, retry: 1, outputDir: missingOutput }, retry: 1 });
        let current = Heyna.getExecutionData()[0];
        expect(current).toMatchObject({ status: 'RUNNING', traceAvailable: false });
        expect(current).not.toHaveProperty('traceFile');
        expect(current).not.toHaveProperty('traceSize');
        expect(current).not.toHaveProperty('traceModified');
        Heyna.completeTest('retry trace legacy label', 'PASSED', 1, undefined, { retry: 1 });
        current = Heyna.getExecutionData()[0];
        expect(current).toMatchObject({ traceAvailable: false, retryCount: 1 });
        expect(current).not.toHaveProperty('traceFile');
        expect(current).not.toHaveProperty('traceSize');
        expect(current).not.toHaveProperty('traceModified');
        expect(current.attempts[0]).toMatchObject({ traceAvailable: true, traceSize: 'trace-a'.length });
        expect(current.attempts[1]).toMatchObject({ traceAvailable: false });
        for (const field of ['traceFile', 'traceSize', 'traceModified']) expect(current.attempts[1]).not.toHaveProperty(field);

        Heyna.initializeTest('retry trace legacy label', { testInfo: { ...base, retry: 2, outputDir: replacementOutput }, retry: 2 });
        Heyna.completeTest('retry trace legacy label', 'PASSED', 1, undefined, { retry: 2 });
        current = Heyna.getExecutionData()[0];
        expect(current).toMatchObject({ traceAvailable: true, traceSize: 'replacement-trace-b'.length, retryCount: 2 });
        expect(current.traceFile.replace(/\\/g, '/')).toContain('playwright-output/replacement/trace.zip');
        expect(current.attempts[2]).toMatchObject({
            traceAvailable: true,
            traceFile: current.traceFile,
            traceSize: 'replacement-trace-b'.length
        });
        expect(current.attempts[0].traceFile).not.toBe(current.traceFile);
    } finally {
        Heyna.completeRun();
        Heyna.configure({ projectRoot, artifactRoot: process.env.HEYNA_ARTIFACT_ROOT || projectRoot });
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('strong no-trace lifecycle stays consistently trace-free without testInfo completion', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'heyna strong no trace '));
    const outputDir = path.join(root, 'playwright-output', 'no-trace');
    fs.mkdirSync(outputDir, { recursive: true });
    try {
        Heyna.configure({ projectRoot, artifactRoot: root, history: { enabled: false } });
        Heyna.initializeRun({ reset: true });
        Heyna.initializeTest('strong no-trace legacy label', {
            testInfo: info({ title: 'Strong no-trace lifecycle', titlePath: ['checkout.spec.js', 'Strong no-trace lifecycle'], outputDir })
        });
        Heyna.completeTest('strong no-trace legacy label', 'PASSED', 1);
        const execution = Heyna.getExecutionData();
        expect(execution).toHaveLength(1);
        expect(execution[0]).toMatchObject({ testCase: 'Strong no-trace lifecycle', traceAvailable: false });
        for (const field of ['traceFile', 'traceSize', 'traceModified']) {
            expect(execution[0]).not.toHaveProperty(field);
            expect(execution[0].attempts[0]).not.toHaveProperty(field);
        }
        expect(execution[0].attempts[0].traceAvailable).toBe(false);
    } finally {
        Heyna.completeRun();
        Heyna.configure({ projectRoot, artifactRoot: process.env.HEYNA_ARTIFACT_ROOT || projectRoot });
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('trace locators with sensitive machine paths are never serialized or disclosed', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'heyna trace privacy artifact '));
    const sensitiveOutput = path.join(root, 'playwright-output', 'credential-user_token-secret-output');
    fs.mkdirSync(sensitiveOutput, { recursive: true });
    fs.writeFileSync(path.join(sensitiveOutput, 'trace.zip'), 'private trace bytes');
    const sensitivePaths = [
        sensitiveOutput,
        'C:\\Users\\secret-user\\project\\test-results',
        'C:/Users/secret-user/project/test-results',
        '/home/secret-user/project/test-results',
        path.join(os.tmpdir(), 'username_password', 'token-sk-private-123')
    ];
    const history = mergeHistoryConfig({ enabled: true, migration: { enabled: false }, artifacts: { traces: true } });
    const consoleOutput = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...values) => consoleOutput.push(values.join(' '));
    console.error = (...values) => consoleOutput.push(values.join(' '));
    try {
        Heyna.configure({ projectRoot, artifactRoot: root, history });
        Heyna.initializeRun({ reset: true });
        sensitivePaths.forEach((outputDir, index) => {
            const title = `Private trace lifecycle ${index}`;
            Heyna.initializeTest(`private trace legacy ${index}`, {
                testInfo: info({ title, titlePath: ['checkout.spec.js', title], outputDir })
            });
            Heyna.completeTest(`private trace legacy ${index}`, 'FAILED', 1, 'fixed failure');
        });
        const execution = Heyna.getExecutionData();
        expect(execution).toHaveLength(sensitivePaths.length);
        expect(execution[0].traceAvailable).toBe(true);
        expect(execution[0]).not.toHaveProperty('traceFile');
        expect(execution.slice(1).every(item => item.traceAvailable === false)).toBe(true);

        const paths = Heyna.getPaths();
        const pdf = await HeynaPdfGenerator.generate({ paths });
        const dashboard = await HeynaHtmlDashboardGenerator.generate({ paths });
        const executionStartTime = Heyna.getMetadata().executionStartTime;
        Heyna.updateMetadata({
            executionEndTime: new Date(Date.parse(executionStartTime) + 1000).toISOString(),
            runStatus: 'COMPLETED'
        });
        const manager = new HistoryManager({ paths, history, logger: { log() {}, error() {} } });
        await manager.initialize();
        const persisted = await manager.persistRun({ execution, metadata: Heyna.getMetadata(), artifacts: { pdf, dashboard: paths.dashboardDir } });
        const reader = new HistoricalFailureReader({ historyManager: manager, clock: () => new Date('2026-08-03T00:00:00.000Z') });
        const read = await reader.read();
        const analysis = await new FailureTrendAnalyzer({ historicalFailureReader: reader }).analyze();
        const serialized = [
            JSON.stringify(execution),
            fs.readFileSync(paths.executionFile, 'utf8'),
            fs.readFileSync(path.join(persisted.directory, 'execution.json'), 'utf8'),
            fs.readFileSync(path.join(persisted.directory, 'failure-index.json'), 'utf8'),
            fs.readFileSync(path.join(persisted.directory, 'summary.json'), 'utf8'),
            fs.readFileSync(dashboard, 'utf8'),
            fs.readFileSync(pdf).toString('latin1'),
            JSON.stringify(read),
            JSON.stringify(analysis),
            JSON.stringify(consoleOutput)
        ].join('\n');
        for (const sensitive of sensitivePaths) {
            expect(serialized).not.toContain(sensitive);
            expect(serialized).not.toContain(JSON.stringify(sensitive).slice(1, -1));
        }
        for (const sensitiveComponent of ['credential-user_token-secret-output', 'secret-user', 'token-sk-private-123']) {
            expect(serialized).not.toContain(sensitiveComponent);
        }
        const index = JSON.parse(fs.readFileSync(path.join(persisted.directory, 'failure-index.json'), 'utf8'));
        expect(index.testOutcomes.filter(item => item.traceAvailable)).toHaveLength(1);
    } finally {
        console.log = originalLog;
        console.error = originalError;
        Heyna.completeRun();
        Heyna.configure({ projectRoot, artifactRoot: process.env.HEYNA_ARTIFACT_ROOT || projectRoot });
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(sensitiveOutput, { recursive: true, force: true });
    }
});

test('identity fields are bounded', () => {
    expect(() => createTestIdentity({ projectRoot, testCase: 'x'.repeat(513) })).toThrow(/512 character/);
    expect(() => createTestIdentity({ projectRoot, testInfo: info({ titlePath: ['f', ...Array(33).fill('suite'), 'title'] }) })).toThrow(/32 item/);
});

test('volatile values normalize to one semantic failure signature', () => {
    const first = createFailureIdentity({
        projectRoot,
        failureCategory: 'TIMEOUT_FAILURE',
        errorMessage: '2026-08-03T10:11:12.123Z request-id=abc-123 Timeout 5000ms at https://localhost:4173/a?token=secret UUID 123e4567-e89b-12d3-a456-426614174000 browser Chrome 140.0.1 run 12345678',
        stack: `TimeoutError\n    at submit (${path.join(projectRoot, 'tests', 'checkout.spec.js')}:42:9)`
    });
    const second = createFailureIdentity({
        projectRoot,
        failureCategory: 'TIMEOUT_FAILURE',
        errorMessage: '2027-09-04T01:02:03.000Z request-id=other Timeout 9000ms at https://localhost:9999/b?q=private UUID a9876543-e21b-42d3-a456-426614174999 browser Chrome 141.2.3 run 87654321',
        stack: `TimeoutError\n    at submit (${path.join(projectRoot, 'tests', 'checkout.spec.js')}:99:1)`
    });
    expect(first.signature).toBe(second.signature);
    expect(normalizeVolatileText('request-id=SECRET port localhost:4321')).not.toContain('secret');
});

test('bounded path, locale date, and real endpoint normalization preserves business values', () => {
    expect(normalizeVolatileText('at C:\\Users\\x\\a.spec.js:10:2'))
        .toBe(normalizeVolatileText('at C:/Users/x/a.spec.js:99:8'));
    expect(normalizeVolatileText('at /home/private-user/tests/a.spec.js:10:2')).toBe('at <path>');
    expect(normalizeVolatileText('at file:///home/private-user/tests/a.spec.js:10:2')).toBe('at <path>');
    expect(normalizeVolatileText('failed 08/03/2026, 10:11:12 PM'))
        .toBe(normalizeVolatileText('failed 9/4/2027, 1:02:03 AM'));
    for (const endpoint of ['localhost:3000', '127.0.0.1:8080', 'example.test:443', 'api.internal.example:8443', '[::1]:3000']) {
        expect(normalizeVolatileText(`connect ${endpoint}`)).toContain('<host>:<port>');
    }
    for (const [left, right] of [
        ['account:42', 'tenant:43'],
        ['order:1001', 'order:1002'],
        ['selector:2', 'selector:3'],
        ['expected value 41', 'expected value 42'],
        ['expected selector #checkout', 'expected selector #confirm']
    ]) {
        expect(normalizeVolatileText(left)).not.toBe(normalizeVolatileText(right));
        const first = createFailureIdentity({ failureCategory: 'ASSERTION_FAILURE', errorMessage: left, stack: 'AssertionError\n at check (tests/a.spec.js:1:2)' });
        const second = createFailureIdentity({ failureCategory: 'ASSERTION_FAILURE', errorMessage: right, stack: 'AssertionError\n at check (tests/a.spec.js:1:2)' });
        expect(first.signature).not.toBe(second.signature);
    }
});

test('complete English month-name timestamps normalize without collapsing month prose', () => {
    for (const timestamp of [
        'Aug 3, 2026, 10:11 PM',
        'August 3, 2026, 10:11 PM',
        'Jan 2, 2025 9:10 AM',
        'January 2, 2025 09:10:45 AM',
        '3 Aug 2026 22:11',
        '3 August 2026, 22:11:45',
        'aUg 3, 2026, 10:11 pM'
    ]) {
        expect(normalizeVolatileText(`failed ${timestamp}`)).toBe('failed <timestamp>');
    }
    for (const prose of ['May release', 'March report', 'August account', 'January balance']) {
        expect(normalizeVolatileText(prose)).toBe(prose.toLowerCase());
    }
    expect(normalizeVolatileText('August account 42')).not.toBe(normalizeVolatileText('January balance 43'));
});

test('month-name timestamps validate leap years and calendar boundaries before normalization', () => {
    for (const timestamp of [
        'February 29, 2024 13:30',
        'Feb 29, 2000 8:15 PM',
        '29 February 2024 20:15:30',
        '(fEbRuArY 29, 2024, 1:30 am).'
    ]) {
        expect(normalizeVolatileText(`failed ${timestamp}`)).toContain('<timestamp>');
    }
    for (const invalid of [
        'February 29, 2025 13:30', 'February 30, 2024 13:30', 'February 31, 2026 13:30',
        'April 31, 2026 13:30', 'June 31, 2026 13:30', 'November 31, 2026 13:30',
        'March 0, 2026 13:30', 'May 10, 2026 24:30', 'May 10, 2026 13:60',
        'May 10, 2026 13:30:60'
    ]) {
        expect(normalizeVolatileText(invalid)).toBe(invalid.toLowerCase());
    }
    for (const prose of ['May release', 'March report', 'January balance', 'August payment', 'account May', 'selector March']) {
        expect(normalizeVolatileText(prose)).toBe(prose.toLowerCase());
    }
});

test('category and user frame participate in identity while message alone is insufficient', () => {
    const base = { projectRoot, errorMessage: 'expect(page).toHaveURL expected value' };
    const assertion = createFailureIdentity({ ...base, failureCategory: 'ASSERTION_FAILURE', stack: `AssertionError\n at a (${path.join(projectRoot, 'tests', 'a.spec.js')}:1:2)` });
    const timeout = createFailureIdentity({ ...base, failureCategory: 'TIMEOUT_FAILURE', stack: `TimeoutError\n at a (${path.join(projectRoot, 'tests', 'a.spec.js')}:1:2)` });
    const otherFrame = createFailureIdentity({ ...base, failureCategory: 'ASSERTION_FAILURE', stack: `AssertionError\n at b (${path.join(projectRoot, 'tests', 'b.spec.js')}:1:2)` });
    expect(assertion.signature).not.toBe(timeout.signature);
    expect(assertion.signature).not.toBe(otherFrame.signature);
    expect(createRecurrenceKey('chromium', createTestIdentity({ projectRoot, testCase: 'TC' }).testKey, assertion.signature)).toMatch(/^sha256:[a-f0-9]{64}$/);
});

test('serialized failure identity contains no raw secrets, URL, stack, or absolute path', () => {
    const secret = 'super-secret-token';
    const identity = createFailureIdentity({
        projectRoot,
        failureCategory: 'API_FAILURE',
        errorMessage: `API failed at https://example.test/users?token=${secret}`,
        stack: `APIError\n at request (${path.join(projectRoot, 'tests', 'api.spec.js')}:10:3)`
    });
    const serialized = JSON.stringify(identity);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('https://');
    expect(serialized).not.toContain(projectRoot);
    expect(serialized).not.toContain(' at request ');
});
