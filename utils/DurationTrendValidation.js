const DURATION_TREND_SCHEMA_VERSION = '1.0.0';
const SUPPORTED_AGGREGATION_SCHEMA_VERSION = '1.0.0';
const CANONICAL_METRIC = 'elapsedDurationMs';
const SPIKE_ALGORITHM = 'previous-point-percent-increase';
const GRANULARITIES = Object.freeze(['run', 'day', 'week', 'month']);
const AGGREGATOR_FILTER_FIELDS = Object.freeze([
    'from', 'to', 'runIds', 'project', 'feature', 'environment', 'browser', 'executedBy',
    'schemaVersion', 'includeMigrated', 'limit'
]);
const OPTION_FIELDS = new Set([...AGGREGATOR_FILTER_FIELDS, 'granularity', 'spikeThresholdPercent']);
const NUMERIC_RANGE_ERROR_CODE = 'HEYNA_DURATION_TREND_NUMERIC_RANGE';

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
    return codedError(TypeError, 'HEYNA_DURATION_TREND_INVALID_OPTION', message);
}

function dependencyError(message) {
    return codedError(TypeError, 'HEYNA_DURATION_TREND_DEPENDENCY', message);
}

function sourceContractError(message) {
    return codedError(
        TypeError,
        'HEYNA_DURATION_TREND_SOURCE_CONTRACT',
        `HistoricalMetricsAggregator result contract violation: ${message}`
    );
}

function numericRangeError(context) {
    return codedError(RangeError, NUMERIC_RANGE_ERROR_CODE, `Duration trend numeric range exceeded for ${context}.`);
}

function cloneFilterValue(value) {
    if (Array.isArray(value)) return value.slice();
    if (value instanceof Date) return new Date(value.getTime());
    return value;
}

function normalizeDurationTrendOptions(options = {}) {
    if (!isPlainObject(options)) throw optionError('Duration trend options must be a plain object.');
    const unsupported = Object.keys(options).filter(key => !OPTION_FIELDS.has(key)).sort();
    if (unsupported.length) throw optionError(`Unsupported duration trend option: ${unsupported[0]}`);

    const granularity = options.granularity === undefined ? 'run' : options.granularity;
    if (typeof granularity !== 'string' || !GRANULARITIES.includes(granularity)) {
        throw optionError(`Unsupported duration trend granularity: ${granularity}`);
    }

    const suppliedThreshold = options.spikeThresholdPercent === undefined ? 50 : options.spikeThresholdPercent;
    if (typeof suppliedThreshold !== 'number' || !Number.isFinite(suppliedThreshold)
        || suppliedThreshold < 0 || suppliedThreshold > Number.MAX_SAFE_INTEGER) {
        throw optionError('spikeThresholdPercent must be a finite non-negative number within the safe numeric range.');
    }
    const spikeThresholdPercent = Object.is(suppliedThreshold, -0) ? 0 : suppliedThreshold;

    const aggregatorOptions = {};
    AGGREGATOR_FILTER_FIELDS.forEach(field => {
        if (Object.prototype.hasOwnProperty.call(options, field)) aggregatorOptions[field] = cloneFilterValue(options[field]);
    });
    aggregatorOptions.newestFirst = true;

    return { aggregatorOptions, granularity, spikeThresholdPercent };
}

function requireSafeNonNegativeInteger(value, context, errorFactory = numericRangeError) {
    if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) throw errorFactory(context);
    return value;
}

function safeAddNonNegativeInteger(left, right, context) {
    requireSafeNonNegativeInteger(left, context);
    requireSafeNonNegativeInteger(right, context);
    const result = left + right;
    if (!Number.isSafeInteger(result) || result < 0 || Object.is(result, -0)) throw numericRangeError(context);
    return result;
}

function requireFiniteNonNegativeNumber(value, context, errorFactory = numericRangeError) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0
        || value > Number.MAX_SAFE_INTEGER || Object.is(value, -0)) {
        throw errorFactory(context);
    }
    return value;
}

function roundMetric(value, context) {
    if (typeof value !== 'number' || !Number.isFinite(value)
        || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw numericRangeError(context);
    const rounded = Number(value.toFixed(2));
    if (!Number.isFinite(rounded) || Math.abs(rounded) > Number.MAX_SAFE_INTEGER) throw numericRangeError(context);
    return Object.is(rounded, -0) ? 0 : rounded;
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
    if (typeof value !== 'object') throw sourceContractError(`${context} contains an unsupported ${typeof value} value.`);
    if (active.has(value)) throw sourceContractError(`${context} contains a cyclic reference.`);

    active.add(value);
    try {
        if (Array.isArray(value)) {
            Reflect.ownKeys(value).forEach(key => {
                if (typeof key === 'symbol') throw sourceContractError(`${context} contains a symbol property.`);
                if (key === 'length') return;
                if (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
                    throw sourceContractError(`${context} contains a non-index array property.`);
                }
            });
            const result = new Array(value.length);
            for (let index = 0; index < value.length; index += 1) {
                const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
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
        if (error && error.code === 'HEYNA_DURATION_TREND_SOURCE_CONTRACT') throw error;
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
    DURATION_TREND_SCHEMA_VERSION,
    GRANULARITIES,
    NUMERIC_RANGE_ERROR_CODE,
    SPIKE_ALGORITHM,
    SUPPORTED_AGGREGATION_SCHEMA_VERSION,
    assertJsonSafeNumbers,
    cloneJsonValue,
    dependencyError,
    finalizeResult,
    isPlainObject,
    normalizeDurationTrendOptions,
    numericRangeError,
    requireFiniteNonNegativeNumber,
    requireSafeNonNegativeInteger,
    roundMetric,
    safeAddNonNegativeInteger,
    sourceContractError,
    trendWarning
};
