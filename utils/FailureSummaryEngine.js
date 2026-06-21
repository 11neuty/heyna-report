const { FAILURE_CATEGORIES } = require('./FailureClassifier');

const CATEGORY_ORDER = [
    FAILURE_CATEGORIES.ASSERTION_FAILURE,
    FAILURE_CATEGORIES.LOCATOR_FAILURE,
    FAILURE_CATEGORIES.TIMEOUT_FAILURE,
    FAILURE_CATEGORIES.NETWORK_FAILURE,
    FAILURE_CATEGORIES.API_FAILURE,
    FAILURE_CATEGORIES.CONFIGURATION_FAILURE,
    FAILURE_CATEGORIES.UNKNOWN_FAILURE
];

const RECOMMENDATIONS = {
    [FAILURE_CATEGORIES.ASSERTION_FAILURE]: {
        text: 'Review business rules and expected outcomes.',
        details: ['Verify application behaviour matches test assertions.', 'Check for recent changes to expected data or UI state.']
    },
    [FAILURE_CATEGORIES.LOCATOR_FAILURE]: {
        text: 'Review selectors and recent UI changes.',
        details: ['Check for dynamic content, iframes, or shadow DOM changes.', 'Verify locator strategies are resilient to DOM updates.']
    },
    [FAILURE_CATEGORIES.TIMEOUT_FAILURE]: {
        text: 'Review application response times and waiting strategy.',
        details: ['Consider increasing timeouts for slow operations.', 'Add explicit waits for dynamic content.', 'Optimize test performance by reducing unnecessary waits.']
    },
    [FAILURE_CATEGORIES.NETWORK_FAILURE]: {
        text: 'Review environment stability and API availability.',
        details: ['Check network connectivity and server health.', 'Verify API endpoints are reachable from test environment.']
    },
    [FAILURE_CATEGORIES.API_FAILURE]: {
        text: 'Review API contracts, status codes, and endpoint health.',
        details: ['Verify API response handling matches expected status codes.', 'Check for API contract changes or version mismatches.']
    },
    [FAILURE_CATEGORIES.CONFIGURATION_FAILURE]: {
        text: 'Review browser configuration, environment setup, and test dependencies.',
        details: ['Check browser versions and installed dependencies.', 'Verify test data fixtures and environment variables.']
    },
    [FAILURE_CATEGORIES.UNKNOWN_FAILURE]: {
        text: 'Review raw error messages and extend classification rules if patterns emerge.',
        details: ['Update FailureClassifier rules to better categorize these failures.', 'Check for unexpected error types not yet handled.']
    }
};

function isFailed(status) {
    const s = String(status || '').toUpperCase();
    return s === 'FAILED' || s === 'FAILED:' || s === 'FAIL';
}

function computeHealthStatus(total, passRate) {
    if (total === 0) return 'HEALTHY';
    const rate = parseFloat(passRate);
    if (rate >= 95) return 'HEALTHY';
    if (rate >= 80) return 'WARNING';
    return 'CRITICAL';
}

function computeDistribution(executionData) {
    const counts = {};
    let totalFailed = 0;

    for (const tc of executionData) {
        if (!isFailed(tc.status)) continue;
        totalFailed++;
        const cat = tc.failureCategory || FAILURE_CATEGORIES.UNKNOWN_FAILURE;
        counts[cat] = (counts[cat] || 0) + 1;
    }

    const distribution = CATEGORY_ORDER
        .filter(cat => counts[cat] > 0)
        .map(cat => ({
            category: cat,
            count: counts[cat],
            percentage: totalFailed ? parseFloat(((counts[cat] / totalFailed) * 100).toFixed(2)) : 0
        }))
        .sort((a, b) => b.count - a.count);

    return { distribution, totalFailed };
}

function computeTopRecurring(failureGroups) {
    if (!Array.isArray(failureGroups)) return [];

    return failureGroups.slice(0, 5).map(g => ({
        category: g.category,
        signature: g.signature,
        occurrences: g.occurrences
    }));
}

function computeImpactedSuites(executionData) {
    const suites = {};
    let totalFailed = 0;

    for (const tc of executionData) {
        if (!isFailed(tc.status)) continue;
        totalFailed++;
        const suite = tc.feature || 'Uncategorized';
        suites[suite] = (suites[suite] || 0) + 1;
    }

    return Object.entries(suites)
        .map(([suite, count]) => ({
            suite,
            failedCount: count,
            percentage: totalFailed ? parseFloat(((count / totalFailed) * 100).toFixed(2)) : 0
        }))
        .sort((a, b) => b.failedCount - a.failedCount)
        .slice(0, 5);
}

function computeRecommendation(distribution, totalFailed) {
    if (totalFailed === 0) {
        return { text: 'All tests passed. No issues detected.', details: [] };
    }

    if (!distribution.length) {
        return { text: 'All tests passed. No issues detected.', details: [] };
    }

    const dominant = distribution[0];

    if (dominant.percentage >= 40) {
        const rec = RECOMMENDATIONS[dominant.category] || RECOMMENDATIONS[FAILURE_CATEGORIES.UNKNOWN_FAILURE];
        const prefix = `${dominant.category} failures dominate (${dominant.percentage}%).`;
        return {
            text: `${prefix} ${rec.text}`,
            details: rec.details
        };
    }

    return {
        text: 'Multiple failure types detected. Review recurring failures and failure groups first.',
        details: ['No single category exceeds 40% of failures.', 'Prioritise by occurrence count in the Failure Group Summary.']
    };
}

function generateInsights(executionData, metadata, failureGroups) {
    const execData = Array.isArray(executionData) ? executionData : [];
    const meta = metadata || {};
    const groups = Array.isArray(failureGroups) ? failureGroups : [];

    const { distribution, totalFailed } = computeDistribution(execData);
    const topRecurring = computeTopRecurring(groups);
    const impactedSuites = computeImpactedSuites(execData);
    const recommendation = computeRecommendation(distribution, totalFailed);
    const healthStatus = computeHealthStatus(totalFailed, meta.passRate || '100');

    return {
        healthStatus,
        totalFailed,
        hasFailures: totalFailed > 0,
        distribution,
        topRecurring,
        impactedSuites,
        recommendation
    };
}

module.exports = { generateInsights };
