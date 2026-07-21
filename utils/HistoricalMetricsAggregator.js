const {
    AGGREGATION_SCHEMA_VERSION,
    GROUP_DIMENSIONS,
    METADATA_FIELDS,
    NUMERIC_RANGE_ERROR_CODE,
    SUPPORTED_HISTORY_SCHEMA_VERSIONS,
    TIME_DIMENSIONS,
    WARNING_CODES,
    assertSafeNumbers,
    compareCodePoints,
    deepFreeze,
    durationFromUnits,
    durationToUnits,
    legacyWriterDurationToUnits,
    normalizeQuery,
    numericRangeError,
    roundMetric,
    safeAddDurationUnits,
    safeAddFinite,
    safeAddInteger,
    timeBucket,
    validateDimension,
    warning
} = require('./HistoricalMetricsValidation');
const { validateSummary } = require('./HistoryValidation');

const STATUS_FIELDS = Object.freeze(['passed', 'failed', 'skipped', 'timedOut', 'interrupted']);
const AGGREGATION_COUNT_FIELDS = Object.freeze(['total', ...STATUS_FIELDS, 'unsuccessful', 'traceReportedCount', 'tracePreservedCount', 'traceAvailableCount']);
const AVAILABILITY_FIELDS = Object.freeze(['pdf', 'dashboard', 'evidence', 'traces']);
const DIAGNOSTIC_MESSAGES = Object.freeze({
    HEYNA_HISTORICAL_MISSING_SUMMARY: 'Completed history run is missing summary.json.',
    HEYNA_HISTORICAL_CORRUPT_SUMMARY: 'Completed history run contains corrupt summary.json.',
    HEYNA_HISTORICAL_UNSUPPORTED_SCHEMA: 'Completed history run uses an unsupported summary schema.',
    HEYNA_HISTORICAL_INVALID_SUMMARY: 'Completed history run contains an invalid summary.',
    HEYNA_HISTORICAL_AGGREGATION_UNUSABLE_SUMMARY: 'Completed history run is valid storage but cannot be represented by the aggregation numeric contract.',
    HEYNA_HISTORICAL_UNREADABLE_RUN: 'Completed history run summary.json could not be read.'
});
const SAFE_DIAGNOSTIC_ERROR_CODES = new Set(['ENOENT', 'EACCES', 'EPERM', 'EIO', 'EISDIR', 'ENOTDIR', 'UNKNOWN']);
const SAFE_DIAGNOSTIC_CODES = new Set(Object.keys(DIAGNOSTIC_MESSAGES));
const SAFE_SEVERITIES = new Set(['warning']);
const SAFE_VERSION_TOKEN = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,32})?$/;
const SAFE_RUN_ID = /^\d{8}-\d{6}-\d{3}-[a-f0-9]{8}$/;
const SAFE_FIELD = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

function publicVersionToken(value) {
    return typeof value === 'string' && value.length <= 64 && SAFE_VERSION_TOKEN.test(value)
        ? value
        : 'invalid-version-token';
}

function sortedObject(entries) {
    const result = {};
    [...entries]
        .sort(([left], [right]) => compareCodePoints(left, right))
        .forEach(([key, value]) => {
            Object.defineProperty(result, key, {
                value,
                enumerable: true,
                configurable: true,
                writable: true
            });
        });
    return result;
}

function normalizeMetadata(summary, field, issues) {
    const value = summary[field];
    if (value === null || value === undefined) {
        issues.push(warning(
            WARNING_CODES.MISSING_METADATA,
            `Historical summary is missing optional metadata field ${field}.`,
            { runId: summary.runId, field }
        ));
        return null;
    }
    if (typeof value !== 'string' || value.trim() === '') {
        issues.push(warning(
            WARNING_CODES.INVALID_METADATA,
            `Historical summary has invalid optional metadata field ${field}.`,
            { runId: summary.runId, field, details: { valueType: typeof value } }
        ));
        return null;
    }
    return value;
}

