const {
    CANONICAL_METRIC,
    DURATION_TREND_SCHEMA_VERSION,
    SPIKE_ALGORITHM,
    SUPPORTED_AGGREGATION_SCHEMA_VERSION,
    cloneJsonValue,
    dependencyError,
    finalizeResult,
    isPlainObject,
    normalizeDurationTrendOptions,
    requireFiniteNonNegativeNumber,
    requireSafeNonNegativeInteger,
    roundMetric,
    safeAddNonNegativeInteger,
    sourceContractError,
    trendWarning
} = require('./DurationTrendValidation');

const WARNING_CODES = Object.freeze({
    INSUFFICIENT_DATA: 'HEYNA_DURATION_TREND_INSUFFICIENT_DATA',
    UNDEFINED_PERCENT_CHANGE: 'HEYNA_DURATION_TREND_UNDEFINED_PERCENT_CHANGE',
    ZERO_DURATION_POINT: 'HEYNA_DURATION_TREND_ZERO_DURATION_POINT'
});
const SOURCE_COUNTER_FIELDS = Object.freeze([
    'discoveredRunCount',
    'validRunCount',
    'excludedRunCount',
    'aggregationExcludedRunCount',
    'matchedRunCount',
    'selectedRunCount'
]);
const PUBLIC_QUERY_FIELDS = Object.freeze([
    'from', 'to', 'runIds', 'project', 'feature', 'environment', 'browser', 'executedBy',
    'schemaVersion', 'includeMigrated', 'limit'
]);
const QUERY_METADATA_FIELDS = Object.freeze(['project', 'feature', 'environment', 'browser', 'executedBy']);
const WARNING_SEVERITIES = new Set(['info', 'warning', 'error']);
const WARNING_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SAFE_FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;
const SAFE_VERSION_PATTERN = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,32})?$/;
const SAFE_DIAGNOSTIC_ERROR_CODES = new Set(['ENOENT', 'EACCES', 'EPERM', 'EIO', 'EISDIR', 'ENOTDIR', 'UNKNOWN']);
const ISO_TIMESTAMP_PATTERN = /^(\d{4}|[+-]\d{6})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:(Z)|([+-])(\d{2}):(\d{2}))$/;
const TIME_GROUP_KEY_PATTERNS = Object.freeze({
    day: /^(?:\d{4}|[+-]\d{6})-\d{2}-\d{2}$/,
    week: /^(?:\d{4}|[+-]\d{6})-W(?:0[1-9]|[1-4]\d|5[0-3])$/,
    month: /^(?:\d{4}|[+-]\d{6})-(?:0[1-9]|1[0-2])$/
});
const HISTORICAL_WARNING_MESSAGES = Object.freeze({
    HEYNA_HISTORICAL_CORRUPT_SUMMARY: 'Completed history run contains corrupt summary.json.',
    HEYNA_HISTORICAL_MISSING_SUMMARY: 'Completed history run is missing summary.json.',
    HEYNA_HISTORICAL_UNREADABLE_RUN: 'Completed history run summary.json could not be read.',
    HEYNA_HISTORICAL_UNSUPPORTED_SCHEMA: 'Completed history run uses an unsupported summary schema.',
    HEYNA_HISTORICAL_INVALID_SUMMARY: 'Completed history run contains an invalid summary.',
    HEYNA_HISTORICAL_AGGREGATION_UNUSABLE_SUMMARY: 'Completed history run is valid storage but cannot be represented by the aggregation numeric contract.',
    HEYNA_HISTORICAL_DURATION_NORMALIZED: 'Historical summary totalDuration contained a recognized legacy floating-point writer artifact and was normalized.',
    HEYNA_HISTORICAL_DERIVED_METRIC_MISMATCH: 'A stored derived historical metric did not match its recomputed value.',
    HEYNA_HISTORICAL_MISSING_METADATA: 'One or more selected historical runs are missing optional metadata.',
    HEYNA_HISTORICAL_INVALID_METADATA: 'One or more selected historical runs have invalid optional metadata.',
    HEYNA_HISTORICAL_EXCLUDED_RUN: 'One or more discovered historical runs were excluded from metrics.',
    HEYNA_HISTORICAL_PARTIAL_AGGREGATION: 'Historical metrics are partial because one or more discovered runs were excluded.',
    HEYNA_HISTORICAL_EMPTY_HISTORY: 'No completed historical runs were discovered.',
    HEYNA_HISTORICAL_NO_MATCHING_RUNS: 'No valid historical runs matched the query filters.',
    HEYNA_HISTORICAL_ZERO_TEST_RUN: 'Historical run contains zero tests and does not contribute to rate denominators.',
    HEYNA_HISTORICAL_LIMIT_APPLIED: 'The historical query limit was applied after filtering.'
});
const HISTORICAL_WARNING_DETAIL_FIELDS = Object.freeze({
    HEYNA_HISTORICAL_CORRUPT_SUMMARY: Object.freeze(['file', 'schemaVersion', 'errorCode']),
    HEYNA_HISTORICAL_MISSING_SUMMARY: Object.freeze(['file', 'schemaVersion', 'errorCode']),
    HEYNA_HISTORICAL_UNREADABLE_RUN: Object.freeze(['file', 'schemaVersion', 'errorCode']),
    HEYNA_HISTORICAL_UNSUPPORTED_SCHEMA: Object.freeze(['file', 'schemaVersion', 'errorCode']),
    HEYNA_HISTORICAL_INVALID_SUMMARY: Object.freeze(['file', 'schemaVersion', 'errorCode']),
    HEYNA_HISTORICAL_AGGREGATION_UNUSABLE_SUMMARY: Object.freeze(['file', 'schemaVersion', 'errorCode']),
    HEYNA_HISTORICAL_DURATION_NORMALIZED: Object.freeze(['stored', 'normalized']),
    HEYNA_HISTORICAL_DERIVED_METRIC_MISMATCH: Object.freeze(['stored', 'recomputed']),
    HEYNA_HISTORICAL_MISSING_METADATA: Object.freeze(['affectedRunCount']),
    HEYNA_HISTORICAL_INVALID_METADATA: Object.freeze(['affectedRunCount']),
    HEYNA_HISTORICAL_EXCLUDED_RUN: Object.freeze(['excludedRunCount', 'aggregationExcludedRunCount']),
    HEYNA_HISTORICAL_PARTIAL_AGGREGATION: Object.freeze(['excludedRunCount', 'aggregationExcludedRunCount']),
    HEYNA_HISTORICAL_EMPTY_HISTORY: Object.freeze([]),
    HEYNA_HISTORICAL_NO_MATCHING_RUNS: Object.freeze([]),
    HEYNA_HISTORICAL_ZERO_TEST_RUN: Object.freeze([]),
    HEYNA_HISTORICAL_LIMIT_APPLIED: Object.freeze(['limit', 'matchedRunCount', 'selectedRunCount'])
});
const WARNING_COUNT_DETAIL_FIELDS = new Set([
    'affectedRunCount', 'excludedRunCount', 'aggregationExcludedRunCount', 'limit', 'matchedRunCount', 'selectedRunCount'
]);
const WARNING_NUMBER_DETAIL_FIELDS = new Set(['stored', 'normalized', 'recomputed']);

