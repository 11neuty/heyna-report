const {
    CANONICAL_METRIC,
    SUPPORTED_AGGREGATION_SCHEMA_VERSION,
    TREND_SCHEMA_VERSION,
    cloneJsonValue,
    dependencyError,
    finalizeResult,
    normalizeTrendOptions,
    roundRate,
    safeAddCount,
    safeSubtractCount,
    sourceContractError,
    trendWarning
} = require('./PassRateTrendValidation');

const WARNING_CODES = Object.freeze({
    INSUFFICIENT_DATA: 'HEYNA_PASS_RATE_TREND_INSUFFICIENT_DATA',
    ZERO_TEST_POINT: 'HEYNA_PASS_RATE_TREND_ZERO_TEST_POINT',
    UNDEFINED_RELATIVE_CHANGE: 'HEYNA_PASS_RATE_TREND_UNDEFINED_RELATIVE_CHANGE'
});
const SOURCE_COUNTER_FIELDS = Object.freeze([
    'discoveredRunCount',
    'validRunCount',
    'excludedRunCount',
    'aggregationExcludedRunCount',
    'matchedRunCount',
    'selectedRunCount'
]);
const STATUS_FIELDS = Object.freeze(['passed', 'failed', 'skipped', 'timedOut', 'interrupted']);
const WARNING_SEVERITIES = new Set(['info', 'warning', 'error']);
const WARNING_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ISO_TIMESTAMP_PATTERN = /^(\d{4}|[+-]\d{6})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:(Z)|([+-])(\d{2}):(\d{2}))$/;

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

function requireSourceCount(value, context) {
    if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
        throw sourceContractError(`${context} must be a safe non-negative integer.`);
    }
    return value;
}

function addSourceCounts(left, right, context) {
    requireSourceCount(left, context);
    requireSourceCount(right, context);
    const result = left + right;
    if (!Number.isSafeInteger(result)) throw sourceContractError(`${context} exceeds the safe integer range.`);
    return result;
}

function requireBoundedString(value, context, maximumLength = 256) {
    if (typeof value !== 'string' || value.trim() === '' || value.length > maximumLength || /[\u0000-\u001f\u007f]/.test(value)) {
        throw sourceContractError(`${context} must be a non-empty bounded string.`);
    }
    return value;
}

function requireRate(value, context, allowNull = true) {
    if (value === null && allowNull) return value;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100 || Object.is(value, -0)) {
        throw sourceContractError(`${context} must be${allowNull ? ' null or' : ''} a finite number from 0 through 100.`);
    }
    return value;
}

function expectedWeightedRate(passed, total) {
    if (total === 0) return null;
    const value = Number(((passed / total) * 100).toFixed(2));
    return Object.is(value, -0) ? 0 : value;
}

function validateRun(run, index) {
    const context = `runs[${index}]`;
    if (!isPlainObject(run)) throw sourceContractError(`${context} must be a plain object.`);
    requireBoundedString(run.runId, `${context}.runId`);
    if (!RUN_ID_PATTERN.test(run.runId) || run.runId === '.' || run.runId === '..') {
        throw sourceContractError(`${context}.runId must be filesystem-safe.`);
    }
    timestampEpoch(run.timestamp, `${context}.timestamp`);
    requireSourceCount(run.total, `${context}.total`);
    requireSourceCount(run.passed, `${context}.passed`);
    if (run.passed > run.total) throw sourceContractError(`${context}.passed must not exceed total.`);

    let statusTotal = 0;
    STATUS_FIELDS.forEach(field => {
        requireSourceCount(run[field], `${context}.${field}`);
        statusTotal = addSourceCounts(statusTotal, run[field], `${context} status total`);
    });
    if (statusTotal !== run.total) throw sourceContractError(`${context} status counts must sum to total.`);
    requireSourceCount(run.unsuccessful, `${context}.unsuccessful`);
    const expectedUnsuccessful = addSourceCounts(
        addSourceCounts(run.failed, run.timedOut, `${context} unsuccessful count`),
        run.interrupted,
        `${context} unsuccessful count`
    );
    if (run.unsuccessful !== expectedUnsuccessful) {
        throw sourceContractError(`${context}.unsuccessful must equal failed plus timedOut plus interrupted.`);
    }

    const expectedRate = expectedWeightedRate(run.passed, run.total);
    if (expectedRate === null) {
        if (run.passRate !== null) throw sourceContractError(`${context}.passRate must be null when total is zero.`);
    } else {
        requireRate(run.passRate, `${context}.passRate`, false);
        if (run.passRate !== expectedRate) throw sourceContractError(`${context}.passRate contradicts passed and total counts.`);
    }
    if (Object.prototype.hasOwnProperty.call(run, 'averageRunPassRate')) {
        requireRate(run.averageRunPassRate, `${context}.averageRunPassRate`);
    }
}