function normalizeReportAvailability(summary, issues) {
    const source = summary.reportAvailability;
    const result = {};
    AVAILABILITY_FIELDS.forEach(field => {
        const value = source && source[field];
        if (typeof value !== 'boolean') {
            issues.push(warning(
                WARNING_CODES.INVALID_METADATA,
                `Historical summary has invalid report availability field ${field}.`,
                { runId: summary.runId, field: `reportAvailability.${field}` }
            ));
        }
        result[field] = value === true;
    });
    return result;
}

function normalizeSummaryDuration(summary, issues) {
    try {
        durationToUnits(summary.totalDuration, 'summary total duration');
        return summary.totalDuration;
    } catch (error) {
        if (!error || error.code !== NUMERIC_RANGE_ERROR_CODE || summary.schemaVersion !== '1.0.0' || summary.total < 2) throw error;
        try {
            const units = legacyWriterDurationToUnits(summary.totalDuration, 'summary total duration');
            const normalized = durationFromUnits(units, 'summary total duration');
            const storedAverage = roundMetric(summary.totalDuration / summary.total);
            const normalizedAverage = roundMetric(normalized / summary.total);
            if (summary.averageDuration !== storedAverage || summary.averageDuration !== normalizedAverage) throw error;
            issues.push(warning(
                WARNING_CODES.DURATION_NORMALIZED,
                'Historical summary totalDuration contained a recognized legacy floating-point writer artifact and was normalized.',
                {
                    runId: summary.runId,
                    field: 'totalDuration',
                    details: { stored: summary.totalDuration, normalized }
                }
            ));
            return normalized;
        } catch (compatibilityError) {
            throw error;
        }
    }
}

function validateAggregationSummaryNumbers(summary, issues) {
    AGGREGATION_COUNT_FIELDS.forEach(field => {
        if (!Number.isSafeInteger(summary[field]) || summary[field] < 0 || Object.is(summary[field], -0)) {
            throw numericRangeError(`summary ${field}`);
        }
    });
    Object.entries(summary.failureCategoryCounts).forEach(([category, count]) => {
        if (!Number.isSafeInteger(count) || count < 0 || Object.is(count, -0)) {
            throw numericRangeError(`failure category ${category}`);
        }
    });
    const totalDuration = normalizeSummaryDuration(summary, issues);
    durationToUnits(summary.averageDuration, 'summary average duration');
    if (!Number.isFinite(summary.passRate) || Object.is(summary.passRate, -0)) {
        throw numericRangeError('summary pass rate');
    }
    return { totalDuration };
}

