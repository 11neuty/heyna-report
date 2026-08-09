const { createRecurrenceKey } = require('./FailureIdentity');
const { validateFailureIndex } = require('./HistoricalFailureValidation');
const {
    FAILURE_HISTORY_SCHEMA_VERSION,
    SUPPORTED_FAILURE_HISTORY_SCHEMA_VERSIONS,
    FAILURE_TREND_SCHEMA_VERSION,
    canonicalizeWarning,
    cloneJsonValue,
    compareCodePoints,
    dependencyError,
    finalizeResult,
    isPlainObject,
    normalizeAnalyzerOptions,
    parseDate,
    roundPercent,
    safeAdd,
    sourceContractError,
    warning
} = require('./FailureTrendValidation');
const { ATTEMPT_HISTORY_NOT_PERSISTED } = require('./FlakyAttemptHistory');

const SOURCE_FIELDS = Object.freeze([
    'discoveredRunCount', 'validRunCount', 'excludedRunCount', 'matchedRunCount', 'selectedRunCount',
    'indexedRunCount', 'legacyNormalizedRunCount', 'aggregateOnlyRunCount',
    'malformedFailureIndexRunCount', 'zeroTestRunCount', 'testOutcomeCount', 'failureObservationCount'
]);

const RECURRENCE_OUTCOME_FIELDS = Object.freeze([
    'testKey', 'playwrightTestIdFingerprint', 'project', 'file', 'suitePath', 'title', 'line',
    'repeatEachIndex', 'retryCount', 'status', 'traceAvailable', 'identityQuality', 'failure'
]);

function validateFlakyClassification(value, context) {
    if (!isPlainObject(value)) throw sourceContractError(`${context} must be a plain object.`);
    const keys = Reflect.ownKeys(value).sort(compareCodePoints);
    const expected = ['flaky', 'flakyEligibility', 'reasonCode'];
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
        throw sourceContractError(`${context} contains unsupported fields.`);
    }
    if (value.flakyEligibility === 'known') {
        if (typeof value.flaky !== 'boolean' || value.reasonCode !== null) {
            throw sourceContractError(`${context} known classification is inconsistent.`);
        }
    } else if (value.flakyEligibility === 'unknown') {
        if (value.flaky !== null || value.reasonCode !== ATTEMPT_HISTORY_NOT_PERSISTED) {
            throw sourceContractError(`${context} unknown classification is inconsistent.`);
        }
    } else {
        throw sourceContractError(`${context}.flakyEligibility is unsupported.`);
    }
}

function projectRecurrenceOutcome(outcome, schemaVersion, context) {
    if (!isPlainObject(outcome)) throw sourceContractError(`${context} must be a plain object.`);
    const expected = schemaVersion === '1.1.0'
        ? [...RECURRENCE_OUTCOME_FIELDS, 'flakyClassification']
        : [...RECURRENCE_OUTCOME_FIELDS];
    const keys = Reflect.ownKeys(outcome).sort(compareCodePoints);
    const sortedExpected = expected.sort(compareCodePoints);
    if (keys.length !== sortedExpected.length || keys.some((key, index) => key !== sortedExpected[index])) {
        throw sourceContractError(`${context} contains unsupported fields.`);
    }
    if (schemaVersion === '1.1.0') validateFlakyClassification(outcome.flakyClassification, `${context}.flakyClassification`);
    return Object.fromEntries(RECURRENCE_OUTCOME_FIELDS.map(field => [field, outcome[field]]));
}