function compareCodePoints(left, right) {
    if (left === right) return 0;
    return left < right ? -1 : 1;
}

function validateDependency(dependency) {
    if (!dependency || typeof dependency !== 'object') {
        throw dependencyError('historicalMetricsAggregator is required.');
    }
    if (typeof dependency.queryRuns !== 'function' || typeof dependency.groupBy !== 'function') {
        throw dependencyError('historicalMetricsAggregator must provide queryRuns() and groupBy().');
    }
    return dependency;
}

function daysInMonth(year, month) {
    if (month === 2) {
        const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
        return leap ? 29 : 28;
    }
    return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function timestampEpoch(value, context, normalizedUtc = false) {
    if (typeof value !== 'string') throw sourceContractError(`${context} must be an ISO-8601 timestamp string.`);
    const match = ISO_TIMESTAMP_PATTERN.exec(value);
    if (!match) throw sourceContractError(`${context} must be a full ISO-8601 timestamp.`);
    const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText, zulu, sign, offsetHourText, offsetMinuteText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    const millisecond = Number((fractionText || '').padEnd(3, '0'));
    const offsetHour = zulu ? 0 : Number(offsetHourText);
    const offsetMinute = zulu ? 0 : Number(offsetMinuteText);
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)
        || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) {
        throw sourceContractError(`${context} must be a valid timestamp.`);
    }

    const local = new Date(0);
    local.setUTCFullYear(year, month - 1, day);
    local.setUTCHours(hour, minute, second, millisecond);
    const signedOffsetMinutes = zulu ? 0 : (sign === '+' ? 1 : -1) * (offsetHour * 60 + offsetMinute);
    const timestamp = local.getTime() - signedOffsetMinutes * 60000;
    const roundTrip = new Date(timestamp + signedOffsetMinutes * 60000);
    if (!Number.isFinite(timestamp) || roundTrip.getUTCFullYear() !== year
        || roundTrip.getUTCMonth() !== month - 1 || roundTrip.getUTCDate() !== day
        || roundTrip.getUTCHours() !== hour || roundTrip.getUTCMinutes() !== minute
        || roundTrip.getUTCSeconds() !== second || roundTrip.getUTCMilliseconds() !== millisecond) {
        throw sourceContractError(`${context} must be a valid timestamp.`);
    }
    if (normalizedUtc && new Date(timestamp).toISOString() !== value) {
        throw sourceContractError(`${context} must be a normalized UTC timestamp.`);
    }
    return timestamp;
}

