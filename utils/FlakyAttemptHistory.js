const FINAL_ATTEMPT_STATUSES = Object.freeze([
    'PASSED',
    'FAILED',
    'TIMEDOUT',
    'INTERRUPTED',
    'SKIPPED'
]);

const FINAL_ATTEMPT_STATUS_SET = new Set(FINAL_ATTEMPT_STATUSES);
const ATTEMPT_HISTORY_NOT_PERSISTED = 'ATTEMPT_HISTORY_NOT_PERSISTED';

const UNKNOWN_CLASSIFICATION = Object.freeze({
    flakyEligibility: 'unknown',
    flaky: null,
    reasonCode: ATTEMPT_HISTORY_NOT_PERSISTED
});
const KNOWN_FLAKY = Object.freeze({ flakyEligibility: 'known', flaky: true, reasonCode: null });
const KNOWN_NOT_FLAKY = Object.freeze({ flakyEligibility: 'known', flaky: false, reasonCode: null });

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function requireSafeRetry(value, label) {
    if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
        throw new TypeError(`${label} must be a safe non-negative integer.`);
    }
    return value;
}

function requireFinalStatus(value, label) {
    if (typeof value !== 'string' || !FINAL_ATTEMPT_STATUS_SET.has(value)) {
        throw new TypeError(`${label} is unsupported.`);
    }
    return value;
}

function denseArrayLength(value, label) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
        throw new TypeError(`${label} must be an ordinary array.`);
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (!lengthDescriptor || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')
        || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
        throw new TypeError(`${label} has an invalid length.`);
    }
    const length = lengthDescriptor.value;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1 || keys[length] !== 'length') {
        throw new TypeError(`${label} must be dense and contain no extra properties.`);
    }
    for (let index = 0; index < length; index += 1) {
        if (keys[index] !== String(index)) throw new TypeError(`${label}[${index}] must be a dense data property.`);
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
            throw new TypeError(`${label}[${index}] must be a dense data property.`);
        }
    }
    return length;
}

function passiveRequiredProperty(value, key, label) {
    let descriptor;
    try {
        descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (error) {
        throw new TypeError(`${label}.${key} could not be inspected passively.`);
    }
    if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw new TypeError(`${label}.${key} must be an enumerable data property.`);
    }
    return descriptor.value;
}

function passiveBoundaryProperty(value, key, options = {}) {
    let descriptor;
    try {
        descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch (error) {
        throw new TypeError(`Attempt-history input.${key} could not be inspected passively.`);
    }
    if (!descriptor) {
        if (options.required === false) return undefined;
        throw new TypeError(`Attempt-history input.${key} must be an own data property.`);
    }
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw new TypeError(`Attempt-history input.${key} must be an own data property.`);
    }
    return descriptor.value;
}

function passiveAttemptHistorySnapshot(input, options = {}) {
    if (!isPlainObject(input)) throw new TypeError('Attempt-history input must be a plain object.');
    return {
        finalStatus: passiveBoundaryProperty(input, 'finalStatus'),
        retryCount: passiveBoundaryProperty(input, 'retryCount'),
        attempts: passiveBoundaryProperty(input, 'attempts', { required: options.attemptsRequired === true })
    };
}

function validateAttemptEntry(value, index, options = {}) {
    const label = `${options.label || 'attempts'}[${index}]`;
    if (!isPlainObject(value)) throw new TypeError(`${label} must be a plain object.`);
    if (options.exactKeys !== false) {
        let keys;
        try {
            keys = Reflect.ownKeys(value);
        } catch (error) {
            throw new TypeError(`${label} could not be inspected passively.`);
        }
        if (keys.length !== 2 || keys.some(key => typeof key !== 'string')
            || !keys.includes('retry') || !keys.includes('status')) {
            throw new TypeError(`${label} contains unsupported fields.`);
        }
    }
    const retry = requireSafeRetry(passiveRequiredProperty(value, 'retry', label), `${label}.retry`);
    const status = requireFinalStatus(passiveRequiredProperty(value, 'status', label), `${label}.status`);
    return { retry, status };
}