function normalizeSummary(summary) {
    validateSummary(summary, { expectedRunId: summary && summary.runId });
    const issues = [];
    const { totalDuration } = validateAggregationSummaryNumbers(summary, issues);
    const statusCounts = {};
    STATUS_FIELDS.forEach(field => { statusCounts[field] = summary[field]; });
    const total = Object.values(statusCounts).reduce((sum, value) => safeAddInteger(sum, value, 'normalized status total'), 0);
    const unsuccessful = [statusCounts.failed, statusCounts.timedOut, statusCounts.interrupted]
        .reduce((sum, value) => safeAddInteger(sum, value, 'normalized unsuccessful count'), 0);
    const computedPassRate = total > 0 ? roundMetric((statusCounts.passed / total) * 100) : null;
    const storedPassRate = summary.passRate;
    const storagePassRate = computedPassRate === null ? 0 : computedPassRate;
    if (storedPassRate !== storagePassRate) {
        issues.push(warning(
            WARNING_CODES.DERIVED_METRIC_MISMATCH,
            'Stored passRate does not match the rate recomputed from status counts.',
            {
                runId: summary.runId,
                field: 'passRate',
                details: { stored: storedPassRate, recomputed: storagePassRate }
            }
        ));
    }

    const computedAverageDuration = total > 0 ? roundMetric(totalDuration / total) : 0;
    if (summary.averageDuration !== computedAverageDuration) {
        issues.push(warning(
            WARNING_CODES.DERIVED_METRIC_MISMATCH,
            'Stored averageDuration does not match totalDuration divided by total.',
            {
                runId: summary.runId,
                field: 'averageDuration',
                details: { stored: summary.averageDuration, recomputed: computedAverageDuration }
            }
        ));
    }

    if (total === 0) {
        issues.push(warning(
            WARNING_CODES.ZERO_TEST_RUN,
            'Historical run contains zero tests and does not contribute to rate denominators.',
            { runId: summary.runId }
        ));
    }

    const failureCategoryCounts = sortedObject(Object.entries(summary.failureCategoryCounts || {}));
    const startTimeMs = Date.parse(summary.startTime);
    const endTimeMs = Date.parse(summary.endTime);
    const elapsedDurationMs = endTimeMs - startTimeMs;
    if (!Number.isFinite(elapsedDurationMs) || elapsedDurationMs < 0 || elapsedDurationMs > Number.MAX_SAFE_INTEGER) {
        throw new RangeError('Historical summary elapsed duration is outside the safe numeric range.');
    }
    const metadata = {};
    METADATA_FIELDS.forEach(field => { metadata[field] = normalizeMetadata(summary, field, issues); });
    const migration = summary.migration
        ? {
            identity: summary.migration.identity,
            source: summary.migration.source,
            sourceChecksum: summary.migration.sourceChecksum
        }
        : null;

    const run = {
        runId: summary.runId,
        historySchemaVersion: summary.schemaVersion,
        timestamp: summary.timestamp,
        startTime: summary.startTime,
        endTime: summary.endTime,
        elapsedDurationMs,
        total,
        ...statusCounts,
        unsuccessful,
        passRate: computedPassRate,
        totalTestDurationMs: totalDuration,
        averageTestDurationMs: total > 0 ? roundMetric(totalDuration / total) : null,
        ...metadata,
        failureCategoryCounts,
        traceReportedCount: summary.traceReportedCount,
        tracePreservedCount: summary.tracePreservedCount,
        reportAvailability: normalizeReportAvailability(summary, issues),
        migration
    };

    return { run: deepFreeze(run), issues };
}

function addCounts(target, source) {
    Object.keys(source).forEach(key => {
        const existing = Object.prototype.hasOwnProperty.call(target, key) ? target[key] : 0;
        const value = safeAddInteger(existing, source[key], `failure category ${key}`);
        Object.defineProperty(target, key, {
            value,
            enumerable: true,
            configurable: true,
            writable: true
        });
    });
}

