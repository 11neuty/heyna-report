const {
    buildLegacyFailureIndex,
    DUPLICATE_OUTCOME_CODE,
    validateFailureIndex
} = require('./HistoricalFailureValidation');
const {
    FAILURE_HISTORY_SCHEMA_VERSION,
    cloneJsonValue,
    compareCodePoints,
    dependencyError,
    finalizeResult,
    isPlainObject,
    parseDate,
    safeAdd,
    sourceContractError,
    warning
} = require('./FailureTrendValidation');

const HISTORY_DIAGNOSTIC_CODES = new Set([
    'HEYNA_HISTORICAL_MISSING_SUMMARY', 'HEYNA_HISTORICAL_CORRUPT_SUMMARY',
    'HEYNA_HISTORICAL_UNSUPPORTED_SCHEMA', 'HEYNA_HISTORICAL_INVALID_SUMMARY',
    'HEYNA_HISTORICAL_UNREADABLE_RUN'
]);
const INDEX_DIAGNOSTIC_CODES = new Set([
    'HEYNA_FAILURE_HISTORY_MISSING_INDEX', 'HEYNA_FAILURE_HISTORY_UNSUPPORTED_INDEX_SCHEMA',
    'HEYNA_FAILURE_HISTORY_INVALID_INDEX', 'HEYNA_FAILURE_HISTORY_UNREADABLE_INDEX'
]);
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function safeCount(value, context) {
    if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
        throw sourceContractError(`${context} must be a safe non-negative integer.`);
    }
    return value;
}

function normalizeReaderOptions(options = {}) {
    if (!isPlainObject(options)) throw new TypeError('HistoricalFailureReader options must be a plain object.');
    const supported = new Set(['from', 'to', 'limit', 'project', 'includeMigrated']);
    const unexpected = Object.keys(options).filter(key => !supported.has(key)).sort(compareCodePoints);
    if (unexpected.length) throw new TypeError(`Unsupported historical failure reader option: ${unexpected[0]}`);
    const from = options.from == null ? null : parseDate(options.from, 'from', message => new TypeError(message));
    const to = options.to == null ? null : parseDate(options.to, 'to', message => new TypeError(message));
    if (from && to && from.epoch > to.epoch) throw new TypeError('from must not be later than to.');
    const limit = options.limit == null ? null : options.limit;
    if (limit !== null && (!Number.isSafeInteger(limit) || limit < 0)) throw new TypeError('limit must be a safe non-negative integer or null.');
    let project = null;
    if (options.project != null) {
        project = Array.isArray(options.project) ? options.project.slice() : [options.project];
        if (!project.length || project.some(item => typeof item !== 'string' || !item || item.length > 256 || /[\u0000-\u001f\u007f]/.test(item))) {
            throw new TypeError('project must contain bounded non-empty strings.');
        }
        if (new Set(project).size !== project.length) throw new TypeError('project values must be unique.');
        project.sort(compareCodePoints);
    }
    if (options.includeMigrated !== undefined && typeof options.includeMigrated !== 'boolean') throw new TypeError('includeMigrated must be boolean.');
    return {
        from: from ? from.iso : null,
        to: to ? to.iso : null,
        limit,
        project,
        includeMigrated: options.includeMigrated !== false
    };
}

