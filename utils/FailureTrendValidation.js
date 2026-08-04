const { HASH_PATTERN } = require('./FailureIdentity');

const FAILURE_TREND_SCHEMA_VERSION = '1.0.0';
const FAILURE_HISTORY_SCHEMA_VERSION = '1.0.0';
const ERROR_CODES = Object.freeze({
    INVALID_OPTION: 'HEYNA_FAILURE_TREND_INVALID_OPTION',
    DEPENDENCY: 'HEYNA_FAILURE_TREND_DEPENDENCY',
    SOURCE_CONTRACT: 'HEYNA_FAILURE_TREND_SOURCE_CONTRACT',
    NUMERIC_RANGE: 'HEYNA_FAILURE_TREND_NUMERIC_RANGE'
});
const OPTION_FIELDS = Object.freeze([
    'from', 'to', 'limit', 'project', 'testKey', 'category', 'includeMigrated',
    'minimumOccurrences', 'minimumAffectedRuns', 'includeResolved'
]);
const FAILURE_CATEGORIES = new Set([
    'ASSERTION_FAILURE', 'LOCATOR_FAILURE', 'TIMEOUT_FAILURE', 'NETWORK_FAILURE',
    'API_FAILURE', 'CONFIGURATION_FAILURE', 'UNKNOWN_FAILURE'
]);
const WARNING_CATALOG = Object.freeze({
    HEYNA_HISTORICAL_MISSING_SUMMARY: { message: 'Completed history run is missing summary.json.', runId: 'nullable', fields: [null], details: ['file'] },
    HEYNA_HISTORICAL_CORRUPT_SUMMARY: { message: 'Completed history run contains corrupt summary.json.', runId: 'nullable', fields: [null], details: ['file'] },
    HEYNA_HISTORICAL_UNSUPPORTED_SCHEMA: { message: 'Completed history run uses an unsupported summary schema.', runId: 'nullable', fields: [null, 'schemaVersion'], details: ['file'] },
    HEYNA_HISTORICAL_INVALID_SUMMARY: { message: 'Completed history run contains an invalid summary.', runId: 'nullable', fields: [null, 'runId'], details: ['file'] },
    HEYNA_HISTORICAL_UNREADABLE_RUN: { message: 'Completed history run summary.json could not be read.', runId: 'nullable', fields: [null], details: ['file'] },
    HEYNA_FAILURE_HISTORY_MISSING_INDEX: { message: 'Historical run has no usable immutable failure index.', runId: 'required', fields: ['failureIndex'], details: [] },
    HEYNA_FAILURE_HISTORY_UNSUPPORTED_INDEX_SCHEMA: { message: 'Historical run uses an unsupported failure index schema.', runId: 'required', fields: ['failureIndex'], details: [] },
    HEYNA_FAILURE_HISTORY_INVALID_INDEX: { message: 'Historical run contains an invalid failure index.', runId: 'required', fields: ['failureIndex'], details: [] },
    HEYNA_FAILURE_HISTORY_UNREADABLE_INDEX: { message: 'Historical run failure index could not be read.', runId: 'required', fields: ['failureIndex'], details: [] },
    HEYNA_FAILURE_HISTORY_LEGACY_EXECUTION_NORMALIZED: { message: 'Historical execution was normalized in memory for degraded failure analysis.', runId: 'required', fields: [null], details: [] },
    HEYNA_FAILURE_HISTORY_LEGACY_DUPLICATE_COLLAPSED: { message: 'Equivalent legacy retry records were collapsed to one finalized outcome.', runId: 'required', fields: [null], details: [] },
    HEYNA_FAILURE_HISTORY_LEGACY_DUPLICATE_CONFLICT: { message: 'Conflicting legacy outcome records prevent detailed failure analysis for this run.', runId: 'required', fields: [null], details: [] },
    HEYNA_FAILURE_HISTORY_DEGRADED_IDENTITY: { message: 'Historical failure identity is degraded because strong test metadata was unavailable.', runId: 'required', fields: [null], details: [] },
    HEYNA_FAILURE_HISTORY_AGGREGATE_ONLY_RUN: { message: 'Historical run has aggregate counts but no usable failure details.', runId: 'required', fields: [null], details: [] },
    HEYNA_FAILURE_HISTORY_ZERO_TEST_RUN: { message: 'Historical run contains zero tests and is excluded from failure-rate denominators.', runId: 'required', fields: [null], details: [] },
    HEYNA_FAILURE_HISTORY_EMPTY: { message: 'No completed historical runs were discovered.', runId: 'null', fields: [null], details: [] },
    HEYNA_FAILURE_HISTORY_NO_MATCHING_RUNS: { message: 'No historical failure observations matched the query.', runId: 'null', fields: [null], details: [] },
    HEYNA_FAILURE_HISTORY_LIMIT_APPLIED: { message: 'The historical failure query limit was applied after filtering.', runId: 'null', fields: ['limit'], details: ['limit', 'matchedRunCount', 'selectedRunCount'], requiredDetails: ['limit', 'matchedRunCount', 'selectedRunCount'] },
    HEYNA_FAILURE_HISTORY_RETENTION_WINDOW: { message: 'Failure analysis is limited to the currently retained history window.', runId: 'null', fields: [null], details: [] },
    HEYNA_FAILURE_HISTORY_PARTIAL_ANALYSIS: { message: 'Failure analysis is partial because one or more historical runs have unknown failure detail.', runId: 'null', fields: [null], details: [] }
});
Object.values(WARNING_CATALOG).forEach(definition => {
    Object.freeze(definition.fields);
    Object.freeze(definition.details);
    if (definition.requiredDetails) Object.freeze(definition.requiredDetails);
    Object.freeze(definition);
});
const WARNING_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function codedError(ErrorType, code, message) {
    const error = new ErrorType(message);
    error.code = code;
    return error;
}