function sourceCount(value, context) {
    return requireSafeNonNegativeInteger(value, context, label => sourceContractError(`${label} must be a safe non-negative integer.`));
}

function sourceDuration(value, context, integer = false) {
    requireFiniteNonNegativeNumber(value, context, label => sourceContractError(`${label} must be a finite non-negative duration within the safe numeric range.`));
    if (integer && !Number.isSafeInteger(value)) throw sourceContractError(`${context} must be a safe non-negative integer duration.`);
    return value;
}

function sourceAdd(left, right, context) {
    sourceCount(left, context);
    sourceCount(right, context);
    const result = left + right;
    if (!Number.isSafeInteger(result)) throw sourceContractError(`${context} exceeds the safe integer range.`);
    return result;
}

function boundedString(value, context, maximumLength = 512) {
    if (typeof value !== 'string' || value.trim() === '' || value.length > maximumLength || /[\u0000-\u001f\u007f]/.test(value)) {
        throw sourceContractError(`${context} must be a non-empty bounded string.`);
    }
    return value;
}

function canonicalizeSource(source) {
    if (!isPlainObject(source)) throw sourceContractError('source must be a plain object.');
    SOURCE_COUNTER_FIELDS.forEach(field => sourceCount(source[field], `source.${field}`));
    if (source.discoveredRunCount !== sourceAdd(source.validRunCount, source.excludedRunCount, 'source discovered run count')) {
        throw sourceContractError('source.discoveredRunCount must equal validRunCount plus excludedRunCount.');
    }
    if (source.aggregationExcludedRunCount > source.validRunCount) {
        throw sourceContractError('source.aggregationExcludedRunCount must not exceed validRunCount.');
    }
    if (source.selectedRunCount > source.matchedRunCount) {
        throw sourceContractError('source.selectedRunCount must not exceed matchedRunCount.');
    }
    if (source.matchedRunCount > source.validRunCount - source.aggregationExcludedRunCount) {
        throw sourceContractError('source.matchedRunCount must not exceed aggregatable valid runs.');
    }
    const canonical = {};
    SOURCE_COUNTER_FIELDS.forEach(field => { canonical[field] = source[field]; });
    return canonical;
}

