const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { mergeHistoryConfig, resolveArtifactPaths } = require('./ArtifactPaths');
const { ensureDir, readJson, atomicWriteJson } = require('./JsonFile');
const {
    aggregateSize,
    fileChecksum,
    validateFinalStatuses,
    validateManifest,
    validateSummary
} = require('./HistoryValidation');

const SCHEMA_VERSION = '1.0.0';
const HISTORY_FORMAT_VERSION = 1;
const RUN_ID_PATTERN = /^\d{8}-\d{6}-\d{3}-[a-f0-9]{8}$/;
const ISO_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function canonicalStatus(status) {
    const value = String(status || '').toUpperCase();
    if (value === 'PASS') return 'PASSED';
    if (value === 'FAIL') return 'FAILED';
    if (value === 'SKIP') return 'SKIPPED';
    return value || 'UNKNOWN';
}

function runIdPrefix(date) {
    const iso = date.toISOString();
    return `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}-${iso.slice(20, 23)}`;
}

function runIdFor(date = new Date()) {
    return `${runIdPrefix(date)}-${crypto.randomBytes(4).toString('hex')}`;
}

function migrationIdentity(sourceName, sourceHash) {
    return `sha256:${crypto.createHash('sha256').update(`${sourceName}\0${sourceHash}`).digest('hex')}`;
}

function migrationRunId(createdAt, identity) {
    return `${runIdPrefix(new Date(normalizeTimestamp(createdAt, 'migration.createdAt')))}-${identity.slice(-8)}`;
}

function normalizeTimestamp(value, label) {
    if (typeof value !== 'string' || !ISO_INPUT_PATTERN.test(value)) throw new TypeError(`${label} must be a valid ISO-8601 timestamp.`);
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) throw new TypeError(`${label} must be a valid ISO-8601 timestamp.`);
    return new Date(timestamp).toISOString();
}

function packageVersion(projectRoot, fileSystem = fs) {
    try {
        const packageJson = readJson(path.join(projectRoot, 'package.json'), undefined, fileSystem);
        return packageJson && packageJson.version;
    } catch (error) {
        return undefined;
    }
}

function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function warning(code, error, extra = {}) {
    return { code, message: error.message, ...extra };
}

function countFiles(target, fileSystem = fs) {
    const stat = fileSystem.statSync(target);
    if (stat.isFile()) return 1;
    if (!stat.isDirectory()) return 0;
    return fileSystem.readdirSync(target, { withFileTypes: true })
        .reduce((total, entry) => total + countFiles(path.join(target, entry.name), fileSystem), 0);
}

class HistoryManager {
    constructor(options = {}) {
        this.logger = options.logger || console;
        this.fs = options.fileSystem || fs;
        this.lockOperations = options.lockOperations || {};
        this.paths = options.paths || resolveArtifactPaths(options);
        this.config = mergeHistoryConfig(this.paths.history, options.history);
        this.staleTemporaryAgeMs = Number(options.staleTemporaryAgeMs || 24 * 60 * 60 * 1000);
    }

    async initialize() {
        if (!this.config.enabled) return { enabled: false, migrated: [], cleanup: [] };
        this.ensureHistoryDirectories();
        return this.withHistoryLock(async () => {
            const cleanup = this.cleanupStaleTemporaryRunsLocked();
            const migrated = this.config.migration.enabled ? await this.migrateLegacyIfNeededLocked() : [];
            return { enabled: true, migrated, cleanup };
        });
    }

    ensureHistoryDirectories() {
        ensureDir(this.paths.historyRoot, this.fs);
        ensureDir(this.paths.historyRunsDir, this.fs);
        ensureDir(this.paths.historyTempDir, this.fs);
    }

    generateRunId(date) {
        return runIdFor(date);
    }