function optionError(message) {
    return codedError(TypeError, ERROR_CODES.INVALID_OPTION, message);
}

function dependencyError(message) {
    return codedError(TypeError, ERROR_CODES.DEPENDENCY, message);
}

function sourceContractError(message) {
    return codedError(TypeError, ERROR_CODES.SOURCE_CONTRACT, message);
}

function numericRangeError(context) {
    return codedError(RangeError, ERROR_CODES.NUMERIC_RANGE, `Failure trend numeric range exceeded for ${context}.`);
}

function parseDate(value, label, errorFactory = optionError) {
    let date;
    if (value instanceof Date) date = new Date(value.getTime());
    else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) date = new Date(value);
    else throw errorFactory(`${label} must be a Date or full ISO-8601 timestamp.`);
    if (!Number.isFinite(date.getTime())) throw errorFactory(`${label} must be a valid date.`);
    return { epoch: date.getTime(), iso: date.toISOString() };
}

function stringFilter(value, label, options = {}) {
    if (value === null || value === undefined) return null;
    const values = Array.isArray(value) ? value.slice() : [value];
    if (!values.length) throw optionError(`${label} must not be an empty array.`);
    values.forEach(item => {
        if (typeof item !== 'string' || !item || item.length > (options.maximum || 512) || /[\u0000-\u001f\u007f]/.test(item)) {
            throw optionError(`${label} must contain bounded non-empty strings.`);
        }
        if (options.pattern && !options.pattern.test(item)) throw optionError(`${label} contains an invalid value.`);
        if (options.allowed && !options.allowed.has(item)) throw optionError(`${label} contains an unsupported value.`);
    });
    if (new Set(values).size !== values.length) throw optionError(`${label} values must be unique.`);
    return values.sort(compareCodePoints);
}

