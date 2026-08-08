const fs = require('fs');
const path = require('path');
const { createFailureIdentity, createTestIdentity, HASH_PATTERN } = require('./FailureIdentity');
const { fileChecksum } = require('./HistoryValidation');
const { cloneJsonValue } = require('./FailureTrendValidation');
const {
    extractPersistedAttemptHistory,
    validatePersistedAttemptHistory
} = require('./FlakyAttemptHistory');

const CURRENT_FAILURE_INDEX_SCHEMA_VERSION = '2.0.0';
const SUPPORTED_FAILURE_INDEX_SCHEMA_VERSIONS = Object.freeze(['1.0.0', '2.0.0']);
const FINAL_STATUSES = new Set(['PASSED', 'FAILED', 'SKIPPED', 'TIMEDOUT', 'INTERRUPTED']);
const UNSUCCESSFUL_STATUSES = new Set(['FAILED', 'TIMEDOUT', 'INTERRUPTED']);
const FAILURE_CATEGORIES = new Set([
    'ASSERTION_FAILURE',
    'LOCATOR_FAILURE',
    'TIMEOUT_FAILURE',
    'NETWORK_FAILURE',
    'API_FAILURE',
    'CONFIGURATION_FAILURE',
    'UNKNOWN_FAILURE'
]);
const QUALITY_VALUES = new Set(['strong', 'degraded']);
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DUPLICATE_OUTCOME_CODE = 'HEYNA_FAILURE_HISTORY_DUPLICATE_OUTCOME';
const INVALID_INDEX_CODE = 'HEYNA_FAILURE_HISTORY_INVALID_INDEX';

function indexError(code, message) {
    const error = new TypeError(message);
    error.code = code;
    return error;
}

function duplicateOutcomeError() {
    return indexError(DUPLICATE_OUTCOME_CODE, 'Failure index contains duplicate finalized test outcomes.');
}

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function requireExactKeys(value, expected, label) {
    const keys = Object.keys(value).sort();
    const allowed = expected.slice().sort();
    if (keys.length !== allowed.length || keys.some((key, index) => key !== allowed[index])) {
        throw new TypeError(`${label} contains unsupported fields.`);
    }
}

function canonicalStatus(value) {
    const status = String(value || '').toUpperCase();
    if (status === 'PASS') return 'PASSED';
    if (status === 'FAIL') return 'FAILED';
    if (status === 'SKIP') return 'SKIPPED';
    return status;
}

function requireSafeCount(value, label) {
    if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
        throw new TypeError(`${label} must be a safe non-negative integer.`);
    }
    return value;
}

function requireBoundedString(value, label, maximum, options = {}) {
    if (value === null && options.nullable) return null;
    if (typeof value !== 'string' || !value || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
        throw new TypeError(`${label} must be a non-empty bounded string.`);
    }
    if (value.normalize('NFC') !== value) throw new TypeError(`${label} must be Unicode-normalized.`);
    return value;
}

function requireFingerprint(value, label, options = {}) {
    if (value === null && options.nullable) return null;
    if (!HASH_PATTERN.test(value)) throw new TypeError(`${label} must be a SHA-256 fingerprint.`);
    return value;
}

function validateRelativeFile(value, label) {
    if (value === null) return null;
    requireBoundedString(value, label, 1024);
    if (path.isAbsolute(value) || value.includes('\\') || value === '..' || value.startsWith('../') || value.includes('/../')) {
        throw new TypeError(`${label} must be a contained normalized relative path.`);
    }
    return value;
}

function validateFailure(value, context) {
    if (!isPlainObject(value)) throw new TypeError(`${context} must be an object.`);
    requireExactKeys(value, [
        'category', 'signatureClass', 'errorType', 'signature', 'messageFingerprint',
        'stackFrameFingerprint', 'signatureQuality'
    ], context);
    requireBoundedString(value.category, `${context}.category`, 128);
    if (!FAILURE_CATEGORIES.has(value.category)) throw new TypeError(`${context}.category is unsupported.`);
    requireBoundedString(value.signatureClass, `${context}.signatureClass`, 128);
    requireBoundedString(value.errorType, `${context}.errorType`, 128);
    requireFingerprint(value.signature, `${context}.signature`);
    requireFingerprint(value.messageFingerprint, `${context}.messageFingerprint`);
    requireFingerprint(value.stackFrameFingerprint, `${context}.stackFrameFingerprint`, { nullable: true });
    if (!QUALITY_VALUES.has(value.signatureQuality)) throw new TypeError(`${context}.signatureQuality is unsupported.`);
    return value;
}

