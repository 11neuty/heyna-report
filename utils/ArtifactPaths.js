const fs = require('fs');
const path = require('path');

const DEFAULT_HISTORY_CONFIG = Object.freeze({
    enabled: false,
    rootDir: 'history',
    runsDir: 'runs',
    tempDir: '.temp',
    latestFile: 'latest.json',
    lock: Object.freeze({
        file: '.history.lock',
        retryDelayMs: 50,
        maxRetries: 100,
        staleMs: 30000
    }),
    retention: Object.freeze({
        enabled: false,
        maxRuns: null,
        maxAgeDays: null
    }),
    artifacts: Object.freeze({
        execution: true,
        metadata: true,
        pdf: true,
        dashboard: true,
        evidence: true,
        traces: true
    }),
    migration: Object.freeze({
        enabled: true,
        stateFile: '.migration-state.json'
    })
});

function mergeHistoryConfig(...values) {
    const merged = values.filter(Boolean).reduce((current, value) => {
        if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('history configuration must be an object.');
        if (value.lock !== undefined && (!value.lock || typeof value.lock !== 'object' || Array.isArray(value.lock))) {
            throw new TypeError('history.lock must be an object.');
        }
        return {
            ...current,
            ...value,
            retention: { ...current.retention, ...(value.retention || {}) },
            artifacts: { ...current.artifacts, ...(value.artifacts || {}) },
            migration: { ...current.migration, ...(value.migration || {}) },
            lock: { ...current.lock, ...(value.lock || {}) }
        };
    }, {
        ...DEFAULT_HISTORY_CONFIG,
        retention: { ...DEFAULT_HISTORY_CONFIG.retention },
        artifacts: { ...DEFAULT_HISTORY_CONFIG.artifacts },
        migration: { ...DEFAULT_HISTORY_CONFIG.migration },
        lock: { ...DEFAULT_HISTORY_CONFIG.lock }
    });
    validateLockConfig(merged.lock);
    return merged;
}

function requireFiniteNonNegativeNumber(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new TypeError(`${label} must be a finite non-negative number.`);
    }
}

function validateLockConfig(lock) {
    if (!lock || typeof lock !== 'object' || Array.isArray(lock)) {
        throw new TypeError('history.lock must be an object.');
    }
    if (typeof lock.maxRetries !== 'number' || !Number.isSafeInteger(lock.maxRetries) || lock.maxRetries < 0) {
        throw new TypeError('history.lock.maxRetries must be a safe non-negative integer.');
    }
    requireFiniteNonNegativeNumber(lock.retryDelayMs, 'history.lock.retryDelayMs');
    requireFiniteNonNegativeNumber(lock.staleMs, 'history.lock.staleMs');
    return lock;
}

function loadProjectConfig(projectRoot) {
    const configFile = path.join(projectRoot, 'heyna.config.js');
    if (!fs.existsSync(configFile)) return {};
    delete require.cache[require.resolve(configFile)];
    return require(configFile);
}

function resolveFrom(rootDir, value) {
    return path.isAbsolute(value) ? path.normalize(value) : path.resolve(rootDir, value);
}

function resolveHistoryChild(historyRoot, value, label, options = {}) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new TypeError(`history.${label} must be a non-empty relative path.`);
    }
    if (path.isAbsolute(value)) {
        throw new TypeError(`history.${label} must be relative to history.rootDir to preserve same-filesystem atomicity.`);
    }
    const resolved = path.resolve(historyRoot, value);
    const relative = path.relative(historyRoot, resolved);
    if ((!options.allowRoot && relative === '') || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new TypeError(`history.${label} must resolve inside history.rootDir.`);
    }
    return resolved;
}

function resolveArtifactPaths(options = {}) {
    const projectRoot = path.resolve(options.projectRoot || process.env.HEYNA_PROJECT_ROOT || process.cwd());
    const artifactRoot = path.resolve(options.artifactRoot || options.rootDir || process.env.HEYNA_ARTIFACT_ROOT || projectRoot);
    const config = options.config || loadProjectConfig(projectRoot);
    const history = mergeHistoryConfig(config.history, options.history);
    const resultDir = resolveFrom(artifactRoot, config.resultDir || 'test-results');
    const reportDir = resolveFrom(artifactRoot, config.reportDir || 'reports');
    const dashboardDir = resolveFrom(artifactRoot, config.dashboardDir || 'dashboard');
    const evidenceDir = resolveFrom(artifactRoot, config.evidenceDir || 'evidence');
    const historyRoot = resolveFrom(artifactRoot, history.rootDir);
    const historyRunsDir = resolveHistoryChild(historyRoot, history.runsDir, 'runsDir');
    const historyTempDir = resolveHistoryChild(historyRoot, history.tempDir, 'tempDir');

    const relativeRunsToTemp = path.relative(historyRunsDir, historyTempDir);
    const relativeTempToRuns = path.relative(historyTempDir, historyRunsDir);
    if (relativeRunsToTemp === '' || !relativeRunsToTemp.startsWith('..') || !relativeTempToRuns.startsWith('..')) {
        throw new TypeError('history.runsDir and history.tempDir must be distinct sibling trees under history.rootDir.');
    }

    const historyLockFile = resolveHistoryChild(historyRoot, history.lock.file, 'lock.file');

    return {
        rootDir: artifactRoot,
        projectRoot,
        artifactRoot,
        configFile: path.join(projectRoot, 'heyna.config.js'),
        assetsDir: path.join(projectRoot, 'assets'),
        resultDir,
        executionFile: path.join(resultDir, 'execution.json'),
        metadataFile: path.join(resultDir, 'metadata.json'),
        runLockFile: path.join(resultDir, '.heyna-run.lock'),
        writeLockFile: path.join(resultDir, '.heyna-write.lock'),
        reportDir,
        reportFile: path.join(reportDir, 'HeynaReport.pdf'),
        legacyReportFile: path.join(reportDir, 'TestExecutionReport.pdf'),
        dashboardDir,
        dashboardFile: path.join(dashboardDir, 'index.html'),
        evidenceDir,
        history,
        historyRoot,
        historyRunsDir,
        historyTempDir,
        historyLatestFile: resolveHistoryChild(historyRoot, history.latestFile, 'latestFile'),
        // The configured lock path is a coordination directory. Active owners
        // publish never-reused token-scoped claims below its claims directory.
        historyLockFile,
        historyLockClaimsDir: path.join(historyLockFile, 'claims'),
        historyMigrationStateFile: resolveHistoryChild(historyRoot, history.migration.stateFile, 'migration.stateFile'),
        legacyExecutionsDir: path.join(historyRoot, 'executions')
    };
}

module.exports = {
    DEFAULT_HISTORY_CONFIG,
    mergeHistoryConfig,
    loadProjectConfig,
    resolveArtifactPaths,
    resolveHistoryChild,
    validateLockConfig
};
