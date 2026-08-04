const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { computeFailureSignature, FAILURE_CATEGORIES } = require('./FailureClassifier');

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const MAX_TITLE_LENGTH = 512;
const MAX_SUITE_DEPTH = 32;
const MAX_SUITE_PART_LENGTH = 256;
const MAX_FILE_LENGTH = 1024;
const MAX_PROJECT_LENGTH = 256;
const ENGLISH_MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const MONTH_NAME_TIMESTAMP_CANDIDATE = new RegExp(
    `\\b(?:${ENGLISH_MONTH}\\s+\\d{1,2},?\\s+\\d{4}(?:,\\s*|\\s+)\\d{1,2}:\\d{2}(?::\\d{2})?\\s*(?:am|pm)?|\\d{1,2}\\s+${ENGLISH_MONTH},?\\s+\\d{4}(?:,\\s*|\\s+)\\d{1,2}:\\d{2}(?::\\d{2})?\\s*(?:am|pm)?)\\b(?!:\\d)`,
    'gi'
);
const MONTH_NUMBERS = Object.freeze({
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
});

function isLeapYear(year) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isValidMonthNameTimestamp(value) {
    const monthFirst = value.match(new RegExp(
        `^(${ENGLISH_MONTH})\\s+(\\d{1,2}),?\\s+(\\d{4})(?:,\\s*|\\s+)(\\d{1,2}):(\\d{2})(?::(\\d{2}))?\\s*(am|pm)?$`,
        'i'
    ));
    const dayFirst = monthFirst ? null : value.match(new RegExp(
        `^(\\d{1,2})\\s+(${ENGLISH_MONTH}),?\\s+(\\d{4})(?:,\\s*|\\s+)(\\d{1,2}):(\\d{2})(?::(\\d{2}))?\\s*(am|pm)?$`,
        'i'
    ));
    const match = monthFirst || dayFirst;
    if (!match) return false;

    const monthName = monthFirst ? match[1] : match[2];
    const day = Number(monthFirst ? match[2] : match[1]);
    const year = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = match[6] === undefined ? 0 : Number(match[6]);
    const period = match[7] && match[7].toLowerCase();
    const month = MONTH_NUMBERS[monthName.slice(0, 3).toLowerCase()];
    if (!month || year < 1 || year > 9999 || minute > 59 || second > 59) return false;
    if (period ? (hour < 1 || hour > 12) : (hour < 0 || hour > 23)) return false;

    const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day >= 1 && day <= days[month - 1];
}

function fingerprint(value) {
    return `sha256:${crypto.createHash('sha256').update(String(value), 'utf8').digest('hex')}`;
}

function boundedString(value, label, maximum, options = {}) {
    if (value === null || value === undefined) {
        if (options.optional) return null;
        throw new TypeError(`${label} must be a string.`);
    }
    if (typeof value !== 'string') throw new TypeError(`${label} must be a string.`);
    const normalized = value.normalize('NFC').trim();
    if (!normalized && !options.allowEmpty) throw new TypeError(`${label} must not be empty.`);
    if (normalized.length > maximum) throw new TypeError(`${label} exceeds the ${maximum} character limit.`);
    if (/[\u0000-\u001f\u007f]/.test(normalized)) throw new TypeError(`${label} contains control characters.`);
    return normalized;
}

function normalizeProject(value) {
    return boundedString(value || 'Project', 'project', MAX_PROJECT_LENGTH);
}

function hostPathSeparators(value) {
    return value.replace(/[\\/]/g, path.sep);
}

function containedRelativeFile(projectRoot, file) {
    const root = path.resolve(hostPathSeparators(projectRoot || process.cwd()));
    const supplied = boundedString(file, 'test file', MAX_FILE_LENGTH);
    const hostFile = hostPathSeparators(supplied);
    const foreignAbsolute = path.sep === '/'
        ? path.win32.isAbsolute(supplied)
        : path.posix.isAbsolute(supplied);
    if (foreignAbsolute && !path.isAbsolute(hostFile)) {
        throw new TypeError('test file must resolve inside projectRoot.');
    }
    const target = path.resolve(root, hostFile);
    const relative = path.relative(root, target);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new TypeError('test file must resolve inside projectRoot.');
    }
    const normalized = relative.replace(/\\/g, '/').normalize('NFC');
    if (normalized.length > MAX_FILE_LENGTH) throw new TypeError(`test file exceeds the ${MAX_FILE_LENGTH} character limit.`);
    return normalized;
}

function normalizeSuitePath(value) {
    if (!Array.isArray(value)) throw new TypeError('suitePath must be an array.');
    if (value.length > MAX_SUITE_DEPTH) throw new TypeError(`suitePath exceeds the ${MAX_SUITE_DEPTH} item limit.`);
    return value.map((item, index) => boundedString(item, `suitePath[${index}]`, MAX_SUITE_PART_LENGTH));
}