function validateReaderResult(value) {
    const result = cloneJsonValue(value, 'HistoricalFailureReader result');
    if (!isPlainObject(result) || !SUPPORTED_FAILURE_HISTORY_SCHEMA_VERSIONS.includes(result.failureHistorySchemaVersion)) {
        throw sourceContractError(`failureHistorySchemaVersion must be a supported version through ${FAILURE_HISTORY_SCHEMA_VERSION}.`);
    }
    parseDate(result.generatedAt, 'generatedAt', sourceContractError);
    if (!isPlainObject(result.query) || !isPlainObject(result.source)) throw sourceContractError('reader result must provide plain query and source objects.');
    SOURCE_FIELDS.forEach(field => {
        if (!Number.isSafeInteger(result.source[field]) || result.source[field] < 0 || Object.is(result.source[field], -0)) {
            throw sourceContractError(`source.${field} must be a safe non-negative integer.`);
        }
    });
    if (result.source.discoveredRunCount !== safeAdd(result.source.validRunCount, result.source.excludedRunCount, 'source run counts')) {
        throw sourceContractError('source discovered count is inconsistent.');
    }
    if (result.source.selectedRunCount > result.source.matchedRunCount || result.source.matchedRunCount > result.source.validRunCount) {
        throw sourceContractError('source selected/matched counts are inconsistent.');
    }
    if (typeof result.partial !== 'boolean' || typeof result.limited !== 'boolean' || typeof result.retentionBounded !== 'boolean') {
        throw sourceContractError('reader partial, limited, and retentionBounded fields must be boolean.');
    }
    if (!Array.isArray(result.runs) || result.runs.length !== result.source.selectedRunCount) {
        throw sourceContractError('runs length must equal source.selectedRunCount.');
    }
    if (!Array.isArray(result.warnings)) throw sourceContractError('warnings must be an array.');
    result.warnings = result.warnings.map((item, index) => canonicalizeWarning(item, `warnings[${index}]`));

    const seen = new Set();
    let indexedRunCount = 0;
    let legacyNormalizedRunCount = 0;
    let aggregateOnlyRunCount = 0;
    let malformedFailureIndexRunCount = 0;
    let zeroTestRunCount = 0;
    let testOutcomeCount = 0;
    let failureObservationCount = 0;
    let previous = null;
    result.runs.forEach((run, index) => {
        if (!isPlainObject(run) || typeof run.runId !== 'string' || !run.runId || seen.has(run.runId)) {
            throw sourceContractError(`runs[${index}] has an invalid or duplicate runId.`);
        }
        seen.add(run.runId);
        const timestamp = parseDate(run.timestamp, `runs[${index}].timestamp`, sourceContractError).epoch;
        if (previous && (timestamp < previous.timestamp || (timestamp === previous.timestamp && compareCodePoints(run.runId, previous.runId) < 0))) {
            throw sourceContractError('runs must be chronologically ordered.');
        }
        previous = { timestamp, runId: run.runId };
        for (const field of ['totalTests', 'unsuccessfulTests']) {
            if (!Number.isSafeInteger(run[field]) || run[field] < 0 || Object.is(run[field], -0)) {
                throw sourceContractError(`runs[${index}].${field} must be a safe non-negative integer.`);
            }
        }
        if (run.unsuccessfulTests > run.totalTests || !Array.isArray(run.testOutcomes)) throw sourceContractError(`runs[${index}] is inconsistent.`);
        if (!['indexed', 'legacy-normalized', 'aggregate-only', 'invalid-index'].includes(run.detailStatus)) {
            throw sourceContractError(`runs[${index}].detailStatus is unsupported.`);
        }
        if (run.detailStatus === 'indexed' || run.detailStatus === 'legacy-normalized') {
            const recurrenceOutcomes = run.testOutcomes.map((outcome, outcomeIndex) => projectRecurrenceOutcome(
                outcome,
                result.failureHistorySchemaVersion,
                `runs[${index}].testOutcomes[${outcomeIndex}]`
            ));
            const failureCount = recurrenceOutcomes.filter(item => item && item.failure !== null).length;
            try {
                validateFailureIndex({
                    failureIndexSchemaVersion: '1.0.0',
                    runId: run.runId,
                    timestamp: run.timestamp,
                    counts: { indexedTests: recurrenceOutcomes.length, indexedFailures: failureCount },
                    testOutcomes: recurrenceOutcomes
                }, { expectedRunId: run.runId, expectedTimestamp: run.timestamp });
            } catch (error) {
                throw sourceContractError(`runs[${index}] contains invalid finalized outcomes.`);
            }
            run.testOutcomes = recurrenceOutcomes;
            if (run.testOutcomes.length !== run.totalTests) throw sourceContractError(`runs[${index}] detail count contradicts totalTests.`);
            testOutcomeCount = safeAdd(testOutcomeCount, run.testOutcomes.length, 'reader test outcomes');
            failureObservationCount = safeAdd(failureObservationCount, failureCount, 'reader failure observations');
            if (run.detailStatus === 'indexed') indexedRunCount = safeAdd(indexedRunCount, 1, 'indexed runs');
            else legacyNormalizedRunCount = safeAdd(legacyNormalizedRunCount, 1, 'legacy normalized runs');
        } else {
            if (run.testOutcomes.length) throw sourceContractError(`runs[${index}] without detail must not expose outcomes.`);
            aggregateOnlyRunCount = safeAdd(aggregateOnlyRunCount, 1, 'aggregate-only runs');
            if (run.detailStatus === 'invalid-index') {
                malformedFailureIndexRunCount = safeAdd(malformedFailureIndexRunCount, 1, 'malformed failure indexes');
            }
        }
        if (run.totalTests === 0) zeroTestRunCount = safeAdd(zeroTestRunCount, 1, 'zero-test runs');
    });
    const computed = { indexedRunCount, legacyNormalizedRunCount, aggregateOnlyRunCount, malformedFailureIndexRunCount, zeroTestRunCount, testOutcomeCount, failureObservationCount };
    Object.entries(computed).forEach(([field, expected]) => {
        if (result.source[field] !== expected) throw sourceContractError(`source.${field} contradicts runs.`);
    });
    return result;
}