function aggregateRuns(runs) {
    const totals = {
        tests: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        timedOut: 0,
        interrupted: 0,
        unsuccessful: 0
    };
    const durations = {
        totalTestDurationMs: 0,
        averageRunTestDurationMs: null,
        averageTestDurationMs: null,
        totalElapsedDurationMs: 0,
        averageRunElapsedDurationMs: null
    };
    let totalTestDurationUnits = 0n;
    const traces = { reported: 0, preserved: 0 };
    const failureCategoryCounts = {};
    const artifactAvailabilityCounts = { pdf: 0, dashboard: 0, evidence: 0, traces: 0 };
    let runPassRateTotal = 0;
    let ratedRunCount = 0;

    runs.forEach(run => {
        totals.tests = safeAddInteger(totals.tests, run.total, 'total tests');
        totals.passed = safeAddInteger(totals.passed, run.passed, 'passed tests');
        totals.failed = safeAddInteger(totals.failed, run.failed, 'failed tests');
        totals.skipped = safeAddInteger(totals.skipped, run.skipped, 'skipped tests');
        totals.timedOut = safeAddInteger(totals.timedOut, run.timedOut, 'timed-out tests');
        totals.interrupted = safeAddInteger(totals.interrupted, run.interrupted, 'interrupted tests');
        totals.unsuccessful = safeAddInteger(totals.unsuccessful, run.unsuccessful, 'unsuccessful tests');
        totalTestDurationUnits = safeAddDurationUnits(totalTestDurationUnits, run.totalTestDurationMs, 'total test duration');
        durations.totalElapsedDurationMs = safeAddInteger(durations.totalElapsedDurationMs, run.elapsedDurationMs, 'total elapsed duration');
        traces.reported = safeAddInteger(traces.reported, run.traceReportedCount, 'reported traces');
        traces.preserved = safeAddInteger(traces.preserved, run.tracePreservedCount, 'preserved traces');
        addCounts(failureCategoryCounts, run.failureCategoryCounts);
        AVAILABILITY_FIELDS.forEach(field => {
            if (run.reportAvailability[field]) artifactAvailabilityCounts[field] = safeAddInteger(artifactAvailabilityCounts[field], 1, `${field} availability`);
        });
        if (run.total > 0) {
            runPassRateTotal = safeAddFinite(runPassRateTotal, (run.passed / run.total) * 100, 'run pass rates');
            ratedRunCount = safeAddInteger(ratedRunCount, 1, 'rated runs');
        }
    });

    durations.totalTestDurationMs = durationFromUnits(totalTestDurationUnits, 'total test duration');
    if (runs.length) {
        durations.averageRunTestDurationMs = roundMetric(durations.totalTestDurationMs / runs.length);
        durations.averageRunElapsedDurationMs = roundMetric(durations.totalElapsedDurationMs / runs.length);
    }
    if (totals.tests > 0) {
        durations.averageTestDurationMs = roundMetric(durations.totalTestDurationMs / totals.tests);
    }

    const rates = {
        weightedPassRate: totals.tests > 0 ? roundMetric((totals.passed / totals.tests) * 100) : null,
        averageRunPassRate: ratedRunCount > 0 ? roundMetric(runPassRateTotal / ratedRunCount) : null,
        unsuccessfulRate: totals.tests > 0 ? roundMetric((totals.unsuccessful / totals.tests) * 100) : null,
        skippedRate: totals.tests > 0 ? roundMetric((totals.skipped / totals.tests) * 100) : null,
        ratedRunCount
    };

    return {
        runCount: runs.length,
        totals,
        rates,
        durations,
        traces,
        failureCategoryCounts: sortedObject(Object.entries(failureCategoryCounts)),
        artifactAvailabilityCounts
    };
}

function selectedDateRange(runs) {
    if (!runs.length) return { from: null, to: null };
    let from = runs[0].timestamp;
    let to = runs[0].timestamp;
    let fromMs = Date.parse(from);
    let toMs = fromMs;
    for (let index = 1; index < runs.length; index += 1) {
        const timestamp = runs[index].timestamp;
        const timestampMs = Date.parse(timestamp);
        if (timestampMs < fromMs) {
            from = timestamp;
            fromMs = timestampMs;
        }
        if (timestampMs > toMs) {
            to = timestamp;
            toMs = timestampMs;
        }
    }
    return { from, to };
}

function coalesceRunWarnings(records) {
    const coalesced = new Map();
    const warnings = [];
    records.forEach(record => {
        record.issues.forEach(item => {
            if (![WARNING_CODES.MISSING_METADATA, WARNING_CODES.INVALID_METADATA].includes(item.code)) {
                warnings.push({ ...item, details: { ...item.details } });
                return;
            }
            const key = `${item.code}\0${item.field}`;
            if (!coalesced.has(key)) coalesced.set(key, { template: item, count: 0 });
            coalesced.get(key).count += 1;
        });
    });
    [...coalesced.values()].forEach(({ template, count }) => {
        warnings.push(warning(
            template.code,
            `${count} selected historical run${count === 1 ? '' : 's'} ${template.code === WARNING_CODES.MISSING_METADATA ? 'are missing' : 'have invalid'} ${template.field}.`,
            { field: template.field, details: { affectedRunCount: count } }
        ));
    });
    return warnings;
}

function cloneDiagnostic(diagnostic) {
    const source = diagnostic && typeof diagnostic === 'object' ? diagnostic : {};
    const code = SAFE_DIAGNOSTIC_CODES.has(source.code) ? source.code : WARNING_CODES.INVALID_SUMMARY;
    const details = {};
    if (source.details && typeof source.details === 'object') {
        if (source.details.file === 'summary.json') details.file = 'summary.json';
        if (Object.prototype.hasOwnProperty.call(source.details, 'schemaVersion')) {
            details.schemaVersion = publicVersionToken(source.details.schemaVersion);
        }
        if (SAFE_DIAGNOSTIC_ERROR_CODES.has(source.details.errorCode)) details.errorCode = source.details.errorCode;
    }
    return {
        code,
        severity: SAFE_SEVERITIES.has(source.severity) ? source.severity : 'warning',
        message: DIAGNOSTIC_MESSAGES[code],
        runId: typeof source.runId === 'string' && SAFE_RUN_ID.test(source.runId) ? source.runId : null,
        field: typeof source.field === 'string' && SAFE_FIELD.test(source.field) ? source.field : null,
        details
    };
}