function validateOutcome(value, index, schemaVersion = CURRENT_FAILURE_INDEX_SCHEMA_VERSION) {
    const context = `testOutcomes[${index}]`;
    if (!isPlainObject(value)) throw new TypeError(`${context} must be an object.`);
    const expectedKeys = [
        'testKey', 'playwrightTestIdFingerprint', 'project', 'file', 'suitePath', 'title', 'line',
        'repeatEachIndex', 'retryCount', 'status', 'traceAvailable', 'identityQuality', 'failure'
    ];
    if (schemaVersion === '2.0.0') expectedKeys.push('attempts');
    requireExactKeys(value, expectedKeys, context);
    requireFingerprint(value.testKey, `${context}.testKey`);
    requireFingerprint(value.playwrightTestIdFingerprint, `${context}.playwrightTestIdFingerprint`, { nullable: true });
    requireBoundedString(value.project, `${context}.project`, 256);
    validateRelativeFile(value.file, `${context}.file`);
    if (!Array.isArray(value.suitePath) || value.suitePath.length > 32) throw new TypeError(`${context}.suitePath must be a bounded array.`);
    value.suitePath.forEach((item, suiteIndex) => requireBoundedString(item, `${context}.suitePath[${suiteIndex}]`, 256));
    requireBoundedString(value.title, `${context}.title`, 512);
    if (value.line !== null && (!Number.isSafeInteger(value.line) || value.line <= 0)) throw new TypeError(`${context}.line must be null or a positive safe integer.`);
    requireSafeCount(value.repeatEachIndex, `${context}.repeatEachIndex`);
    requireSafeCount(value.retryCount, `${context}.retryCount`);
    if (!FINAL_STATUSES.has(value.status)) throw new TypeError(`${context}.status is unsupported.`);
    if (typeof value.traceAvailable !== 'boolean') throw new TypeError(`${context}.traceAvailable must be boolean.`);
    if (!QUALITY_VALUES.has(value.identityQuality)) throw new TypeError(`${context}.identityQuality is unsupported.`);
    if (value.identityQuality === 'degraded'
        && (value.file !== null || value.suitePath.length !== 0 || value.title !== 'Unidentified test')) {
        throw new TypeError(`${context} exposes unsupported degraded identity metadata.`);
    }
    if (UNSUCCESSFUL_STATUSES.has(value.status)) validateFailure(value.failure, `${context}.failure`);
    else if (value.failure !== null) throw new TypeError(`${context}.failure must be null for a successful/non-failure outcome.`);
    if (schemaVersion === '2.0.0') validatePersistedAttemptHistory({
        finalStatus: value.status,
        retryCount: value.retryCount,
        attempts: value.attempts
    });
    return value;
}

function compareOutcomeOrder(left, right) {
    if (left.project !== right.project) return left.project < right.project ? -1 : 1;
    if (left.testKey !== right.testKey) return left.testKey < right.testKey ? -1 : 1;
    return left.repeatEachIndex - right.repeatEachIndex;
}