function rank(left, right) {
    if (right.occurrenceCount !== left.occurrenceCount) return right.occurrenceCount - left.occurrenceCount;
    if (right.affectedRunCount !== left.affectedRunCount) return right.affectedRunCount - left.affectedRunCount;
    if (right.affectedTestCount !== left.affectedTestCount) return right.affectedTestCount - left.affectedTestCount;
    const lastDifference = Date.parse(right.lastSeenTimestamp) - Date.parse(left.lastSeenTimestamp);
    return lastDifference || compareCodePoints(left.key, right.key);
}

function appendCanonicalOccurrence(group, occurrence, operations) {
    const previous = group.occurrences[group.occurrences.length - 1];
    operations.occurrenceOrderChecks += 1;
    if (previous && (occurrence.runPosition < previous.runPosition
        || (occurrence.runPosition === previous.runPosition
            && occurrence.repeatEachIndex <= previous.repeatEachIndex))) {
        throw sourceContractError('failure occurrences must use canonical run and repeatEachIndex order.');
    }
    group.occurrences.push(occurrence);

    for (const [field, value] of [
        ['affectedOpportunityPositions', occurrence.opportunityIndex],
        ['affectedRunPositions', occurrence.runPosition]
    ]) {
        const positions = group[field];
        const last = positions[positions.length - 1];
        operations.positionOrderChecks += 1;
        if (last !== undefined && value < last) throw sourceContractError('failure positions must use canonical order.');
        if (last !== value) positions.push(value);
    }
}

function rangeIsComplete(testState, startOpportunity, endOpportunity, startPosition, endPosition, detailIncompletePrefix, operations) {
    operations.completenessRangeChecks += 1;
    if (startPosition > endPosition) return true;
    const start = testState.eligible[startOpportunity];
    const end = testState.eligible[endOpportunity];
    if (!start || !end || start.runPosition !== startPosition || end.runPosition !== endPosition) return false;
    const runCount = endPosition - startPosition + 1;
    const opportunityCount = endOpportunity - startOpportunity + 1;
    if (opportunityCount !== runCount) return false;
    if (detailIncompletePrefix[endPosition + 1] - detailIncompletePrefix[startPosition] !== 0) return false;
    return testState.incompleteOpportunityPrefix[endOpportunity + 1]
        - testState.incompleteOpportunityPrefix[startOpportunity] === 0;
}