    buildSummary(runId, execution, metadata, createdAt, migration) {
        this.validateRunId(runId);
        if (!Array.isArray(execution)) throw new TypeError('Execution history input must be an array.');
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new TypeError('Execution metadata must be an object.');
        validateFinalStatuses(execution, canonicalStatus);

        const created = normalizeTimestamp(createdAt, 'createdAt');
        const startTime = normalizeTimestamp(metadata.executionStartTime || created, 'metadata.executionStartTime');
        const endTime = normalizeTimestamp(metadata.executionEndTime || created, 'metadata.executionEndTime');
        const statuses = execution.map(testCase => canonicalStatus(testCase.status));
        const count = status => statuses.filter(value => value === status).length;
        const durations = execution.map((testCase, index) => {
            const duration = Number(testCase.duration);
            if (!Number.isFinite(duration) || duration < 0) throw new TypeError(`Execution item ${index} duration must be a finite non-negative number.`);
            return duration;
        });
        const total = execution.length;
        const passed = count('PASSED');
        const failed = count('FAILED');
        const timedOut = count('TIMEDOUT');
        const interrupted = count('INTERRUPTED');
        const totalDuration = durations.reduce((sum, value) => sum + value, 0);
        const failureCategoryCounts = {};

        execution.forEach(testCase => {
            const status = canonicalStatus(testCase.status);
            if (!['FAILED', 'TIMEDOUT', 'INTERRUPTED'].includes(status)) return;
            const category = testCase.failureCategory || (status === 'TIMEDOUT' ? 'TIMEOUT_FAILURE' : 'UNKNOWN_FAILURE');
            failureCategoryCounts[category] = (failureCategoryCounts[category] || 0) + 1;
        });

        const summary = {
            runId,
            schemaVersion: SCHEMA_VERSION,
            createdAt: created,
            timestamp: startTime,
            startTime,
            endTime,
            total,
            passed,
            failed,
            skipped: count('SKIPPED'),
            timedOut,
            interrupted,
            unsuccessful: failed + timedOut + interrupted,
            passRate: total ? Number(((passed / total) * 100).toFixed(2)) : 0,
            totalDuration,
            averageDuration: total ? Number((totalDuration / total).toFixed(2)) : 0,
            project: metadata.project || null,
            feature: metadata.feature || null,
            environment: metadata.environment || null,
            browser: metadata.browser || null,
            executedBy: metadata.executedBy || null,
            failureCategoryCounts,
            traceReportedCount: execution.filter(testCase => testCase.traceAvailable === true).length,
            tracePreservedCount: 0,
            traceAvailableCount: 0,
            reportAvailability: { pdf: false, dashboard: false, evidence: false, traces: false }
        };
        if (migration !== undefined) summary.migration = migration;
        return validateSummary(summary, { expectedRunId: runId });
    }

    async persistRun(input = {}) {
        if (!this.config.enabled) return { persisted: false, reason: 'disabled' };
        this.ensureHistoryDirectories();
        return this.withHistoryLock(() => this.persistRunLocked(input));
    }

    async persistRunLocked(input = {}) {
        const runId = input.runId || this.generateRunId();
        this.validateRunId(runId);
        const temporaryDir = path.join(this.paths.historyTempDir, runId);
        const finalDir = path.join(this.paths.historyRunsDir, runId);
        if (this.fs.existsSync(finalDir)) throw new Error(`Completed history run already exists: ${runId}`);
        if (this.fs.existsSync(temporaryDir)) throw new Error(`Temporary history run already exists: ${runId}`);

        const execution = input.execution !== undefined ? input.execution : readJson(this.paths.executionFile, undefined, this.fs);
        const metadata = input.metadata !== undefined ? input.metadata : readJson(this.paths.metadataFile, undefined, this.fs);
        if (execution === undefined) throw new Error(`Current execution file is missing: ${this.paths.executionFile}`);
        if (metadata === undefined) throw new Error(`Current metadata file is missing: ${this.paths.metadataFile}`);

        const createdAt = normalizeTimestamp(input.createdAt || new Date().toISOString(), 'createdAt');
        const summary = this.buildSummary(runId, execution, metadata, createdAt, input.migration);
        const manifest = { artifacts: [] };
        let published = false;

        try {
            ensureDir(temporaryDir, this.fs);
            if (this.config.artifacts.execution) {
                this.writeJson(path.join(temporaryDir, 'execution.json'), execution);
                this.addManifestEntry(manifest, temporaryDir, 'execution', 'execution.json');
            }
            if (this.config.artifacts.metadata) {
                this.writeJson(path.join(temporaryDir, 'metadata.json'), metadata);
                this.addManifestEntry(manifest, temporaryDir, 'metadata', 'metadata.json');
            }

            const sources = this.artifactSources(input.artifacts || {});
            this.copyOptionalArtifact(manifest, temporaryDir, 'pdf', sources.pdf, 'artifacts/reports/HeynaReport.pdf', summary);
            this.copyOptionalArtifact(manifest, temporaryDir, 'dashboard', sources.dashboard, 'artifacts/dashboard', summary);
            this.copyOptionalArtifact(manifest, temporaryDir, 'evidence', sources.evidence, 'artifacts/evidence', summary);
            this.copyTraceArtifacts(manifest, temporaryDir, execution, sources.traces, summary);

            validateSummary(summary, { expectedRunId: runId });
            this.writeJson(path.join(temporaryDir, 'summary.json'), summary);
            this.writeJson(path.join(temporaryDir, 'schema.json'), {
                schemaVersion: SCHEMA_VERSION,
                historyFormatVersion: HISTORY_FORMAT_VERSION,
                heynaVersion: packageVersion(this.paths.projectRoot, this.fs) || null,
                createdAt,
                compatibleReaders: ['HEYNA REPORT >=2.4.0-next.0'],
                compatibilityNotes: 'Readers must reject unknown major schema versions.'
            });
            this.writeJson(path.join(temporaryDir, 'manifest.json'), manifest);
            this.validateStagedRun(temporaryDir);
            this.fs.renameSync(temporaryDir, finalDir);
            published = true;

            const retention = await this.enforceRetentionLocked({ refreshLatest: false });
            const warnings = [...retention.warnings];
            try {
                this.refreshLatestPointerLocked();
            } catch (error) {
                const item = warning('HEYNA_LATEST_UPDATE_FAILED', error, { runId });
                warnings.push(item);
                this.logger.error(`[HEYNA HISTORY] Run ${runId} persisted, but latest.json update failed: ${error.message}`);
            }
            return { persisted: true, runId, directory: finalDir, summary, retention, warnings };
        } catch (error) {
            if (!published && this.fs.existsSync(temporaryDir)) {
                try {
                    this.fs.rmSync(temporaryDir, { recursive: true, force: true });
                } catch (cleanupError) {
                    error.cleanupWarning = warning('HEYNA_TEMP_CLEANUP_FAILED', cleanupError, { runId, directory: temporaryDir });
                }
            }
            throw error;
        }
    }

