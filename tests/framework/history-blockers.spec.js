const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { test, expect } = require('@playwright/test');
const HistoryManager = require('../../utils/HistoryManager');
const { DEFAULT_HISTORY_CONFIG, mergeHistoryConfig, resolveArtifactPaths } = require('../../utils/ArtifactPaths');
const { atomicWriteJson } = require('../../utils/JsonFile');
const { validateSummary } = require('../../utils/HistoryValidation');
const { groupFailures } = require('../../utils/FailureGrouping');
const { generateInsights } = require('../../utils/FailureSummaryEngine');
const { clusterRootCauses } = require('../../utils/RootCauseClusterer');
const HeynaPdfGenerator = require('../../utils/HeynaPdfGenerator');
const HeynaHtmlDashboardGenerator = require('../../utils/HeynaHtmlDashboardGenerator');
const HeynaReporter = require('../../utils/HeynaReporter');

const projectRoot = path.resolve(__dirname, '..', '..');
const roots = new Set();

function tempRoot(prefix = 'heyna-blocker-') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    roots.add(root);
    return root;
}

function history(overrides = {}) {
    return mergeHistoryConfig({ enabled: true, migration: { enabled: false }, lock: { retryDelayMs: 10, maxRetries: 100, staleMs: 1000 } }, overrides);
}

function managerFor(artifactRoot, overrides = {}, options = {}) {
    const config = history(overrides);
    const paths = resolveArtifactPaths({ projectRoot, artifactRoot, config: { history: config } });
    return new HistoryManager({ paths, history: config, logger: options.logger || { log() {}, error() {} }, ...options });
}

function metadata(start = '2026-07-01T10:00:00.000Z', end = start) {
    return { project: 'History', executionStartTime: start, executionEndTime: end };
}

function item(status = 'PASSED', duration = 1, extra = {}) {
    return { testCase: `TC_${status}`, status, duration, traceAvailable: false, ...extra };
}

function fileSystemProxy(overrides = {}) {
    return Object.assign(Object.create(fs), overrides);
}

function createClaim(manager, options = {}) {
    const token = options.token || 'a'.repeat(24);
    const pid = options.pid ?? (options.malformed ? 2147483647 : process.pid);
    const claimDir = manager.lockClaimPath(token, pid);
    fs.mkdirSync(claimDir, { recursive: true });
    if (options.malformed) {
        fs.writeFileSync(path.join(claimDir, 'owner.json'), '{ malformed');
    } else {
        const owner = {
            pid,
            createdAt: options.createdAt || new Date().toISOString(),
            token
        };
        fs.writeFileSync(path.join(claimDir, 'owner.json'), JSON.stringify(owner));
        fs.writeFileSync(path.join(claimDir, 'ticket.json'), JSON.stringify({ token, number: options.ticket || 1 }));
    }
    if (options.old) {
        const old = new Date(Date.now() - 1000);
        fs.utimesSync(claimDir, old, old);
    }
    return { token, claimDir };
}

function claimOwner(manager, token) {
    const directory = fs.readdirSync(manager.paths.historyLockClaimsDir).find(name => name.endsWith(`-${token}`));
    if (!directory) throw new Error(`Lock claim not found for token ${token}`);
    return JSON.parse(fs.readFileSync(path.join(manager.paths.historyLockClaimsDir, directory, 'owner.json'), 'utf8'));
}

function lockArtifacts(manager) {
    if (!fs.existsSync(manager.paths.historyLockFile)) return [];
    const result = [];
    const visit = directory => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const target = path.join(directory, entry.name);
            result.push(path.relative(manager.paths.historyLockFile, target));
            if (entry.isDirectory()) visit(target);
        }
    };
    visit(manager.paths.historyLockFile);
    return result.sort();
}

function startChild(root, action = 'persist', options = {}) {
    const encoded = Buffer.from(JSON.stringify(options)).toString('base64');
    const child = spawn(process.execPath, [path.join(projectRoot, 'tests', 'fixtures', 'history-writer.js'), projectRoot, root, action, encoded], {
        cwd: projectRoot,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    const completion = new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill();
        }, options.timeoutMs || 10000);
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.on('close', (code, signal) => {
            clearTimeout(timer);
            resolve({ code, signal, timedOut, stdout, stderr });
        });
    });
    return { child, completion };
}

function runChild(root, action = 'persist', options = {}) {
    return startChild(root, action, options).completion;
}