function sourceContractError(message) {
    const error = new TypeError(`HistoryManager diagnostic source contract violation: ${message}`);
    error.code = 'HEYNA_HISTORICAL_SOURCE_CONTRACT';
    return error;
}

function finalizeResult(result) {
    assertSafeNumbers(result);
    JSON.stringify(result);
    return deepFreeze(result);
}

class HistoricalMetricsAggregator {
    constructor(options = {}) {
        if (!options || typeof options !== 'object' || Array.isArray(options)) {
            throw new TypeError('HistoricalMetricsAggregator options must be an object.');
        }
        if (!options.historyManager || typeof options.historyManager.listRunsWithDiagnostics !== 'function') {
            throw new TypeError('historyManager with listRunsWithDiagnostics() is required.');
        }

        if (options.clock !== undefined && typeof options.clock !== 'function') throw new TypeError('clock must be a function.');
        this.historyManager = options.historyManager;
        this.logger = options.logger || null;
        this.clock = options.clock || (() => new Date());
    }

    generatedAt() {
        const value = this.clock();
        const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
        if (!Number.isFinite(date.getTime())) throw new TypeError('clock must return a valid date value.');
        return date.toISOString();
    }

    async prepare(options = {}, behavior = {}) {
        let query = normalizeQuery(options);
        if (behavior.ignoreLimit) query = { ...query, limit: null };
        const sourceResult = await this.historyManager.listRunsWithDiagnostics();
        if (!sourceResult || !Array.isArray(sourceResult.runs) || !Array.isArray(sourceResult.diagnostics)) {
            throw sourceContractError('runs and diagnostics must be arrays.');
        }
        for (const field of ['discoveredRunCount', 'validRunCount', 'excludedRunCount']) {
            if (!Number.isSafeInteger(sourceResult[field]) || sourceResult[field] < 0) {
                throw sourceContractError(`${field} must be a safe non-negative integer.`);
            }
        }
        if (sourceResult.discoveredRunCount !== sourceResult.validRunCount + sourceResult.excludedRunCount) {
            throw sourceContractError('discoveredRunCount must equal validRunCount plus excludedRunCount.');
        }
        if (sourceResult.runs.length !== sourceResult.validRunCount) {
            throw sourceContractError('runs length must equal validRunCount.');
        }
        if (sourceResult.diagnostics.length !== sourceResult.excludedRunCount) {
            throw sourceContractError('diagnostics length must equal excludedRunCount.');
        }

        const records = [];
        const aggregationDiagnostics = [];
        sourceResult.runs.forEach(summary => {
            try {
                records.push(normalizeSummary(summary));
            } catch (error) {
                if (!error || error.code !== NUMERIC_RANGE_ERROR_CODE) throw error;
                aggregationDiagnostics.push(warning(
                    WARNING_CODES.AGGREGATION_UNUSABLE_SUMMARY,
                    'Completed history run is valid storage but cannot be represented by the aggregation numeric contract.',
                    { runId: summary.runId, field: 'numericContract' }
                ));
            }
        });
        if (records.length + aggregationDiagnostics.length !== sourceResult.validRunCount) {
            throw sourceContractError('aggregatable runs plus aggregation exclusions must equal validRunCount.');
        }
        const runIdFilter = query.runIds ? new Set(query.runIds) : null;
        const schemaFilter = new Set(query.schemaVersion);
        const metadataFilters = {};
        METADATA_FIELDS.forEach(field => {
            metadataFilters[field] = query[field] ? new Set(query[field]) : null;
        });
        const from = query.from === null ? null : Date.parse(query.from);
        const to = query.to === null ? null : Date.parse(query.to);

        const matchedRecords = records.filter(record => {
            const run = record.run;
            const timestamp = Date.parse(run.timestamp);
            if (from !== null && timestamp < from) return false;
            if (to !== null && timestamp > to) return false;
            if (runIdFilter && !runIdFilter.has(run.runId)) return false;
            if (!schemaFilter.has(run.historySchemaVersion)) return false;
            if (!query.includeMigrated && run.migration) return false;
            return METADATA_FIELDS.every(field => !metadataFilters[field] || metadataFilters[field].has(run[field]));
        });

        matchedRecords.sort((left, right) => {
            const timestampDifference = Date.parse(left.run.timestamp) - Date.parse(right.run.timestamp);
            const runIdDifference = compareCodePoints(left.run.runId, right.run.runId);
            const ascending = timestampDifference || runIdDifference;
            return query.newestFirst ? -ascending : ascending;
        });
        const selectedRecords = query.limit === null ? matchedRecords.slice() : matchedRecords.slice(0, query.limit);
        const source = {
            discoveredRunCount: sourceResult.discoveredRunCount,
            validRunCount: sourceResult.validRunCount,
            excludedRunCount: sourceResult.excludedRunCount,
            aggregationExcludedRunCount: aggregationDiagnostics.length,
            matchedRunCount: matchedRecords.length,
            selectedRunCount: selectedRecords.length
        };

        if (!Number.isSafeInteger(source.matchedRunCount) || !Number.isSafeInteger(source.selectedRunCount)
            || source.selectedRunCount > source.matchedRunCount
            || source.matchedRunCount > source.validRunCount - source.aggregationExcludedRunCount) {
            throw sourceContractError('selectedRunCount must not exceed matchedRunCount, and matchedRunCount must not exceed aggregatable valid runs.');
        }

        return { query, source, sourceResult, aggregationDiagnostics, matchedRecords, selectedRecords };
    }