function consecutiveStreaks(testState, affectedOpportunityPositions, affectedRunPositions, active, detailIncompletePrefix, operations) {
    let current = 0;
    let maximum = 0;
    let previousPosition = null;
    let previousOpportunity = null;
    for (let index = 0; index < affectedRunPositions.length; index += 1) {
        operations.streakOccurrenceVisits += 1;
        const position = affectedRunPositions[index];
        const opportunity = affectedOpportunityPositions[index];
        current = previousPosition !== null && position === previousPosition + 1
            && rangeIsComplete(
                testState,
                previousOpportunity,
                opportunity,
                previousPosition,
                position,
                detailIncompletePrefix,
                operations
            )
            ? safeAdd(current, 1, 'consecutive opportunities')
            : 1;
        if (current > maximum) maximum = current;
        previousPosition = position;
        previousOpportunity = opportunity;
    }
    return { current: active ? current : 0, maximum };
}

class FailureTrendAnalyzer {
    constructor(options = {}) {
        if (!isPlainObject(options)) throw dependencyError('FailureTrendAnalyzer options must be a plain object.');
        if (!options.historicalFailureReader || typeof options.historicalFailureReader.read !== 'function') {
            throw dependencyError('historicalFailureReader with read() is required.');
        }
        if (options.operationObserver !== undefined && typeof options.operationObserver !== 'function') {
            throw dependencyError('operationObserver must be a function.');
        }
        this.historicalFailureReader = options.historicalFailureReader;
        this.operationObserver = options.operationObserver || null;
    }