function queryStringList(value, context, pattern = null) {
    if (value === null) return null;
    if (!Array.isArray(value) || value.length === 0) throw sourceContractError(`${context} must be null or a non-empty array.`);
    const seen = new Set();
    value.forEach(item => {
        if (typeof item !== 'string' || item.trim() === '') throw sourceContractError(`${context} must contain non-empty strings.`);
        if (pattern && !pattern.test(item)) throw sourceContractError(`${context} contains an invalid value.`);
        if (seen.has(item)) throw sourceContractError(`${context} must contain unique values.`);
        seen.add(item);
    });
    return value.slice();
}

function sameStringList(left, right) {
    if (left === null || right === null) return left === right;
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function requestedStringList(options, field) {
    if (!Object.prototype.hasOwnProperty.call(options, field) || options[field] === null || options[field] === undefined) {
        return null;
    }
    return Array.isArray(options[field]) ? options[field].slice() : [options[field]];
}

function requestedTimestamp(options, field) {
    if (!Object.prototype.hasOwnProperty.call(options, field) || options[field] === null || options[field] === undefined) {
        return null;
    }
    let value = options[field];
    if (value instanceof Date) {
        if (!Number.isFinite(value.getTime())) throw sourceContractError(`requested ${field} must be a valid date.`);
        value = value.toISOString();
    }
    return new Date(timestampEpoch(value, `requested ${field}`)).toISOString();
}

function canonicalizeQuery(query, requestedOptions) {
    if (!isPlainObject(query)) throw sourceContractError('query must be a plain object.');
    PUBLIC_QUERY_FIELDS.forEach(field => {
        if (!Object.prototype.hasOwnProperty.call(query, field)) {
            throw sourceContractError(`query.${field} is required by the normalized query contract.`);
        }
    });
    const from = query.from === null ? null : (timestampEpoch(query.from, 'query.from', true), query.from);
    const to = query.to === null ? null : (timestampEpoch(query.to, 'query.to', true), query.to);
    if (from !== null && to !== null && Date.parse(from) > Date.parse(to)) {
        throw sourceContractError('query.from must not be later than query.to.');
    }
    const canonical = {
        from,
        to,
        runIds: queryStringList(query.runIds, 'query.runIds', RUN_ID_PATTERN)
    };
    QUERY_METADATA_FIELDS.forEach(field => {
        canonical[field] = queryStringList(query[field], `query.${field}`);
    });
    canonical.schemaVersion = queryStringList(query.schemaVersion, 'query.schemaVersion', SAFE_VERSION_PATTERN);
    if (typeof query.includeMigrated !== 'boolean') throw sourceContractError('query.includeMigrated must be a boolean.');
    canonical.includeMigrated = query.includeMigrated;
    if (query.limit !== null) sourceCount(query.limit, 'query.limit');
    canonical.limit = query.limit;

    for (const field of ['runIds', ...QUERY_METADATA_FIELDS]) {
        if (!sameStringList(canonical[field], requestedStringList(requestedOptions, field))) {
            throw sourceContractError(`query.${field} must match the requested filter semantics.`);
        }
    }
    if (canonical.from !== requestedTimestamp(requestedOptions, 'from')
        || canonical.to !== requestedTimestamp(requestedOptions, 'to')) {
        throw sourceContractError('query date bounds must match the requested filter semantics.');
    }
    const expectedIncludeMigrated = requestedOptions.includeMigrated !== false;
    const expectedLimit = requestedOptions.limit === null || requestedOptions.limit === undefined ? null : requestedOptions.limit;
    if (canonical.includeMigrated !== expectedIncludeMigrated || canonical.limit !== expectedLimit) {
        throw sourceContractError('query migration and limit fields must match the requested filter semantics.');
    }
    return canonical;
}

function validateRun(run, index, seenRunIds) {
    const context = `runs[${index}]`;
    if (!isPlainObject(run)) throw sourceContractError(`${context} must be a plain object.`);
    boundedString(run.runId, `${context}.runId`, 256);
    if (!RUN_ID_PATTERN.test(run.runId) || run.runId === '.' || run.runId === '..') {
        throw sourceContractError(`${context}.runId must be filesystem-safe.`);
    }
    if (seenRunIds.has(run.runId)) throw sourceContractError(`${context}.runId must be unique.`);
    seenRunIds.add(run.runId);
    const timestamp = timestampEpoch(run.timestamp, `${context}.timestamp`, true);
    const start = timestampEpoch(run.startTime, `${context}.startTime`, true);
    const end = timestampEpoch(run.endTime, `${context}.endTime`, true);
    if (timestamp !== start) throw sourceContractError(`${context}.timestamp must equal startTime.`);
    if (end < start) throw sourceContractError(`${context}.endTime must not be earlier than startTime.`);
    sourceDuration(run.elapsedDurationMs, `${context}.elapsedDurationMs`, true);
    if (run.elapsedDurationMs !== end - start) {
        throw sourceContractError(`${context}.elapsedDurationMs must equal endTime minus startTime.`);
    }
}

function validateGroup(group, index, seenKeys, granularity) {
    const context = `groups[${index}]`;
    if (!isPlainObject(group)) throw sourceContractError(`${context} must be a plain object.`);
    boundedString(group.key, `${context}.key`, 256);
    boundedString(group.label, `${context}.label`);
    if (!TIME_GROUP_KEY_PATTERNS[granularity].test(group.key)) {
        throw sourceContractError(`${context}.key is invalid for ${granularity} granularity.`);
    }
    if (seenKeys.has(group.key)) throw sourceContractError(`${context}.key must be unique.`);
    seenKeys.add(group.key);
    const start = timestampEpoch(group.start, `${context}.start`, true);
    const endExclusive = timestampEpoch(group.endExclusive, `${context}.endExclusive`, true);
    if (start >= endExclusive) throw sourceContractError(`${context}.start must be earlier than endExclusive.`);
    sourceCount(group.runCount, `${context}.runCount`);
    if (group.runCount === 0) throw sourceContractError(`${context}.runCount must be greater than zero.`);
    if (!isPlainObject(group.durations)) throw sourceContractError(`${context}.durations must be a plain object.`);
    sourceDuration(group.durations.totalElapsedDurationMs, `${context}.durations.totalElapsedDurationMs`, true);
    sourceDuration(group.durations.averageRunElapsedDurationMs, `${context}.durations.averageRunElapsedDurationMs`);
    const expectedAverage = roundMetric(
        group.durations.totalElapsedDurationMs / group.runCount,
        `${context} expected average elapsed duration`
    );
    if (group.durations.averageRunElapsedDurationMs !== expectedAverage) {
        throw sourceContractError(`${context}.durations.averageRunElapsedDurationMs contradicts total elapsed duration and runCount.`);
    }
    return group.runCount;
}

function canonicalizeWarningDetails(code, details, context) {
    const result = {};
    HISTORICAL_WARNING_DETAIL_FIELDS[code].forEach(field => {
        if (!Object.prototype.hasOwnProperty.call(details, field)) return;
        const value = details[field];
        if (WARNING_COUNT_DETAIL_FIELDS.has(field)) {
            result[field] = sourceCount(value, `${context}.details.${field}`);
            return;
        }
        if (WARNING_NUMBER_DETAIL_FIELDS.has(field)) {
            result[field] = sourceDuration(value, `${context}.details.${field}`);
            return;
        }
        if (field === 'file') {
            if (value === 'summary.json') result.file = value;
            return;
        }
        if (field === 'schemaVersion') {
            if (typeof value === 'string' && SAFE_VERSION_PATTERN.test(value)) result.schemaVersion = value;
            return;
        }
        if (field === 'errorCode' && SAFE_DIAGNOSTIC_ERROR_CODES.has(value)) result.errorCode = value;
    });
    return result;
}

function canonicalizeWarning(item, index) {
    const context = `warnings[${index}]`;
    if (!isPlainObject(item)) throw sourceContractError(`${context} must be a non-null plain object.`);
    if (typeof item.code !== 'string' || !WARNING_CODE_PATTERN.test(item.code)
        || !Object.prototype.hasOwnProperty.call(HISTORICAL_WARNING_MESSAGES, item.code)) {
        throw sourceContractError(`${context}.code is not a supported historical warning code.`);
    }
    if (!WARNING_SEVERITIES.has(item.severity) || item.severity !== 'warning') {
        throw sourceContractError(`${context}.severity is unsupported.`);
    }
    if (typeof item.message !== 'string') throw sourceContractError(`${context}.message must be a string.`);
    if (item.runId !== null && item.runId !== undefined
        && (typeof item.runId !== 'string' || !RUN_ID_PATTERN.test(item.runId))) {
        throw sourceContractError(`${context}.runId must be null or a filesystem-safe run ID.`);
    }
    if (item.field !== null && item.field !== undefined
        && (typeof item.field !== 'string' || !SAFE_FIELD_PATTERN.test(item.field))) {
        throw sourceContractError(`${context}.field must be null or a bounded field token.`);
    }
    if (!isPlainObject(item.details)) throw sourceContractError(`${context}.details must be a plain object.`);
    return {
        code: item.code,
        severity: 'warning',
        message: HISTORICAL_WARNING_MESSAGES[item.code],
        runId: item.runId || null,
        field: item.field || null,
        details: canonicalizeWarningDetails(item.code, item.details, context)
    };
}

function validateAggregatorResult(value, granularity, requestedOptions) {
    const result = cloneJsonValue(value, 'HistoricalMetricsAggregator result');
    if (!isPlainObject(result)) throw sourceContractError('result must be a plain object.');
    if (result.aggregationSchemaVersion !== SUPPORTED_AGGREGATION_SCHEMA_VERSION) {
        throw sourceContractError(`aggregationSchemaVersion must be ${SUPPORTED_AGGREGATION_SCHEMA_VERSION}.`);
    }
    timestampEpoch(result.generatedAt, 'generatedAt', true);
    result.query = canonicalizeQuery(result.query, requestedOptions);
    result.source = canonicalizeSource(result.source);
    if (!Array.isArray(result.warnings)) throw sourceContractError('warnings must be a dense array.');
    result.warnings = result.warnings.map(canonicalizeWarning);

    if (granularity === 'run') {
        if (!Array.isArray(result.runs)) throw sourceContractError('runs must be a dense array.');
        const seenRunIds = new Set();
        result.runs.forEach((run, index) => validateRun(run, index, seenRunIds));
        if (result.runs.length !== result.source.selectedRunCount) {
            throw sourceContractError('runs length must equal source.selectedRunCount.');
        }
    } else {
        if (!Array.isArray(result.groups)) throw sourceContractError('groups must be a dense array.');
        const seenKeys = new Set();
        let groupedRunCount = 0;
        result.groups.forEach((group, index) => {
            groupedRunCount = sourceAdd(groupedRunCount, validateGroup(group, index, seenKeys, granularity), 'group runCount total');
        });
        if (groupedRunCount !== result.source.selectedRunCount) {
            throw sourceContractError('sum of group.runCount must equal source.selectedRunCount.');
        }
    }
    return result;
}

function runPoint(run) {
    return {
        key: run.runId,
        label: run.runId,
        start: run.timestamp,
        endExclusive: null,
        runCount: 1,
        totalElapsedDurationMs: run.elapsedDurationMs,
        averageRunElapsedDurationMs: run.elapsedDurationMs,
        previousChangeMs: null,
        previousChangePercent: null,
        spike: false
    };
}

function groupPoint(group) {
    return {
        key: group.key,
        label: group.key,
        start: group.start,
        endExclusive: group.endExclusive,
        runCount: group.runCount,
        totalElapsedDurationMs: group.durations.totalElapsedDurationMs,
        averageRunElapsedDurationMs: group.durations.averageRunElapsedDurationMs,
        previousChangeMs: null,
        previousChangePercent: null,
        spike: false
    };
}

function chronologicalPoints(result, granularity) {
    const points = granularity === 'run' ? result.runs.map(runPoint) : result.groups.map(groupPoint);
    return points.sort((left, right) => {
        const difference = Date.parse(left.start) - Date.parse(right.start);
        return difference || compareCodePoints(left.key, right.key);
    });
}

function comparison(baseline, current, context) {
    if (!baseline || !current || baseline === current) {
        return { changeMs: null, changePercent: null, exactChangePercent: null };
    }
    const changeMs = roundMetric(
        current.averageRunElapsedDurationMs - baseline.averageRunElapsedDurationMs,
        `${context} duration change`
    );
    const exactChangePercent = baseline.averageRunElapsedDurationMs === 0
        ? null
        : (changeMs / baseline.averageRunElapsedDurationMs) * 100;
    const changePercent = exactChangePercent === null
        ? null
        : roundMetric(exactChangePercent, `${context} duration percentage change`);
    return { changeMs, changePercent, exactChangePercent };
}

function appendUndefinedWarning(warnings, seen, baseline, current, comparisonName) {
    if (!baseline || !current || baseline === current || baseline.averageRunElapsedDurationMs !== 0) return;
    const signature = `${baseline.key}\0${current.key}`;
    if (seen.has(signature)) return;
    seen.add(signature);
    warnings.push(trendWarning(
        WARNING_CODES.UNDEFINED_PERCENT_CHANGE,
        'Duration percentage change is undefined because the comparison baseline is zero.',
        {
            field: 'averageRunElapsedDurationMs',
            details: { comparison: comparisonName, baselineKey: baseline.key, currentKey: current.key }
        }
    ));
}

function addPreviousComparisons(points, threshold, warnings, undefinedWarnings) {
    return points.map((point, index) => {
        if (index === 0) return point;
        const previous = points[index - 1];
        const change = comparison(previous, point, 'previous-point');
        appendUndefinedWarning(warnings, undefinedWarnings, previous, point, 'previous-point');
        return {
            ...point,
            previousChangeMs: change.changeMs,
            previousChangePercent: change.changePercent,
            spike: change.changeMs > 0
                && change.exactChangePercent !== null
                && change.exactChangePercent >= threshold
        };
    });
}

function summarize(points, source, threshold, warnings, undefinedWarnings) {
    const first = points[0] || null;
    const latest = points[points.length - 1] || null;
    const previous = points.length >= 2 ? points[points.length - 2] : null;
    const firstChange = comparison(first, latest, 'first-to-latest');
    const previousChange = comparison(previous, latest, 'previous-to-latest');
    appendUndefinedWarning(warnings, undefinedWarnings, first, latest, 'first-to-latest');
    appendUndefinedWarning(warnings, undefinedWarnings, previous, latest, 'previous-to-latest');

    let totalElapsedDurationMs = 0;
    let runCount = 0;
    points.forEach(point => {
        totalElapsedDurationMs = safeAddNonNegativeInteger(
            totalElapsedDurationMs,
            point.totalElapsedDurationMs,
            'summary total elapsed duration'
        );
        runCount = safeAddNonNegativeInteger(runCount, point.runCount, 'summary run count');
    });
    const averageRunElapsedDurationMs = runCount === 0
        ? null
        : roundMetric(totalElapsedDurationMs / runCount, 'summary average run elapsed duration');
    let minimumPointDurationMs = null;
    let maximumPointDurationMs = null;
    points.forEach(point => {
        const duration = point.averageRunElapsedDurationMs;
        minimumPointDurationMs = minimumPointDurationMs === null ? duration : Math.min(minimumPointDurationMs, duration);
        maximumPointDurationMs = maximumPointDurationMs === null ? duration : Math.max(maximumPointDurationMs, duration);
    });
    const spikeKeys = points.filter(point => point.spike).map(point => point.key);

    return {
        firstKey: first ? first.key : null,
        firstDurationMs: first ? first.averageRunElapsedDurationMs : null,
        previousKey: previous ? previous.key : null,
        previousDurationMs: previous ? previous.averageRunElapsedDurationMs : null,
        latestKey: latest ? latest.key : null,
        latestDurationMs: latest ? latest.averageRunElapsedDurationMs : null,
        changeFromFirstMs: firstChange.changeMs,
        changeFromFirstPercent: firstChange.changePercent,
        changeFromPreviousMs: previousChange.changeMs,
        changeFromPreviousPercent: previousChange.changePercent,
        averageRunElapsedDurationMs,
        minimumPointDurationMs,
        maximumPointDurationMs,
        spikeCount: spikeKeys.length,
        spikeKeys,
        spikeAlgorithm: SPIKE_ALGORITHM,
        spikeThresholdPercent: threshold,
        partial: source.excludedRunCount > 0
            || source.aggregationExcludedRunCount > 0
            || warnings.some(item => item.code === 'HEYNA_HISTORICAL_PARTIAL_AGGREGATION'),
        limited: source.selectedRunCount < source.matchedRunCount
    };
}

class DurationTrendAnalyzer {
    constructor(options = {}) {
        if (!isPlainObject(options)) throw dependencyError('DurationTrendAnalyzer options must be a plain object.');
        this.historicalMetricsAggregator = validateDependency(options.historicalMetricsAggregator);
    }

    async analyze(options = {}) {
        const normalized = normalizeDurationTrendOptions(options);
        const upstream = normalized.granularity === 'run'
            ? await this.historicalMetricsAggregator.queryRuns(normalized.aggregatorOptions)
            : await this.historicalMetricsAggregator.groupBy(normalized.granularity, normalized.aggregatorOptions);
        const aggregateResult = validateAggregatorResult(upstream, normalized.granularity, normalized.aggregatorOptions);
        const warnings = aggregateResult.warnings;
        const undefinedWarnings = new Set();
        const ordered = chronologicalPoints(aggregateResult, normalized.granularity);
        const series = addPreviousComparisons(
            ordered,
            normalized.spikeThresholdPercent,
            warnings,
            undefinedWarnings
        );

        if (series.length < 2) {
            warnings.push(trendWarning(
                WARNING_CODES.INSUFFICIENT_DATA,
                'There are not enough duration points to compare execution performance.',
                { field: 'elapsedDurationMs', details: { pointCount: series.length, requiredPointCount: 2 } }
            ));
        }
        const zeroDurationPointCount = series.filter(point => point.averageRunElapsedDurationMs === 0).length;
        if (zeroDurationPointCount > 0) {
            warnings.push(trendWarning(
                WARNING_CODES.ZERO_DURATION_POINT,
                `${zeroDurationPointCount} duration trend point${zeroDurationPointCount === 1 ? '' : 's'} had zero elapsed duration.`,
                { field: 'averageRunElapsedDurationMs', details: { affectedPointCount: zeroDurationPointCount } }
            ));
        }

        const summary = summarize(
            series,
            aggregateResult.source,
            normalized.spikeThresholdPercent,
            warnings,
            undefinedWarnings
        );

        return finalizeResult({
            durationTrendSchemaVersion: DURATION_TREND_SCHEMA_VERSION,
            generatedAt: aggregateResult.generatedAt,
            metric: CANONICAL_METRIC,
            granularity: normalized.granularity,
            query: {
                ...aggregateResult.query,
                granularity: normalized.granularity,
                spikeThresholdPercent: normalized.spikeThresholdPercent
            },
            source: aggregateResult.source,
            pointCount: series.length,
            series,
            summary,
            warnings
        });
    }
}

DurationTrendAnalyzer.DURATION_TREND_SCHEMA_VERSION = DURATION_TREND_SCHEMA_VERSION;
DurationTrendAnalyzer.WARNING_CODES = WARNING_CODES;

module.exports = DurationTrendAnalyzer;
module.exports.DurationTrendAnalyzer = DurationTrendAnalyzer;