    writeJson(file, value) {
        atomicWriteJson(file, value, this.fs);
    }

    artifactSources(overrides) {
        const source = (name, fallback) => Object.prototype.hasOwnProperty.call(overrides, name) ? overrides[name] : fallback;
        return {
            pdf: source('pdf', this.paths.reportFile),
            dashboard: source('dashboard', this.paths.dashboardDir),
            evidence: source('evidence', this.paths.evidenceDir),
            traces: overrides.traces
        };
    }

    copyPath(source, destination) {
        const stat = this.fs.statSync(source);
        ensureDir(path.dirname(destination), this.fs);
        if (stat.isDirectory()) this.fs.cpSync(source, destination, { recursive: true, errorOnExist: true, force: false });
        else this.fs.copyFileSync(source, destination, this.fs.constants.COPYFILE_EXCL);
    }

    copyOptionalArtifact(manifest, runDir, type, source, relativeDestination, summary) {
        if (!this.config.artifacts[type] || !source || !this.fs.existsSync(source)) return;
        const destination = path.join(runDir, ...relativeDestination.split('/'));
        this.copyPath(source, destination);
        this.addManifestEntry(manifest, runDir, type, relativeDestination);
        summary.reportAvailability[type] = true;
    }

    copyTraceArtifacts(manifest, runDir, execution, overrideSource, summary) {
        if (!this.config.artifacts.traces) return;
        if (overrideSource && this.fs.existsSync(overrideSource)) {
            this.copyOptionalArtifact(manifest, runDir, 'traces', overrideSource, 'artifacts/traces', summary);
            const target = path.join(runDir, 'artifacts', 'traces');
            summary.tracePreservedCount = countFiles(target, this.fs);
            summary.traceAvailableCount = summary.tracePreservedCount;
            return;
        }

        const copied = new Set();
        execution.filter(testCase => testCase.traceAvailable && testCase.traceFile).forEach((testCase, index) => {
            const source = path.isAbsolute(testCase.traceFile)
                ? testCase.traceFile
                : path.resolve(this.paths.artifactRoot, testCase.traceFile);
            if (!this.fs.existsSync(source) || copied.has(source)) return;
            const name = `${String(index + 1).padStart(3, '0')}-${path.basename(path.dirname(source))}-${path.basename(source)}`.replace(/[^\w.-]+/g, '_');
            const relativeDestination = `artifacts/traces/${name}`;
            this.copyPath(source, path.join(runDir, ...relativeDestination.split('/')));
            this.addManifestEntry(manifest, runDir, 'trace', relativeDestination);
            copied.add(source);
        });
        summary.tracePreservedCount = copied.size;
        summary.traceAvailableCount = copied.size;
        summary.reportAvailability.traces = copied.size > 0;
    }

    addManifestEntry(manifest, runDir, type, relativePath) {
        const normalized = relativePath.replace(/\\/g, '/');
        const target = path.join(runDir, ...normalized.split('/'));
        const stat = this.fs.statSync(target);
        const entry = { type, path: normalized, availability: true, size: aggregateSize(target, this.fs) };
        if (stat.isFile()) entry.checksum = `sha256:${fileChecksum(target, this.fs)}`;
        manifest.artifacts.push(entry);
    }