    async analyze(options = {}) {
        const query = normalizeAnalyzerOptions(options);
        const upstream = await this.historicalFailureReader.read({
            from: query.from,
            to: query.to,
            limit: query.limit,
            project: query.project,
            includeMigrated: query.includeMigrated
        });
        const history = validateReaderResult(upstream);
        const testFilter = query.testKey ? new Set(query.testKey) : null;
        const categoryFilter = query.category ? new Set(query.category) : null;
        const projectFilter = query.project ? new Set(query.project) : null;
        const operations = {
            runVisits: 0,
            outcomeVisits: 0,
            occurrenceVisits: 0,
            occurrenceOrderChecks: 0,
            positionOrderChecks: 0,
            completenessPrefixBuildVisits: 0,
            opportunityCompletenessBuildVisits: 0,
            completenessRangeChecks: 0,
            streakOccurrenceVisits: 0,
            groupVisits: 0,
            timelineKeyVisits: 0
        };
        const testStates = new Map();
        const recurrenceGroups = new Map();
        const signatureGroups = new Map();
        const occurrenceDeduplication = new Set();
        const timelineByRunId = new Map();
        const affectedRuns = new Set();
        const affectedTests = new Set();
        const detailIncompletePrefix = [0];
        let occurrenceCount = 0;

        for (let runPosition = 0; runPosition < history.runs.length; runPosition += 1) {
            const run = history.runs[runPosition];
            operations.runVisits += 1;
            operations.completenessPrefixBuildVisits += 1;
            detailIncompletePrefix.push(safeAdd(
                detailIncompletePrefix[detailIncompletePrefix.length - 1],
                ['indexed', 'legacy-normalized'].includes(run.detailStatus) ? 0 : 1,
                'detail completeness prefix'
            ));
            timelineByRunId.set(run.runId, { occurrenceCount: 0, recurrenceKeys: new Set() });
            if (!['indexed', 'legacy-normalized'].includes(run.detailStatus)) continue;
            const byTest = new Map();
            for (const outcome of run.testOutcomes) {
                operations.outcomeVisits += 1;
                if (projectFilter && !projectFilter.has(outcome.project)) continue;
                if (testFilter && !testFilter.has(outcome.testKey)) continue;
                const testScope = `${outcome.project}\0${outcome.testKey}`;
                if (!byTest.has(testScope)) byTest.set(testScope, []);
                byTest.get(testScope).push(outcome);
                if (!testStates.has(testScope)) {
                    testStates.set(testScope, {
                        eligible: [],
                        incompleteOpportunityPrefix: [0],
                        eligibleExecutionCount: 0
                    });
                }
            }
            for (const [testScope, outcomes] of byTest) {
                const testState = testStates.get(testScope);
                const eligibleOutcomes = outcomes.filter(outcome => outcome.status === 'PASSED'
                    || (Boolean(outcome.failure) && ['FAILED', 'TIMEDOUT'].includes(outcome.status)));
                if (!eligibleOutcomes.length) continue;
                const opportunityIndex = testState.eligible.length;
                const complete = eligibleOutcomes.length === outcomes.length;
                testState.eligible.push({ runId: run.runId, timestamp: run.timestamp, runPosition, complete });
                operations.opportunityCompletenessBuildVisits += 1;
                testState.incompleteOpportunityPrefix.push(safeAdd(
                    testState.incompleteOpportunityPrefix[testState.incompleteOpportunityPrefix.length - 1],
                    complete ? 0 : 1,
                    'opportunity completeness prefix'
                ));
                testState.eligibleExecutionCount = safeAdd(
                    testState.eligibleExecutionCount,
                    eligibleOutcomes.length,
                    'eligible test executions'
                );

                for (const outcome of eligibleOutcomes) {
                    if (!outcome.failure || !['FAILED', 'TIMEDOUT'].includes(outcome.status)) continue;
                    if (categoryFilter && !categoryFilter.has(outcome.failure.category)) continue;
                    const dedupeKey = `${run.runId}\0${outcome.project}\0${outcome.testKey}\0${outcome.repeatEachIndex}`;
                    if (occurrenceDeduplication.has(dedupeKey)) throw sourceContractError('reader exposed duplicate finalized failure observations.');
                    occurrenceDeduplication.add(dedupeKey);
                    operations.occurrenceVisits += 1;
                    occurrenceCount = safeAdd(occurrenceCount, 1, 'failure occurrences');
                    affectedRuns.add(run.runId);
                    affectedTests.add(outcome.testKey);
                    const recurrenceKey = createRecurrenceKey(outcome.project, outcome.testKey, outcome.failure.signature);
                    if (!recurrenceGroups.has(recurrenceKey)) {
                        recurrenceGroups.set(recurrenceKey, {
                            key: recurrenceKey,
                            testScope,
                            test: {
                                testKey: outcome.testKey,
                                project: outcome.project,
                                file: outcome.file,
                                suitePath: outcome.suitePath.slice(),
                                title: outcome.title,
                                identityQuality: outcome.identityQuality
                            },
                            failure: {
                                signature: outcome.failure.signature,
                                signatureVersion: '1',
                                category: outcome.failure.category,
                                signatureClass: outcome.failure.signatureClass,
                                errorType: outcome.failure.errorType,
                                signatureQuality: outcome.failure.signatureQuality
                            },
                            occurrences: [],
                            affectedOpportunityPositions: [],
                            affectedRunPositions: []
                        });
                    }
                    appendCanonicalOccurrence(recurrenceGroups.get(recurrenceKey), {
                        runId: run.runId,
                        timestamp: run.timestamp,
                        runPosition,
                        opportunityIndex,
                        testKey: outcome.testKey,
                        project: outcome.project,
                        repeatEachIndex: outcome.repeatEachIndex,
                        retryCount: outcome.retryCount,
                        status: outcome.status,
                        traceAvailable: outcome.traceAvailable
                    }, operations);
                    const timelineEntry = timelineByRunId.get(run.runId);
                    timelineEntry.occurrenceCount = safeAdd(timelineEntry.occurrenceCount, 1, 'timeline occurrences');
                    timelineEntry.recurrenceKeys.add(recurrenceKey);

                    const signature = outcome.failure.signature;
                    if (!signatureGroups.has(signature)) {
                        signatureGroups.set(signature, {
                            key: signature,
                            category: outcome.failure.category,
                            signatureClass: outcome.failure.signatureClass,
                            occurrences: 0,
                            runs: new Set(),
                            tests: new Set(),
                            lastSeenTimestamp: run.timestamp
                        });
                    }
                    const signatureGroup = signatureGroups.get(signature);
                    signatureGroup.occurrences = safeAdd(signatureGroup.occurrences, 1, 'signature occurrences');
                    signatureGroup.runs.add(run.runId);
                    signatureGroup.tests.add(outcome.testKey);
                    signatureGroup.lastSeenTimestamp = run.timestamp;
                }
            }
        }

        const allSpecific = [];
        const unlocatedUnknown = history.source.excludedRunCount > 0 || history.retentionBounded;
        const finalRunPosition = history.runs.length - 1;
        for (const group of recurrenceGroups.values()) {
            operations.groupVisits += 1;
            const testState = testStates.get(group.testScope);
            const affectedOpportunityPositions = group.affectedOpportunityPositions;
            const affectedRunPositions = group.affectedRunPositions;
            const firstSeen = group.occurrences[0];
            const lastSeen = group.occurrences[group.occurrences.length - 1];
            const affectedRunCount = affectedRunPositions.length;
            const eligibleRunCount = testState.eligible.length;
            const eligibleTestExecutionCount = testState.eligibleExecutionCount;
            const firstOpportunity = affectedOpportunityPositions[0];
            const subsequentOpportunityCount = eligibleRunCount - firstOpportunity - 1;
            const repeatedAffected = affectedOpportunityPositions.length - 1;
            const meetsThresholds = group.occurrences.length >= query.minimumOccurrences
                && affectedRunCount >= query.minimumAffectedRuns;
            const knownBetweenOccurrences = !unlocatedUnknown
                && rangeIsComplete(
                    testState,
                    firstSeen.opportunityIndex,
                    lastSeen.opportunityIndex,
                    firstSeen.runPosition,
                    lastSeen.runPosition,
                    detailIncompletePrefix,
                    operations
                );
            const finalOpportunity = testState.eligible.length - 1;
            const knownThroughWindow = !unlocatedUnknown
                && finalRunPosition >= firstSeen.runPosition
                && rangeIsComplete(
                    testState,
                    firstSeen.opportunityIndex,
                    finalOpportunity,
                    firstSeen.runPosition,
                    finalRunPosition,
                    detailIncompletePrefix,
                    operations
                );
            const active = knownThroughWindow && lastSeen.runPosition === finalRunPosition;
            const resolved = meetsThresholds && knownThroughWindow && lastSeen.runPosition < finalRunPosition;
            let pattern = 'single';
            if (group.occurrences.length >= 2) {
                if (!knownBetweenOccurrences) pattern = 'indeterminate';
                else pattern = affectedRunPositions.length < lastSeen.runPosition - firstSeen.runPosition + 1
                    ? 'non-consecutive'
                    : 'consecutive';
            } else if (unlocatedUnknown) pattern = 'indeterminate';
            const state = active ? 'active' : (resolved ? 'resolved' : 'indeterminate');
            const streak = consecutiveStreaks(
                testState,
                affectedOpportunityPositions,
                affectedRunPositions,
                active,
                detailIncompletePrefix,
                operations
            );
            allSpecific.push({
                key: group.key,
                test: group.test,
                failure: group.failure,
                occurrenceCount: group.occurrences.length,
                affectedRunCount,
                affectedTestCount: 1,
                eligibleRunCount,
                eligibleTestExecutionCount,
                firstSeen: { runId: firstSeen.runId, timestamp: firstSeen.timestamp },
                lastSeen: { runId: lastSeen.runId, timestamp: lastSeen.timestamp },
                state,
                pattern,
                reappeared: pattern === 'non-consecutive',
                currentConsecutiveRunCount: streak.current,
                maximumConsecutiveRunCount: streak.maximum,
                frequency: {
                    runFrequencyPercent: roundPercent(affectedRunCount, eligibleRunCount, 'run frequency'),
                    testFrequencyPercent: roundPercent(group.occurrences.length, eligibleTestExecutionCount, 'test frequency'),
                    recurrenceRatePercent: roundPercent(repeatedAffected, subsequentOpportunityCount, 'recurrence rate')
                },
                occurrences: group.occurrences.map(({ runPosition, opportunityIndex, ...occurrence }) => occurrence),
                lastSeenTimestamp: lastSeen.timestamp,
                meetsThresholds
            });
        }
        allSpecific.sort(rank);
        const recurringFailures = allSpecific.filter(group => group.meetsThresholds && (query.includeResolved || group.state !== 'resolved'))
            .map(({ lastSeenTimestamp, meetsThresholds, ...group }) => group);

        const mostCommonFailures = [...signatureGroups.values()].map(group => ({
            key: group.key,
            category: group.category,
            signatureClass: group.signatureClass,
            occurrenceCount: group.occurrences,
            affectedRunCount: group.runs.size,
            affectedTestCount: group.tests.size,
            lastSeen: group.lastSeenTimestamp,
            lastSeenTimestamp: group.lastSeenTimestamp
        })).sort(rank).map((group, index) => ({
            rank: index + 1,
            key: group.key,
            category: group.category,
            signatureClass: group.signatureClass,
            occurrenceCount: group.occurrenceCount,
            affectedRunCount: group.affectedRunCount,
            affectedTestCount: group.affectedTestCount,
            lastSeen: group.lastSeen
        }));

        const recurringKeySet = new Set(recurringFailures.map(group => group.key));
        const timeline = history.runs.map(run => {
            const indexed = timelineByRunId.get(run.runId);
            const keys = [];
            for (const key of indexed.recurrenceKeys) {
                operations.timelineKeyVisits += 1;
                if (recurringKeySet.has(key)) keys.push(key);
            }
            return {
                runId: run.runId,
                timestamp: run.timestamp,
                detailStatus: run.detailStatus,
                totalTests: run.totalTests,
                unsuccessfulTests: run.unsuccessfulTests,
                failureObservationCount: indexed.occurrenceCount,
                recurringFailureKeys: keys
            };
        });

        const activeRecurringFailureCount = recurringFailures.filter(group => group.state === 'active').length;
        const resolvedFailureCount = recurringFailures.filter(group => group.state === 'resolved').length;
        const reappearedFailureCount = recurringFailures.filter(group => group.reappeared).length;
        const warnings = history.warnings.map(item => ({ ...item, details: { ...item.details } }));
        if (occurrenceCount === 0 && history.source.selectedRunCount > 0) warnings.push(warning(
            'HEYNA_FAILURE_HISTORY_NO_MATCHING_RUNS'
        ));
        if (this.operationObserver) this.operationObserver(Object.freeze({ ...operations }));

        return finalizeResult({
            failureTrendSchemaVersion: FAILURE_TREND_SCHEMA_VERSION,
            generatedAt: history.generatedAt,
            query,
            source: { ...history.source },
            summary: {
                uniqueFailureSignatureCount: signatureGroups.size,
                failureGroupCount: recurrenceGroups.size,
                recurringFailureCount: recurringFailures.length,
                activeRecurringFailureCount,
                resolvedFailureCount,
                reappearedFailureCount,
                occurrenceCount,
                affectedRunCount: affectedRuns.size,
                affectedTestCount: affectedTests.size,
                mostCommonFailureKey: mostCommonFailures.length ? mostCommonFailures[0].key : null,
                partial: history.partial,
                limited: history.limited
            },
            recurringFailures,
            mostCommonFailures,
            timeline,
            warnings
        });
    }
}

FailureTrendAnalyzer.FAILURE_TREND_SCHEMA_VERSION = FAILURE_TREND_SCHEMA_VERSION;

module.exports = FailureTrendAnalyzer;
module.exports.FailureTrendAnalyzer = FailureTrendAnalyzer;