function validateFailureIndex(value, options = {}) {
    try {
        value = cloneJsonValue(value, 'failure index');
    } catch (error) {
        if (error && error.code === DUPLICATE_OUTCOME_CODE) throw error;
        throw indexError(INVALID_INDEX_CODE, 'Failure index must contain passive JSON data.');
    }
    if (!isPlainObject(value)) throw new TypeError('failure index must be an object.');
    requireExactKeys(value, ['failureIndexSchemaVersion', 'runId', 'timestamp', 'counts', 'testOutcomes'], 'failure index');
    if (!SUPPORTED_FAILURE_INDEX_SCHEMA_VERSIONS.includes(value.failureIndexSchemaVersion)) {
        throw indexError('HEYNA_FAILURE_HISTORY_UNSUPPORTED_INDEX_SCHEMA', 'Failure index uses an unsupported schema.');
    }
    const schemaVersion = value.failureIndexSchemaVersion;
    requireBoundedString(value.runId, 'failureIndex.runId', 128);
    if (!RUN_ID.test(value.runId) || value.runId === '.' || value.runId === '..') throw new TypeError('failureIndex.runId is invalid.');
    if (options.expectedRunId && value.runId !== options.expectedRunId) throw new TypeError('failureIndex.runId does not match its run.');
    if (typeof value.timestamp !== 'string' || !ISO_UTC.test(value.timestamp) || !Number.isFinite(Date.parse(value.timestamp))) {
        throw new TypeError('failureIndex.timestamp must be a normalized UTC timestamp.');
    }
    if (options.expectedTimestamp && value.timestamp !== options.expectedTimestamp) throw new TypeError('failureIndex.timestamp does not match summary.timestamp.');
    if (!isPlainObject(value.counts)) throw new TypeError('failureIndex.counts must be an object.');
    requireExactKeys(value.counts, ['indexedTests', 'indexedFailures'], 'failureIndex.counts');
    requireSafeCount(value.counts.indexedTests, 'failureIndex.counts.indexedTests');
    requireSafeCount(value.counts.indexedFailures, 'failureIndex.counts.indexedFailures');
    if (!Array.isArray(value.testOutcomes)) throw new TypeError('failureIndex.testOutcomes must be an array.');
    const finalized = new Set();
    let failureCount = 0;
    let previousOutcome = null;
    value.testOutcomes.forEach((item, index) => {
        validateOutcome(item, index, schemaVersion);
        const tuple = `${item.project}\0${item.testKey}\0${item.repeatEachIndex}`;
        if (finalized.has(tuple)) throw duplicateOutcomeError();
        finalized.add(tuple);
        if (previousOutcome && compareOutcomeOrder(previousOutcome, item) >= 0) {
            throw new TypeError('failure index testOutcomes must use canonical project, testKey, and repeatEachIndex order.');
        }
        previousOutcome = item;
        if (UNSUCCESSFUL_STATUSES.has(item.status)) failureCount += 1;
    });
    if (value.counts.indexedTests !== value.testOutcomes.length) throw new TypeError('failure index test count does not match testOutcomes.');
    if (value.counts.indexedFailures !== failureCount) throw new TypeError('failure index failure count does not match testOutcomes.');
    JSON.stringify(value);
    return value;
}

function normalizedExistingIdentity(testCase, metadata, projectRoot) {
    const source = testCase && testCase.testIdentity;
    if (source && isPlainObject(source)) {
        try {
            const candidate = {
                testKey: source.testKey,
                playwrightTestIdFingerprint: source.playwrightTestIdFingerprint == null ? null : source.playwrightTestIdFingerprint,
                project: source.project || testCase.project || metadata.project || 'Project',
                file: source.file == null ? null : source.file,
                suitePath: Array.isArray(source.suitePath) ? source.suitePath.slice() : [],
                title: source.title || testCase.testCase || 'Unknown test',
                line: source.line == null ? null : source.line,
                identityQuality: source.identityQuality || 'degraded'
            };
            validateOutcome({
                ...candidate,
                repeatEachIndex: 0,
                retryCount: 0,
                status: 'PASSED',
                traceAvailable: false,
                failure: null
            }, 0, '1.0.0');
            return candidate;
        } catch (error) {
            // Fall through to a deterministic degraded identity.
        }
    }
    return createTestIdentity({
        projectRoot,
        testCase: testCase && testCase.testCase || 'Unknown test',
        project: testCase && testCase.project || metadata.project || 'Project'
    });
}

function normalizedFailure(testCase, status, projectRoot) {
    if (!UNSUCCESSFUL_STATUSES.has(status)) return null;
    const source = testCase && testCase.failureIdentity;
    if (source && isPlainObject(source)) {
        try {
            return validateFailure({
                category: source.category,
                signatureClass: source.signatureClass,
                errorType: source.errorType,
                signature: source.signature,
                messageFingerprint: source.messageFingerprint,
                stackFrameFingerprint: source.stackFrameFingerprint == null ? null : source.stackFrameFingerprint,
                signatureQuality: source.signatureQuality
            }, 'failure');
        } catch (error) {
            // Fall through to degraded legacy normalization.
        }
    }
    const derived = createFailureIdentity({
        projectRoot,
        errorMessage: testCase && testCase.errorMessage || '',
        failureCategory: testCase && testCase.failureCategory
            || (status === 'TIMEDOUT' ? 'TIMEOUT_FAILURE' : 'UNKNOWN_FAILURE')
    });
    return { ...derived, signatureQuality: 'degraded' };
}

function normalizedRetryCount(testCase, index) {
    if (!testCase || !Object.prototype.hasOwnProperty.call(testCase, 'retryCount')) return 0;
    return requireSafeCount(testCase.retryCount, `Execution item ${index} retryCount`);
}