function normalizeAnalyzerOptions(options = {}) {
    if (!isPlainObject(options)) throw optionError('FailureTrendAnalyzer options must be a plain object.');
    const unsupported = Object.keys(options).filter(key => !OPTION_FIELDS.includes(key)).sort(compareCodePoints);
    if (unsupported.length) throw optionError(`Unsupported failure trend option: ${unsupported[0]}`);
    const from = options.from == null ? null : parseDate(options.from, 'from');
    const to = options.to == null ? null : parseDate(options.to, 'to');
    if (from && to && from.epoch > to.epoch) throw optionError('from must not be later than to.');
    const limit = options.limit == null ? null : options.limit;
    if (limit !== null && (!Number.isSafeInteger(limit) || limit < 0)) throw optionError('limit must be a safe non-negative integer or null.');
    const minimumOccurrences = options.minimumOccurrences == null ? 2 : options.minimumOccurrences;
    const minimumAffectedRuns = options.minimumAffectedRuns == null ? 2 : options.minimumAffectedRuns;
    if (!Number.isSafeInteger(minimumOccurrences) || minimumOccurrences < 1) throw optionError('minimumOccurrences must be a safe integer of at least 1.');
    if (!Number.isSafeInteger(minimumAffectedRuns) || minimumAffectedRuns < 1) throw optionError('minimumAffectedRuns must be a safe integer of at least 1.');
    for (const field of ['includeMigrated', 'includeResolved']) {
        if (options[field] !== undefined && typeof options[field] !== 'boolean') throw optionError(`${field} must be boolean.`);
    }
    return {
        from: from ? from.iso : null,
        to: to ? to.iso : null,
        limit,
        project: stringFilter(options.project, 'project', { maximum: 256 }),
        testKey: stringFilter(options.testKey, 'testKey', { pattern: HASH_PATTERN, maximum: 71 }),
        category: stringFilter(options.category, 'category', { allowed: FAILURE_CATEGORIES, maximum: 128 }),
        includeMigrated: options.includeMigrated !== false,
        minimumOccurrences,
        minimumAffectedRuns,
        includeResolved: options.includeResolved !== false
    };
}

function compareCodePoints(left, right) {
    if (left === right) return 0;
    return left < right ? -1 : 1;
}

function safeAdd(left, right, context) {
    if (!Number.isSafeInteger(left) || left < 0 || Object.is(left, -0)
        || !Number.isSafeInteger(right) || right < 0 || Object.is(right, -0)) {
        throw numericRangeError(context);
    }
    const result = left + right;
    if (!Number.isSafeInteger(result) || result < 0 || Object.is(result, -0)) throw numericRangeError(context);
    return result;
}

function roundPercent(numerator, denominator, context) {
    if (denominator === 0) return null;
    if (!Number.isSafeInteger(numerator) || numerator < 0 || !Number.isSafeInteger(denominator) || denominator < 0) {
        throw numericRangeError(context);
    }
    const result = Number(((numerator / denominator) * 100).toFixed(2));
    if (!Number.isFinite(result)) throw numericRangeError(context);
    return Object.is(result, -0) ? 0 : result;
}

function jsonPath(parent, key) {
    return typeof key === 'number' ? `${parent}[${key}]` : `${parent}.${key}`;
}

function cloneJsonValueInternal(value, context, active) {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || Object.is(value, -0) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
            throw sourceContractError(`${context} contains an unsupported number.`);
        }
        return value;
    }
    if (['undefined', 'function', 'bigint', 'symbol'].includes(typeof value)) {
        throw sourceContractError(`${context} contains a non-JSON value.`);
    }
    if (!value || typeof value !== 'object') throw sourceContractError(`${context} contains an unsupported value.`);
    if (active.has(value)) throw sourceContractError(`${context} contains a cycle.`);
    active.add(value);
    try {
        const array = Array.isArray(value);
        const prototype = Object.getPrototypeOf(value);
        const keys = Reflect.ownKeys(value);
        if (array) {
            if (prototype !== Array.prototype) throw sourceContractError(`${context} must contain only ordinary arrays.`);
            const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
            if (!lengthDescriptor || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')
                || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
                throw sourceContractError(`${context} has an invalid array length.`);
            }
            const length = lengthDescriptor.value;
            if (keys.length !== length + 1 || keys[length] !== 'length') {
                throw sourceContractError(`${context} contains unsupported array properties.`);
            }
            const clone = [];
            for (let index = 0; index < length; index += 1) {
                const key = String(index);
                if (keys[index] !== key) throw sourceContractError(`${jsonPath(context, index)} must be a dense data property.`);
                const descriptor = Object.getOwnPropertyDescriptor(value, key);
                if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
                    throw sourceContractError(`${jsonPath(context, index)} must be a dense data property.`);
                }
                clone.push(cloneJsonValueInternal(descriptor.value, jsonPath(context, index), active));
            }
            return clone;
        }
        if (prototype !== Object.prototype && prototype !== null) throw sourceContractError(`${context} must contain only plain objects.`);
        const clone = prototype === null ? Object.create(null) : {};
        for (const key of keys) {
            if (typeof key !== 'string') throw sourceContractError(`${context} contains a symbol key.`);
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
                throw sourceContractError(`${jsonPath(context, key)} must be an enumerable data property.`);
            }
            Object.defineProperty(clone, key, {
                value: cloneJsonValueInternal(descriptor.value, jsonPath(context, key), active),
                enumerable: true,
                configurable: true,
                writable: true
            });
        }
        return clone;
    } catch (error) {
        if (error && error.code === ERROR_CODES.SOURCE_CONTRACT) throw error;
        throw sourceContractError(`${context} could not be inspected as passive JSON data.`);
    } finally {
        active.delete(value);
    }
}

