const { FAILURE_CATEGORIES } = require('./FailureClassifier');

const ROOT_CAUSES = {
    AUTH_FLOW_REGRESSION: 'Authentication Flow Regression',
    UI_REGRESSION: 'UI Regression',
    API_REGRESSION: 'API Regression',
    TIMEOUT_REGRESSION: 'Timeout Regression',
    CONFIGURATION_REGRESSION: 'Configuration Regression',
    UNKNOWN_ROOT_CAUSE: 'Unknown Root Cause'
};

const ROOT_CAUSE_LABELS = Object.fromEntries(
    Object.entries(ROOT_CAUSES).map(([key, val]) => [key, val])
);

const AUTH_KEYWORDS = [
    /login/i, /authentication/i, /auth/i, /session/i,
    /401/i, /403/i, /logout/i, /password/i, /credential/i,
    /unauthorized/i, /forbidden/i, /token/i
];

function isFailed(status) {
    const s = String(status || '').toUpperCase();
    return ['FAILED', 'FAILED:', 'FAIL', 'TIMEDOUT', 'INTERRUPTED'].includes(s);
}

function extractErrorType(errorMessage) {
    if (!errorMessage || typeof errorMessage !== 'string') return 'UnknownError';

    const cleaned = errorMessage.trim();

    if (/expect\s*\(/i.test(cleaned)) return 'AssertionError';
    if (/timeout/i.test(cleaned) && /ms exceeded/i.test(cleaned)) return 'TimeoutError';
    if (/strict mode violation/i.test(cleaned)) return 'StrictModeViolation';
    if (/net::ERR_/i.test(cleaned)) return 'NetworkError';
    if (/ECONNREFUSED/i.test(cleaned)) return 'ConnectionRefused';
    if (/socket hang up/i.test(cleaned)) return 'SocketHangUp';
    if (/fetch failed/i.test(cleaned)) return 'FetchFailed';
    if (/api.*fail/i.test(cleaned) || /api.*error/i.test(cleaned)) return 'APIError';
    if (/status.*is\s+\d{3}/i.test(cleaned)) return 'StatusError';
    if (/browserType\.launch/i.test(cleaned)) return 'BrowserLaunchError';
    if (/executable.*does.*not.*exist/i.test(cleaned)) return 'ExecutableNotFound';
    if (/context.*already.*closed/i.test(cleaned)) return 'ContextClosedError';
    if (/page\.locator/i.test(cleaned) || /waiting for locator/i.test(cleaned)) return 'LocatorError';
    if (/element.*not.*found/i.test(cleaned) || /no element/i.test(cleaned)) return 'ElementNotFound';
    if (/element.*not.*visible/i.test(cleaned)) return 'ElementNotVisible';
    if (/getByRole/i.test(cleaned) || /getByText/i.test(cleaned)) return 'LocatorError';

    return 'UnknownError';
}

function extractStackOrigin(errorMessage) {
    if (!errorMessage || typeof errorMessage !== 'string') return null;

    const atMatch = errorMessage.match(/\bat\s+(?:.+?\s+)?\(?([A-Za-z0-9_\\/.-]+\.(?:js|ts|jsx|tsx|mjs|cjs))\b/i);
    if (atMatch) return atMatch[1].replace(/^.*[/\\]/, '');

    const fileMatch = errorMessage.match(/([A-Za-z0-9_]+\.(?:js|ts|jsx|tsx))\s*:\s*\d+/i);
    if (fileMatch) return fileMatch[1];

    return null;
}

function hasAuthKeywords(errorMessage) {
    if (!errorMessage || typeof errorMessage !== 'string') return false;
    return AUTH_KEYWORDS.some(kw => kw.test(errorMessage));
}

function determineRootCause(category, errorMessages, signatures) {
    const allMessages = errorMessages.join('\n');

    if (hasAuthKeywords(allMessages)) return 'AUTH_FLOW_REGRESSION';

    const dominantSig = signatures[0] || '';

    if (category === FAILURE_CATEGORIES.LOCATOR_FAILURE) return 'UI_REGRESSION';
    if (category === FAILURE_CATEGORIES.API_FAILURE) return 'API_REGRESSION';
    if (category === FAILURE_CATEGORIES.NETWORK_FAILURE) return 'API_REGRESSION';

    if (category === FAILURE_CATEGORIES.TIMEOUT_FAILURE) return 'TIMEOUT_REGRESSION';
    if (category === FAILURE_CATEGORIES.CONFIGURATION_FAILURE) return 'CONFIGURATION_REGRESSION';
    if (category === FAILURE_CATEGORIES.ASSERTION_FAILURE) {
        if (/url/i.test(dominantSig) || /toHaveURL/i.test(allMessages)) return 'AUTH_FLOW_REGRESSION';
        return 'UNKNOWN_ROOT_CAUSE';
    }

    return 'UNKNOWN_ROOT_CAUSE';
}

function computeRecommendation(rootCause) {
    const recs = {
        AUTH_FLOW_REGRESSION: 'Review authentication flow, session handling, and login credentials. Check for recent changes to auth logic or token expiration.',
        UI_REGRESSION: 'Inspect UI changes, selector updates, and DOM structure. Verify locators match current page markup.',
        API_REGRESSION: 'Review API contracts, endpoint availability, and response status codes. Check for service outages or version mismatches.',
        TIMEOUT_REGRESSION: 'Investigate performance regressions, slow page loads, and network latency. Consider increasing timeouts or optimising slow operations.',
        CONFIGURATION_REGRESSION: 'Check browser configuration, environment variables, and test dependencies. Verify setup scripts and test data fixtures.',
        UNKNOWN_ROOT_CAUSE: 'Review individual failure details and error messages. Consider adding classification rules for unrecognised patterns.'
    };
    return recs[rootCause] || recs.UNKNOWN_ROOT_CAUSE;
}

function parseFailureMessages(executionData, failureGroups) {
    if (!Array.isArray(failureGroups) || !failureGroups.length) return new Map();

    const groupMessages = new Map();

    for (const group of failureGroups) {
        const key = `${group.category}:${group.signature}`;
        const testCases = group.testCases || [];
        const messages = [];
        const features = new Set();
        const stackOrigins = new Set();
        const errorTypes = new Set();
        const allSignatures = new Set();

        allSignatures.add(group.signature);

        for (const tcName of testCases) {
            const tc = (executionData || []).find(e => e.testCase === tcName);
            if (!tc) continue;

            if (tc.errorMessage) messages.push(tc.errorMessage);
            if (tc.feature) features.add(tc.feature);

            const origin = extractStackOrigin(tc.errorMessage);
            if (origin) stackOrigins.add(origin);

            const errType = extractErrorType(tc.errorMessage);
            errorTypes.add(errType);
        }

        groupMessages.set(key, {
            category: group.category,
            signature: group.signature,
            occurrences: group.occurrences,
            testCases: testCases,
            features: Array.from(features),
            stackOrigins: Array.from(stackOrigins),
            errorTypes: Array.from(errorTypes),
            messages,
            signatures: Array.from(allSignatures)
        });
    }

    return groupMessages;
}

function computeConfidence(cluster) {
    let score = 0;

    const uniqueSignatures = new Set(cluster.signatures);
    if (uniqueSignatures.size === 1) score += 40;

    if (cluster.features.length === 1 && cluster.occurrences > 1) score += 20;

    const hasCommonStack = cluster.stackOrigins.length === 1 && cluster.occurrences > 1;
    if (hasCommonStack) score += 20;

    const uniqueErrorTypes = new Set(cluster.errorTypes);
    if (uniqueErrorTypes.size === 1 && cluster.occurrences > 1) score += 10;

    const categories = new Set(cluster.sourceCategories || [cluster.category]);
    if (categories.size > 1) score += 10;

    return Math.min(score, 100);
}

function computeConfidenceLabel(score) {
    if (score >= 80) return 'HIGH';
    if (score >= 50) return 'MEDIUM';
    return 'LOW';
}

function mergeGroupsIntoClusters(parsedGroups, executionData) {
    if (!parsedGroups.size) return [];

    const groups = Array.from(parsedGroups.values());
    const clusters = [];
    const used = new Set();

    for (let i = 0; i < groups.length; i++) {
        if (used.has(i)) continue;
        used.add(i);

        const cluster = {
            sourceKeys: [Object.keys(Object.fromEntries(parsedGroups))[i]],
            category: groups[i].category,
            signatures: [groups[i].signature],
            occurrences: groups[i].occurrences,
            testCases: [...groups[i].testCases],
            features: [...groups[i].features],
            stackOrigins: [...groups[i].stackOrigins],
            errorTypes: [...groups[i].errorTypes],
            messages: [...groups[i].messages],
            sourceCategories: [groups[i].category]
        };

        for (let j = i + 1; j < groups.length; j++) {
            if (used.has(j)) continue;

            const ga = groups[i];
            const gb = groups[j];

            const hasCommonFeature = ga.features.some(f => gb.features.includes(f));
            if (!hasCommonFeature) continue;

            const hasCommonStack = ga.stackOrigins.some(s => gb.stackOrigins.includes(s));
            const hasCommonErrorType = ga.errorTypes.some(e => gb.errorTypes.includes(e));
            const isCrossCategory = ga.category !== gb.category;

            if (hasCommonStack || hasCommonErrorType || isCrossCategory) {
                used.add(j);
                cluster.occurrences += gb.occurrences;
                cluster.testCases = cluster.testCases.concat(gb.testCases);
                cluster.features = Array.from(new Set(cluster.features.concat(gb.features)));
                cluster.stackOrigins = Array.from(new Set(cluster.stackOrigins.concat(gb.stackOrigins)));
                cluster.errorTypes = Array.from(new Set(cluster.errorTypes.concat(gb.errorTypes)));
                cluster.messages = cluster.messages.concat(gb.messages);
                cluster.signatures = Array.from(new Set(cluster.signatures.concat(gb.signatures)));
                cluster.sourceCategories = Array.from(new Set(cluster.sourceCategories.concat(gb.category)));
                cluster.sourceKeys.push(Object.keys(Object.fromEntries(parsedGroups))[j]);

                if (ga.occurrences >= gb.occurrences) {
                    cluster.category = ga.category;
                } else {
                    cluster.category = gb.category;
                }
            }
        }

        const allMessages = cluster.messages;
        const rootCause = determineRootCause(cluster.category, allMessages, cluster.signatures);
        const confidence = computeConfidence(cluster);
        const totalFailed = (executionData || []).filter(tc => isFailed(tc.status)).length;

        clusters.push({
            id: `RC-${String(clusters.length + 1).padStart(3, '0')}`,
            rootCause,
            label: ROOT_CAUSE_LABELS[rootCause] || 'Unknown Root Cause',
            confidence,
            confidenceLabel: computeConfidenceLabel(confidence),
            category: cluster.category,
            occurrences: cluster.occurrences,
            percentage: totalFailed ? parseFloat(((cluster.occurrences / totalFailed) * 100).toFixed(2)) : 0,
            affectedTests: cluster.testCases,
            affectedSuites: cluster.features,
            evidence: buildEvidence(cluster),
            signatures: cluster.signatures,
            recommendation: computeRecommendation(rootCause)
        });
    }

    return clusters.sort((a, b) => b.confidence - a.confidence);
}

function buildEvidence(cluster) {
    const evidence = [];

    const sigCounts = {};
    for (const sig of cluster.signatures) {
        sigCounts[sig] = (sigCounts[sig] || 0) + 1;
    }

    for (const [sig, count] of Object.entries(sigCounts)) {
        evidence.push(`${count} ${sig} occurrence${count !== 1 ? 's' : ''}`);
    }

    if (cluster.stackOrigins.length && cluster.stackOrigins[0] !== 'UnknownFile') {
        evidence.push(`Common stack origin: ${cluster.stackOrigins[0]}`);
    }

    if (cluster.features.length) {
        evidence.push(`Affected suites: ${cluster.features.join(', ')}`);
    }

    return evidence;
}

function clusterRootCauses(executionData, failureGroups) {
    const execData = Array.isArray(executionData) ? executionData : [];
    const groups = Array.isArray(failureGroups) ? failureGroups : [];

    const parsedGroups = parseFailureMessages(execData, groups);
    const rootCauses = mergeGroupsIntoClusters(parsedGroups, execData);

    const totalFailed = execData.filter(tc => isFailed(tc.status)).length;
    const clusteredFailures = rootCauses.reduce((sum, rc) => sum + rc.occurrences, 0);

    return {
        rootCauses,
        totalClusters: rootCauses.length,
        totalFailuresClustered: clusteredFailures,
        coverage: totalFailed ? parseFloat(((clusteredFailures / totalFailed) * 100).toFixed(2)) : 100,
        unclusteredCount: totalFailed - clusteredFailures
    };
}

module.exports = { clusterRootCauses, ROOT_CAUSES };