function validateListing(value) {
    const listing = cloneJsonValue(value, 'HistoryManager listing');
    if (!isPlainObject(listing) || !Array.isArray(listing.runs) || !Array.isArray(listing.diagnostics)) {
        throw sourceContractError('HistoryManager listing must provide runs and diagnostics arrays.');
    }
    for (const field of ['discoveredRunCount', 'validRunCount', 'excludedRunCount']) safeCount(listing[field], `listing.${field}`);
    if (listing.discoveredRunCount !== safeAdd(listing.validRunCount, listing.excludedRunCount, 'listing run counts')) {
        throw sourceContractError('discoveredRunCount must equal validRunCount plus excludedRunCount.');
    }
    if (listing.runs.length !== listing.validRunCount || listing.diagnostics.length !== listing.excludedRunCount) {
        throw sourceContractError('listing collection lengths contradict source counters.');
    }
    if (listing.retention !== undefined) {
        if (!isPlainObject(listing.retention)
            || Reflect.ownKeys(listing.retention).length !== 3
            || !['enabled', 'maxRuns', 'maxAgeDays'].every(key => Object.prototype.hasOwnProperty.call(listing.retention, key))
            || typeof listing.retention.enabled !== 'boolean') {
            throw sourceContractError('listing.retention is invalid.');
        }
        if (listing.retention.maxRuns !== null
            && (!Number.isSafeInteger(listing.retention.maxRuns) || listing.retention.maxRuns < 0 || Object.is(listing.retention.maxRuns, -0))) {
            throw sourceContractError('listing.retention.maxRuns is invalid.');
        }
        if (listing.retention.maxAgeDays !== null
            && (!Number.isFinite(listing.retention.maxAgeDays) || listing.retention.maxAgeDays < 0 || Object.is(listing.retention.maxAgeDays, -0))) {
            throw sourceContractError('listing.retention.maxAgeDays is invalid.');
        }
    }
    const seen = new Set();
    listing.runs.forEach((summary, index) => {
        if (!isPlainObject(summary)) throw sourceContractError(`runs[${index}] must be a plain object.`);
        if (typeof summary.runId !== 'string' || !RUN_ID.test(summary.runId) || summary.runId === '.' || summary.runId === '..') {
            throw sourceContractError(`runs[${index}].runId is invalid.`);
        }
        if (seen.has(summary.runId)) throw sourceContractError(`duplicate runId: ${summary.runId}`);
        seen.add(summary.runId);
        parseDate(summary.timestamp, `runs[${index}].timestamp`, sourceContractError);
        safeCount(summary.total, `runs[${index}].total`);
        safeCount(summary.unsuccessful, `runs[${index}].unsuccessful`);
        if (summary.unsuccessful > summary.total) throw sourceContractError(`runs[${index}].unsuccessful exceeds total.`);
        if (summary.project !== null && summary.project !== undefined
            && (typeof summary.project !== 'string' || !summary.project || summary.project.length > 256)) {
            throw sourceContractError(`runs[${index}].project is invalid.`);
        }
    });
    return listing;
}

function cloneHistoryDiagnostic(item) {
    const code = item && HISTORY_DIAGNOSTIC_CODES.has(item.code)
        ? item.code
        : 'HEYNA_HISTORICAL_INVALID_SUMMARY';
    return warning(code, {
        runId: item && typeof item.runId === 'string' && RUN_ID.test(item.runId) ? item.runId : null,
        field: item && typeof item.field === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(item.field) ? item.field : null,
        details: item && item.details && item.details.file === 'summary.json' ? { file: 'summary.json' } : {}
    });
}

function forceDegraded(index) {
    return {
        ...index,
        counts: { ...index.counts },
        testOutcomes: index.testOutcomes.map(outcome => ({
            ...outcome,
            file: null,
            suitePath: [],
            title: 'Unidentified test',
            identityQuality: 'degraded',
            failure: outcome.failure ? { ...outcome.failure, signatureQuality: 'degraded' } : null
        }))
    };
}

class HistoricalFailureReader {
    constructor(options = {}) {
        if (!isPlainObject(options)) throw dependencyError('HistoricalFailureReader options must be a plain object.');
        if (!options.historyManager
            || typeof options.historyManager.listRunsWithDiagnostics !== 'function'
            || typeof options.historyManager.getRun !== 'function') {
            throw dependencyError('historyManager with listRunsWithDiagnostics() and getRun() is required.');
        }
        if (options.clock !== undefined && typeof options.clock !== 'function') throw dependencyError('clock must be a function.');
        this.historyManager = options.historyManager;
        this.clock = options.clock || (() => new Date());
    }

    generatedAt() {
        const value = this.clock();
        const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
        if (!Number.isFinite(date.getTime())) throw new TypeError('clock must return a valid date.');
        return date.toISOString();
    }