    validateStagedRun(runDir) {
        const summary = readJson(path.join(runDir, 'summary.json'), undefined, this.fs);
        const schema = readJson(path.join(runDir, 'schema.json'), undefined, this.fs);
        const manifest = readJson(path.join(runDir, 'manifest.json'), undefined, this.fs);
        validateSummary(summary, { expectedRunId: path.basename(runDir) });
        validateManifest(manifest, runDir, this.fs);
        if (!schema || schema.schemaVersion !== SCHEMA_VERSION || !schema.heynaVersion) throw new Error('Staged schema failed validation.');
        if (this.config.artifacts.execution && !Array.isArray(readJson(path.join(runDir, 'execution.json'), undefined, this.fs))) throw new Error('Staged execution.json must contain an array.');
        if (this.config.artifacts.metadata) {
            const metadata = readJson(path.join(runDir, 'metadata.json'), undefined, this.fs);
            if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Staged metadata.json must contain an object.');
        }
    }

    latestPointer(summary) {
        return {
            runId: summary.runId,
            relativePath: path.relative(this.paths.historyRoot, path.join(this.paths.historyRunsDir, summary.runId)).replace(/\\/g, '/'),
            timestamp: summary.timestamp,
            schemaVersion: summary.schemaVersion
        };
    }

    refreshLatestPointerLocked() {
        const summaries = this.scanValidSummaries();
        if (!summaries.length) {
            this.fs.rmSync(this.paths.historyLatestFile, { force: true });
            return null;
        }
        const latest = summaries[0];
        this.writeJson(this.paths.historyLatestFile, this.latestPointer(latest));
        return latest;
    }

    async repairLatestPointer() {
        if (!this.config.enabled) return null;
        this.ensureHistoryDirectories();
        return this.withHistoryLock(() => this.refreshLatestPointerLocked());
    }