function buildFailureIndex(options = {}) {
    const execution = options.execution;
    const metadata = options.metadata || {};
    if (!Array.isArray(execution)) throw new TypeError('Failure index execution input must be an array.');
    const testOutcomes = execution.map((testCase, index) => {
        const status = canonicalStatus(testCase && testCase.status);
        if (!FINAL_STATUSES.has(status)) throw new TypeError(`Execution item ${index} has an unsupported final status.`);
        const identity = normalizedExistingIdentity(testCase, metadata, options.projectRoot);
        const retryCount = normalizedRetryCount(testCase, index);
        return {
            testKey: identity.testKey,
            playwrightTestIdFingerprint: identity.playwrightTestIdFingerprint,
            project: identity.project,
            file: identity.file,
            suitePath: identity.suitePath.slice(),
            title: identity.title,
            line: identity.line,
            repeatEachIndex: Number.isSafeInteger(testCase.repeatEachIndex) && testCase.repeatEachIndex >= 0 ? testCase.repeatEachIndex : 0,
            retryCount,
            status,
            traceAvailable: testCase.traceAvailable === true,
            identityQuality: identity.identityQuality,
            failure: normalizedFailure(testCase, status, options.projectRoot),
            attempts: extractPersistedAttemptHistory(testCase, {
                finalStatus: status,
                retryCount,
                forceUnavailable: options.forceAttemptHistoryUnavailable === true
            })
        };
    }).sort(compareOutcomeOrder);
    const result = {
        failureIndexSchemaVersion: CURRENT_FAILURE_INDEX_SCHEMA_VERSION,
        runId: options.runId,
        timestamp: options.timestamp,
        counts: {
            indexedTests: testOutcomes.length,
            indexedFailures: testOutcomes.filter(item => item.failure !== null).length
        },
        testOutcomes
    };
    return validateFailureIndex(result, { expectedRunId: options.runId, expectedTimestamp: options.timestamp });
}

function legacySemanticOutcome(outcome) {
    const { retryCount, traceAvailable, ...semantic } = outcome;
    return JSON.stringify(semantic);
}

function buildLegacyFailureIndex(options = {}) {
    const execution = options.execution;
    if (!Array.isArray(execution)) throw new TypeError('Failure index execution input must be an array.');
    const metadata = options.metadata || {};
    const byTuple = new Map();
    let collapsedDuplicateCount = 0;
    for (let index = 0; index < execution.length; index += 1) {
        const testCase = execution[index];
        const status = canonicalStatus(testCase && testCase.status);
        if (!FINAL_STATUSES.has(status)) throw new TypeError(`Execution item ${index} has an unsupported final status.`);
        const identity = normalizedExistingIdentity(testCase, metadata, options.projectRoot);
        const outcome = {
            testKey: identity.testKey,
            playwrightTestIdFingerprint: identity.playwrightTestIdFingerprint,
            project: identity.project,
            file: identity.file,
            suitePath: identity.suitePath.slice(),
            title: identity.title,
            line: identity.line,
            repeatEachIndex: Number.isSafeInteger(testCase.repeatEachIndex) && testCase.repeatEachIndex >= 0 ? testCase.repeatEachIndex : 0,
            retryCount: Number.isSafeInteger(testCase.retryCount) && testCase.retryCount >= 0 ? testCase.retryCount : 0,
            status,
            traceAvailable: testCase.traceAvailable === true,
            identityQuality: identity.identityQuality,
            failure: normalizedFailure(testCase, status, options.projectRoot)
        };
        const tuple = `${outcome.project}\0${outcome.testKey}\0${outcome.repeatEachIndex}`;
        const existing = byTuple.get(tuple);
        if (!existing) {
            byTuple.set(tuple, outcome);
            continue;
        }
        if (legacySemanticOutcome(existing) !== legacySemanticOutcome(outcome)) throw duplicateOutcomeError();
        existing.retryCount = Math.max(existing.retryCount, outcome.retryCount);
        existing.traceAvailable = existing.traceAvailable || outcome.traceAvailable;
        collapsedDuplicateCount += 1;
    }
    const testOutcomes = [...byTuple.values()].sort(compareOutcomeOrder);
    const index = validateFailureIndex({
        failureIndexSchemaVersion: '1.0.0',
        runId: options.runId,
        timestamp: options.timestamp,
        counts: {
            indexedTests: testOutcomes.length,
            indexedFailures: testOutcomes.filter(item => item.failure !== null).length
        },
        testOutcomes
    }, { expectedRunId: options.runId, expectedTimestamp: options.timestamp });
    return { index, collapsedDuplicateCount };
}