function validateCompleteAttemptHistory(input, options = {}) {
    if (!isPlainObject(input)) throw new TypeError('Attempt-history input must be a plain object.');
    const label = options.label || 'attempts';
    const retryCount = requireSafeRetry(input.retryCount, 'retryCount');
    const finalStatus = requireFinalStatus(input.finalStatus, 'finalStatus');
    const attempts = input.attempts;
    const length = denseArrayLength(attempts, label);
    if (length === 0) throw new TypeError(`${label} must not be empty.`);
    if (length !== retryCount + 1) throw new TypeError(`${label}.length must equal retryCount + 1.`);

    const normalized = [];
    for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(attempts, String(index));
        const attempt = validateAttemptEntry(descriptor.value, index, options);
        if (attempt.retry !== index) throw new TypeError(`${label}[${index}].retry must equal ${index}.`);
        normalized.push(attempt);
    }
    const finalAttempt = normalized[normalized.length - 1];
    if (finalAttempt.retry !== retryCount) throw new TypeError('Final attempt retry must equal retryCount.');
    if (finalAttempt.status !== finalStatus) throw new TypeError('Final attempt status must equal finalStatus.');
    return normalized;
}

function validatePersistedAttemptHistory(input) {
    const snapshot = passiveAttemptHistorySnapshot(input, { attemptsRequired: true });
    requireSafeRetry(snapshot.retryCount, 'retryCount');
    requireFinalStatus(snapshot.finalStatus, 'finalStatus');
    if (snapshot.attempts === null) return null;
    return validateCompleteAttemptHistory(snapshot, { exactKeys: true, label: 'attempts' });
}

function extractPersistedAttemptHistory(testCase, options = {}) {
    if (options.forceUnavailable === true) return null;
    if (!testCase || typeof testCase !== 'object') return null;
    let descriptor;
    try {
        descriptor = Object.getOwnPropertyDescriptor(testCase, 'attempts');
    } catch (error) {
        throw new TypeError('Execution attempt history could not be inspected passively.');
    }
    if (!descriptor) return null;
    if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw new TypeError('Execution attempts must be an enumerable data property.');
    }
    if (descriptor.value === null || descriptor.value === undefined) {
        throw new TypeError('Execution attempts is explicitly present but unavailable or malformed.');
    }
    return validateCompleteAttemptHistory({
        finalStatus: options.finalStatus,
        retryCount: options.retryCount,
        attempts: descriptor.value
    }, { exactKeys: false, label: 'execution.attempts' });
}

function classifyFlakyAttemptHistory(input) {
    const snapshot = passiveAttemptHistorySnapshot(input);
    requireSafeRetry(snapshot.retryCount, 'retryCount');
    requireFinalStatus(snapshot.finalStatus, 'finalStatus');
    if (snapshot.attempts === null || snapshot.attempts === undefined) return { ...UNKNOWN_CLASSIFICATION };
    const attempts = validateCompleteAttemptHistory(snapshot, { exactKeys: true, label: 'attempts' });
    let flaky = false;
    if (snapshot.finalStatus === 'PASSED') {
        for (let index = 0; index < attempts.length - 1; index += 1) {
            if (attempts[index].status === 'FAILED' || attempts[index].status === 'TIMEDOUT') {
                flaky = true;
                break;
            }
        }
    }
    return { ...(flaky ? KNOWN_FLAKY : KNOWN_NOT_FLAKY) };
}

module.exports = {
    ATTEMPT_HISTORY_NOT_PERSISTED,
    FINAL_ATTEMPT_STATUSES,
    classifyFlakyAttemptHistory,
    extractPersistedAttemptHistory,
    requireFinalStatus,
    requireSafeRetry,
    validatePersistedAttemptHistory
};