function validateGroup(group, index) {
    const context = `groups[${index}]`;
    if (!isPlainObject(group)) throw sourceContractError(`${context} must be a plain object.`);
    requireBoundedString(group.key, `${context}.key`);
    requireBoundedString(group.label, `${context}.label`, 512);
    const start = timestampEpoch(group.start, `${context}.start`, true);
    const endExclusive = timestampEpoch(group.endExclusive, `${context}.endExclusive`, true);
    if (start >= endExclusive) throw sourceContractError(`${context} start must be earlier than endExclusive.`);
    requireSourceCount(group.runCount, `${context}.runCount`);
    if (!isPlainObject(group.totals) || !isPlainObject(group.rates)) {
        throw sourceContractError(`${context} must provide plain totals and rates objects.`);
    }
    requireSourceCount(group.totals.tests, `${context}.totals.tests`);
    requireSourceCount(group.totals.passed, `${context}.totals.passed`);
    if (group.totals.passed > group.totals.tests) {
        throw sourceContractError(`${context}.totals.passed must not exceed totals.tests.`);
    }
    const expectedRate = expectedWeightedRate(group.totals.passed, group.totals.tests);
    if (expectedRate === null) {
        if (group.rates.weightedPassRate !== null) {
            throw sourceContractError(`${context}.rates.weightedPassRate must be null when totals.tests is zero.`);
        }
    } else {
        requireRate(group.rates.weightedPassRate, `${context}.rates.weightedPassRate`, false);
        if (group.rates.weightedPassRate !== expectedRate) {
            throw sourceContractError(`${context}.rates.weightedPassRate contradicts totals.`);
        }
    }
    requireRate(group.rates.averageRunPassRate, `${context}.rates.averageRunPassRate`);
    return group.runCount;
}

function validateWarning(item, index) {
    const context = `warnings[${index}]`;
    if (!isPlainObject(item)) throw sourceContractError(`${context} must be a non-null plain object.`);
    if (typeof item.code !== 'string' || !WARNING_CODE_PATTERN.test(item.code)) {
        throw sourceContractError(`${context}.code must be a bounded uppercase token.`);
    }
    if (!WARNING_SEVERITIES.has(item.severity)) throw sourceContractError(`${context}.severity is unsupported.`);
    if (typeof item.message !== 'string') throw sourceContractError(`${context}.message must be a string.`);
}