function testInfoIdentityParts(testInfo) {
    if (!testInfo || typeof testInfo !== 'object') return null;
    const titlePath = Array.isArray(testInfo.titlePath) ? testInfo.titlePath.slice() : [];
    const title = typeof testInfo.title === 'string' && testInfo.title.trim()
        ? testInfo.title
        : titlePath[titlePath.length - 1];
    if ((testInfo.file === null || testInfo.file === undefined) || !title) return null;
    const withoutFile = titlePath.length
        && path.basename(hostPathSeparators(String(titlePath[0]))) === path.basename(hostPathSeparators(String(testInfo.file)))
        ? titlePath.slice(1)
        : titlePath;
    const suitePath = withoutFile.length && withoutFile[withoutFile.length - 1] === title
        ? withoutFile.slice(0, -1)
        : withoutFile;
    return { title, suitePath };
}

function createTestIdentity(options = {}) {
    const testInfo = options.testInfo;
    const project = normalizeProject(
        options.project
        || (testInfo && testInfo.project && testInfo.project.name)
        || 'Project'
    );
    const strong = testInfoIdentityParts(testInfo);
    let file = null;
    let suitePath = [];
    let title;
    let identityQuality;
    let testKey;

    if (strong) {
        file = containedRelativeFile(options.projectRoot, testInfo.file);
        suitePath = normalizeSuitePath(strong.suitePath);
        title = boundedString(strong.title, 'test title', MAX_TITLE_LENGTH);
        const payload = ['test-identity/v1', file, ...suitePath, title].join('\0');
        testKey = fingerprint(payload);
        identityQuality = 'strong';
    } else {
        const fallbackInput = boundedString(options.testCase || 'Unknown test', 'testCase', MAX_TITLE_LENGTH);
        title = 'Unidentified test';
        testKey = fingerprint(`test-identity-fallback/v1\0${fallbackInput}`);
        identityQuality = 'degraded';
    }

    const line = testInfo && Number.isSafeInteger(testInfo.line) && testInfo.line > 0 ? testInfo.line : null;
    const playwrightTestIdFingerprint = testInfo && typeof testInfo.testId === 'string' && testInfo.testId
        ? fingerprint(`playwright-test-id/v1\0${testInfo.testId}`)
        : null;

    return {
        testKey,
        playwrightTestIdFingerprint,
        project,
        file,
        suitePath,
        title,
        line,
        identityQuality
    };
}