    warningsFor(prepared, records) {
        const warnings = [
            ...prepared.sourceResult.diagnostics.map(cloneDiagnostic),
            ...prepared.aggregationDiagnostics.map(cloneDiagnostic)
        ];
        const totalExcludedRunCount = safeAddInteger(
            prepared.source.excludedRunCount,
            prepared.source.aggregationExcludedRunCount,
            'total excluded runs'
        );
        if (totalExcludedRunCount > 0) {
            const details = {
                excludedRunCount: prepared.source.excludedRunCount,
                aggregationExcludedRunCount: prepared.source.aggregationExcludedRunCount
            };
            warnings.push(warning(
                WARNING_CODES.EXCLUDED_RUN,
                `${totalExcludedRunCount} discovered historical run${totalExcludedRunCount === 1 ? ' was' : 's were'} excluded from metrics.`,
                { details }
            ));
            warnings.push(warning(
                WARNING_CODES.PARTIAL_AGGREGATION,
                'Historical metrics are partial because one or more discovered runs were excluded.',
                { details }
            ));
        }
        warnings.push(...coalesceRunWarnings(records));
        if (prepared.source.discoveredRunCount === 0) {
            warnings.push(warning(WARNING_CODES.EMPTY_HISTORY, 'No completed historical runs were discovered.'));
        } else if (prepared.source.validRunCount > prepared.source.aggregationExcludedRunCount && prepared.source.matchedRunCount === 0) {
            warnings.push(warning(WARNING_CODES.NO_MATCHING_RUNS, 'No valid historical runs matched the query filters.'));
        }
        if (prepared.source.selectedRunCount < prepared.source.matchedRunCount) {
            warnings.push(warning(
                WARNING_CODES.LIMIT_APPLIED,
                `The historical query limit of ${prepared.query.limit} was applied after filtering.`,
                {
                    field: 'limit',
                    details: {
                        limit: prepared.query.limit,
                        matchedRunCount: prepared.source.matchedRunCount,
                        selectedRunCount: prepared.source.selectedRunCount
                    }
                }
            ));
        }
        return warnings;
    }

