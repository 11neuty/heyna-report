const AGGREGATION_SCHEMA_VERSION = '1.0.0';
const SUPPORTED_HISTORY_SCHEMA_VERSIONS = Object.freeze(['1.0.0']);
const ISO_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;
const RUN_ID_PATTERN = /^\d{8}-\d{6}-\d{3}-[a-f0-9]{8}$/;
const MAX_SAFE_NUMERIC_VALUE = Number.MAX_SAFE_INTEGER;
const DURATION_DECIMAL_PLACES = 3;
const DURATION_SCALE = 10 ** DURATION_DECIMAL_PLACES;
const DURATION_SCALE_BIGINT = BigInt(DURATION_SCALE);
const MAX_DURATION_UNITS = BigInt(MAX_SAFE_NUMERIC_VALUE) * DURATION_SCALE_BIGINT;
const CANONICAL_NUMBER_PATTERN = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/;
const NUMERIC_RANGE_ERROR_CODE = 'HEYNA_HISTORICAL_NUMERIC_RANGE';
const QUERY_FIELDS = Object.freeze([
    'from',
    'to',
    'runIds',
    'project',
    'feature',
    'environment',
    'browser',
    'executedBy',
    'schemaVersion',
    'includeMigrated',
    'newestFirst',
    'limit'
]);
const METADATA_FIELDS = Object.freeze(['project', 'feature', 'environment', 'browser', 'executedBy']);
const GROUP_DIMENSIONS = Object.freeze([
    'day',
    'week',
    'month',
    'project',
    'feature',
    'environment',
    'browser',
    'executedBy',
    'schemaVersion',
    'migration'
]);
const TIME_DIMENSIONS = Object.freeze(['day', 'week', 'month']);
const WARNING_CODES = Object.freeze({
    CORRUPT_SUMMARY: 'HEYNA_HISTORICAL_CORRUPT_SUMMARY',
    UNSUPPORTED_SCHEMA: 'HEYNA_HISTORICAL_UNSUPPORTED_SCHEMA',
    INVALID_SUMMARY: 'HEYNA_HISTORICAL_INVALID_SUMMARY',
    AGGREGATION_UNUSABLE_SUMMARY: 'HEYNA_HISTORICAL_AGGREGATION_UNUSABLE_SUMMARY',
    DURATION_NORMALIZED: 'HEYNA_HISTORICAL_DURATION_NORMALIZED',
    DERIVED_METRIC_MISMATCH: 'HEYNA_HISTORICAL_DERIVED_METRIC_MISMATCH',
    MISSING_METADATA: 'HEYNA_HISTORICAL_MISSING_METADATA',
    INVALID_METADATA: 'HEYNA_HISTORICAL_INVALID_METADATA',
    EXCLUDED_RUN: 'HEYNA_HISTORICAL_EXCLUDED_RUN',
    PARTIAL_AGGREGATION: 'HEYNA_HISTORICAL_PARTIAL_AGGREGATION',
    EMPTY_HISTORY: 'HEYNA_HISTORICAL_EMPTY_HISTORY',
    NO_MATCHING_RUNS: 'HEYNA_HISTORICAL_NO_MATCHING_RUNS',
    ZERO_TEST_RUN: 'HEYNA_HISTORICAL_ZERO_TEST_RUN',
    LIMIT_APPLIED: 'HEYNA_HISTORICAL_LIMIT_APPLIED'
});

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function daysInMonth(year, month) {
    if (month === 2) {
        const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
        return leap ? 29 : 28;
    }
    return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseIsoTimestamp(value, label) {
    const match = ISO_INPUT_PATTERN.exec(value);
    if (!match) throw new TypeError(`${label} must be a Date or full ISO-8601 timestamp.`);
    const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText, zone, sign, offsetHourText, offsetMinuteText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    const millisecond = Number((fractionText || '').padEnd(3, '0'));
    const offsetHour = zone === 'Z' ? 0 : Number(offsetHourText);
    const offsetMinute = zone === 'Z' ? 0 : Number(offsetMinuteText);
    if (month < 1 || month > 12
        || day < 1 || day > daysInMonth(year, month)
        || hour > 23 || minute > 59 || second > 59
        || offsetHour > 23 || offsetMinute > 59) {
        throw new TypeError(`${label} must be a valid date.`);
    }

    const local = new Date(0);
    local.setUTCFullYear(year, month - 1, day);
    local.setUTCHours(hour, minute, second, millisecond);
    const signedOffsetMinutes = zone === 'Z' ? 0 : (sign === '+' ? 1 : -1) * (offsetHour * 60 + offsetMinute);
    const timestamp = local.getTime() - signedOffsetMinutes * 60000;
    const roundTrip = new Date(timestamp + signedOffsetMinutes * 60000);
    if (!Number.isFinite(timestamp)
        || roundTrip.getUTCFullYear() !== year
        || roundTrip.getUTCMonth() !== month - 1
        || roundTrip.getUTCDate() !== day
        || roundTrip.getUTCHours() !== hour
        || roundTrip.getUTCMinutes() !== minute
        || roundTrip.getUTCSeconds() !== second
        || roundTrip.getUTCMilliseconds() !== millisecond) {
        throw new TypeError(`${label} must be a valid date.`);
    }
    return timestamp;
}

function parseDate(value, label) {
    let timestamp;
    if (value instanceof Date) timestamp = value.getTime();
    else if (typeof value === 'string') timestamp = parseIsoTimestamp(value, label);
    else throw new TypeError(`${label} must be a Date or full ISO-8601 timestamp.`);
    if (!Number.isFinite(timestamp)) throw new TypeError(`${label} must be a valid date.`);
    return { timestamp, iso: new Date(timestamp).toISOString() };
}

function uniqueStrings(value, label, options = {}) {
    const values = Array.isArray(value) ? value.slice() : [value];
    if (!values.length) throw new TypeError(`${label} must not be an empty array.`);
    values.forEach(item => {
        if (typeof item !== 'string' || item.trim() === '') {
            throw new TypeError(`${label} must contain non-empty strings.`);
        }
        if (options.pattern && !options.pattern.test(item)) {
            throw new TypeError(`${label} contains an invalid value: ${item}`);
        }
    });
    if (new Set(values).size !== values.length) throw new TypeError(`${label} must contain unique values.`);
    return values;
}

function normalizeQuery(options = {}) {
    if (!isPlainObject(options)) throw new TypeError('Historical metrics options must be an object.');
    const unsupported = Object.keys(options).filter(key => !QUERY_FIELDS.includes(key));
    if (unsupported.length) throw new TypeError(`Unsupported historical metrics option: ${unsupported.sort()[0]}`);

    const from = options.from == null ? null : parseDate(options.from, 'from');
    const to = options.to == null ? null : parseDate(options.to, 'to');
    if (from && to && from.timestamp > to.timestamp) throw new TypeError('from must not be later than to.');

    const runIds = options.runIds == null ? null : uniqueStrings(options.runIds, 'runIds', { pattern: RUN_ID_PATTERN });
    const metadata = {};
    METADATA_FIELDS.forEach(field => {
        metadata[field] = options[field] == null ? null : uniqueStrings(options[field], field);
    });

    const schemaVersion = options.schemaVersion == null
        ? SUPPORTED_HISTORY_SCHEMA_VERSIONS.slice()
        : uniqueStrings(options.schemaVersion, 'schemaVersion');
    schemaVersion.forEach(version => {
        if (!SUPPORTED_HISTORY_SCHEMA_VERSIONS.includes(version)) {
            throw new TypeError(`Unsupported historical schemaVersion requested: ${version}`);
        }
    });

    if (options.includeMigrated !== undefined && typeof options.includeMigrated !== 'boolean') {
        throw new TypeError('includeMigrated must be a boolean.');
    }
    if (options.newestFirst !== undefined && typeof options.newestFirst !== 'boolean') {
        throw new TypeError('newestFirst must be a boolean.');
    }
    const limit = options.limit == null ? null : options.limit;
    if (limit !== null && (!Number.isSafeInteger(limit) || limit < 0)) {
        throw new TypeError('limit must be a non-negative integer or null.');
    }

    return {
        from: from ? from.iso : null,
        to: to ? to.iso : null,
        runIds,
        ...metadata,
        schemaVersion,
        includeMigrated: options.includeMigrated !== false,
        newestFirst: options.newestFirst !== false,
        limit
    };
}

function validateDimension(dimension) {
    if (typeof dimension !== 'string' || !GROUP_DIMENSIONS.includes(dimension)) {
        throw new TypeError(`Unsupported historical metrics grouping dimension: ${dimension}`);
    }
    return dimension;
}

function roundMetric(value) {
    if (!Number.isFinite(value)) throw numericRangeError('rounded metric');
    const rounded = Number(value.toFixed(2));
    if (!Number.isFinite(rounded)) throw numericRangeError('rounded metric');
    return Object.is(rounded, -0) ? 0 : rounded;
}

function numericRangeError(context) {
    const error = new RangeError(`Historical aggregation numeric range exceeded for ${context}.`);
    error.code = NUMERIC_RANGE_ERROR_CODE;
    return error;
}

function safeAddInteger(left, right, context) {
    if (!Number.isSafeInteger(left) || left < 0 || Object.is(left, -0)
        || !Number.isSafeInteger(right) || right < 0 || Object.is(right, -0)) {
        throw numericRangeError(context);
    }
    const result = left + right;
    if (!Number.isSafeInteger(result) || result < 0 || Object.is(result, -0)) throw numericRangeError(context);
    return result;
}

function durationToUnits(value, context) {
    if (!Number.isFinite(value) || value < 0 || value > MAX_SAFE_NUMERIC_VALUE || Object.is(value, -0)) {
        throw numericRangeError(context);
    }

    const canonical = String(value);
    const match = CANONICAL_NUMBER_PATTERN.exec(canonical);
    if (!match) throw numericRangeError(`${context} precision`);

    const [, whole, fraction = '', exponentText = '0'] = match;
    const coefficient = BigInt(`${whole}${fraction}`);
    const unitExponent = Number(exponentText) - fraction.length + DURATION_DECIMAL_PLACES;
    let units;
    if (unitExponent >= 0) {
        units = coefficient * (10n ** BigInt(unitExponent));
    } else {
        const divisor = 10n ** BigInt(-unitExponent);
        if (coefficient % divisor !== 0n) throw numericRangeError(`${context} precision`);
        units = coefficient / divisor;
    }

    if (units < 0n || units > MAX_DURATION_UNITS) throw numericRangeError(context);
    return units;
}

function adjacentNumber(value, direction) {
    if (value === 0) return direction > 0 ? Number.MIN_VALUE : -Number.MIN_VALUE;
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setFloat64(0, value, false);
    const bits = view.getBigUint64(0, false);
    const increasingBits = (value > 0) === (direction > 0);
    view.setBigUint64(0, increasingBits ? bits + 1n : bits - 1n, false);
    return view.getFloat64(0, false);
}

function legacyWriterDurationToUnits(value, context) {
    if (!Number.isFinite(value) || value < 0 || value > MAX_SAFE_NUMERIC_VALUE || Object.is(value, -0)) {
        throw numericRangeError(context);
    }

    const canonical = String(value);
    const match = CANONICAL_NUMBER_PATTERN.exec(canonical);
    if (!match) throw numericRangeError(`${context} compatibility`);
    const [, whole, fraction = '', exponentText = '0'] = match;
    const coefficient = BigInt(`${whole}${fraction}`);
    const unitExponent = Number(exponentText) - fraction.length + DURATION_DECIMAL_PLACES;
    if (unitExponent >= 0) throw numericRangeError(`${context} compatibility`);

    const divisor = 10n ** BigInt(-unitExponent);
    const lowerUnits = coefficient / divisor;
    const remainder = coefficient % divisor;
    if (remainder === 0n || remainder * 2n === divisor) throw numericRangeError(`${context} compatibility`);
    const candidateUnits = remainder * 2n < divisor ? lowerUnits : lowerUnits + 1n;
    if (candidateUnits < 0n || candidateUnits > MAX_DURATION_UNITS) throw numericRangeError(context);
    const candidate = durationFromUnits(candidateUnits, `${context} compatibility`);
    if (value !== adjacentNumber(candidate, -1) && value !== adjacentNumber(candidate, 1)) {
        throw numericRangeError(`${context} compatibility`);
    }
    return candidateUnits;
}

function durationFromUnits(units, context) {
    if (typeof units !== 'bigint' || units < 0n || units > MAX_DURATION_UNITS) throw numericRangeError(context);
    const whole = units / DURATION_SCALE_BIGINT;
    const fraction = (units % DURATION_SCALE_BIGINT).toString().padStart(DURATION_DECIMAL_PLACES, '0');
    const result = Number(`${whole}.${fraction}`);
    if (!Number.isFinite(result) || Object.is(result, -0) || durationToUnits(result, context) !== units) {
        throw numericRangeError(`${context} representation`);
    }
    return result;
}

function safeAddDurationUnits(leftUnits, right, context) {
    if (typeof leftUnits !== 'bigint' || leftUnits < 0n || leftUnits > MAX_DURATION_UNITS) {
        throw numericRangeError(context);
    }
    const result = leftUnits + durationToUnits(right, context);
    if (result < 0n || result > MAX_DURATION_UNITS) throw numericRangeError(context);
    return result;
}

function safeAddFinite(left, right, context) {
    if (!Number.isFinite(left) || left < 0 || left > MAX_SAFE_NUMERIC_VALUE
        || !Number.isFinite(right) || right < 0 || right > MAX_SAFE_NUMERIC_VALUE) {
        throw numericRangeError(context);
    }
    const result = left + right;
    if (!Number.isFinite(result) || result < 0 || result > MAX_SAFE_NUMERIC_VALUE || Object.is(result, -0)
        || (right !== 0 && result === left) || (left !== 0 && result === right)) {
        throw numericRangeError(context);
    }
    return result;
}

function assertSafeNumbers(value) {
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

function warning(code, message, options = {}) {
    return {
        code,
        severity: options.severity || 'warning',
        message,
        runId: options.runId || null,
        field: options.field || null,
        details: options.details ? { ...options.details } : {}
    };
}

function compareCodePoints(left, right) {
    if (left === right) return 0;
    return left < right ? -1 : 1;
}

function utcTimestamp(year, month, day) {
    const date = new Date(0);
    date.setUTCFullYear(year, month, day);
    date.setUTCHours(0, 0, 0, 0);
    return date.getTime();
}

function formatIsoYear(year) {
    if (year >= 0 && year <= 9999) return String(year).padStart(4, '0');
    const sign = year < 0 ? '-' : '+';
    return `${sign}${String(Math.abs(year)).padStart(6, '0')}`;
}

function isoWeekBucket(timestamp) {
    const date = new Date(timestamp);
    const isoDay = (date.getUTCDay() + 6) % 7;
    const startMs = utcTimestamp(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - isoDay);
    const thursday = new Date(startMs + 3 * 86400000);
    const weekYear = thursday.getUTCFullYear();
    const januaryFourth = new Date(utcTimestamp(weekYear, 0, 4));
    const januaryFourthIsoDay = (januaryFourth.getUTCDay() + 6) % 7;
    const firstWeekStart = utcTimestamp(weekYear, 0, 4 - januaryFourthIsoDay);
    const week = 1 + Math.floor((startMs - firstWeekStart) / (7 * 86400000));
    const key = `${formatIsoYear(weekYear)}-W${String(week).padStart(2, '0')}`;
    return {
        key,
        label: key,
        start: new Date(startMs).toISOString(),
        endExclusive: new Date(startMs + 7 * 86400000).toISOString()
    };
}

function timeBucket(dimension, timestamp) {
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) throw new TypeError('Time bucket timestamp must be valid.');
    if (dimension === 'week') return isoWeekBucket(timestamp);

    if (dimension === 'day') {
        const startMs = utcTimestamp(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
        const key = new Date(startMs).toISOString().slice(0, 10);
        return {
            key,
            label: key,
            start: new Date(startMs).toISOString(),
            endExclusive: new Date(startMs + 86400000).toISOString()
        };
    }

    if (dimension === 'month') {
        const startMs = utcTimestamp(date.getUTCFullYear(), date.getUTCMonth(), 1);
        const endMs = utcTimestamp(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
        const key = new Date(startMs).toISOString().slice(0, 7);
        return {
            key,
            label: key,
            start: new Date(startMs).toISOString(),
            endExclusive: new Date(endMs).toISOString()
        };
    }

    throw new TypeError(`Unsupported time dimension: ${dimension}`);
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
}

module.exports = {
    AGGREGATION_SCHEMA_VERSION,
    DURATION_DECIMAL_PLACES,
    DURATION_SCALE,
    GROUP_DIMENSIONS,
    MAX_SAFE_NUMERIC_VALUE,
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
};