    async read(options = {}) {
        const query = normalizeReaderOptions(options);
        const listing = validateListing(await this.historyManager.listRunsWithDiagnostics());
        const projectFilter = query.project ? new Set(query.project) : null;
        const from = query.from === null ? null : Date.parse(query.from);
        const to = query.to === null ? null : Date.parse(query.to);
        const matched = listing.runs.filter(summary => {
            const timestamp = Date.parse(summary.timestamp);
            if (from !== null && timestamp < from) return false;
            if (to !== null && timestamp > to) return false;
            if (projectFilter && !projectFilter.has(summary.project)) return false;
            if (!query.includeMigrated && summary.migration) return false;
            return true;
        });
        matched.sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp)
            || compareCodePoints(right.runId, left.runId));
        const selected = query.limit === null ? matched.slice() : matched.slice(0, query.limit);
        selected.sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp)
            || compareCodePoints(left.runId, right.runId));

        const warnings = listing.diagnostics.map(cloneHistoryDiagnostic);
        const runs = [];
        let indexedRunCount = 0;
        let legacyNormalizedRunCount = 0;
        let aggregateOnlyRunCount = 0;
        let malformedFailureIndexRunCount = 0;
        let zeroTestRunCount = 0;
        let testOutcomeCount = 0;
        let failureObservationCount = 0;

        for (const summary of selected) {
            const stored = cloneJsonValue(
                await this.historyManager.getRun(summary.runId),
                `HistoryManager run ${summary.runId}`
            );
            let index = null;
            let detailStatus = 'aggregate-only';
            if (stored && stored.failureIndex) {
                try {
                    index = validateFailureIndex(cloneJsonValue(stored.failureIndex, `run ${summary.runId} failure index`), {
                        expectedRunId: summary.runId,
                        expectedTimestamp: summary.timestamp
                    });
                    detailStatus = 'indexed';
                    indexedRunCount = safeAdd(indexedRunCount, 1, 'indexed runs');
                } catch (error) {
                    malformedFailureIndexRunCount = safeAdd(malformedFailureIndexRunCount, 1, 'malformed failure indexes');
                    detailStatus = 'invalid-index';
                    warnings.push(warning(
                        error && error.code === 'HEYNA_FAILURE_HISTORY_UNSUPPORTED_INDEX_SCHEMA'
                            ? 'HEYNA_FAILURE_HISTORY_UNSUPPORTED_INDEX_SCHEMA'
                            : 'HEYNA_FAILURE_HISTORY_INVALID_INDEX',
                        { runId: summary.runId, field: 'failureIndex' }
                    ));
                }
            } else if (stored && stored.failureIndexDiagnostic) {
                malformedFailureIndexRunCount = safeAdd(malformedFailureIndexRunCount, 1, 'malformed failure indexes');
                detailStatus = 'invalid-index';
                const code = INDEX_DIAGNOSTIC_CODES.has(stored.failureIndexDiagnostic.code)
                    ? stored.failureIndexDiagnostic.code
                    : 'HEYNA_FAILURE_HISTORY_INVALID_INDEX';
                warnings.push(warning(code, { runId: summary.runId, field: 'failureIndex' }));
            } else if (stored && Array.isArray(stored.execution)) {
                warnings.push(warning(
                    'HEYNA_FAILURE_HISTORY_MISSING_INDEX',
                    { runId: summary.runId, field: 'failureIndex' }
                ));
                try {
                    const legacy = buildLegacyFailureIndex({
                        runId: summary.runId,
                        timestamp: summary.timestamp,
                        execution: cloneJsonValue(stored.execution, `run ${summary.runId} legacy execution`),
                        metadata: stored.metadata || summary
                    });
                    index = forceDegraded(legacy.index);
                    validateFailureIndex(index, { expectedRunId: summary.runId, expectedTimestamp: summary.timestamp });
                    detailStatus = 'legacy-normalized';
                    legacyNormalizedRunCount = safeAdd(legacyNormalizedRunCount, 1, 'legacy normalized runs');
                    warnings.push(warning(
                        'HEYNA_FAILURE_HISTORY_LEGACY_EXECUTION_NORMALIZED',
                        { runId: summary.runId }
                    ));
                    warnings.push(warning(
                        'HEYNA_FAILURE_HISTORY_DEGRADED_IDENTITY',
                        { runId: summary.runId }
                    ));
                    if (legacy.collapsedDuplicateCount > 0) warnings.push(warning(
                        'HEYNA_FAILURE_HISTORY_LEGACY_DUPLICATE_COLLAPSED',
                        { runId: summary.runId }
                    ));
                } catch (error) {
                    index = null;
                    detailStatus = 'aggregate-only';
                    if (error && error.code === DUPLICATE_OUTCOME_CODE) warnings.push(warning(
                        'HEYNA_FAILURE_HISTORY_LEGACY_DUPLICATE_CONFLICT',
                        { runId: summary.runId }
                    ));
                }
            } else {
                warnings.push(warning(
                    'HEYNA_FAILURE_HISTORY_MISSING_INDEX',
                    { runId: summary.runId, field: 'failureIndex' }
                ));
            }

            if (!index) {
                aggregateOnlyRunCount = safeAdd(aggregateOnlyRunCount, 1, 'aggregate-only runs');
                warnings.push(warning(
                    'HEYNA_FAILURE_HISTORY_AGGREGATE_ONLY_RUN',
                    { runId: summary.runId }
                ));
            } else {
                testOutcomeCount = safeAdd(testOutcomeCount, index.counts.indexedTests, 'indexed test outcomes');
                failureObservationCount = safeAdd(failureObservationCount, index.counts.indexedFailures, 'indexed failure observations');
            }
            if (summary.total === 0) {
                zeroTestRunCount = safeAdd(zeroTestRunCount, 1, 'zero-test runs');
                warnings.push(warning(
                    'HEYNA_FAILURE_HISTORY_ZERO_TEST_RUN',
                    { runId: summary.runId }
                ));
            }
            runs.push({
                runId: summary.runId,
                timestamp: summary.timestamp,
                project: summary.project || null,
                totalTests: summary.total,
                unsuccessfulTests: summary.unsuccessful,
                migrated: Boolean(summary.migration),
                detailStatus,
                testOutcomes: index ? index.testOutcomes.map(outcome => ({
                    ...outcome,
                    suitePath: outcome.suitePath.slice(),
                    failure: outcome.failure ? { ...outcome.failure } : null
                })) : []
            });
        }

        if (listing.discoveredRunCount === 0) warnings.push(warning('HEYNA_FAILURE_HISTORY_EMPTY'));
        else if (matched.length === 0) warnings.push(warning('HEYNA_FAILURE_HISTORY_NO_MATCHING_RUNS'));
        if (selected.length < matched.length) warnings.push(warning(
            'HEYNA_FAILURE_HISTORY_LIMIT_APPLIED',
            { field: 'limit', details: { limit: query.limit, matchedRunCount: matched.length, selectedRunCount: selected.length } }
        ));
        const retentionEnabled = Boolean(listing.retention && listing.retention.enabled);
        if (retentionEnabled) warnings.push(warning(
            'HEYNA_FAILURE_HISTORY_RETENTION_WINDOW'
        ));
        const partial = listing.excludedRunCount > 0 || aggregateOnlyRunCount > 0 || malformedFailureIndexRunCount > 0 || retentionEnabled;
        if (partial) warnings.push(warning(
            'HEYNA_FAILURE_HISTORY_PARTIAL_ANALYSIS'
        ));

        return finalizeResult({
            failureHistorySchemaVersion: FAILURE_HISTORY_SCHEMA_VERSION,
            generatedAt: this.generatedAt(),
            query,
            source: {
                discoveredRunCount: listing.discoveredRunCount,
                validRunCount: listing.validRunCount,
                excludedRunCount: listing.excludedRunCount,
                matchedRunCount: matched.length,
                selectedRunCount: selected.length,
                indexedRunCount,
                legacyNormalizedRunCount,
                aggregateOnlyRunCount,
                malformedFailureIndexRunCount,
                zeroTestRunCount,
                testOutcomeCount,
                failureObservationCount
            },
            partial,
            limited: selected.length < matched.length,
            retentionBounded: retentionEnabled,
            runs,
            warnings
        });
    }
}

HistoricalFailureReader.FAILURE_HISTORY_SCHEMA_VERSION = FAILURE_HISTORY_SCHEMA_VERSION;

module.exports = HistoricalFailureReader;
module.exports.HistoricalFailureReader = HistoricalFailureReader;