    baseResult(prepared, records) {
        const runs = records.map(record => record.run);
        const metrics = aggregateRuns(runs);
        return {
            aggregationSchemaVersion: AGGREGATION_SCHEMA_VERSION,
            supportedHistorySchemaVersions: SUPPORTED_HISTORY_SCHEMA_VERSIONS.slice(),
            generatedAt: this.generatedAt(),
            query: { ...prepared.query },
            source: { ...prepared.source },
            ...metrics,
            dateRange: selectedDateRange(runs),
            warnings: this.warningsFor(prepared, records)
        };
    }

    async queryRuns(options = {}) {
        const prepared = await this.prepare(options);
        return finalizeResult({
            aggregationSchemaVersion: AGGREGATION_SCHEMA_VERSION,
            generatedAt: this.generatedAt(),
            query: { ...prepared.query },
            source: { ...prepared.source },
            runs: prepared.selectedRecords.map(record => record.run),
            warnings: this.warningsFor(prepared, prepared.selectedRecords)
        });
    }

    async aggregate(options = {}) {
        const prepared = await this.prepare(options);
        return finalizeResult(this.baseResult(prepared, prepared.selectedRecords));
    }

    async groupBy(dimension, options = {}) {
        const selectedDimension = validateDimension(dimension);
        const prepared = await this.prepare(options);
        const buckets = new Map();

        prepared.selectedRecords.forEach(record => {
            const run = record.run;
            let descriptor;
            if (TIME_DIMENSIONS.includes(selectedDimension)) {
                descriptor = timeBucket(selectedDimension, run.timestamp);
            } else if (selectedDimension === 'schemaVersion') {
                descriptor = { key: run.historySchemaVersion, label: run.historySchemaVersion, start: null, endExclusive: null };
            } else if (selectedDimension === 'migration') {
                descriptor = run.migration
                    ? { key: 'migrated', label: 'Migrated', start: null, endExclusive: null }
                    : { key: 'native', label: 'Native', start: null, endExclusive: null };
            } else {
                const key = run[selectedDimension];
                descriptor = { key, label: key === null ? 'Unknown' : key, start: null, endExclusive: null };
            }

            const bucketId = descriptor.key === null ? 'null:' : `string:${descriptor.key}`;
            if (!buckets.has(bucketId)) buckets.set(bucketId, { descriptor, runs: [] });
            buckets.get(bucketId).runs.push(run);
        });

        const groups = [...buckets.values()].map(bucket => ({
            ...bucket.descriptor,
            ...aggregateRuns(bucket.runs)
        }));
        groups.sort((left, right) => {
            if (TIME_DIMENSIONS.includes(selectedDimension)) return compareCodePoints(left.start, right.start);
            if (left.key === null) return right.key === null ? 0 : 1;
            if (right.key === null) return -1;
            return compareCodePoints(left.key, right.key);
        });

        return finalizeResult({
            ...this.baseResult(prepared, prepared.selectedRecords),
            groups
        });
    }

    getAvailableDimensions() {
        return finalizeResult(GROUP_DIMENSIONS.map(name => ({
            name,
            kind: TIME_DIMENSIONS.includes(name) ? 'time' : 'dimension'
        })));
    }

    async getAvailableDateRange(options = {}) {
        const prepared = await this.prepare(options, { ignoreLimit: true });
        const matchedRuns = prepared.matchedRecords.map(record => record.run);
        return finalizeResult({
            aggregationSchemaVersion: AGGREGATION_SCHEMA_VERSION,
            generatedAt: this.generatedAt(),
            query: { ...prepared.query },
            source: { ...prepared.source },
            dateRange: selectedDateRange(matchedRuns),
            warnings: this.warningsFor(prepared, prepared.matchedRecords)
        });
    }
}

HistoricalMetricsAggregator.AGGREGATION_SCHEMA_VERSION = AGGREGATION_SCHEMA_VERSION;
HistoricalMetricsAggregator.SUPPORTED_HISTORY_SCHEMA_VERSIONS = SUPPORTED_HISTORY_SCHEMA_VERSIONS;

module.exports = HistoricalMetricsAggregator;
module.exports.HistoricalMetricsAggregator = HistoricalMetricsAggregator;
