const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { test, expect } = require('@playwright/test');
const {
    OWNERSHIP_MARKER,
    OWNERSHIP_SCHEMA_VERSION,
    STALE_INTERNAL_VARIABLES,
    TEST_ROOT_PREFIX,
    applyTestArtifactScope,
    resolveTestArtifactScope
} = require('../../heyna.test-bootstrap');
const CleanupReporter = require('../../heyna.test-cleanup-reporter');

const projectRoot = path.resolve(__dirname, '..', '..');
const generatedNames = ['allure-results', 'dashboard', 'evidence', 'reports', 'test-results', 'playwright-report'];

function cleanChildEnvironment(values = {}) {
    const environment = { ...process.env, ...values };
    delete environment.HEYNA_ARTIFACT_ROOT;
    for (const name of STALE_INTERNAL_VARIABLES) delete environment[name];
    return environment;
}

function runFocusedPlaywright(workspace, configFile, environment, extraArguments = []) {
    const cli = require.resolve('@playwright/test/cli');
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cli, 'test', '--config', configFile, ...extraArguments], {
            cwd: workspace,
            env: environment,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        const timeout = setTimeout(() => {
            if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
            else child.kill('SIGKILL');
            reject(new Error(`Focused Playwright bootstrap timed out.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
        }, 60000);
        child.once('error', error => {
            clearTimeout(timeout);
            reject(error);
        });
        child.once('close', (code, signal) => {
            clearTimeout(timeout);
            resolve({ code, signal, pid: child.pid, stdout, stderr });
        });
    });
}

function ownershipFor(rootName, invocationId = 'a'.repeat(64)) {
    return { schemaVersion: OWNERSHIP_SCHEMA_VERSION, invocationId, rootName, markerName: OWNERSHIP_MARKER };
}

async function removeOwned(scope) {
    await new CleanupReporter(scope).onExit();
}

function writeHarness(options = {}) {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'heyna bootstrap workspace with spaces '));
    const configFile = path.join(workspace, 'playwright.config.js');
    const specFile = path.join(workspace, 'bootstrap-child.spec.js');
    const reporterFile = path.join(workspace, 'verification-reporter.js');
    const scopeFile = path.join(workspace, 'scope.json');
    const stateFile = path.join(workspace, 'reporter-state.json');
    const bootstrapPath = path.join(projectRoot, 'heyna.test-bootstrap.js');
    const globalSetupPath = path.join(projectRoot, 'heyna.global-setup.js');
    const globalTeardownPath = path.join(projectRoot, 'heyna.global-teardown.js');
    const cleanupReporterPath = path.join(projectRoot, 'heyna.test-cleanup-reporter.js');
    const playwrightModule = path.dirname(require.resolve('@playwright/test/package.json'));

    fs.writeFileSync(reporterFile, `
const fs = require('fs');
class VerificationReporter {
  constructor(options) { this.options = options; }
  readArtifact(stage) {
    const value = fs.readFileSync(this.options.artifact, 'utf8');
    const state = fs.existsSync(this.options.state) ? JSON.parse(fs.readFileSync(this.options.state, 'utf8')) : {};
    state[stage] = value;
    fs.writeFileSync(this.options.state, JSON.stringify(state));
  }
  onEnd() { this.readArtifact('onEnd'); }
  onExit() {
    this.readArtifact('onExit');
    if (this.options.failOnExit) throw new Error('fixed verification reporter failure');
  }
}
module.exports = VerificationReporter;
`);
    fs.writeFileSync(configFile, `
const fs = require('fs');
const path = require('path');
const { defineConfig, devices } = require(${JSON.stringify(playwrightModule)});
const { resolveTestArtifactScope } = require(${JSON.stringify(bootstrapPath)});
const scope = resolveTestArtifactScope();
if (scope.cleanup) fs.writeFileSync(${JSON.stringify(scopeFile)}, JSON.stringify(scope));
const artifact = path.join(scope.root, 'reporter-readable.txt');
const reporters = [['line']];
  ${options.verifyReporter === false ? '' : `reporters.push([${JSON.stringify(reporterFile)}, { artifact, state: ${JSON.stringify(stateFile)}, failOnExit: ${options.reporterFailure === true} }]);`}
reporters.push([${JSON.stringify(cleanupReporterPath)}, scope]);
module.exports = defineConfig({
  testDir: __dirname,
  testMatch: 'bootstrap-child.spec.js',
  metadata: { heynaTestArtifactScope: scope },
  outputDir: path.join(scope.root, 'playwright-output'),
  globalSetup: ${JSON.stringify(globalSetupPath)},
  globalTeardown: ${JSON.stringify(globalTeardownPath)},
  reporter: reporters,
  workers: 1,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
`);
    fs.writeFileSync(specFile, `
const fs = require('fs');
const path = require('path');
const { test, expect } = require(${JSON.stringify(playwrightModule)});
test('worker receives metadata-owned root', async ({ page }) => {
  expect(process.env.HEYNA_ARTIFACT_ROOT).toBeTruthy();
  for (const name of ${JSON.stringify(STALE_INTERNAL_VARIABLES)}) expect(process.env[name]).toBeUndefined();
  fs.writeFileSync(path.join(process.env.HEYNA_ARTIFACT_ROOT, 'reporter-readable.txt'), 'available');
  await page.setContent('<button>ready</button>');
  await expect(page.getByRole('button')).toHaveText('ready');
  ${options.failing ? "expect('actual').toBe('expected');" : ''}
});
`);
    return { workspace, configFile, scopeFile, stateFile };
}

async function runHarness(options = {}) {
    const harness = writeHarness(options);
    let scope;
    try {
        const result = await runFocusedPlaywright(
            harness.workspace,
            harness.configFile,
            cleanChildEnvironment(),
            options.arguments || []
        );
        scope = JSON.parse(fs.readFileSync(harness.scopeFile, 'utf8'));
        const state = fs.existsSync(harness.stateFile)
            ? JSON.parse(fs.readFileSync(harness.stateFile, 'utf8'))
            : null;
        return { ...result, scope, state, rootExists: fs.existsSync(scope.root) };
    } finally {
        if (scope && fs.existsSync(scope.root)) await removeOwned(scope);
        fs.rmSync(harness.workspace, { recursive: true, force: true });
    }
}

test('generated scope has a stable private marker and metadata-only worker propagation', async () => {
    const environment = {
        HEYNA_TEST_COMMAND_ROOT: 'stale', HEYNA_CLEAN_ARTIFACT_ROOT: '1',
        HEYNA_FRAMEWORK_ISOLATED: '1', HEYNA_FRAMEWORK_ONLY: '1', HEYNA_FRAMEWORK_ISOLATION: '1'
    };
    const scope = resolveTestArtifactScope({ environment });
    try {
        const marker = JSON.parse(fs.readFileSync(path.join(scope.root, OWNERSHIP_MARKER), 'utf8'));
        expect(scope.cleanup).toBe(true);
        expect(scope.root.endsWith(scope.ownership.rootName)).toBe(true);
        expect(scope.ownership.invocationId).toMatch(/^[a-f0-9]{64}$/);
        expect(marker).toEqual({
            schemaVersion: OWNERSHIP_SCHEMA_VERSION,
            invocationId: scope.ownership.invocationId,
            rootName: scope.ownership.rootName
        });

        const workerEnvironment = Object.fromEntries(STALE_INTERNAL_VARIABLES.map(name => [name, 'stale']));
        const applied = applyTestArtifactScope(scope, workerEnvironment);
        expect(applied).toEqual(scope);
        expect(workerEnvironment.HEYNA_ARTIFACT_ROOT).toBe(scope.root);
        for (const name of STALE_INTERNAL_VARIABLES) expect(workerEnvironment[name]).toBeUndefined();
    } finally {
        await removeOwned(scope);
    }
    expect(fs.existsSync(scope.root)).toBe(false);
});

test('public artifact roots are never marked or deleted by repository cleanup', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'heyna user configured root '));
    const marker = path.join(root, 'user-owned.txt');
    fs.writeFileSync(marker, 'preserve');
    try {
        const scope = resolveTestArtifactScope({ environment: { HEYNA_ARTIFACT_ROOT: root } });
        expect(scope).toEqual({ root: path.resolve(root), cleanup: false, ownership: null });
        await removeOwned(scope);
        expect(fs.readFileSync(marker, 'utf8')).toBe('preserve');
        expect(fs.existsSync(path.join(root, OWNERSHIP_MARKER))).toBe(false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('cleanup refuses unrelated, missing-marker, wrong-token, traversal, and protected roots', async () => {
    const unrelated = fs.mkdtempSync(path.join(os.tmpdir(), 'unrelated pre-existing '));
    const unrelatedMarker = path.join(unrelated, 'user-owned.txt');
    fs.writeFileSync(unrelatedMarker, 'preserve');
    const missingMarker = fs.mkdtempSync(path.join(os.tmpdir(), TEST_ROOT_PREFIX));
    const owned = resolveTestArtifactScope({ environment: {} });
    const messages = [];
    const logger = { error(message) { messages.push(message); } };
    try {
        await new CleanupReporter({
            root: unrelated, cleanup: true,
            ownership: ownershipFor(path.basename(unrelated)), logger
        }).onExit();
        await new CleanupReporter({
            root: missingMarker, cleanup: true,
            ownership: ownershipFor(path.basename(missingMarker)), logger
        }).onExit();
        await new CleanupReporter({
            ...owned,
            ownership: { ...owned.ownership, invocationId: 'b'.repeat(64) },
            logger
        }).onExit();
        const traversal = `${path.join(os.tmpdir(), 'placeholder')}${path.sep}..${path.sep}${owned.ownership.rootName}`;
        await new CleanupReporter({ ...owned, root: traversal, logger }).onExit();
        for (const root of ['', path.parse(projectRoot).root, projectRoot]) {
            await new CleanupReporter({
                root, cleanup: true,
                ownership: ownershipFor(path.basename(root) || `${TEST_ROOT_PREFIX}root`), logger
            }).onExit();
        }

        expect(fs.readFileSync(unrelatedMarker, 'utf8')).toBe('preserve');
        expect(fs.existsSync(missingMarker)).toBe(true);
        expect(fs.existsSync(owned.root)).toBe(true);
        expect(messages.length).toBeGreaterThanOrEqual(6);
        expect(messages.every(message => message === '[HEYNA TEST CLEANUP] Temporary artifact cleanup was refused.')).toBe(true);
        expect(JSON.stringify(messages)).not.toContain(unrelated);
        expect(JSON.stringify(messages)).not.toContain(owned.root);
    } finally {
        await removeOwned(owned);
        fs.rmSync(unrelated, { recursive: true, force: true });
        fs.rmSync(missingMarker, { recursive: true, force: true });
    }
});

test('cleanup refuses malformed ownership markers, missing IDs, and cross-invocation tokens', async () => {
    const ownedA = resolveTestArtifactScope({ environment: {} });
    const ownedB = resolveTestArtifactScope({ environment: {} });
    const markerPath = path.join(ownedA.root, OWNERSHIP_MARKER);
    const originalMarker = fs.readFileSync(markerPath, 'utf8');
    const messages = [];
    const logger = { error(message) { messages.push(message); } };
    const refuse = async (scope = ownedA) => {
        const before = fs.readdirSync(ownedA.root).slice().sort();
        await new CleanupReporter({ ...scope, logger }).onExit();
        expect(fs.existsSync(ownedA.root)).toBe(true);
        expect(fs.readdirSync(ownedA.root).slice().sort()).toEqual(before);
    };
    let markerLinkCreated = false;
    const markerTargetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'heyna marker link target '));
    const markerTarget = path.join(markerTargetRoot, 'marker.json');
    try {
        fs.writeFileSync(markerPath, JSON.stringify({
            schemaVersion: OWNERSHIP_SCHEMA_VERSION,
            invocationId: ownedA.ownership.invocationId,
            rootName: 'wrong-root-name'
        }));
        await refuse();

        fs.writeFileSync(markerPath, '{ malformed marker');
        await refuse();

        fs.writeFileSync(markerPath, JSON.stringify({
            schemaVersion: '9.9.9',
            invocationId: ownedA.ownership.invocationId,
            rootName: ownedA.ownership.rootName
        }));
        await refuse();

        fs.writeFileSync(markerPath, JSON.stringify({
            schemaVersion: OWNERSHIP_SCHEMA_VERSION,
            rootName: ownedA.ownership.rootName
        }));
        await refuse();

        fs.writeFileSync(markerPath, JSON.stringify({ invalid: true }));
        await refuse();

        fs.writeFileSync(markerPath, originalMarker);
        await refuse({
            ...ownedA,
            ownership: { ...ownedA.ownership, invocationId: ownedB.ownership.invocationId }
        });

        fs.writeFileSync(markerTarget, originalMarker);
        fs.rmSync(markerPath);
        try {
            fs.symlinkSync(markerTarget, markerPath, 'file');
            markerLinkCreated = true;
            await refuse();
        } catch (error) {
            expect(['EPERM', 'EACCES', 'UNKNOWN']).toContain(error.code || 'UNKNOWN');
        } finally {
            if (markerLinkCreated) fs.rmSync(markerPath, { force: true });
            fs.writeFileSync(markerPath, originalMarker);
        }

        expect(messages.length).toBe(markerLinkCreated ? 7 : 6);
        expect(messages.every(message => message === '[HEYNA TEST CLEANUP] Temporary artifact cleanup was refused.')).toBe(true);
        expect(JSON.stringify(messages)).not.toContain(ownedA.root);
        expect(JSON.stringify(messages)).not.toContain(ownedB.ownership.invocationId);
    } finally {
        if (!fs.existsSync(markerPath)) fs.writeFileSync(markerPath, originalMarker);
        await removeOwned(ownedA);
        await removeOwned(ownedB);
        fs.rmSync(markerTargetRoot, { recursive: true, force: true });
    }
});

test('cleanup rejects root and nested links without following them', async () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'heyna link target '));
    const linkName = `${TEST_ROOT_PREFIX}link_${Date.now()}`;
    const link = path.join(os.tmpdir(), linkName);
    const invocationId = 'c'.repeat(64);
    fs.writeFileSync(path.join(target, OWNERSHIP_MARKER), JSON.stringify({
        schemaVersion: OWNERSHIP_SCHEMA_VERSION, invocationId, rootName: linkName
    }));
    let linkCreated = false;
    try {
        fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
        linkCreated = true;
        await new CleanupReporter({
            root: link, cleanup: true, ownership: ownershipFor(linkName, invocationId),
            logger: { error() {} }
        }).onExit();
        expect(fs.existsSync(link)).toBe(true);
        expect(fs.existsSync(target)).toBe(true);
    } catch (error) {
        test.skip(!linkCreated, `Directory links are not supported in this environment: ${error.code || error.message}`);
        throw error;
    } finally {
        if (linkCreated) fs.rmSync(link, { force: true });
        fs.rmSync(target, { recursive: true, force: true });
    }

    const owned = resolveTestArtifactScope({ environment: {} });
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'heyna nested link target '));
    const nestedLink = path.join(owned.root, 'nested-link');
    try {
        fs.symlinkSync(outside, nestedLink, process.platform === 'win32' ? 'junction' : 'dir');
        await new CleanupReporter({ ...owned, logger: { error() {} } }).onExit();
        expect(fs.existsSync(owned.root)).toBe(true);
        expect(fs.existsSync(outside)).toBe(true);
    } finally {
        fs.rmSync(nestedLink, { force: true });
        await removeOwned(owned);
        fs.rmSync(outside, { recursive: true, force: true });
    }
});

test('cleanup is idempotent, concurrent-safe, and sanitizes locked-file failures', async () => {
    const owned = resolveTestArtifactScope({ environment: {} });
    const messages = [];
    const busy = Object.create(fs);
    busy.rmSync = () => {
        const error = new Error('EBUSY private path');
        error.code = 'EBUSY';
        throw error;
    };
    await new CleanupReporter({ ...owned, fileSystem: busy, logger: { error(message) { messages.push(message); } } }).onExit();
    expect(fs.existsSync(owned.root)).toBe(true);
    expect(messages).toEqual(['[HEYNA TEST CLEANUP] Temporary artifact cleanup could not be completed.']);
    expect(JSON.stringify(messages)).not.toContain(owned.root);

    await Promise.all([removeOwned(owned), removeOwned(owned)]);
    expect(fs.existsSync(owned.root)).toBe(false);
    await removeOwned(owned);
    expect(fs.existsSync(owned.root)).toBe(false);
});

test('later reporters read artifacts onEnd and onExit before cleanup for passing and failing runs', async () => {
    for (const failing of [false, true]) {
        const result = await runHarness({ failing });
        const diagnostics = `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
        expect(result.code, diagnostics).toBe(failing ? 1 : 0);
        expect(result.signal, diagnostics).toBeNull();
        expect(result.state).toEqual({ onEnd: 'available', onExit: 'available' });
        expect(result.rootExists).toBe(false);
        expect(() => process.kill(result.pid, 0)).toThrow();
        expect(result.stdout).not.toContain(result.scope.root);
        expect(result.stderr).not.toContain(result.scope.root);
    }
});

test('a preceding reporter failure preserves the Playwright result and still permits safe cleanup', async () => {
    const unrelated = fs.mkdtempSync(path.join(os.tmpdir(), 'heyna unrelated reporter failure '));
    const unrelatedFile = path.join(unrelated, 'user-owned.txt');
    fs.writeFileSync(unrelatedFile, 'preserve');
    try {
        for (const failing of [false, true]) {
            const result = await runHarness({ failing, reporterFailure: true });
            const output = result.stdout + result.stderr;
            expect(result.code, output).toBe(failing ? 1 : 0);
            expect(result.state).toEqual({ onEnd: 'available', onExit: 'available' });
            expect(output).toContain('Error in reporter');
            expect(output).toContain('fixed verification reporter failure');
            expect(result.rootExists).toBe(false);
            expect(() => process.kill(result.pid, 0)).toThrow();
            expect(fs.readFileSync(unrelatedFile, 'utf8')).toBe('preserve');
        }
    } finally {
        fs.rmSync(unrelated, { recursive: true, force: true });
    }
});

test('no-tests-found execution still removes only its owned root', async () => {
    const result = await runHarness({ verifyReporter: false, arguments: ['--grep', '^NO_SUCH_HEYNA_TEST$'] });
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toContain('No tests found');
    expect(result.rootExists).toBe(false);
    expect(() => process.kill(result.pid, 0)).toThrow();
});

test('two concurrent top-level invocations use different roots and ownership tokens', async () => {
    const before = Object.fromEntries(generatedNames.map(name => [name, fs.existsSync(path.join(projectRoot, name))]));
    const [first, second] = await Promise.all([runHarness(), runHarness()]);
    for (const result of [first, second]) {
        expect(result.code, result.stdout + result.stderr).toBe(0);
        expect(result.rootExists).toBe(false);
        expect(() => process.kill(result.pid, 0)).toThrow();
        expect(result.stdout + result.stderr).not.toMatch(/EPERM|EBADF/);
    }
    expect(first.scope.root).not.toBe(second.scope.root);
    expect(first.scope.ownership.invocationId).not.toBe(second.scope.ownership.invocationId);
    expect(Object.fromEntries(generatedNames.map(name => [name, fs.existsSync(path.join(projectRoot, name))]))).toEqual(before);
});

test('interruption documentation describes marker-owned roots and verified manual cleanup', () => {
    const documentation = fs.readFileSync(path.join(projectRoot, 'docs', 'getting-started.md'), 'utf8');
    for (const required of [
        'heyna-framework-test-', '.heyna-test-root.json', 'cleanup reporter', 'onExit()',
        'global teardown', 'SIGINT', 'SIGTERM', 'SIGKILL', 'operating-system temporary directory',
        'Future test runs do not sweep', 'User-configured artifact roots are never cleanup-owned'
    ]) expect(documentation).toContain(required);
    expect(documentation).not.toContain('C:\\Users\\');
    expect(documentation).not.toMatch(/delete arbitrary|remove arbitrary/i);
});

test('trace documentation describes private locators, optional links, and retry reset semantics', () => {
    const documentation = fs.readFileSync(path.join(projectRoot, 'docs', 'reporting.md'), 'utf8');
    for (const required of [
        'process-memory-only',
        'private locator is never serialized',
        '`traceFile` is optional',
        'Unsafe, external, credential-like, or token-like trace paths',
        '`traceAvailable: true` without `traceFile`',
        '`traceAvailable` does not guarantee a clickable or downloadable link',
        'atomically resets the top-level trace state',
        'clears `traceFile`, `traceSize`, and `traceModified`'
    ]) expect(documentation).toContain(required);
    expect(documentation).not.toContain('the HTML report provides a relative download link for an available trace');
    expect(documentation).not.toContain('If the file can be inspected, the execution record exposes:');
});

test('failure-trend documentation protects constant-time completeness-prefix analysis', () => {
    const documents = [
        fs.readFileSync(path.join(projectRoot, 'docs', 'failure-trends.md'), 'utf8'),
        fs.readFileSync(path.join(projectRoot, 'docs', 'adr', 'failure-trends.md'), 'utf8')
    ];
    for (const documentation of documents) {
        expect(documentation).toMatch(/completeness[^.]*prefix-count structures[^.]*once/i);
        expect(documentation).toMatch(/O\(1\)[^.]*prefix-count differences/i);
        expect(documentation).toMatch(/(?:no[^.]*binary search[^.]*per occurrence|per-occurrence binary search[^.]*prohibited)/i);
        expect(documentation).toContain('O(runs + outcomes + occurrences + groups log groups)');
        expect(documentation).not.toMatch(/\b(?:uses?|performs?|requires?) (?:an? )?(?:per-occurrence )?binary search/i);
        expect(documentation).not.toMatch(/\b(?:sorts?|performs?|requires?) (?:occurrence-sized )?per-group (?:occurrence|position) sorting/i);
        expect(documentation).not.toMatch(/\b(?:each recurrence group|the analyzer) rescans all runs/i);
    }
});
