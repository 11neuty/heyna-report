const TREND_SCHEMA_VERSION = '1.0.0';
const SUPPORTED_AGGREGATION_SCHEMA_VERSION = '1.0.0';
const CANONICAL_METRIC = 'weightedPassRate';
const GRANULARITIES = Object.freeze(['run', 'day', 'week', 'month']);
const AGGREGATOR_FILTER_FIELDS = Object.freeze([
    'from', 'to', 'runIds', 'project', 'feature', 'environment', 'browser', 'executedBy',
    'schemaVersion', 'includeMigrated', 'limit'
]);
const TREND_OPTION_FIELDS = Object.freeze([
    'granularity', 'metric', 'movingAverageWindow', 'stableThresholdPoints',
    'minimumPoints', 'includeAverageRunComparison'
]);
const SUPPORTED_OPTION_FIELDS = new Set([...AGGREGATOR_FILTER_FIELDS, ...TREND_OPTION_FIELDS, 'newestFirst']);
const NUMERIC_RANGE_ERROR_CODE = 'HEYNA_PASS_RATE_TREND_NUMERIC_RANGE';

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
    return codedError(TypeError, 'HEYNA_PASS_RATE_TREND_INVALID_OPTION', message);
}

function dependencyError(message) {
    return codedError(TypeError, 'HEYNA_PASS_RATE_TREND_DEPENDENCY', message);
}

function sourceContractError(message) {
    return codedError(TypeError, 'HEYNA_PASS_RATE_TREND_SOURCE_CONTRACT', `HistoricalMetricsAggregator result contract violation: ${message}`);
}

function numericRangeError(context) {
    return codedError(RangeError, NUMERIC_RANGE_ERROR_CODE, `Pass-rate trend numeric range exceeded for ${context}.`);
}

function cloneFilterValue(value) {
    if (Array.isArray(value)) return value.slice();
    if (value instanceof Date) return new Date(value.getTime());
    return value;
}

function normalizeTrendOptions(options = {}) {
    if (!isPlainObject(options)) throw optionError('Pass-rate trend options must be an object.');
    const unknown = Object.keys(options).filter(key => !SUPPORTED_OPTION_FIELDS.has(key)).sort();
    if (unknown.length) throw optionError(`Unsupported pass-rate trend option: ${unknown[0]}`);
    if (Object.prototype.hasOwnProperty.call(options, 'newestFirst')) {
        throw optionError('newestFirst is not supported by pass-rate trends; output is always chronological.');
    }

    const granularity = options.granularity === undefined ? 'day' : options.granularity;
    if (typeof granularity !== 'string' || !GRANULARITIES.includes(granularity)) {
        throw optionError(`Unsupported pass-rate trend granularity: ${granularity}`);
    }
    const metric = options.metric === undefined ? CANONICAL_METRIC : options.metric;
    if (metric !== CANONICAL_METRIC) throw optionError(`Unsupported pass-rate trend metric: ${metric}`);

    const movingAverageWindow = options.movingAverageWindow === undefined ? null : options.movingAverageWindow;
    if (movingAverageWindow !== null && (!Number.isSafeInteger(movingAverageWindow) || movingAverageWindow < 2)) {
        throw optionError('movingAverageWindow must be null or a safe integer of at least 2.');
    }

    const thresholdValue = options.stableThresholdPoints === undefined ? 0.5 : options.stableThresholdPoints;
    if (typeof thresholdValue !== 'number' || !Number.isFinite(thresholdValue) || thresholdValue < 0 || thresholdValue > 100) {
        throw optionError('stableThresholdPoints must be a finite number from 0 through 100.');
    }
    const stableThresholdPoints = Object.is(thresholdValue, -0) ? 0 : thresholdValue;

    const minimumPoints = options.minimumPoints === undefined ? 2 : options.minimumPoints;
    if (!Number.isSafeInteger(minimumPoints) || minimumPoints < 2) {
        throw optionError('minimumPoints must be a safe integer of at least 2.');
    }

    const includeAverageRunComparison = options.includeAverageRunComparison === undefined
        ? false
        : options.includeAverageRunComparison;
    if (typeof includeAverageRunComparison !== 'boolean') {
        throw optionError('includeAverageRunComparison must be a boolean.');
    }

    const aggregatorOptions = {};
    AGGREGATOR_FILTER_FIELDS.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(options, field)) aggregatorOptions[field] = cloneFilterValue(options[field]);
    });
    aggregatorOptions.newestFirst = true;
    return {
        aggregatorOptions,
        trendOptions: {
            granularity,
            metric,
            movingAverageWindow,
            stableThresholdPoints,
            minimumPoints,
            includeAverageRunComparison
        }
    };
}