function createFailureIndexDescriptor(file, index, fileSystem = fs) {
    const stat = fileSystem.statSync(file);
    if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size < 0) throw new TypeError('failure index must be a safely sized file.');
    return {
        schemaVersion: index.failureIndexSchemaVersion,
        path: 'failure-index.json',
        size: stat.size,
        checksum: `sha256:${fileChecksum(file, fileSystem)}`,
        indexedTestCount: index.counts.indexedTests,
        indexedFailureCount: index.counts.indexedFailures
    };
}

function validateFailureIndexDescriptor(descriptor) {
    if (!isPlainObject(descriptor)) throw new TypeError('summary.failureIndex must be an object.');
    requireExactKeys(descriptor, [
        'schemaVersion', 'path', 'size', 'checksum', 'indexedTestCount', 'indexedFailureCount'
    ], 'summary.failureIndex');
    if (!SUPPORTED_FAILURE_INDEX_SCHEMA_VERSIONS.includes(descriptor.schemaVersion)) {
        const error = new TypeError(`Unsupported failure index schema: ${descriptor.schemaVersion}`);
        error.code = 'HEYNA_FAILURE_HISTORY_UNSUPPORTED_INDEX_SCHEMA';
        throw error;
    }
    if (descriptor.path !== 'failure-index.json') throw new TypeError('summary.failureIndex.path must be failure-index.json.');
    requireSafeCount(descriptor.size, 'summary.failureIndex.size');
    requireFingerprint(descriptor.checksum, 'summary.failureIndex.checksum');
    requireSafeCount(descriptor.indexedTestCount, 'summary.failureIndex.indexedTestCount');
    requireSafeCount(descriptor.indexedFailureCount, 'summary.failureIndex.indexedFailureCount');
    return descriptor;
}

function readAndValidateFailureIndex(summary, runDir, fileSystem = fs) {
    const descriptor = validateFailureIndexDescriptor(summary.failureIndex);
    const resolvedRun = path.resolve(runDir);
    const file = path.resolve(runDir, descriptor.path);
    const relative = path.relative(resolvedRun, file);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new TypeError('failure index path escapes its run directory.');
    }
    const stat = fileSystem.statSync(file);
    if (!stat.isFile() || stat.size !== descriptor.size) throw new TypeError('failure index size does not match its descriptor.');
    if (`sha256:${fileChecksum(file, fileSystem)}` !== descriptor.checksum) throw new TypeError('failure index checksum does not match its descriptor.');
    let value;
    try {
        value = JSON.parse(fileSystem.readFileSync(file, 'utf8'));
    } catch (error) {
        if (error && ['EACCES', 'EPERM', 'EIO', 'EISDIR', 'ENOTDIR', 'ENOENT'].includes(error.code)) throw error;
        const wrapped = new TypeError('failure index contains invalid JSON.');
        wrapped.code = 'HEYNA_FAILURE_HISTORY_INVALID_INDEX';
        throw wrapped;
    }
    validateFailureIndex(value, { expectedRunId: summary.runId, expectedTimestamp: summary.timestamp });
    if (descriptor.schemaVersion !== value.failureIndexSchemaVersion) {
        throw new TypeError('failure index descriptor schema does not match the index.');
    }
    if (descriptor.indexedTestCount !== value.counts.indexedTests
        || descriptor.indexedFailureCount !== value.counts.indexedFailures) {
        throw new TypeError('failure index descriptor counts do not match the index.');
    }
    return value;
}

module.exports = {
    CURRENT_FAILURE_INDEX_SCHEMA_VERSION,
    DUPLICATE_OUTCOME_CODE,
    FAILURE_INDEX_SCHEMA_VERSION: CURRENT_FAILURE_INDEX_SCHEMA_VERSION,
    SUPPORTED_FAILURE_INDEX_SCHEMA_VERSIONS,
    UNSUCCESSFUL_STATUSES,
    buildFailureIndex,
    buildLegacyFailureIndex,
    canonicalStatus,
    createFailureIndexDescriptor,
    isPlainObject,
    readAndValidateFailureIndex,
    requireSafeCount,
    validateFailureIndex,
    validateFailureIndexDescriptor
};
