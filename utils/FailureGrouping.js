const { computeFailureSignature } = require('./FailureClassifier');

function groupFailures(executionData) {
    if (!Array.isArray(executionData) || !executionData.length) {
        return [];
    }

    const groups = {};

    for (const tc of executionData) {
        const status = String(tc.status || '').toUpperCase();
        if (!['FAILED', 'FAILED:', 'FAIL', 'TIMEDOUT', 'INTERRUPTED'].includes(status)) {
            continue;
        }

        const category = tc.failureCategory || 'UNKNOWN_FAILURE';
        const errorMessage = tc.errorMessage || '';
        const { signature } = computeFailureSignature(errorMessage, category);

        const key = `${category}:${signature}`;

        if (!groups[key]) {
            groups[key] = {
                category,
                signature,
                occurrences: 0,
                testCases: []
            };
        }

        groups[key].occurrences++;
        groups[key].testCases.push(tc.testCase);
    }

    return Object.values(groups).sort((a, b) => {
        if (b.occurrences !== a.occurrences) {
            return b.occurrences - a.occurrences;
        }
        if (a.category !== b.category) {
            return a.category.localeCompare(b.category);
        }
        return a.signature.localeCompare(b.signature);
    });
}

module.exports = { groupFailures };