async function waitForFile(file, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (!fs.existsSync(file)) {
        if (Date.now() >= deadline) throw new Error(`Timed out waiting for child signal: ${file}`);
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}

test.afterEach(() => {
    HeynaReporter.configure({ projectRoot, artifactRoot: process.env.HEYNA_ARTIFACT_ROOT || projectRoot });
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
    roots.clear();
});

test.describe('authoritative configuration and safe paths', () => {
    test('no history configuration uses the disabled authoritative default', () => {
        const paths = resolveArtifactPaths({ projectRoot, artifactRoot: tempRoot(), config: {} });
        expect(paths.history).toEqual({
            ...DEFAULT_HISTORY_CONFIG,
            retention: { ...DEFAULT_HISTORY_CONFIG.retention },
            artifacts: { ...DEFAULT_HISTORY_CONFIG.artifacts },
            migration: { ...DEFAULT_HISTORY_CONFIG.migration },
            lock: { ...DEFAULT_HISTORY_CONFIG.lock }
        });
        expect(paths.history.enabled).toBe(false);
    });

    test('partial top-level and nested configurations preserve defaults', () => {
        const merged = mergeHistoryConfig(
            { rootDir: 'custom-history', retention: { maxRuns: 20 }, artifacts: { evidence: false } },
            { artifacts: { pdf: false }, retention: { enabled: true }, migration: { enabled: false }, lock: { maxRetries: 7 } }
        );
        expect(merged).toMatchObject({
            enabled: false,
            rootDir: 'custom-history',
            runsDir: 'runs',
            latestFile: 'latest.json',
            artifacts: { execution: true, metadata: true, pdf: false, dashboard: true, evidence: false, traces: true },
            retention: { enabled: true, maxRuns: 20, maxAgeDays: null },
            migration: { enabled: false, stateFile: '.migration-state.json' },
            lock: { file: '.history.lock', maxRetries: 7 }
        });
    });

    test('HistoryManager merges raw partial history options', () => {
        const root = tempRoot();
        const manager = new HistoryManager({ projectRoot, artifactRoot: root, history: { enabled: true, artifacts: { pdf: false } } });
        expect(manager.config.artifacts).toMatchObject({ execution: true, metadata: true, pdf: false, dashboard: true, evidence: true, traces: true });
        expect(manager.config.retention).toEqual({ enabled: false, maxRuns: null, maxAgeDays: null });
    });

    test('project root metadata remains available with isolated artifact and custom history roots', async () => {
        const fakeProject = tempRoot('heyna-project-');
        const artifactRoot = tempRoot('heyna-artifacts-');
        fs.writeFileSync(path.join(fakeProject, 'package.json'), JSON.stringify({ version: '9.8.7-next.0' }));
        const config = history({ rootDir: 'custom/output-history' });
        const paths = resolveArtifactPaths({ projectRoot: fakeProject, artifactRoot, config: { history: config } });
        const manager = new HistoryManager({ paths, history: config, logger: { log() {}, error() {} } });
        const result = await manager.persistRun({ execution: [item()], metadata: metadata() });
        const schema = JSON.parse(fs.readFileSync(path.join(result.directory, 'schema.json')));
        expect(paths.projectRoot).toBe(fakeProject);
        expect(paths.artifactRoot).toBe(artifactRoot);
        expect(paths.historyRoot).toBe(path.join(artifactRoot, 'custom', 'output-history'));
        expect(schema.heynaVersion).toBe('9.8.7-next.0');
    });

    for (const [name, override] of [
        ['absolute runsDir', { runsDir: path.resolve(os.tmpdir(), 'runs') }],
        ['absolute tempDir', { tempDir: path.resolve(os.tmpdir(), 'temp') }],
        ['runsDir traversal', { runsDir: '../runs' }],
        ['tempDir traversal', { tempDir: '../temp' }],
        ['latest traversal', { latestFile: '../latest.json' }],
        ['lock traversal', { lock: { file: '../lock' } }],
        ['migration state traversal', { migration: { stateFile: '../state.json' } }]
    ]) {
        test(`rejects ${name}`, () => {
            expect(() => resolveArtifactPaths({ projectRoot, artifactRoot: tempRoot(), config: { history: history(override) } })).toThrow(/relative|inside/);
        });
    }

    test('documents Git ignore responsibility for custom repository history roots', () => {
        const documentation = fs.readFileSync(path.join(projectRoot, 'docs', 'history-storage.md'), 'utf8');
        expect(documentation).toContain('If `history.rootDir` points to a custom location inside a repository');
        expect(documentation).toContain("add that custom runtime path to the repository's own `.gitignore`");
    });
});

test.describe('bounded lock configuration', () => {
    test('accepts zero retries, zero delay, zero stale age, and positive retry values', () => {
        expect(mergeHistoryConfig({ lock: { maxRetries: 0, retryDelayMs: 0, staleMs: 0 } }).lock)
            .toMatchObject({ maxRetries: 0, retryDelayMs: 0, staleMs: 0 });
        expect(mergeHistoryConfig({ lock: { maxRetries: 3, retryDelayMs: 1.5, staleMs: 10 } }).lock)
            .toMatchObject({ maxRetries: 3, retryDelayMs: 1.5, staleMs: 10 });
    });

    test('rejects a malformed lock configuration object', () => {
        expect(() => mergeHistoryConfig({ lock: 'invalid' })).toThrow(/history\.lock must be an object/);
    });

    for (const [name, value] of [
        ['Infinity', Number.POSITIVE_INFINITY],
        ['NaN', Number.NaN],
        ['negative', -1],
        ['fractional', 1.5],
        ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
        ['string', '3']
    ]) {
        test(`rejects ${name} maxRetries`, () => {
            expect(() => mergeHistoryConfig({ lock: { maxRetries: value } })).toThrow(/maxRetries.*safe non-negative integer/);
        });
    }

    for (const [field, value] of [
        ['retryDelayMs', Number.POSITIVE_INFINITY],
        ['retryDelayMs', -1],
        ['retryDelayMs', '0'],
        ['staleMs', Number.NaN],
        ['staleMs', -1],
        ['staleMs', '0']
    ]) {
        test(`rejects invalid ${field} value ${String(value)}`, () => {
            expect(() => mergeHistoryConfig({ lock: { [field]: value } })).toThrow(new RegExp(`${field}.*finite non-negative number`));
        });
    }

    test('finite retry configuration terminates when a live lock remains busy', async () => {
        const root = tempRoot();
        const manager = managerFor(root, { lock: { maxRetries: 2, retryDelayMs: 0, staleMs: 0 } });
        manager.ensureHistoryDirectories();
        const live = createClaim(manager, { token: '1'.repeat(24), pid: process.pid, ticket: 1 });
        const started = Date.now();
        await expect(manager.acquireHistoryLock()).rejects.toThrow(/busy after 3 lock attempts/);
        expect(Date.now() - started).toBeLessThan(1000);
        expect(claimOwner(manager, live.token).token).toBe(live.token);
    });

    test('a claim publication collision never removes the existing owner path', async () => {
        const root = tempRoot();
        const base = managerFor(root);
        let existingClaimDir;
        const injected = fileSystemProxy({
            mkdirSync(directory, options) {
                if (!existingClaimDir && path.dirname(directory) === base.paths.historyLockClaimsDir) {
                    fs.mkdirSync(directory, options);
                    existingClaimDir = directory;
                    const identity = base.parseLockClaimName(path.basename(directory));
                    fs.writeFileSync(path.join(directory, 'owner.json'), JSON.stringify({
                        ...identity,
                        createdAt: new Date().toISOString()
                    }));
                    fs.writeFileSync(path.join(directory, 'ticket.json'), JSON.stringify({ token: identity.token, number: 1 }));
                    const error = new Error('injected claim collision');
                    error.code = 'EEXIST';
                    throw error;
                }
                return fs.mkdirSync(directory, options);
            }
        });
        const manager = managerFor(root, { lock: { maxRetries: 0, retryDelayMs: 0, staleMs: 0 } }, { fileSystem: injected });
        await expect(manager.acquireHistoryLock()).rejects.toThrow(/busy after 1 lock attempts/);
        expect(existingClaimDir).toBeTruthy();
        expect(fs.existsSync(existingClaimDir)).toBe(true);
    });

    test('recovers a malformed expired lock without leaving lock state behind', async () => {
        const root = tempRoot();
        const manager = managerFor(root, { lock: { staleMs: 0 } });
        manager.ensureHistoryDirectories();
        createClaim(manager, { token: '2'.repeat(24), malformed: true, old: true });
        const initialized = await manager.initialize();
        expect(initialized.enabled).toBe(true);
        expect(fs.existsSync(manager.paths.historyLockFile)).toBe(false);
    });

    test('stale recovery removes only its token-scoped claim when a live claim appears at the deletion boundary', () => {
        const root = tempRoot();
        const base = managerFor(root, { lock: { staleMs: 0 } });
        base.ensureHistoryDirectories();
        const stale = createClaim(base, { token: '3'.repeat(24), pid: 2147483647, createdAt: '2000-01-01T00:00:00.000Z' });
        const replacementToken = '4'.repeat(24);
        let replacedAtBoundary = false;
        const injected = fileSystemProxy({
            rmSync(file, options) {
                if (file === stale.claimDir && !replacedAtBoundary) {
                    replacedAtBoundary = true;
                    createClaim(base, { token: replacementToken, pid: process.pid, ticket: 2 });
                }
                return fs.rmSync(file, options);
            }
        });
        const manager = managerFor(root, { lock: { staleMs: 0 } }, { fileSystem: injected });
        expect(manager.recoverStaleLock()).toBe(true);
        expect(replacedAtBoundary).toBe(true);
        expect(fs.existsSync(stale.claimDir)).toBe(false);
        expect(claimOwner(base, replacementToken).token).toBe(replacementToken);
    });
});

test.describe('reporter project configuration reload', () => {
    test('switches project roots without leakage and keeps explicit overrides highest priority', async () => {
        const projectA = tempRoot('heyna-project-a-');
        const projectB = tempRoot('heyna-project-b-');
        const artifactsA = tempRoot('heyna-artifacts-a-');
        const artifactsB = tempRoot('heyna-artifacts-b-');
        fs.writeFileSync(path.join(projectA, 'package.json'), JSON.stringify({ version: '1.2.3-next.0' }));
        fs.writeFileSync(path.join(projectB, 'package.json'), JSON.stringify({ version: '9.8.7-next.0' }));
        fs.writeFileSync(path.join(projectA, 'heyna.config.js'), `module.exports = {
            project: 'Project A',
            history: { enabled: true, rootDir: 'history-a', artifacts: { evidence: false } }
        };\n`);
        fs.writeFileSync(path.join(projectB, 'heyna.config.js'), `module.exports = {
            project: 'Project B',
            history: { enabled: false, rootDir: 'history-b', artifacts: { pdf: false } }
        };\n`);

        HeynaReporter.configure({ projectRoot: projectA, artifactRoot: artifactsA });
        expect(HeynaReporter.getConfig()).toMatchObject({ project: 'Project A', projectRoot: projectA });
        expect(HeynaReporter.getConfig().history).toMatchObject({ enabled: true, rootDir: 'history-a', artifacts: { evidence: false } });
        expect(HeynaReporter.getPaths().historyRoot).toBe(path.join(artifactsA, 'history-a'));

        HeynaReporter.configure({ history: { enabled: false, rootDir: 'runtime-a' } });
        expect(HeynaReporter.getConfig().history).toMatchObject({ enabled: false, rootDir: 'runtime-a' });

        HeynaReporter.configure({ projectRoot: projectB, artifactRoot: artifactsB });
        expect(HeynaReporter.getConfig()).toMatchObject({ project: 'Project B', projectRoot: projectB, artifactRoot: artifactsB });
        expect(HeynaReporter.getConfig().history).toMatchObject({ enabled: false, rootDir: 'history-b', artifacts: { pdf: false, evidence: true } });
        expect(HeynaReporter.getPaths().historyRoot).toBe(path.join(artifactsB, 'history-b'));

        HeynaReporter.configure({
            history: {
                enabled: true,
                rootDir: 'runtime-b',
                migration: { enabled: false },
                artifacts: { pdf: false, dashboard: false, evidence: false, traces: false }
            }
        });
        const paths = HeynaReporter.getPaths();
        const manager = new HistoryManager({ paths, history: HeynaReporter.getConfig().history, logger: { log() {}, error() {} } });
        const result = await manager.persistRun({ execution: [item()], metadata: metadata() });
        const schema = JSON.parse(fs.readFileSync(path.join(result.directory, 'schema.json')));
        expect(paths.historyRoot).toBe(path.join(artifactsB, 'runtime-b'));
        expect(schema.heynaVersion).toBe('9.8.7-next.0');
        expect(HeynaReporter.getConfig().project).toBe('Project B');
    });
});

test.describe('summary schema and status metrics', () => {
    test('mixed final statuses satisfy counts and unsuccessful invariant', () => {
        const manager = managerFor(tempRoot());
        const execution = ['PASSED', 'FAILED', 'SKIPPED', 'TIMEDOUT', 'INTERRUPTED'].map(status => item(status, 2));
        const summary = manager.buildSummary('20260701-100000-000-aaaaaaaa', execution, metadata(), '2026-07-01T10:00:00Z');
        expect(summary).toMatchObject({ total: 5, passed: 1, failed: 1, skipped: 1, timedOut: 1, interrupted: 1, unsuccessful: 3, passRate: 20, totalDuration: 10 });
        expect(summary.total).toBe(summary.passed + summary.failed + summary.skipped + summary.timedOut + summary.interrupted);
    });

    for (const status of ['RUNNING', 'UNKNOWN', 'BROKEN']) {
        test(`rejects incomplete final status ${status}`, async () => {
            const manager = managerFor(tempRoot());
            await expect(manager.persistRun({ execution: [item(status)], metadata: metadata() })).rejects.toThrow(/unsupported final status/);
        });
    }

    test('rejects invalid and reversed timestamps', async () => {
        const manager = managerFor(tempRoot());
        await expect(manager.persistRun({ execution: [item()], metadata: metadata('not-a-date') })).rejects.toThrow(/ISO-8601/);
        await expect(manager.persistRun({ execution: [item()], metadata: metadata('2026-07-02T00:00:00Z', '2026-07-01T00:00:00Z') })).rejects.toThrow(/endTime/);
    });

    test('rejects invalid durations and count invariants', () => {
        const manager = managerFor(tempRoot());
        expect(() => manager.buildSummary('20260701-100000-000-aaaaaaaa', [item('PASSED', -1)], metadata(), '2026-07-01T10:00:00Z')).toThrow(/duration/);
        const summary = manager.buildSummary('20260701-100000-000-aaaaaaaa', [item()], metadata(), '2026-07-01T10:00:00Z');
        expect(() => validateSummary({ ...summary, total: 2 })).toThrow(/must equal/);
        expect(() => validateSummary({ ...summary, totalDuration: Number.NaN })).toThrow(/finite/);
        expect(() => validateSummary({ ...summary, failed: -1 })).toThrow(/non-negative/);
    });
});

test.describe('manifest and trace contract', () => {
    test('manifest is always present even with an empty artifact list', async () => {
        const manager = managerFor(tempRoot(), { artifacts: { execution: false, metadata: false, pdf: false, dashboard: false, evidence: false, traces: false } });
        const result = await manager.persistRun({ execution: [item()], metadata: metadata() });
        expect(JSON.parse(fs.readFileSync(path.join(result.directory, 'manifest.json')))).toEqual({ artifacts: [] });
    });

    test('directory size is aggregate and directory checksum is absent', async () => {
        const root = tempRoot();
        const evidence = path.join(root, 'source-evidence');
        fs.mkdirSync(evidence);
        fs.writeFileSync(path.join(evidence, 'a.txt'), 'abc');
        fs.writeFileSync(path.join(evidence, 'b.txt'), '12345');
        const manager = managerFor(root);
        const result = await manager.persistRun({ execution: [item()], metadata: metadata(), artifacts: { evidence, pdf: false, dashboard: false } });
        const entry = result && JSON.parse(fs.readFileSync(path.join(result.directory, 'manifest.json'))).artifacts.find(value => value.type === 'evidence');
        expect(entry).toMatchObject({ size: 8, availability: true });
        expect(entry.checksum).toBeUndefined();
    });

    test('retrieval rejects manifest traversal, size mismatch, and checksum mismatch', async () => {
        const manager = managerFor(tempRoot());
        const result = await manager.persistRun({ execution: [item()], metadata: metadata(), artifacts: { pdf: false, dashboard: false, evidence: false } });
        const file = path.join(result.directory, 'manifest.json');
        const original = JSON.parse(fs.readFileSync(file));
        atomicWriteJson(file, { artifacts: [{ ...original.artifacts[0], path: '../outside.json' }] });
        await expect(manager.getRun(result.runId)).rejects.toThrow(/escapes|relative/);
        atomicWriteJson(file, { artifacts: [{ ...original.artifacts[0], size: original.artifacts[0].size + 1 }] });
        await expect(manager.getRun(result.runId)).rejects.toThrow(/size mismatch/);
        atomicWriteJson(file, { artifacts: [{ ...original.artifacts[0], checksum: `sha256:${'0'.repeat(64)}` }] });
        await expect(manager.getRun(result.runId)).rejects.toThrow(/checksum mismatch/);
    });

    test('reported traces are distinct from traces actually preserved', async () => {
        const manager = managerFor(tempRoot());
        const result = await manager.persistRun({
            execution: [item('FAILED', 1, { traceAvailable: true, traceFile: 'missing/trace.zip' })],
            metadata: metadata(),
            artifacts: { pdf: false, dashboard: false, evidence: false }
        });
        expect(result.summary).toMatchObject({ traceReportedCount: 1, tracePreservedCount: 0, traceAvailableCount: 0 });
    });
});

test.describe('mandatory publication validation', () => {
    test('constructor validator options cannot bypass required final-status validation', async () => {
        const root = tempRoot();
        const manager = managerFor(root, {}, {
            validators: {
                summary: value => value,
                manifest: value => value,
                finalStatuses() {}
            }
        });
        manager.validators = {
            summary: value => value,
            manifest: value => value,
            finalStatuses() {}
        };
        await expect(manager.persistRun({ execution: [item('RUNNING')], metadata: metadata() })).rejects.toThrow(/unsupported final status/);
        expect(fs.readdirSync(manager.paths.historyRunsDir)).toEqual([]);
        expect(fs.readdirSync(manager.paths.historyTempDir)).toEqual([]);
        expect(fs.existsSync(manager.paths.historyLockFile)).toBe(false);
    });

    test('staged summary mutation fails mandatory validation and publishes nothing', async () => {
        const root = tempRoot();
        const base = managerFor(root);
        const injected = fileSystemProxy({
            renameSync(source, destination) {
                fs.renameSync(source, destination);
                if (path.basename(destination) === 'summary.json' && destination.startsWith(base.paths.historyTempDir)) {
                    const summary = JSON.parse(fs.readFileSync(destination, 'utf8'));
                    fs.writeFileSync(destination, JSON.stringify({ ...summary, total: summary.total + 1 }));
                }
            }
        });
        const manager = managerFor(root, {}, { fileSystem: injected });
        await expect(manager.persistRun({ execution: [item()], metadata: metadata() })).rejects.toThrow(/must equal/);
        expect(fs.readdirSync(manager.paths.historyRunsDir)).toEqual([]);
        expect(fs.readdirSync(manager.paths.historyTempDir)).toEqual([]);
        expect(fs.existsSync(manager.paths.historyLockFile)).toBe(false);
    });

    test('staged manifest mutation fails mandatory validation and publishes nothing', async () => {
        const root = tempRoot();
        const base = managerFor(root);
        const injected = fileSystemProxy({
            renameSync(source, destination) {
                fs.renameSync(source, destination);
                if (path.basename(destination) === 'manifest.json' && destination.startsWith(base.paths.historyTempDir)) {
                    const manifest = JSON.parse(fs.readFileSync(destination, 'utf8'));
                    manifest.artifacts[0].path = '../outside.json';
                    fs.writeFileSync(destination, JSON.stringify(manifest));
                }
            }
        });
        const manager = managerFor(root, {}, { fileSystem: injected });
        await expect(manager.persistRun({ execution: [item()], metadata: metadata() })).rejects.toThrow(/escapes|relative/);
        expect(fs.readdirSync(manager.paths.historyRunsDir)).toEqual([]);
        expect(fs.readdirSync(manager.paths.historyTempDir)).toEqual([]);
        expect(fs.existsSync(manager.paths.historyLockFile)).toBe(false);
    });
});

test.describe('latest recovery, retention, and date queries', () => {
    test('latest is selected by timestamp, not publication finish order', async () => {
        const manager = managerFor(tempRoot());
        const newest = await manager.persistRun({ execution: [item()], metadata: metadata('2026-07-03T00:00:00Z') });
        await manager.persistRun({ execution: [item()], metadata: metadata('2026-07-01T00:00:00Z') });
        expect((await manager.getLatestRun()).runId).toBe(newest.runId);
        expect(JSON.parse(fs.readFileSync(manager.paths.historyLatestFile)).runId).toBe(newest.runId);
    });

    test('missing, corrupt, stale, and missing-run latest pointers recover by scan', async () => {
        const manager = managerFor(tempRoot());
        const older = await manager.persistRun({ execution: [item()], metadata: metadata('2026-07-01T00:00:00Z') });
        const newest = await manager.persistRun({ execution: [item()], metadata: metadata('2026-07-02T00:00:00Z') });
        fs.rmSync(manager.paths.historyLatestFile);
        expect((await manager.getLatestRun()).runId).toBe(newest.runId);
        fs.writeFileSync(manager.paths.historyLatestFile, '{ broken');
        expect((await manager.getLatestRun()).runId).toBe(newest.runId);
        atomicWriteJson(manager.paths.historyLatestFile, manager.latestPointer(older.summary));
        expect((await manager.getLatestRun()).runId).toBe(newest.runId);
        atomicWriteJson(manager.paths.historyLatestFile, { ...manager.latestPointer(newest.summary), runId: '20260701-000000-000-deadbeef' });
        expect((await manager.getLatestRun()).runId).toBe(newest.runId);
        await manager.repairLatestPointer();
        expect(JSON.parse(fs.readFileSync(manager.paths.historyLatestFile)).runId).toBe(newest.runId);
    });

    test('retention removes a deleted latest pointer before a failed replacement', async () => {
        const root = tempRoot();
        const base = managerFor(root);
        const older = await base.persistRun({ execution: [item()], metadata: metadata('2026-07-01T00:00:00Z') });
        const newest = await base.persistRun({ execution: [item()], metadata: metadata('2026-07-02T00:00:00Z') });
        atomicWriteJson(base.paths.historyLatestFile, base.latestPointer(older.summary));
        const failing = fileSystemProxy({
            renameSync(source, destination) {
                if (destination === base.paths.historyLatestFile) throw new Error('latest rename injected');
                return fs.renameSync(source, destination);
            }
        });
        const manager = managerFor(root, { retention: { enabled: true, maxRuns: 1 } }, { fileSystem: failing });
        const retained = await manager.enforceRetention();
        expect(retained.deletedRunIds).toEqual([older.runId]);
        expect(retained.warnings.map(value => value.code)).toContain('HEYNA_LATEST_UPDATE_FAILED');
        expect(fs.existsSync(base.paths.historyLatestFile)).toBe(false);
        expect((await manager.getLatestRun()).runId).toBe(newest.runId);
    });

    test('date ranges are inclusive, deterministic, and reject invalid or reversed ranges', async () => {
        const manager = managerFor(tempRoot());
        const first = await manager.persistRun({ execution: [item()], metadata: metadata('2026-07-01T00:00:00Z') });
        const second = await manager.persistRun({ execution: [item()], metadata: metadata('2026-07-02T00:00:00Z') });
        expect((await manager.queryRunsByDateRange('2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z')).map(run => run.runId)).toEqual([second.runId, first.runId]);
        await expect(manager.queryRunsByDateRange('invalid', '2026-07-02T00:00:00Z')).rejects.toThrow(/ISO-8601/);
        await expect(manager.queryRunsByDateRange('2026-07-03T00:00:00Z', '2026-07-02T00:00:00Z')).rejects.toThrow(/must not be later/);
    });

    test('corrupt timestamps are skipped and empty history is supported', async () => {
        const empty = managerFor(tempRoot());
        expect(await empty.listRuns()).toEqual([]);
        expect(await empty.getLatestRun()).toBeNull();
        const manager = managerFor(tempRoot());
        const result = await manager.persistRun({ execution: [item()], metadata: metadata() });
        const file = path.join(result.directory, 'summary.json');
        atomicWriteJson(file, { ...result.summary, timestamp: 'corrupt' });
        expect(await manager.listRuns()).toEqual([]);
    });
});

test.describe('filesystem failure injection', () => {
    test('staged JSON write failure cleans temp and preserves current output', async () => {
        const root = tempRoot();
        const base = managerFor(root);
        fs.mkdirSync(base.paths.resultDir, { recursive: true });
        atomicWriteJson(base.paths.executionFile, [item()]);
        atomicWriteJson(base.paths.metadataFile, metadata());
        const injected = fileSystemProxy({
            writeFileSync(file, ...args) {
                if (typeof file === 'string' && path.basename(file).startsWith('.summary.json.')) throw new Error('summary write injected');
                return fs.writeFileSync(file, ...args);
            }
        });
        const manager = managerFor(root, {}, { fileSystem: injected });
        await expect(manager.persistRun()).rejects.toThrow(/summary write injected/);
        expect(fs.readdirSync(manager.paths.historyRunsDir)).toEqual([]);
        expect(fs.readdirSync(manager.paths.historyTempDir)).toEqual([]);
        expect(JSON.parse(fs.readFileSync(base.paths.executionFile))[0].status).toBe('PASSED');
        expect(fs.existsSync(manager.paths.historyLockFile)).toBe(false);
    });

    test('artifact copy, staged validation, and final rename failures publish nothing', async () => {
        const root = tempRoot();
        const pdf = path.join(root, 'source.pdf');
        fs.writeFileSync(pdf, 'pdf');
        const copyManager = managerFor(root, {}, { fileSystem: fileSystemProxy({ copyFileSync() { throw new Error('copy injected'); } }) });
        await expect(copyManager.persistRun({ execution: [item()], metadata: metadata(), artifacts: { pdf, dashboard: false, evidence: false } })).rejects.toThrow(/copy injected/);

        const validationBase = managerFor(root);
        const validationFs = fileSystemProxy({
            renameSync(source, destination) {
                fs.renameSync(source, destination);
                if (path.basename(destination) === 'summary.json' && destination.startsWith(validationBase.paths.historyTempDir)) {
                    const summary = JSON.parse(fs.readFileSync(destination, 'utf8'));
                    fs.writeFileSync(destination, JSON.stringify({ ...summary, total: summary.total + 1 }));
                }
            }
        });
        const validationManager = managerFor(root, {}, { fileSystem: validationFs });
        await expect(validationManager.persistRun({ execution: [item()], metadata: metadata(), artifacts: { pdf: false, dashboard: false, evidence: false } })).rejects.toThrow(/must equal/);

        const normal = managerFor(root);
        const renameFs = fileSystemProxy({
            renameSync(source, destination) {
                if (path.dirname(destination) === normal.paths.historyRunsDir) throw new Error('final rename injected');
                return fs.renameSync(source, destination);
            }
        });
        const renameManager = managerFor(root, {}, { fileSystem: renameFs });
        await expect(renameManager.persistRun({ execution: [item()], metadata: metadata(), artifacts: { pdf: false, dashboard: false, evidence: false } })).rejects.toThrow(/final rename injected/);
        expect(fs.readdirSync(normal.paths.historyRunsDir)).toEqual([]);
        expect(fs.readdirSync(normal.paths.historyTempDir)).toEqual([]);
        expect(fs.existsSync(normal.paths.historyLockFile)).toBe(false);
    });

    test('latest failure returns a warning without deleting the completed run', async () => {
        const root = tempRoot();
        const base = managerFor(root);
        const injected = fileSystemProxy({
            renameSync(source, destination) {
                if (destination === base.paths.historyLatestFile) throw new Error('latest injected');
                return fs.renameSync(source, destination);
            }
        });
        const manager = managerFor(root, {}, { fileSystem: injected });
        const result = await manager.persistRun({ execution: [item()], metadata: metadata() });
        expect(result.warnings.map(value => value.code)).toContain('HEYNA_LATEST_UPDATE_FAILED');
        expect(fs.existsSync(result.directory)).toBe(true);
        expect((await manager.getLatestRun()).runId).toBe(result.runId);

        const writeRoot = tempRoot();
        const writeBase = managerFor(writeRoot);
        const writeInjected = fileSystemProxy({
            writeFileSync(file, ...args) {
                if (typeof file === 'string' && path.basename(file).startsWith('.latest.json.')) throw new Error('latest temporary write injected');
                return fs.writeFileSync(file, ...args);
            }
        });
        const writeManager = managerFor(writeRoot, {}, { fileSystem: writeInjected });
        const writeResult = await writeManager.persistRun({ execution: [item()], metadata: metadata() });
        expect(writeResult.warnings.map(value => value.code)).toContain('HEYNA_LATEST_UPDATE_FAILED');
        expect(fs.existsSync(writeResult.directory)).toBe(true);
        expect(fs.readdirSync(writeManager.paths.historyRoot).filter(name => name.endsWith('.tmp'))).toEqual([]);
    });

    test('lock acquisition and release failures are explicit and recoverable', async () => {
        const root = tempRoot();
        const base = managerFor(root);
        const acquireFs = fileSystemProxy({
            mkdirSync(directory, ...args) {
                if (path.dirname(directory) === base.paths.historyLockClaimsDir && /^\d+-[a-f0-9]{24}$/.test(path.basename(directory))) {
                    const error = new Error('lock denied'); error.code = 'EACCES'; throw error;
                }
                return fs.mkdirSync(directory, ...args);
            }
        });
        await expect(managerFor(root, {}, { fileSystem: acquireFs }).persistRun({ execution: [item()], metadata: metadata() })).rejects.toThrow(/Could not acquire/);

        let failedRelease = false;
        const releaseFs = fileSystemProxy({
            rmSync(file, options) {
                if (path.dirname(file) === base.paths.historyLockClaimsDir && !failedRelease) { failedRelease = true; throw new Error('release injected'); }
                return fs.rmSync(file, options);
            }
        });
        await expect(managerFor(root, {}, { fileSystem: releaseFs }).persistRun({ execution: [item()], metadata: metadata() })).rejects.toThrow(/Could not release/);
        expect(fs.existsSync(base.paths.historyLockFile)).toBe(true);
        const recovered = await base.persistRun({ execution: [item()], metadata: metadata('2026-07-02T00:00:00Z') });
        expect(recovered.persisted).toBe(true);
        expect(fs.existsSync(base.paths.historyLockFile)).toBe(false);
    });

    test('owner-token mismatch during release preserves the foreign claim', async () => {
        const manager = managerFor(tempRoot());
        manager.ensureHistoryDirectories();
        const owner = await manager.acquireHistoryLock();
        const ownerFile = path.join(owner.claimDir, 'owner.json');
        const foreign = { ...JSON.parse(fs.readFileSync(ownerFile, 'utf8')), token: 'f'.repeat(24) };
        fs.writeFileSync(ownerFile, JSON.stringify(foreign));
        expect(() => manager.releaseHistoryLock(owner)).toThrow(/ownership changed/);
        expect(fs.existsSync(owner.claimDir)).toBe(true);
    });

    test('retention deletion and migration publication failures are explicit', async () => {
        const root = tempRoot();
        const base = managerFor(root);
        const old = await base.persistRun({ execution: [item()], metadata: metadata('2026-07-01T00:00:00Z') });
        await base.persistRun({ execution: [item()], metadata: metadata('2026-07-02T00:00:00Z') });
        const deletionFs = fileSystemProxy({
            rmSync(file, options) {
                if (file === old.directory) throw new Error('deletion injected');
                return fs.rmSync(file, options);
            }
        });
        const retained = await managerFor(root, { retention: { enabled: true, maxRuns: 1 } }, { fileSystem: deletionFs }).enforceRetention();
        expect(retained.warnings.map(value => value.code)).toContain('HEYNA_RETENTION_DELETE_FAILED');
        expect(fs.existsSync(old.directory)).toBe(true);

        const migrationRoot = tempRoot();
        const migrationBase = managerFor(migrationRoot, { migration: { enabled: true } });
        fs.mkdirSync(migrationBase.paths.legacyExecutionsDir, { recursive: true });
        fs.writeFileSync(path.join(migrationBase.paths.legacyExecutionsDir, 'legacy.json'), JSON.stringify({ execution: [item()], metadata: metadata() }));
        const migrationFs = fileSystemProxy({
            renameSync(source, destination) {
                if (path.dirname(destination) === migrationBase.paths.historyRunsDir) throw new Error('migration publish injected');
                return fs.renameSync(source, destination);
            }
        });
        const initialized = await managerFor(migrationRoot, { migration: { enabled: true } }, { fileSystem: migrationFs }).initialize();
        expect(initialized.migrated[0]).toMatchObject({ migrated: false });
        expect(fs.readdirSync(migrationBase.paths.historyRunsDir)).toEqual([]);
        expect(fs.existsSync(path.join(migrationBase.paths.legacyExecutionsDir, 'legacy.json'))).toBe(true);
    });
});

test.describe('migration reconciliation', () => {
    test('state-write failure is explicit and retry repairs state without a duplicate run', async () => {
        const root = tempRoot('heyna-migration-state-');
        const base = managerFor(root, { migration: { enabled: true } });
        fs.mkdirSync(base.paths.legacyExecutionsDir, { recursive: true });
        const source = path.join(base.paths.legacyExecutionsDir, 'legacy.json');
        const original = JSON.stringify({ execution: [item()], metadata: metadata() });
        fs.writeFileSync(source, original);
        const injected = fileSystemProxy({
            renameSync(from, destination) {
                if (destination === base.paths.historyMigrationStateFile) throw new Error('migration state write injected');
                return fs.renameSync(from, destination);
            }
        });
        const first = await managerFor(root, { migration: { enabled: true } }, { fileSystem: injected }).initialize();
        expect(first.migrated).toHaveLength(1);
        expect(first.migrated[0]).toMatchObject({ migrated: false, published: true, error: 'migration state write injected' });
        const firstRuns = fs.readdirSync(base.paths.historyRunsDir);
        expect(firstRuns).toHaveLength(1);
        expect(fs.readFileSync(source, 'utf8')).toBe(original);

        const retried = await base.initialize();
        expect(retried.migrated).toHaveLength(1);
        expect(retried.migrated[0]).toMatchObject({
            runId: firstRuns[0],
            migrated: false,
            reconciled: true,
            stateRepaired: true
        });
        expect(fs.readdirSync(base.paths.historyRunsDir)).toEqual(firstRuns);
        expect(JSON.parse(fs.readFileSync(base.paths.historyMigrationStateFile)).migrated['legacy.json']).toMatch(/^[a-f0-9]{64}$/);
        expect(fs.readFileSync(source, 'utf8')).toBe(original);
        expect(fs.readdirSync(base.paths.historyTempDir)).toEqual([]);
        expect(fs.existsSync(base.paths.historyLockFile)).toBe(false);
    });

    test('concurrent child migrations publish the legacy source exactly once', async () => {
        const root = tempRoot('heyna-migration-child-');
        const manager = managerFor(root, { migration: { enabled: true } });
        fs.mkdirSync(manager.paths.legacyExecutionsDir, { recursive: true });
        const source = path.join(manager.paths.legacyExecutionsDir, 'legacy.json');
        const original = JSON.stringify({ execution: [item()], metadata: metadata() });
        fs.writeFileSync(source, original);
        const results = await Promise.all([
            runChild(root, 'migrate-only', { migrationEnabled: true }),
            runChild(root, 'migrate-only', { migrationEnabled: true })
        ]);
        expect(results.map(result => result.code)).toEqual([0, 0]);
        const migrations = results.flatMap(result => JSON.parse(result.stdout).migrated);
        expect(migrations.filter(result => result.migrated === true)).toHaveLength(1);
        expect(fs.readdirSync(manager.paths.historyRunsDir)).toHaveLength(1);
        expect(fs.readFileSync(source, 'utf8')).toBe(original);
        expect(fs.readdirSync(manager.paths.historyTempDir)).toEqual([]);
        expect(fs.existsSync(manager.paths.historyLockFile)).toBe(false);
    });
});

test.describe('cross-process coordination', () => {
    test('two child processes publish distinct complete runs with deterministic latest', async () => {
        const root = tempRoot('heyna-child-');
        const [older, newer] = await Promise.all([
            runChild(root, 'persist', { timestamp: '2026-07-01T00:00:00Z' }),
            runChild(root, 'persist', { timestamp: '2026-07-02T00:00:00Z' })
        ]);
        expect([older.code, newer.code]).toEqual([0, 0]);
        const ids = [JSON.parse(older.stdout).runId, JSON.parse(newer.stdout).runId];
        expect(new Set(ids).size).toBe(2);
        const manager = managerFor(root);
        expect((await manager.listRuns()).length).toBe(2);
        expect((await manager.getLatestRun()).summary.timestamp).toBe('2026-07-02T00:00:00.000Z');
        expect(fs.readdirSync(manager.paths.historyTempDir)).toEqual([]);
        expect(fs.existsSync(manager.paths.historyLockFile)).toBe(false);
    });

    test('duplicate explicit run IDs have exactly one cross-process winner', async () => {
        const root = tempRoot('heyna-child-');
        const runId = '20260701-000000-000-deadbeef';
        const results = await Promise.all([runChild(root, 'persist', { runId }), runChild(root, 'persist', { runId })]);
        expect(results.filter(result => result.code === 0).length).toBe(1);
        expect(results.filter(result => result.code !== 0)[0].stderr).toContain('already exists');
        expect((await managerFor(root).listRuns()).map(run => run.runId)).toEqual([runId]);
    });

    test('terminated writer lock and stale staging are detected and recovered', async () => {
        const root = tempRoot('heyna-child-');
        const orphan = await runChild(root, 'orphan-staging');
        expect(orphan.code).toBe(0);
        const manager = managerFor(root, { lock: { staleMs: 60000 } });
        expect(fs.existsSync(manager.paths.historyLockFile)).toBe(true);
        expect(fs.readdirSync(manager.paths.historyTempDir)).toEqual(['20260701-000000-000-bad0cafe']);
        const initialized = await manager.initialize();
        expect(initialized.cleanup).toEqual(['20260701-000000-000-bad0cafe']);
        const result = await manager.persistRun({ execution: [item()], metadata: metadata() });
        expect(result.persisted).toBe(true);
        expect(fs.existsSync(manager.paths.historyLockFile)).toBe(false);
    });

    test('a replacement live owner is not deleted by another process attempting recovery', async () => {
        const root = tempRoot('heyna-child-lock-race-');
        const stale = await runChild(root, 'orphan-lock');
        expect(stale.code).toBe(0);
        const manager = managerFor(root);
        expect(fs.existsSync(manager.paths.historyLockFile)).toBe(true);

        const signalFile = 'live-owner-ready.json';
        const signalPath = path.join(root, signalFile);
        const holder = startChild(root, 'hold-lock-signal', { holdMs: 750, signalFile });
        try {
            await waitForFile(signalPath);
            const liveOwner = JSON.parse(fs.readFileSync(signalPath, 'utf8'));
            expect(claimOwner(manager, liveOwner.token).token).toBe(liveOwner.token);

            const contender = await runChild(root, 'persist', { maxRetries: 0, retryDelayMs: 0, staleMs: 0 });
            expect(contender.code).not.toBe(0);
            expect(contender.stderr).toContain('busy after 1 lock attempts');
            expect(claimOwner(manager, liveOwner.token).token).toBe(liveOwner.token);

            const held = await holder.completion;
            expect(held.code).toBe(0);
            expect(JSON.parse(held.stdout).token).toBe(liveOwner.token);
            expect(fs.existsSync(manager.paths.historyLockFile)).toBe(false);
        } finally {
            if (holder.child.exitCode === null) holder.child.kill();
        }
    });

    test('deletion-boundary recovery preserves a real replacement child claim and never enters', async () => {
        const root = tempRoot('heyna-child-lock-boundary-');
        const stale = await runChild(root, 'orphan-lock', { staleMs: 0 });
        expect(stale.code).toBe(0);
        const staleOwner = JSON.parse(stale.stdout);

        const boundaryFile = 'recovery-at-delete-boundary.json';
        const replacementReadyFile = 'replacement-claim-ready.json';
        const replacementActiveFile = 'replacement-owner-active.json';
        const recovery = startChild(root, 'recover-boundary', {
            maxRetries: 0,
            retryDelayMs: 0,
            staleMs: 0,
            boundaryFile,
            continueFile: replacementReadyFile,
            boundaryTimeoutMs: 5000,
            timeoutMs: 8000
        });
        await waitForFile(path.join(root, boundaryFile));

        const holder = startChild(root, 'hold-lock-signal', {
            claimReadyFile: replacementReadyFile,
            signalFile: replacementActiveFile,
            holdMs: 1000,
            retryDelayMs: 5,
            maxRetries: 500,
            staleMs: 0,
            timeoutMs: 8000
        });
        try {
            await waitForFile(path.join(root, replacementReadyFile));
            const replacementOwner = JSON.parse(fs.readFileSync(path.join(root, replacementReadyFile), 'utf8'));
            const recovered = await recovery.completion;
            expect(recovered).toMatchObject({ code: 0, timedOut: false });
            const recoveryResult = JSON.parse(recovered.stdout);
            expect(recoveryResult).toMatchObject({ recovered: true, protectedEntries: 0 });
            expect(recoveryResult.busyError).toContain('busy after 1 lock attempts');

            const manager = managerFor(root);
            expect(fs.existsSync(staleOwner.claimDir)).toBe(false);
            expect(claimOwner(manager, replacementOwner.token).token).toBe(replacementOwner.token);
            await waitForFile(path.join(root, replacementActiveFile));

            const held = await holder.completion;
            expect(held).toMatchObject({ code: 0, timedOut: false });
            expect(JSON.parse(held.stdout).token).toBe(replacementOwner.token);
            expect(fs.existsSync(manager.paths.historyLockFile)).toBe(false);
            expect(lockArtifacts(manager)).toEqual([]);
            console.log(`DELETION_BOUNDARY_RESULT=${JSON.stringify({
                staleExitCode: stale.code,
                recoveryExitCode: recovered.code,
                replacementExitCode: held.code,
                staleToken: staleOwner.token,
                replacementToken: replacementOwner.token,
                recovered: recoveryResult.recovered,
                protectedEntries: recoveryResult.protectedEntries,
                busyError: recoveryResult.busyError,
                replacementClaimSurvived: true,
                remainingLockArtifacts: lockArtifacts(manager).length
            })}`);
        } finally {
            if (recovery.child.exitCode === null) recovery.child.kill();
            if (holder.child.exitCode === null) holder.child.kill();
        }
    });

    test('a crashed recovery process leaves only the stale owner claim for the next process to recover', async () => {
        const root = tempRoot('heyna-child-recovery-crash-');
        const stale = await runChild(root, 'orphan-lock', { staleMs: 0 });
        expect(stale.code).toBe(0);
        const staleOwner = JSON.parse(stale.stdout);

        const crashed = await runChild(root, 'recover-crash', { staleMs: 0, exitCode: 77 });
        expect(crashed).toMatchObject({ code: 77, timedOut: false });
        expect(fs.existsSync(staleOwner.claimDir)).toBe(true);

        const recovered = await runChild(root, 'persist', { staleMs: 0, retryDelayMs: 0, maxRetries: 5 });
        expect(recovered).toMatchObject({ code: 0, timedOut: false });
        const manager = managerFor(root);
        expect((await manager.listRuns()).length).toBe(1);
        expect(fs.existsSync(manager.paths.historyLockFile)).toBe(false);
        expect(lockArtifacts(manager)).toEqual([]);
        console.log(`RECOVERY_CRASH_RESULT=${JSON.stringify({ crashedExitCode: crashed.code, successorExitCode: recovered.code, staleToken: staleOwner.token, remainingLockArtifacts: 0 })}`);
    });

    test('repeated child contention has exactly one protected entrant at a time and finite completion', async () => {
        const root = tempRoot('heyna-child-lock-stress-');
        const logFile = 'critical-section.log';
        const children = await Promise.all(Array.from({ length: 8 }, () => runChild(root, 'critical-section', {
            logFile,
            holdMs: 25,
            retryDelayMs: 2,
            maxRetries: 500,
            staleMs: 0,
            timeoutMs: 10000
        })));
        if (children.some(child => child.code !== 0 || child.timedOut)) {
            console.log(`LOCK_STRESS_CHILDREN=${JSON.stringify(children.map(child => ({ code: child.code, timedOut: child.timedOut, stderr: child.stderr })))}`);
        }
        expect(children.map(child => child.code)).toEqual(Array(8).fill(0));
        expect(children.every(child => child.timedOut === false)).toBe(true);

        const events = fs.readFileSync(path.join(root, logFile), 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
        let depth = 0;
        let maximumDepth = 0;
        let protectedEntries = 0;
        for (const event of events) {
            if (event.event === 'enter') {
                depth += 1;
                protectedEntries += 1;
                maximumDepth = Math.max(maximumDepth, depth);
            } else {
                depth -= 1;
            }
            expect(depth).toBeGreaterThanOrEqual(0);
        }
        expect({ protectedEntries, maximumDepth, finalDepth: depth }).toEqual({ protectedEntries: 8, maximumDepth: 1, finalDepth: 0 });
        const manager = managerFor(root);
        expect(fs.existsSync(manager.paths.historyLockFile)).toBe(false);
        expect(lockArtifacts(manager)).toEqual([]);
        console.log(`LOCK_STRESS_RESULT=${JSON.stringify({ childExitCodes: children.map(child => child.code), protectedEntries, maximumDepth, finalDepth: depth, remainingLockArtifacts: 0 })}`);
    });

    test('a protected child failure releases its owner-scoped claim in finally', async () => {
        const root = tempRoot('heyna-child-lock-failure-');
        const failed = await runChild(root, 'fail-protected', { staleMs: 0 });
        expect(failed.code).not.toBe(0);
        expect(failed.timedOut).toBe(false);
        expect(failed.stderr).toContain('protected operation injected');
        const manager = managerFor(root);
        expect(fs.existsSync(manager.paths.historyLockFile)).toBe(false);
        expect(lockArtifacts(manager)).toEqual([]);
    });

    test('retention waits for another process holding the history lock', async () => {
        const root = tempRoot('heyna-child-');
        await runChild(root, 'persist', { timestamp: '2026-07-01T00:00:00Z' });
        const started = Date.now();
        const holder = runChild(root, 'hold-lock', { holdMs: 400 });
        await new Promise(resolve => setTimeout(resolve, 100));
        const writer = runChild(root, 'persist', { timestamp: '2026-07-02T00:00:00Z', staleMs: 50, retention: { enabled: true, maxRuns: 1 } });
        const [held, written] = await Promise.all([holder, writer]);
        expect([held.code, written.code]).toEqual([0, 0]);
        expect(Date.now() - started).toBeGreaterThanOrEqual(350);
        expect((await managerFor(root).listRuns()).length).toBe(1);
        expect(fs.existsSync(managerFor(root).paths.historyLockFile)).toBe(false);
    });
});

test.describe('HTML failure anchor integrity', () => {
    function linksAndIds(execution) {
        const table = HeynaHtmlDashboardGenerator.testCaseTable(execution);
        const details = HeynaHtmlDashboardGenerator.recentFailedTests(execution);
        return {
            table,
            details,
            hrefs: [...table.matchAll(/href="#([^"]+)"/g)].map(match => match[1]),
            ids: [...details.matchAll(/\sid="([^"]+)"/g)].map(match => match[1])
        };
    }

    test('six failed cases each have exactly one detail anchor', () => {
        const execution = Array.from({ length: 6 }, (_, index) => item('FAILED', 1, {
            testCase: `TC_FAILED_${index + 1}`,
            errorMessage: `Failure ${index + 1}`
        }));
        const { hrefs, ids } = linksAndIds(execution);
        expect(hrefs).toHaveLength(6);
        expect(new Set(hrefs).size).toBe(6);
        hrefs.forEach(href => expect(ids.filter(id => id === href)).toHaveLength(1));
    });

    test('mixed statuses, duplicate names, and special characters keep unique resolvable anchors', () => {
        const execution = [
            item('FAILED', 1, { testCase: 'Duplicate case', errorMessage: 'One' }),
            item('TIMEDOUT', 1, { testCase: 'Duplicate case', errorMessage: 'Two' }),
            item('INTERRUPTED', 1, { testCase: 'A&B <special> / case?', errorMessage: 'Three' }),
            item('SKIPPED', 0, { testCase: 'Duplicate case' }),
            item('FAILED', 1, { testCase: 'A B special case', errorMessage: 'Four' }),
            item('TIMEDOUT', 1, { testCase: 'timeout', errorMessage: 'Five' }),
            item('INTERRUPTED', 1, { testCase: 'interrupt', errorMessage: 'Six' })
        ];
        const { hrefs, ids } = linksAndIds(execution);
        expect(hrefs).toHaveLength(6);
        expect(new Set(hrefs).size).toBe(6);
        expect(new Set(ids).size).toBe(ids.length);
        hrefs.forEach(href => expect(ids.filter(id => id === href)).toHaveLength(1));
        expect(hrefs.some(href => href.endsWith('-004'))).toBe(false);
    });
});

test('TIMEDOUT and INTERRUPTED are failure-like across analytics and reports while SKIPPED is not', () => {
    const execution = [
        item('FAILED', 1, { testCase: 'TC_FAILED', failureCategory: 'ASSERTION_FAILURE', errorMessage: 'expect failed' }),
        item('TIMEDOUT', 1, { testCase: 'TC_TIMEDOUT', failureCategory: 'TIMEOUT_FAILURE', errorMessage: 'Timeout exceeded' }),
        item('INTERRUPTED', 1, { testCase: 'TC_INTERRUPTED', failureCategory: 'UNKNOWN_FAILURE', errorMessage: 'Interrupted' }),
        item('SKIPPED', 0, { testCase: 'TC_SKIPPED' })
    ];
    const groups = groupFailures(execution);
    const insights = generateInsights(execution, { passRate: 0 }, groups);
    const clusters = clusterRootCauses(execution, groups);
    expect(groups.reduce((sum, group) => sum + group.occurrences, 0)).toBe(3);
    expect(insights.totalFailed).toBe(3);
    expect(clusters.totalFailuresClustered).toBe(3);
    expect(HeynaPdfGenerator.statusColor('TIMEDOUT')).toBe(HeynaPdfGenerator.statusColor('FAILED'));
    expect(HeynaPdfGenerator.statusColor('INTERRUPTED')).toBe(HeynaPdfGenerator.statusColor('FAILED'));
    expect(HeynaPdfGenerator.statusColor('SKIPPED')).not.toBe(HeynaPdfGenerator.statusColor('FAILED'));
    const table = HeynaHtmlDashboardGenerator.testCaseTable(execution);
    expect(table).toContain('href="#tc_failed-failure-001"');
    expect(table).toContain('href="#tc_timedout-failure-002"');
    expect(table).toContain('href="#tc_interrupted-failure-003"');
    expect(table).not.toContain('tc_skipped-failure-004');
});