function normalizeVolatileText(value) {
    if (value === null || value === undefined) return '';
    let text = String(value).normalize('NFC')
        .replace(/\u001b\[[0-9;]*m/g, '')
        .replace(/\r\n/g, '\n');

    const machineNames = [os.hostname(), process.env.COMPUTERNAME, process.env.HOSTNAME]
        .filter(item => typeof item === 'string' && item.length >= 3)
        .map(item => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const preservedInvalidMonthTimestamps = [];
    text = text.replace(MONTH_NAME_TIMESTAMP_CANDIDATE, match => {
        if (isValidMonthNameTimestamp(match)) return '<timestamp>';
        const placeholder = `\uE000m${preservedInvalidMonthTimestamps.length}\uE001`;
        preservedInvalidMonthTimestamps.push(match);
        return placeholder;
    });

    text = text
        .replace(/\b\d{4}-\d{2}-\d{2}[T ][0-9:.+-]*Z?\b/gi, '<timestamp>')
        .replace(/\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}(?:[ T,]+\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?\s*(?:am|pm)?)?\b/gi, '<timestamp>')
        .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '<uuid>')
        .replace(/\b(?:request|correlation|trace|session)[-_ ]?id\s*[:=]\s*[A-Za-z0-9._:-]+/gi, '<request-id>')
        .replace(/https?:\/\/[^\s"'<>]+/gi, '<url>')
        .replace(/file:\/\/\/?[^\s"'<>]+/gi, '<path>')
        .replace(/\b[A-Za-z]:[\\/][^\s"'<>]+/g, '<path>')
        .replace(/(^|[\s(])\/(?:tmp|temp|home|users?|var|private|opt|workspace|runner|mnt)\/[^\s)"'<>]+/gim, '$1<path>')
        .replace(/\b(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|(?:[A-Za-z0-9-]+\.)+[A-Za-z][A-Za-z0-9-]*):(\d{2,5})\b/gi, '<host>:<port>')
        .replace(/\[(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}\]:(\d{2,5})\b/gi, '<host>:<port>')
        .replace(/\b\d+(?:\.\d+)?\s*(?:ms|milliseconds?|seconds?|secs?|minutes?|mins?)\b/gi, '<duration>')
        .replace(/\b(?:timeout|duration)\s*[:=]?\s*\d+(?:\.\d+)?\b/gi, '$1 <duration>')
        .replace(/\b(?:node(?:\.js)?|chromium|chrome|firefox|webkit|browser|runtime)\s*v?\d+(?:\.\d+){1,3}(?:[-+][A-Za-z0-9.-]+)?\b/gi, '<runtime-version>')
        .replace(machineNames.length ? new RegExp(`\\b(?:${machineNames.join('|')})\\b`, 'gi') : /(?!) /g, '<machine>')
        .replace(/\bline\s+\d+(?:\s*[:,]\s*column\s+\d+)?\b/gi, '<location>')
        .replace(/:([1-9]\d*):([1-9]\d*)\b/g, ':<line>:<column>')
        .replace(/\b[0-9a-f]{16,}\b/gi, '<hex-id>')
        .replace(/\b(?:id|job|build|run|attempt)\s*[:=#-]?\s*\d{4,}\b/gi, '$1 <numeric-id>')
        .replace(/\b\d{7,}\b/g, '<numeric-id>')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .toLowerCase();

    preservedInvalidMonthTimestamps.forEach((timestamp, index) => {
        text = text.replace(`\uE000m${index}\uE001`, timestamp.toLowerCase());
    });

    return text.slice(0, 8192);
}

function errorTypeFor(message, stack) {
    const combined = `${stack || ''}\n${message || ''}`;
    const named = combined.match(/(?:^|\n)\s*([A-Za-z][A-Za-z0-9]*(?:Error|Exception))\b/);
    if (named) return named[1];
    if (/expect\s*\(/i.test(combined)) return 'AssertionError';
    if (/timeout|timed out/i.test(combined)) return 'TimeoutError';
    if (/strict mode violation/i.test(combined)) return 'StrictModeViolation';
    if (/net::ERR_|ECONN|ENOTFOUND|socket hang up/i.test(combined)) return 'NetworkError';
    return 'UnknownError';
}

function normalizeFramePath(file, projectRoot) {
    const normalized = String(file).replace(/\\/g, '/');
    try {
        if (path.isAbsolute(file)) return containedRelativeFile(projectRoot, file);
    } catch (error) {
        const parts = normalized.split('/').filter(Boolean);
        return parts.slice(-2).join('/');
    }
    const parts = normalized.split('/').filter(Boolean);
    if (parts.includes('..')) return parts.slice(-2).join('/');
    return parts.slice(-4).join('/');
}

function firstUserStackFrame(stack, projectRoot) {
    if (typeof stack !== 'string' || !stack.trim()) return null;
    for (const line of stack.split(/\r?\n/)) {
        if (/node_modules[\\/](?:playwright|@playwright)|node:internal|internal[\\/]/i.test(line)) continue;
        const match = line.match(/^\s*at\s+(?:(.*?)\s+\()?(.+?\.(?:[cm]?[jt]sx?))(?::\d+)?(?::\d+)?\)?\s*$/i);
        if (!match) continue;
        const functionName = normalizeVolatileText(match[1] || '<anonymous>').slice(0, 256);
        const file = normalizeFramePath(match[2], projectRoot).normalize('NFC');
        return `${functionName}\0${file}`;
    }
    return null;
}

function createFailureIdentity(options = {}) {
    const category = boundedString(
        options.failureCategory || FAILURE_CATEGORIES.UNKNOWN_FAILURE,
        'failureCategory',
        128
    ).toUpperCase();
    const message = typeof options.errorMessage === 'string' ? options.errorMessage : '';
    const stack = typeof options.stack === 'string' ? options.stack : '';
    const signatureClass = computeFailureSignature(message, category).signature;
    const errorType = errorTypeFor(message, stack);
    const normalizedMessage = normalizeVolatileText(message);
    const normalizedFrame = firstUserStackFrame(stack, options.projectRoot);
    const messageFingerprint = fingerprint(`failure-message/v1\0${normalizedMessage || '<empty>'}`);
    const stackFrameFingerprint = normalizedFrame
        ? fingerprint(`failure-stack-frame/v1\0${normalizedFrame}`)
        : null;
    const signature = fingerprint([
        'failure-signature/v1',
        category,
        signatureClass,
        errorType,
        messageFingerprint,
        stackFrameFingerprint || '<no-user-frame>'
    ].join('\0'));
    const signatureQuality = normalizedMessage && normalizedFrame && category !== FAILURE_CATEGORIES.UNKNOWN_FAILURE
        ? 'strong'
        : 'degraded';

    return {
        category,
        signatureClass,
        errorType,
        signature,
        messageFingerprint,
        stackFrameFingerprint,
        signatureQuality
    };
}

function createRecurrenceKey(project, testKey, failureSignature) {
    const normalizedProject = normalizeProject(project);
    if (!HASH_PATTERN.test(testKey)) throw new TypeError('testKey must be a SHA-256 fingerprint.');
    if (!HASH_PATTERN.test(failureSignature)) throw new TypeError('failureSignature must be a SHA-256 fingerprint.');
    return fingerprint(`recurrence/v1\0${normalizedProject}\0${testKey}\0${failureSignature}`);
}

module.exports = {
    HASH_PATTERN,
    createFailureIdentity,
    createRecurrenceKey,
    createTestIdentity,
    fingerprint,
    firstUserStackFrame,
    normalizeProject,
    normalizeVolatileText
};
