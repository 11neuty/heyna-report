const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SUPPORTED_SCHEMA_VERSIONS = Object.freeze(['1.0.0']);
const FINAL_STATUSES = Object.freeze(['PASSED', 'FAILED', 'SKIPPED', 'TIMEDOUT', 'INTERRUPTED']);
const COUNT_FIELDS = Object.freeze(['total', 'passed', 'failed', 'skipped', 'timedOut', 'interrupted', 'unsuccessful', 'traceReportedCount', 'tracePreservedCount', 'traceAvailableCount']);
const DURATION_FIELDS = Object.freeze(['totalDuration', 'averageDuration']);
const ARTIFACT_TYPES = Object.freeze(['execution', 'metadata', 'pdf', 'dashboard', 'evidence', 'traces', 'trace']);
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;

function isValidIsoTimestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === (value.includes('.') ? value : value.replace('Z', '.000Z'));
}

function requireNonNegativeInteger(value, field) {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) throw new TypeError(`summary.${field} must be a finite non-negative integer.`);
}

function validateSummary(summary, options = {}) {
    if (!summary || typeof summary !== 'object' || Array.isArray(summary)) throw new TypeError('summary must be an object.');
    if (typeof summary.runId !== 'string' || !SAFE_RUN_ID.test(summary.runId) || summary.runId === '.' || summary.runId === '..') {
        throw new TypeError('summary.runId must be a non-empty filesystem-safe string.');
    }
    if (options.expectedRunId && summary.runId !== options.expectedRunId) throw new TypeError('summary.runId does not match its completed directory.');
    if (!SUPPORTED_SCHEMA_VERSIONS.includes(summary.schemaVersion)) throw new TypeError(`Unsupported summary schemaVersion: ${summary.schemaVersion}`);
    for (const field of ['createdAt', 'timestamp', 'startTime', 'endTime']) {
        if (!isValidIsoTimestamp(summary[field])) throw new TypeError(`summary.${field} must be a valid ISO-8601 UTC timestamp.`);
    }
    if (Date.parse(summary.endTime) < Date.parse(summary.startTime)) throw new TypeError('summary.endTime must not be earlier than summary.startTime.');
    for (const field of COUNT_FIELDS) requireNonNegativeInteger(summary[field], field);
    for (const field of DURATION_FIELDS) {
        if (!Number.isFinite(summary[field]) || summary[field] < 0) throw new TypeError(`summary.${field} must be a finite non-negative number.`);
    }
    if (!Number.isFinite(summary.passRate) || summary.passRate < 0 || summary.passRate > 100) throw new TypeError('summary.passRate must be between 0 and 100.');
    if (!summary.failureCategoryCounts || typeof summary.failureCategoryCounts !== 'object' || Array.isArray(summary.failureCategoryCounts)) {
        throw new TypeError('summary.failureCategoryCounts must be an object.');
    }
    Object.entries(summary.failureCategoryCounts).forEach(([category, count]) => requireNonNegativeInteger(count, `failureCategoryCounts.${category}`));
    const statusTotal = summary.passed + summary.failed + summary.skipped + summary.timedOut + summary.interrupted;
    if (summary.total !== statusTotal) throw new TypeError('summary.total must equal passed + failed + skipped + timedOut + interrupted.');
    if (summary.unsuccessful !== summary.failed + summary.timedOut + summary.interrupted) throw new TypeError('summary.unsuccessful must equal failed + timedOut + interrupted.');
    if (summary.traceAvailableCount !== summary.tracePreservedCount) throw new TypeError('summary.traceAvailableCount must describe preserved traces.');
    if (summary.migration !== undefined) {
        const migration = summary.migration;
        if (!migration || typeof migration !== 'object' || Array.isArray(migration)) throw new TypeError('summary.migration must be an object.');
        if (!SHA256.test(migration.identity)) throw new TypeError('summary.migration.identity must be a SHA-256 identity.');
        if (typeof migration.source !== 'string' || migration.source.trim() === '') throw new TypeError('summary.migration.source must be a non-empty string.');
        if (!SHA256.test(migration.sourceChecksum)) throw new TypeError('summary.migration.sourceChecksum must be a SHA-256 checksum.');
    }
    return summary;
}

function safeArtifactTarget(runDir, relativePath) {
    if (typeof relativePath !== 'string' || relativePath === '' || path.isAbsolute(relativePath)) throw new TypeError('Manifest paths must be non-empty relative paths.');
    const target = path.resolve(runDir, relativePath);
    const relative = path.relative(path.resolve(runDir), target);
    if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new TypeError(`Manifest path escapes the run directory: ${relativePath}`);
    return target;
}

function aggregateSize(target, fileSystem = fs) {
    const stat = fileSystem.statSync(target);
    if (stat.isFile()) return stat.size;
    if (!stat.isDirectory()) return 0;
    return fileSystem.readdirSync(target, { withFileTypes: true }).reduce((total, entry) => total + aggregateSize(path.join(target, entry.name), fileSystem), 0);
}

function fileChecksum(target, fileSystem = fs) {
    return crypto.createHash('sha256').update(fileSystem.readFileSync(target)).digest('hex');
}

function validateManifest(manifest, runDir, fileSystem = fs) {
    if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.artifacts)) throw new TypeError('manifest.artifacts must be an array.');
    for (const entry of manifest.artifacts) {
        if (!entry || typeof entry !== 'object' || !ARTIFACT_TYPES.includes(entry.type)) throw new TypeError(`Unsupported manifest artifact type: ${entry && entry.type}`);
        if (typeof entry.availability !== 'boolean') throw new TypeError('Manifest availability must be boolean.');
        const target = safeArtifactTarget(runDir, entry.path);
        if (entry.availability && !fileSystem.existsSync(target)) throw new TypeError(`Available manifest artifact is missing: ${entry.path}`);
        if (!entry.availability) continue;
        const stat = fileSystem.statSync(target);
        const size = aggregateSize(target, fileSystem);
        if (!Number.isFinite(entry.size) || entry.size < 0 || entry.size !== size) throw new TypeError(`Manifest size mismatch: ${entry.path}`);
        if (stat.isDirectory() && entry.checksum !== undefined) throw new TypeError(`Directory manifest entries must not have checksums: ${entry.path}`);
        if (entry.checksum !== undefined) {
            if (!SHA256.test(entry.checksum)) throw new TypeError(`Invalid manifest checksum format: ${entry.path}`);
            if (entry.checksum !== `sha256:${fileChecksum(target, fileSystem)}`) throw new TypeError(`Manifest checksum mismatch: ${entry.path}`);
        }
    }
    return manifest;
}

function validateFinalStatuses(execution, canonicalStatus) {
    execution.forEach((testCase, index) => {
        const status = canonicalStatus(testCase && testCase.status);
        if (!FINAL_STATUSES.includes(status)) throw new TypeError(`Execution item ${index} has unsupported final status: ${status}. Completed history rejects RUNNING and unknown statuses.`);
    });
}

module.exports = {
    ARTIFACT_TYPES,
    FINAL_STATUSES,
    SUPPORTED_SCHEMA_VERSIONS,
    aggregateSize,
    fileChecksum,
    isValidIsoTimestamp,
    safeArtifactTarget,
    validateFinalStatuses,
    validateManifest,
    validateSummary
};