function validateSource(source) {
    if (!isPlainObject(source)) throw sourceContractError('source must be a plain object.');
    SOURCE_COUNTER_FIELDS.forEach(field => requireSourceCount(source[field], `source.${field}`));
    const expectedDiscoveredRunCount = addSourceCounts(
        source.validRunCount,
        source.excludedRunCount,
        'source discovered run count'
    );
    if (source.discoveredRunCount !== expectedDiscoveredRunCount) {
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
}

function validateAggregatorResult(result, granularity) {
    const cloned = cloneJsonValue(result, 'HistoricalMetricsAggregator result');
    if (!isPlainObject(cloned)) throw sourceContractError('result must be a plain object.');
    if (cloned.aggregationSchemaVersion !== SUPPORTED_AGGREGATION_SCHEMA_VERSION) {
        throw sourceContractError(`aggregationSchemaVersion must be ${SUPPORTED_AGGREGATION_SCHEMA_VERSION}.`);
    }
    timestampEpoch(cloned.generatedAt, 'generatedAt', true);
    if (!isPlainObject(cloned.query)) throw sourceContractError('query must be a plain object.');
    validateSource(cloned.source);
    if (!Array.isArray(cloned.warnings)) throw sourceContractError('warnings must be a dense array.');
    cloned.warnings.forEach(validateWarning);

    if (granularity === 'run') {
        if (!Array.isArray(cloned.runs)) throw sourceContractError('runs must be a dense array.');
        cloned.runs.forEach(validateRun);
        if (cloned.runs.length !== cloned.source.selectedRunCount) {
            throw sourceContractError('runs length must equal source.selectedRunCount.');
        }
    } else {
        if (!Array.isArray(cloned.groups)) throw sourceContractError('groups must be a dense array.');
        let groupedRunCount = 0;
        cloned.groups.forEach((group, index) => {
            groupedRunCount = addSourceCounts(groupedRunCount, validateGroup(group, index), 'group runCount total');
        });
        if (groupedRunCount !== cloned.source.selectedRunCount) {
            throw sourceContractError('sum of group.runCount must equal source.selectedRunCount.');
        }
    }
    return cloned;
}

function runPoint(run) {
    const rate = run.total === 0 ? null : run.passRate;
    return {
        key: run.runId,
        label: run.runId,
        start: run.timestamp,
        endExclusive: null,
        runCount: 1,
        totalTests: run.total,
        passed: run.passed,
        weightedPassRate: rate,
        averageRunPassRate: rate,
        movingWeightedPassRate: null
    };
}

function groupPoint(group) {
    return {
        key: group.key,
        label: group.label,
        start: group.start,
        endExclusive: group.endExclusive,
        runCount: group.runCount,
        totalTests: group.totals.tests,
        passed: group.totals.passed,
        weightedPassRate: group.rates.weightedPassRate,
        averageRunPassRate: group.rates.averageRunPassRate,
        movingWeightedPassRate: null
    };
}

function chronologicalPoints(result, granularity) {
    const points = granularity === 'run' ? result.runs.map(runPoint) : result.groups.map(groupPoint);
    return points.sort((left, right) => {
        const timeDifference = Date.parse(left.start) - Date.parse(right.start);
        return timeDifference || compareCodePoints(left.key, right.key);
    });
}

function addMovingRates(points, window) {
    if (window === null) return points;
    let passed = 0;
    let totalTests = 0;
    return points.map((point, index) => {
        if (index >= window) {
            const outgoing = points[index - window];
            passed = safeSubtractCount(passed, outgoing.passed, 'moving passed tests');
            totalTests = safeSubtractCount(totalTests, outgoing.totalTests, 'moving total tests');
        }
        passed = safeAddCount(passed, point.passed, 'moving passed tests');
        totalTests = safeAddCount(totalTests, point.totalTests, 'moving total tests');
        const movingWeightedPassRate = index < window - 1 || totalTests === 0
            ? null
            : roundRate((passed / totalTests) * 100, 'moving weighted pass rate');
        return { ...point, movingWeightedPassRate };
    });
}

function comparison(first, latest, rateField) {
    if (!first || !latest || first === latest) {
        return { percentagePointChange: null, relativePercentChange: null };
    }
    const firstRate = first[rateField];
    const latestRate = latest[rateField];
    const percentagePointChange = roundRate(latestRate - firstRate, `${rateField} percentage-point change`);
    const relativePercentChange = firstRate === 0
        ? null
        : roundRate(((latestRate - firstRate) / firstRate) * 100, `${rateField} relative change`);
    return { percentagePointChange, relativePercentChange };
}

function comparisonSummary(points, field) {
    const candidates = points.filter(point => point[field] !== null);
    const first = candidates[0] || null;
    const latest = candidates[candidates.length - 1] || null;
    const previous = candidates.length >= 2 ? candidates[candidates.length - 2] : null;
    const firstLatest = comparison(first, latest, field);
    const previousLatest = comparison(previous, latest, field);
    return {
        candidates,
        first,
        previous,
        latest,
        percentagePointChange: firstLatest.percentagePointChange,
        relativePercentChange: firstLatest.relativePercentChange,
        previousPercentagePointChange: previousLatest.percentagePointChange,
        previousRelativePercentChange: previousLatest.relativePercentChange
    };
}

function publicAverageRunComparison(value) {
    return {
        firstKey: value.first ? value.first.key : null,
        firstRate: value.first ? value.first.averageRunPassRate : null,
        previousKey: value.previous ? value.previous.key : null,
        previousRate: value.previous ? value.previous.averageRunPassRate : null,
        latestKey: value.latest ? value.latest.key : null,
        latestRate: value.latest ? value.latest.averageRunPassRate : null,
        percentagePointChange: value.percentagePointChange,
        relativePercentChange: value.relativePercentChange,
        previousPercentagePointChange: value.previousPercentagePointChange,
        previousRelativePercentChange: value.previousRelativePercentChange
    };
}

function warningForUndefinedRelative(warnings, seen, metric, comparisonName, baseline, latest) {
    if (!baseline || !latest || baseline === latest || baseline[metric] !== 0 || latest[metric] === null) return;
    const signature = `${metric}\0${baseline.key}\0${latest.key}`;
    if (seen.has(signature)) return;
    seen.add(signature);
    warnings.push(trendWarning(
        WARNING_CODES.UNDEFINED_RELATIVE_CHANGE,
        'Relative pass-rate change is undefined because the comparison baseline is zero.',
        {
            field: metric,
            details: { metric, comparison: comparisonName, baselineKey: baseline.key, latestKey: latest.key }
        }
    ));
}

function directionFor(canonical, options) {
    if (canonical.candidates.length < options.minimumPoints) return 'insufficient-data';
    if (canonical.percentagePointChange > options.stableThresholdPoints) return 'improving';
    if (canonical.percentagePointChange < -options.stableThresholdPoints) return 'declining';
    return 'stable';
}

class PassRateTrendAnalyzer {
    constructor(options = {}) {
        if (!options || typeof options !== 'object' || Array.isArray(options)) {
            throw dependencyError('PassRateTrendAnalyzer options must be an object.');
        }
        this.historicalMetricsAggregator = validateDependency(options.historicalMetricsAggregator);
    }

    async analyze(options = {}) {
        const normalized = normalizeTrendOptions(options);
        const trendOptions = normalized.trendOptions;
        const upstreamResult = trendOptions.granularity === 'run'
            ? await this.historicalMetricsAggregator.queryRuns(normalized.aggregatorOptions)
            : await this.historicalMetricsAggregator.groupBy(trendOptions.granularity, normalized.aggregatorOptions);
        const aggregateResult = validateAggregatorResult(upstreamResult, trendOptions.granularity);

        const points = addMovingRates(
            chronologicalPoints(aggregateResult, trendOptions.granularity),
            trendOptions.movingAverageWindow
        );
        const canonical = comparisonSummary(points, 'weightedPassRate');
        const averageRun = trendOptions.includeAverageRunComparison
            ? comparisonSummary(points, 'averageRunPassRate')
            : null;
        const warnings = aggregateResult.warnings;

        if (canonical.candidates.length < trendOptions.minimumPoints) {
            warnings.push(trendWarning(
                WARNING_CODES.INSUFFICIENT_DATA,
                'There are not enough rate-bearing points to classify the pass-rate trend.',
                {
                    field: 'weightedPassRate',
                    details: {
                        pointCount: points.length,
                        analyzablePointCount: canonical.candidates.length,
                        minimumPoints: trendOptions.minimumPoints
                    }
                }
            ));
        }

        const zeroTestPointCount = points.filter(point => point.totalTests === 0).length;
        if (zeroTestPointCount > 0) {
            warnings.push(trendWarning(
                WARNING_CODES.ZERO_TEST_POINT,
                `${zeroTestPointCount} pass-rate trend point${zeroTestPointCount === 1 ? '' : 's'} contained no tests.`,
                { field: 'weightedPassRate', details: { affectedPointCount: zeroTestPointCount } }
            ));
        }

        const seenUndefinedRelative = new Set();
        warningForUndefinedRelative(warnings, seenUndefinedRelative, 'weightedPassRate', 'first-to-latest', canonical.first, canonical.latest);
        warningForUndefinedRelative(warnings, seenUndefinedRelative, 'weightedPassRate', 'previous-to-latest', canonical.previous, canonical.latest);
        if (averageRun) {
            warningForUndefinedRelative(warnings, seenUndefinedRelative, 'averageRunPassRate', 'first-to-latest', averageRun.first, averageRun.latest);
            warningForUndefinedRelative(warnings, seenUndefinedRelative, 'averageRunPassRate', 'previous-to-latest', averageRun.previous, averageRun.latest);
        }

        const source = aggregateResult.source;
        const partial = source.excludedRunCount > 0
            || source.aggregationExcludedRunCount > 0
            || warnings.some(item => item.code === 'HEYNA_HISTORICAL_PARTIAL_AGGREGATION');
        const limited = source.selectedRunCount < source.matchedRunCount;

        const summary = {
            firstKey: canonical.first ? canonical.first.key : null,
            firstRate: canonical.first ? canonical.first.weightedPassRate : null,
            previousKey: canonical.previous ? canonical.previous.key : null,
            previousRate: canonical.previous ? canonical.previous.weightedPassRate : null,
            latestKey: canonical.latest ? canonical.latest.key : null,
            latestRate: canonical.latest ? canonical.latest.weightedPassRate : null,
            percentagePointChange: canonical.percentagePointChange,
            relativePercentChange: canonical.relativePercentChange,
            previousPercentagePointChange: canonical.previousPercentagePointChange,
            previousRelativePercentChange: canonical.previousRelativePercentChange,
            direction: directionFor(canonical, trendOptions),
            comparison: 'first-to-latest',
            stableThresholdPoints: trendOptions.stableThresholdPoints,
            minimumPoints: trendOptions.minimumPoints,
            partial,
            limited,
            averageRunComparison: averageRun ? publicAverageRunComparison(averageRun) : null
        };

        return finalizeResult({
            trendSchemaVersion: TREND_SCHEMA_VERSION,
            generatedAt: aggregateResult.generatedAt,
            metric: CANONICAL_METRIC,
            granularity: trendOptions.granularity,
            query: { ...aggregateResult.query, ...trendOptions },
            source,
            pointCount: points.length,
            analyzablePointCount: canonical.candidates.length,
            series: points,
            summary,
            warnings
        });
    }
}

PassRateTrendAnalyzer.TREND_SCHEMA_VERSION = TREND_SCHEMA_VERSION;
PassRateTrendAnalyzer.WARNING_CODES = WARNING_CODES;

module.exports = PassRateTrendAnalyzer;
module.exports.PassRateTrendAnalyzer = PassRateTrendAnalyzer;