function roundRate(value, context) {
    if (!Number.isFinite(value)) throw numericRangeError(context);
    const rounded = Number(value.toFixed(2));
    if (!Number.isFinite(rounded)) throw numericRangeError(context);
    return Object.is(rounded, -0) ? 0 : rounded;
}

function requireSafeCount(value, context) {
    if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) throw numericRangeError(context);
    return value;
}

function safeAddCount(left, right, context) {
    requireSafeCount(left, context);
    requireSafeCount(right, context);
    const result = left + right;
    if (!Number.isSafeInteger(result) || result < 0) throw numericRangeError(context);
    return result;
}

function safeSubtractCount(left, right, context) {
    requireSafeCount(left, context);
    requireSafeCount(right, context);
    const result = left - right;
    if (!Number.isSafeInteger(result) || result < 0) throw numericRangeError(context);
    return result;
}

function jsonPath(parent, key) {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

function cloneJsonValueInternal(value, context, active) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || Object.is(value, -0)) {
            throw sourceContractError(`${context} must contain only finite JSON numbers without negative zero.`);
        }
        return value;
    }
    if (typeof value !== 'object') {
        throw sourceContractError(`${context} contains an unsupported ${typeof value} value.`);
    }
    if (active.has(value)) throw sourceContractError(`${context} contains a cyclic reference.`);

    active.add(value);
    try {
        if (Array.isArray(value)) {
            const ownKeys = Reflect.ownKeys(value);
            ownKeys.forEach(key => {
                if (typeof key === 'symbol') throw sourceContractError(`${context} contains a symbol property.`);
                if (key === 'length') return;
                if (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
                    throw sourceContractError(`${context} contains a non-index array property.`);
                }
            });

            const result = new Array(value.length);
            for (let index = 0; index < value.length; index += 1) {
                const key = String(index);
                const descriptor = Object.getOwnPropertyDescriptor(value, key);
                if (!descriptor) throw sourceContractError(`${context} must be a dense array.`);
                if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
                    throw sourceContractError(`${context}[${index}] must not be an accessor property.`);
                }
                result[index] = cloneJsonValueInternal(descriptor.value, `${context}[${index}]`, active);
            }
            return result;
        }

        if (!isPlainObject(value)) throw sourceContractError(`${context} must be a plain JSON object.`);
        const result = {};
        Reflect.ownKeys(value).forEach(key => {
            if (typeof key === 'symbol') throw sourceContractError(`${context} contains a symbol property.`);
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
                throw sourceContractError(`${jsonPath(context, key)} must be an enumerable data property.`);
            }
            Object.defineProperty(result, key, {
                value: cloneJsonValueInternal(descriptor.value, jsonPath(context, key), active),
                enumerable: true,
                configurable: true,
                writable: true
            });
        });
        return result;
    } finally {
        active.delete(value);
    }
}

function cloneJsonValue(value, context = 'value') {
    try {
        return cloneJsonValueInternal(value, context, new WeakSet());
    } catch (error) {
        if (error && error.code === 'HEYNA_PASS_RATE_TREND_SOURCE_CONTRACT') throw error;
        throw sourceContractError(`${context} could not be inspected as strict JSON data.`);
    }
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
}

function assertJsonSafeNumbers(value) {
    const pending = [{ value, path: 'result' }];
    const visited = new WeakSet();
    while (pending.length) {
        const current = pending.pop();
        if (typeof current.value === 'number') {
            if (!Number.isFinite(current.value) || Object.is(current.value, -0)
                || (Number.isInteger(current.value) && !Number.isSafeInteger(current.value))) {
                throw numericRangeError(current.path);
            }
            continue;
        }
        if (!current.value || typeof current.value !== 'object' || visited.has(current.value)) continue;
        visited.add(current.value);
        Object.entries(current.value).forEach(([key, item]) => pending.push({ value: item, path: `${current.path}.${key}` }));
    }
    return value;
}

function finalizeResult(result) {
    assertJsonSafeNumbers(result);
    JSON.stringify(result);
    return deepFreeze(result);
}

function trendWarning(code, message, options = {}) {
    return {
        code,
        severity: 'warning',
        message,
        runId: null,
        field: options.field || null,
        details: options.details ? { ...options.details } : {}
    };
}

module.exports = {
    AGGREGATOR_FILTER_FIELDS,
    CANONICAL_METRIC,
    GRANULARITIES,
    NUMERIC_RANGE_ERROR_CODE,
    SUPPORTED_AGGREGATION_SCHEMA_VERSION,
    TREND_SCHEMA_VERSION,
    assertJsonSafeNumbers,
    cloneJsonValue,
    dependencyError,
    finalizeResult,
    normalizeTrendOptions,
    numericRangeError,
    requireSafeCount,
    roundRate,
    safeAddCount,
    safeSubtractCount,
    sourceContractError,
    trendWarning
};