function cloneJsonValue(value, context = 'value') {
    return cloneJsonValueInternal(value, context, new WeakSet());
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
}

function finalizeResult(value) {
    const clone = cloneJsonValue(value, 'result');
    JSON.stringify(clone);
    return deepFreeze(clone);
}

function validateWarningDetails(details, allowed, required, context) {
    if (!isPlainObject(details)) throw sourceContractError(`${context}.details is invalid.`);
    const keys = Reflect.ownKeys(details);
    if (keys.some(key => typeof key !== 'string' || !allowed.includes(key))) {
        throw sourceContractError(`${context}.details contains unsupported fields.`);
    }
    if (required.some(key => !keys.includes(key))) throw sourceContractError(`${context}.details is incomplete.`);
    for (const key of keys) {
        const value = details[key];
        if (key === 'file' && value !== 'summary.json') throw sourceContractError(`${context}.details.file is invalid.`);
        if (key !== 'file' && (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0))) {
            throw sourceContractError(`${context}.details.${key} is invalid.`);
        }
    }
}

function canonicalizeWarning(item, context = 'warning') {
    if (!isPlainObject(item)) throw sourceContractError(`${context} is invalid.`);
    const keys = Reflect.ownKeys(item);
    const expected = ['code', 'severity', 'message', 'runId', 'field', 'details'];
    if (keys.length !== expected.length || expected.some(key => !keys.includes(key))) {
        throw sourceContractError(`${context} contains unsupported fields.`);
    }
    const definition = typeof item.code === 'string' ? WARNING_CATALOG[item.code] : null;
    if (!definition) throw sourceContractError(`${context}.code is unsupported.`);
    if (item.severity !== 'warning') throw sourceContractError(`${context}.severity is invalid.`);
    if (typeof item.message !== 'string') throw sourceContractError(`${context}.message is invalid.`);
    if (definition.runId === 'required' && (typeof item.runId !== 'string' || !WARNING_RUN_ID.test(item.runId))) {
        throw sourceContractError(`${context}.runId is required.`);
    }
    if (definition.runId === 'null' && item.runId !== null) throw sourceContractError(`${context}.runId must be null.`);
    if (definition.runId === 'nullable' && item.runId !== null
        && (typeof item.runId !== 'string' || !WARNING_RUN_ID.test(item.runId))) {
        throw sourceContractError(`${context}.runId is invalid.`);
    }
    if (!definition.fields.includes(item.field)) throw sourceContractError(`${context}.field is invalid.`);
    validateWarningDetails(item.details, definition.details, definition.requiredDetails || [], context);
    return {
        code: item.code,
        severity: 'warning',
        message: definition.message,
        runId: item.runId,
        field: item.field,
        details: { ...item.details }
    };
}

function warning(code, options = {}) {
    const definition = WARNING_CATALOG[code];
    if (!definition) throw sourceContractError('warning code is unsupported.');
    const candidate = {
        code,
        severity: 'warning',
        message: definition.message,
        runId: options.runId === undefined ? null : options.runId,
        field: options.field === undefined ? null : options.field,
        details: options.details ? { ...options.details } : {}
    };
    return canonicalizeWarning(candidate);
}

module.exports = {
    ERROR_CODES,
    FAILURE_HISTORY_SCHEMA_VERSION,
    FAILURE_TREND_SCHEMA_VERSION,
    WARNING_CATALOG,
    canonicalizeWarning,
    cloneJsonValue,
    compareCodePoints,
    deepFreeze,
    dependencyError,
    finalizeResult,
    isPlainObject,
    normalizeAnalyzerOptions,
    numericRangeError,
    parseDate,
    roundPercent,
    safeAdd,
    sourceContractError,
    warning
};