    scanValidSummaries() {
        if (!this.fs.existsSync(this.paths.historyRunsDir)) return [];
        const summaries = [];
        this.fs.readdirSync(this.paths.historyRunsDir, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .forEach(entry => {
                try {
                    summaries.push(this.readCompletedSummary(entry.name));
                } catch (error) {
                    this.logger.error(`[HEYNA HISTORY] Skipping corrupt completed run ${entry.name}: ${error.message}`);
                }
            });
        return summaries.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp) || b.runId.localeCompare(a.runId));
    }

    async listRuns(options = {}) {
        const from = options.from == null ? null : this.parseDate(options.from, 'from');
        const to = options.to == null ? null : this.parseDate(options.to, 'to');
        if (from !== null && to !== null && from > to) throw new TypeError('from must not be later than to.');
        const newestFirst = options.newestFirst !== false;
        const limit = options.limit == null ? null : Number(options.limit);
        if (limit !== null && (!Number.isInteger(limit) || limit < 0)) throw new TypeError('limit must be a non-negative integer.');
        const summaries = this.scanValidSummaries().filter(summary => {
            const timestamp = Date.parse(summary.timestamp);
            return (from === null || timestamp >= from) && (to === null || timestamp <= to);
        });
        if (!newestFirst) summaries.reverse();
        return limit === null ? summaries : summaries.slice(0, limit);
    }

    async getRun(runId) {
        this.validateRunId(runId);
        const runDir = path.join(this.paths.historyRunsDir, runId);
        if (!this.fs.existsSync(runDir)) return null;
        const summary = this.readCompletedSummary(runId);
        const manifest = readJson(path.join(runDir, 'manifest.json'), undefined, this.fs);
        validateManifest(manifest, runDir, this.fs);
        const value = {
            runId,
            directory: runDir,
            summary,
            schema: readJson(path.join(runDir, 'schema.json'), undefined, this.fs),
            manifest
        };
        const executionFile = path.join(runDir, 'execution.json');
        const metadataFile = path.join(runDir, 'metadata.json');
        if (this.fs.existsSync(executionFile)) value.execution = readJson(executionFile, undefined, this.fs);
        if (this.fs.existsSync(metadataFile)) value.metadata = readJson(metadataFile, undefined, this.fs);
        return value;
    }

    async getRunSummary(runId) {
        this.validateRunId(runId);
        const runDir = path.join(this.paths.historyRunsDir, runId);
        return this.fs.existsSync(runDir) ? this.readCompletedSummary(runId) : null;
    }

    async getLatestRun() {
        const summaries = this.scanValidSummaries();
        if (!summaries.length) return null;
        const newest = summaries[0];
        try {
            const pointer = readJson(this.paths.historyLatestFile, undefined, this.fs);
            if (!pointer || pointer.runId !== newest.runId || pointer.timestamp !== newest.timestamp) throw new Error('Latest pointer is missing or stale.');
            return this.getRun(pointer.runId);
        } catch (error) {
            this.logger.error(`[HEYNA HISTORY] Recovering latest run by scanning summaries: ${error.message}`);
            return this.getRun(newest.runId);
        }
    }

    async queryRunsByDateRange(startDate, endDate) {
        return this.listRuns({ from: startDate, to: endDate, newestFirst: true });
    }

    async enforceRetention() {
        if (!this.config.enabled) return { deletedRunIds: [], skippedCorruptRunIds: [], warnings: [] };
        this.ensureHistoryDirectories();
        return this.withHistoryLock(() => this.enforceRetentionLocked());
    }

    async enforceRetentionLocked(options = {}) {
        const retention = this.config.retention || {};
        if (!retention.enabled) return { deletedRunIds: [], skippedCorruptRunIds: [], warnings: [] };
        const candidates = [];
        const skippedCorruptRunIds = [];
        this.fs.readdirSync(this.paths.historyRunsDir, { withFileTypes: true }).filter(entry => entry.isDirectory()).forEach(entry => {
            try {
                candidates.push(this.readCompletedSummary(entry.name));
            } catch (error) {
                skippedCorruptRunIds.push(entry.name);
                this.logger.error(`[HEYNA HISTORY] Retention skipped corrupt run ${entry.name}: ${error.message}`);
            }
        });
        candidates.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp) || b.runId.localeCompare(a.runId));

        const deleteIds = new Set();
        const maxRuns = retention.maxRuns == null ? null : Number(retention.maxRuns);
        if (maxRuns !== null && (!Number.isInteger(maxRuns) || maxRuns < 0)) throw new TypeError('history.retention.maxRuns must be a non-negative integer or null.');
        if (maxRuns !== null) candidates.slice(maxRuns).forEach(summary => deleteIds.add(summary.runId));
        const maxAgeDays = retention.maxAgeDays == null ? null : Number(retention.maxAgeDays);
        if (maxAgeDays !== null && (!Number.isFinite(maxAgeDays) || maxAgeDays < 0)) throw new TypeError('history.retention.maxAgeDays must be a finite non-negative number or null.');
        if (maxAgeDays !== null) {
            const cutoff = Date.now() - maxAgeDays * 86400000;
            candidates.filter(summary => Date.parse(summary.timestamp) < cutoff).forEach(summary => deleteIds.add(summary.runId));
        }

        const deletedRunIds = [];
        const warnings = [];
        [...deleteIds].sort().forEach(runId => {
            try {
                this.fs.rmSync(path.join(this.paths.historyRunsDir, runId), { recursive: true, force: true });
                deletedRunIds.push(runId);
            } catch (error) {
                warnings.push(warning('HEYNA_RETENTION_DELETE_FAILED', error, { runId }));
            }
        });
        if (deletedRunIds.length && this.fs.existsSync(this.paths.historyLatestFile)) {
            try {
                const pointer = readJson(this.paths.historyLatestFile, undefined, this.fs);
                if (!pointer || deletedRunIds.includes(pointer.runId)) this.fs.rmSync(this.paths.historyLatestFile, { force: true });
            } catch (error) {
                try {
                    this.fs.rmSync(this.paths.historyLatestFile, { force: true });
                } catch (removeError) {
                    warnings.push(warning('HEYNA_LATEST_INVALIDATION_FAILED', removeError));
                }
            }
        }
        if (options.refreshLatest !== false) {
            try {
                this.refreshLatestPointerLocked();
            } catch (error) {
                warnings.push(warning('HEYNA_LATEST_UPDATE_FAILED', error));
            }
        }
        return { deletedRunIds, skippedCorruptRunIds, warnings };
    }

    async migrateLegacyIfNeeded() {
        if (!this.config.enabled || !this.config.migration.enabled) return [];
        this.ensureHistoryDirectories();
        return this.withHistoryLock(() => this.migrateLegacyIfNeededLocked());
    }

    async migrateLegacyIfNeededLocked() {
        const legacyDir = this.paths.legacyExecutionsDir;
        if (!this.fs.existsSync(legacyDir)) return [];
        const state = readJson(this.paths.historyMigrationStateFile, { schemaVersion: 1, migrated: {} }, this.fs);
        const results = [];
        const files = this.fs.readdirSync(legacyDir).filter(name => name.toLowerCase().endsWith('.json')).sort();
        for (const name of files) {
            const source = path.join(legacyDir, name);
            const sourceHash = fileChecksum(source, this.fs);
            if (state.migrated[name] === sourceHash) continue;
            const identity = migrationIdentity(name, sourceHash);
            let completedRunId;
            try {
                const legacy = readJson(source, undefined, this.fs);
                const execution = Array.isArray(legacy) ? legacy : legacy.execution;
                const metadata = Array.isArray(legacy) ? {} : (legacy.metadata || {});
                if (!Array.isArray(execution)) throw new Error('No execution array found.');
                const stat = this.fs.statSync(source);
                const createdAt = metadata.executionStartTime || stat.mtime.toISOString();
                const existing = this.scanValidSummaries().find(summary => summary.migration && summary.migration.identity === identity);
                if (existing) {
                    completedRunId = existing.runId;
                    state.migrated[name] = sourceHash;
                    this.writeJson(this.paths.historyMigrationStateFile, state);
                    this.logger.log(`[HEYNA HISTORY] Reconciled legacy execution ${name} with completed run ${existing.runId}.`);
                    results.push({ source: name, runId: existing.runId, migrated: false, reconciled: true, stateRepaired: true });
                    continue;
                }
                const result = await this.persistRunLocked({
                    runId: migrationRunId(createdAt, identity),
                    execution,
                    metadata,
                    createdAt,
                    migration: {
                        identity,
                        source: name,
                        sourceChecksum: `sha256:${sourceHash}`
                    }
                });
                completedRunId = result.runId;
                state.migrated[name] = sourceHash;
                this.writeJson(this.paths.historyMigrationStateFile, state);
                this.logger.log(`[HEYNA HISTORY] Migrated legacy execution ${name} as ${result.runId}.`);
                results.push({ source: name, runId: result.runId, migrated: true });
            } catch (error) {
                this.logger.error(`[HEYNA HISTORY] Could not migrate ${name}; source preserved: ${error.message}`);
                results.push({
                    source: name,
                    ...(completedRunId ? { runId: completedRunId, published: true } : {}),
                    migrated: false,
                    error: error.message
                });
            }
        }
        return results;
    }

    async cleanupStaleTemporaryRuns() {
        if (!this.config.enabled) return [];
        this.ensureHistoryDirectories();
        return this.withHistoryLock(() => this.cleanupStaleTemporaryRunsLocked());
    }

    cleanupStaleTemporaryRunsLocked() {
        if (!this.fs.existsSync(this.paths.historyTempDir)) return [];
        const removed = [];
        const cutoff = Date.now() - this.staleTemporaryAgeMs;
        this.fs.readdirSync(this.paths.historyTempDir, { withFileTypes: true }).forEach(entry => {
            if (!entry.isDirectory()) return;
            const target = path.join(this.paths.historyTempDir, entry.name);
            if (this.fs.statSync(target).mtimeMs >= cutoff) return;
            this.fs.rmSync(target, { recursive: true, force: true });
            removed.push(entry.name);
            this.logger.log(`[HEYNA HISTORY] Removed stale temporary run ${entry.name}.`);
        });
        return removed.sort();
    }

    readCompletedSummary(runId) {
        this.validateRunId(runId);
        const file = path.join(this.paths.historyRunsDir, runId, 'summary.json');
        try {
            const summary = readJson(file, undefined, this.fs);
            return validateSummary(summary, { expectedRunId: runId });
        } catch (error) {
            throw new Error(`Corrupt completed history run ${runId}: ${error.message}`);
        }
    }

    validateRunId(runId) {
        if (!RUN_ID_PATTERN.test(String(runId || ''))) throw new TypeError(`Invalid history run ID: ${runId}`);
    }

    parseDate(value, label) {
        if (value instanceof Date) {
            const timestamp = value.getTime();
            if (!Number.isFinite(timestamp)) throw new TypeError(`${label} must be a valid date.`);
            return timestamp;
        }
        if (typeof value !== 'string' || !ISO_INPUT_PATTERN.test(value)) throw new TypeError(`${label} must be a valid ISO-8601 timestamp.`);
        const timestamp = Date.parse(value);
        if (!Number.isFinite(timestamp)) throw new TypeError(`${label} must be a valid date.`);
        return timestamp;
    }

    lockClaimPath(token, pid) {
        if (!/^[a-f0-9]{24}$/.test(String(token || ''))) throw new TypeError('History lock owner token is invalid.');
        if (!Number.isInteger(pid) || pid <= 0) throw new TypeError('History lock owner PID is invalid.');
        return path.join(this.paths.historyLockClaimsDir, `${pid}-${token}`);
    }

    parseLockClaimName(name) {
        const match = /^([1-9]\d*)-([a-f0-9]{24})$/.exec(String(name || ''));
        if (!match) return null;
        const pid = Number(match[1]);
        return Number.isSafeInteger(pid) && pid > 0 ? { pid, token: match[2] } : null;
    }

    processIsAlive(pid) {
        if (!Number.isInteger(pid) || pid <= 0) return false;
        try {
            process.kill(pid, 0);
            return true;
        } catch (error) {
            return error.code === 'EPERM';
        }
    }

    validLockOwner(owner, token) {
        return Boolean(owner)
            && typeof owner === 'object'
            && owner.token === token
            && Number.isInteger(owner.pid)
            && owner.pid > 0
            && Number.isFinite(Date.parse(owner.createdAt));
    }

    readLockClaimName(name) {
        const identity = this.parseLockClaimName(name);
        const claimDir = path.join(this.paths.historyLockClaimsDir, name);
        try {
            const stat = this.fs.statSync(claimDir);
            if (!stat.isDirectory()) return null;
            let owner = null;
            let ticket = null;
            let released = null;
            try {
                owner = readJson(path.join(claimDir, 'owner.json'), undefined, this.fs);
            } catch (error) {
                owner = null;
            }
            try {
                ticket = readJson(path.join(claimDir, 'ticket.json'), undefined, this.fs);
            } catch (error) {
                ticket = null;
            }
            try {
                released = readJson(path.join(claimDir, 'released.json'), undefined, this.fs);
            } catch (error) {
                released = null;
            }
            const validOwner = Boolean(identity)
                && this.validLockOwner(owner, identity.token)
                && owner.pid === identity.pid;
            const ticketNumber = ticket
                && identity
                && ticket.token === identity.token
                && Number.isSafeInteger(ticket.number)
                && ticket.number > 0
                ? ticket.number
                : null;
            const releasedByOwner = Boolean(identity && released && released.token === identity.token && Number.isFinite(Date.parse(released.releasedAt)));
            const identityAlive = Boolean(identity) && !releasedByOwner && this.processIsAlive(identity.pid);
            return {
                name,
                token: identity ? identity.token : name,
                identity,
                claimDir,
                stat,
                owner,
                validOwner,
                ownerAlive: validOwner && identityAlive,
                identityAlive,
                ticketNumber,
                choosing: ticketNumber === null,
                released: releasedByOwner,
                ageMs: Date.now() - stat.mtimeMs
            };
        } catch (error) {
            return null;
        }
    }

    readLockClaim(token, pid) {
        return this.readLockClaimName(path.basename(this.lockClaimPath(token, pid)));
    }

    listLockClaims() {
        try {
            return this.fs.readdirSync(this.paths.historyLockClaimsDir, { withFileTypes: true })
                .filter(entry => entry.isDirectory())
                .map(entry => this.readLockClaimName(entry.name))
                .filter(Boolean);
        } catch (error) {
            return [];
        }
    }

    cleanupLockInfrastructure() {
        for (const directory of [this.paths.historyLockClaimsDir, this.paths.historyLockFile]) {
            try {
                this.fs.rmdirSync(directory);
            } catch (error) {
                if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) {
                    this.logger.error(`[HEYNA HISTORY] Could not remove empty lock coordination directory ${directory}: ${error.message}`);
                }
            }
        }
    }

    createLockClaim() {
        const setupAttempts = 10;
        let lastError;
        for (let attempt = 0; attempt < setupAttempts; attempt += 1) {
            const token = crypto.randomBytes(12).toString('hex');
            const owner = { pid: process.pid, createdAt: new Date().toISOString(), token };
            const claimDir = this.lockClaimPath(token, process.pid);
            let claimCreated = false;
            try {
                ensureDir(this.paths.historyLockFile, this.fs);
                ensureDir(this.paths.historyLockClaimsDir, this.fs);
                // Atomic mkdir publishes the choosing claim. PID and token are
                // encoded in the never-reused path, so an incomplete live claim
                // is protected before owner.json is visible.
                this.fs.mkdirSync(claimDir);
                claimCreated = true;
                this.fs.writeFileSync(path.join(claimDir, 'owner.json'), `${JSON.stringify(owner, null, 2)}\n`, 'utf8');

                const highestTicket = this.listLockClaims().reduce((maximum, claim) => Math.max(maximum, claim.ticketNumber || 0), 0);
                if (highestTicket >= Number.MAX_SAFE_INTEGER) throw new Error('History lock ticket space is exhausted.');
                const ticket = highestTicket + 1;
                // ticket.json is immutable. A concurrent partial read is treated
                // as the choosing phase and therefore blocks rather than enters.
                this.fs.writeFileSync(path.join(claimDir, 'ticket.json'), `${JSON.stringify({ token, number: ticket }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
                const publishedOwner = { ...owner, ticket, claimDir };
                if (typeof this.lockOperations.afterPublishLockClaim === 'function') {
                    this.lockOperations.afterPublishLockClaim(publishedOwner);
                }
                return publishedOwner;
            } catch (error) {
                lastError = error;
                if (claimCreated) {
                    try {
                        this.fs.rmSync(claimDir, { recursive: true, force: true });
                    } catch (cleanupError) {
                        error.cleanupError = cleanupError;
                    }
                }
                this.cleanupLockInfrastructure();
                if (!['ENOENT', 'EEXIST', 'EPERM'].includes(error.code)) break;
            }
        }
        throw new Error(`Could not acquire history lock: ${lastError ? lastError.message : 'claim publication failed'}`);
    }

    lockClaimRecoverable(claim) {
        if (!claim) return false;
        if (claim.released) return true;
        if (claim.identity) return !claim.identityAlive;
        return claim.ageMs > this.config.lock.staleMs;
    }

    recoverStaleLock(options = {}) {
        let recovered = false;
        for (const claim of this.listLockClaims()) {
            if (claim.token === options.excludeToken || !this.lockClaimRecoverable(claim)) continue;
            try {
                if (typeof this.lockOperations.beforeRemoveStaleClaim === 'function') {
                    this.lockOperations.beforeRemoveStaleClaim(claim);
                }
                // claimDir is scoped permanently to claim.token. New owners always
                // use new random paths, so this removal cannot target their claims.
                this.fs.rmSync(claim.claimDir, { recursive: true, force: true });
                recovered = true;
                this.logger.log(`[HEYNA HISTORY] Recovered stale history lock claim ${claim.token}.`);
            } catch (error) {
                // A concurrent recovery may already have removed this claim.
            }
        }
        this.cleanupLockInfrastructure();
        return recovered;
    }

    findBlockingLockClaim(owner) {
        const claims = this.listLockClaims();
        for (const claim of claims) {
            if (claim.token === owner.token) continue;
            if (!claim.validOwner || claim.choosing) return claim;
            if (claim.ticketNumber < owner.ticket || (claim.ticketNumber === owner.ticket && claim.token < owner.token)) return claim;
        }
        return null;
    }

    async acquireHistoryLock() {
        const lock = this.config.lock;
        let owner;
        try {
            owner = this.createLockClaim();
            for (let attempt = 0; attempt <= lock.maxRetries; attempt += 1) {
                this.recoverStaleLock({ excludeToken: owner.token });
                const ownClaim = this.readLockClaim(owner.token, owner.pid);
                if (!ownClaim || !ownClaim.validOwner || ownClaim.owner.token !== owner.token || ownClaim.ticketNumber !== owner.ticket) {
                    throw new Error('History lock claim disappeared or changed before acquisition.');
                }
                const blocker = this.findBlockingLockClaim(owner);
                if (!blocker) return owner;
                if (attempt === lock.maxRetries) throw new Error(`History storage is busy after ${lock.maxRetries + 1} lock attempts.`);
                await delay(lock.retryDelayMs);
            }
        } catch (error) {
            if (owner) {
                try {
                    this.releaseHistoryLock(owner);
                } catch (cleanupError) {
                    error.cleanupError = cleanupError;
                }
            }
            if (/^History (?:storage|lock)/.test(error.message)) throw error;
            throw new Error(`Could not acquire history lock: ${error.message}`);
        }
        throw new Error('History storage lock acquisition failed.');
    }

    releaseHistoryLock(owner) {
        const claimDir = this.lockClaimPath(owner && owner.token, owner && owner.pid);
        const current = this.readLockClaim(owner.token, owner.pid);
        if (!current) {
            this.cleanupLockInfrastructure();
            return;
        }
        if (!current.validOwner || current.owner.token !== owner.token) throw new Error('History lock ownership changed before release.');
        try {
            this.fs.rmSync(claimDir, { recursive: true, force: true });
        } catch (error) {
            if (!this.fs.existsSync(claimDir)) {
                this.cleanupLockInfrastructure();
                return;
            }
            try {
                this.fs.writeFileSync(path.join(claimDir, 'released.json'), `${JSON.stringify({ token: owner.token, releasedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
            } catch (markError) {
                error.recoveryError = markError;
            }
            throw new Error(`Could not release history lock; its owner-scoped claim is marked or remains recoverable: ${error.message}`);
        }
        this.cleanupLockInfrastructure();
    }

    async withHistoryLock(action) {
        const owner = await this.acquireHistoryLock();
        try {
            return await action();
        } finally {
            this.releaseHistoryLock(owner);
        }
    }
}

HistoryManager.SCHEMA_VERSION = SCHEMA_VERSION;
HistoryManager.HISTORY_FORMAT_VERSION = HISTORY_FORMAT_VERSION;
HistoryManager.canonicalStatus = canonicalStatus;
HistoryManager.normalizeTimestamp = normalizeTimestamp;

module.exports = HistoryManager;
module.exports.HistoryManager = HistoryManager;
