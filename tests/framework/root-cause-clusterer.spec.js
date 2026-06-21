const { test, expect } = require('@playwright/test');
const { clusterRootCauses, ROOT_CAUSES } = require('../../utils/RootCauseClusterer');

function makeTC(testCase, status, failureCategory, signature, feature, errorMessage) {
    return { testCase, status, failureCategory, signature, feature, errorMessage };
}

function makeFG(category, signature, occurrences, testCases) {
    return { category, signature, occurrences, testCases };
}

const PASSED = 'PASSED';
const FAILED = 'FAILED';

test.describe('clusterRootCauses', () => {
    test.describe('basic clustering', () => {
        test('single root cause across signatures', () => {
            const data = [
                makeTC('TC001', FAILED, 'ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 'Login', 'expect(page).toHaveURL(expected) failed'),
                makeTC('TC002', FAILED, 'ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 'Login', 'expect(page).toHaveURL(expected) failed'),
                makeTC('TC003', FAILED, 'LOCATOR_FAILURE', 'LOCATOR_NOT_FOUND', 'Login', 'element not found on login page')
            ];
            const fgs = [
                makeFG('ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 2, ['TC001', 'TC002']),
                makeFG('LOCATOR_FAILURE', 'LOCATOR_NOT_FOUND', 1, ['TC003'])
            ];

            const result = clusterRootCauses(data, fgs);
            expect(result.totalClusters).toBe(1);
            expect(result.rootCauses[0].occurrences).toBe(3);
            expect(result.rootCauses[0].affectedTests).toContain('TC001');
            expect(result.rootCauses[0].affectedTests).toContain('TC003');
            expect(result.rootCauses[0].category).toBe('ASSERTION_FAILURE');
        });

        test('multiple independent root causes', () => {
            const data = [
                makeTC('TC001', FAILED, 'ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 'Login', 'expect(page).toHaveURL failed'),
                makeTC('TC002', FAILED, 'ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 'Login', 'expect(page).toHaveURL failed'),
                makeTC('TC003', FAILED, 'API_FAILURE', 'API_STATUS_5XX', 'Checkout', 'API call failed status 500')
            ];
            const fgs = [
                makeFG('ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 2, ['TC001', 'TC002']),
                makeFG('API_FAILURE', 'API_STATUS_5XX', 1, ['TC003'])
            ];

            const result = clusterRootCauses(data, fgs);
            expect(result.totalClusters).toBe(2);
        });

        test('no root causes when no failures', () => {
            const data = [
                makeTC('TC001', PASSED, null, null, 'Login', null),
                makeTC('TC002', PASSED, null, null, 'Login', null)
            ];
            const result = clusterRootCauses(data, []);
            expect(result.rootCauses).toHaveLength(0);
            expect(result.totalClusters).toBe(0);
        });

        test('single failure produces one cluster', () => {
            const data = [
                makeTC('TC001', FAILED, 'TIMEOUT_FAILURE', 'TIMEOUT', 'Checkout', 'Timeout 5000ms exceeded')
            ];
            const fgs = [
                makeFG('TIMEOUT_FAILURE', 'TIMEOUT', 1, ['TC001'])
            ];

            const result = clusterRootCauses(data, fgs);
            expect(result.totalClusters).toBe(1);
            expect(result.rootCauses[0].occurrences).toBe(1);
            expect(result.rootCauses[0].affectedTests).toEqual(['TC001']);
        });
    });

    test.describe('confidence scoring', () => {
        test('high confidence cluster (same sig + same feature + same stack)', () => {
            const data = [
                makeTC('TC001', FAILED, 'ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 'Login',
                    "expect(page).toHaveURL failed\n    at LoginPage.verify (LoginPage.js:35:14)"),
                makeTC('TC002', FAILED, 'ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 'Login',
                    "expect(page).toHaveURL failed\n    at LoginPage.verify (LoginPage.js:35:14)")
            ];
            const fgs = [
                makeFG('ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 2, ['TC001', 'TC002'])
            ];

            const result = clusterRootCauses(data, fgs);
            expect(result.rootCauses[0].confidence).toBeGreaterThanOrEqual(80);
            expect(result.rootCauses[0].confidenceLabel).toBe('HIGH');
        });

        test('medium confidence cluster (same feature, diff sigs, same stack)', () => {
            const data = [
                makeTC('TC001', FAILED, 'ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 'Login',
                    "expect(page).toHaveURL failed\n    at LoginPage.verify (LoginPage.js:35:14)"),
                makeTC('TC002', FAILED, 'LOCATOR_FAILURE', 'LOCATOR_NOT_FOUND', 'Login',
                    "element not found\n    at LoginPage.verify (LoginPage.js:35:14)")
            ];
            const fgs = [
                makeFG('ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 1, ['TC001']),
                makeFG('LOCATOR_FAILURE', 'LOCATOR_NOT_FOUND', 1, ['TC002'])
            ];

            const result = clusterRootCauses(data, fgs);
            expect(result.rootCauses[0].confidence).toBeGreaterThanOrEqual(50);
            expect(result.rootCauses[0].confidence).toBeLessThan(80);
            expect(result.rootCauses[0].confidenceLabel).toBe('MEDIUM');
        });

        test('stack trace boosts confidence vs no stack', () => {
            const dataWithStack = [
                makeTC('TC001', FAILED, 'ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 'Login',
                    "expect(page).toHaveURL failed\n    at LoginPage.verify (LoginPage.js:35:14)"),
                makeTC('TC002', FAILED, 'ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 'Login',
                    "expect(page).toHaveURL failed\n    at LoginPage.verify (LoginPage.js:35:14)")
            ];
            const dataNoStack = [
                makeTC('TC001', FAILED, 'ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 'Login', 'expect(page).toHaveURL failed'),
                makeTC('TC002', FAILED, 'ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 'Login', 'expect(page).toHaveURL failed')
            ];
            const fgs = [
                makeFG('ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 2, ['TC001', 'TC002'])
            ];

            const withStack = clusterRootCauses(dataWithStack, fgs);
            const noStack = clusterRootCauses(dataNoStack, fgs);
            expect(withStack.rootCauses[0].confidence).toBeGreaterThan(noStack.rootCauses[0].confidence);
        });

        test('no stack trace still works', () => {
            const data = [
                makeTC('TC001', FAILED, 'ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 'Login', 'expect(page).toHaveURL failed'),
                makeTC('TC002', FAILED, 'ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 'Login', 'expect(page).toHaveURL failed')
            ];
            const fgs = [
                makeFG('ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 2, ['TC001', 'TC002'])
            ];

            const result = clusterRootCauses(data, fgs);
            expect(result.rootCauses[0].affectedTests).toContain('TC001');
            expect(result.rootCauses[0].affectedTests).toContain('TC002');
            expect(result.rootCauses[0].evidence.length).toBeGreaterThan(0);
        });
    });

    test.describe('root cause classification', () => {
        test('auth keywords map to AUTH_FLOW_REGRESSION', () => {
            const data = [
                makeTC('TC001', FAILED, 'ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 'Login',
                    'expect(page).toHaveURL failed - login authentication error')
            ];
            const fgs = [
                makeFG('ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 1, ['TC001'])
            ];

            const result = clusterRootCauses(data, fgs);
            expect(result.rootCauses[0].rootCause).toBe('AUTH_FLOW_REGRESSION');
            expect(result.rootCauses[0].label).toBe('Authentication Flow Regression');
        });

        test('LOCATOR_FAILURE maps to UI_REGRESSION', () => {
            const data = [
                makeTC('TC001', FAILED, 'LOCATOR_FAILURE', 'ELEMENT_NOT_FOUND', 'Login', 'element not found')
            ];
            const fgs = [
                makeFG('LOCATOR_FAILURE', 'ELEMENT_NOT_FOUND', 1, ['TC001'])
            ];

            const result = clusterRootCauses(data, fgs);
            expect(result.rootCauses[0].rootCause).toBe('UI_REGRESSION');
        });

        test('API_FAILURE maps to API_REGRESSION', () => {
            const data = [
                makeTC('TC001', FAILED, 'API_FAILURE', 'API_STATUS_5XX', 'Checkout', 'API call failed status 500')
            ];
            const fgs = [
                makeFG('API_FAILURE', 'API_STATUS_5XX', 1, ['TC001'])
            ];

            const result = clusterRootCauses(data, fgs);
            expect(result.rootCauses[0].rootCause).toBe('API_REGRESSION');
            expect(result.rootCauses[0].label).toBe('API Regression');
        });

        test('TIMEOUT_FAILURE maps to TIMEOUT_REGRESSION', () => {
            const data = [
                makeTC('TC001', FAILED, 'TIMEOUT_FAILURE', 'TIMEOUT', 'Cart', 'Timeout 5000ms exceeded')
            ];
            const fgs = [
                makeFG('TIMEOUT_FAILURE', 'TIMEOUT', 1, ['TC001'])
            ];

            const result = clusterRootCauses(data, fgs);
            expect(result.rootCauses[0].rootCause).toBe('TIMEOUT_REGRESSION');
        });

        test('CONFIGURATION_FAILURE maps to CONFIGURATION_REGRESSION', () => {
            const data = [
                makeTC('TC001', FAILED, 'CONFIGURATION_FAILURE', 'CONFIG_BROWSER_LAUNCH', 'Setup', 'browserType.launch failed')
            ];
            const fgs = [
                makeFG('CONFIGURATION_FAILURE', 'CONFIG_BROWSER_LAUNCH', 1, ['TC001'])
            ];

            const result = clusterRootCauses(data, fgs);
            expect(result.rootCauses[0].rootCause).toBe('CONFIGURATION_REGRESSION');
        });
    });

    test.describe('cross-category merging', () => {
        test('should merge across different categories in same feature', () => {
            const data = [
                makeTC('TC001', FAILED, 'ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 'Login', 'expect(page).toHaveURL failed on login'),
                makeTC('TC002', FAILED, 'LOCATOR_FAILURE', 'LOCATOR_NOT_FOUND', 'Login', 'element not found on login page'),
                makeTC('TC003', FAILED, 'LOCATOR_FAILURE', 'LOCATOR_NOT_FOUND', 'Login', 'element not found on login page')
            ];
            const fgs = [
                makeFG('ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 1, ['TC001']),
                makeFG('LOCATOR_FAILURE', 'LOCATOR_NOT_FOUND', 2, ['TC002', 'TC003'])
            ];

            const result = clusterRootCauses(data, fgs);
            expect(result.totalClusters).toBe(1);
            expect(result.rootCauses[0].occurrences).toBe(3);
            expect(result.rootCauses[0].signatures).toContain('EXPECT_TO_HAVE_URL');
            expect(result.rootCauses[0].signatures).toContain('LOCATOR_NOT_FOUND');
        });

        test('different features do not merge', () => {
            const data = [
                makeTC('TC001', FAILED, 'ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 'Login', 'expect failed'),
                makeTC('TC002', FAILED, 'TIMEOUT_FAILURE', 'TIMEOUT', 'Checkout', 'Timeout exceeded')
            ];
            const fgs = [
                makeFG('ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 1, ['TC001']),
                makeFG('TIMEOUT_FAILURE', 'TIMEOUT', 1, ['TC002'])
            ];

            const result = clusterRootCauses(data, fgs);
            expect(result.totalClusters).toBe(2);
        });
    });

    test.describe('coverage and unclustered', () => {
        test('coverage calculation', () => {
            const data = [
                makeTC('TC001', FAILED, 'ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 'Login', 'expect failed'),
                makeTC('TC002', FAILED, 'TIMEOUT_FAILURE', 'TIMEOUT', 'Checkout', 'Timeout'),
                makeTC('TC003', FAILED, 'ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 'Login', 'expect failed')
            ];
            const fgs = [
                makeFG('ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 2, ['TC001', 'TC003']),
                makeFG('TIMEOUT_FAILURE', 'TIMEOUT', 1, ['TC002'])
            ];

            const result = clusterRootCauses(data, fgs);
            expect(result.totalFailuresClustered).toBe(3);
            expect(result.coverage).toBe(100);
            expect(result.unclusteredCount).toBe(0);
        });
    });

    test.describe('recommendations', () => {
        test('recommendation matches root cause', () => {
            const data = [
                makeTC('TC001', FAILED, 'API_FAILURE', 'API_STATUS_5XX', 'Checkout', 'API call failed status 500')
            ];
            const fgs = [
                makeFG('API_FAILURE', 'API_STATUS_5XX', 1, ['TC001'])
            ];

            const result = clusterRootCauses(data, fgs);
            expect(result.rootCauses[0].recommendation).toContain('API');
        });

        test('unknown root cause gets fallback recommendation', () => {
            const data = [
                makeTC('TC001', FAILED, 'UNKNOWN_FAILURE', 'UNKNOWN', 'Misc', 'weird error')
            ];
            const fgs = [
                makeFG('UNKNOWN_FAILURE', 'UNKNOWN', 1, ['TC001'])
            ];

            const result = clusterRootCauses(data, fgs);
            expect(result.rootCauses[0].recommendation).toBeTruthy();
        });
    });

    test.describe('edge cases', () => {
        test('empty execution data', () => {
            const result = clusterRootCauses([], []);
            expect(result.rootCauses).toHaveLength(0);
            expect(result.totalClusters).toBe(0);
        });

        test('null execution data', () => {
            const result = clusterRootCauses(null, null);
            expect(result.rootCauses).toHaveLength(0);
            expect(result.totalClusters).toBe(0);
        });

        test('missing errorMessage still clusters by feature', () => {
            const data = [
                makeTC('TC001', FAILED, 'ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 'Login', null),
                makeTC('TC002', FAILED, 'ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 'Login', null)
            ];
            const fgs = [
                makeFG('ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 2, ['TC001', 'TC002'])
            ];

            const result = clusterRootCauses(data, fgs);
            expect(result.totalClusters).toBe(1);
            expect(result.rootCauses[0].occurrences).toBe(2);
        });

        test('evidence array populated', () => {
            const data = [
                makeTC('TC001', FAILED, 'ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 'Login', 'expect(page).toHaveURL failed')
            ];
            const fgs = [
                makeFG('ASSERTION_FAILURE', 'EXPECT_TO_HAVE_URL', 1, ['TC001'])
            ];

            const result = clusterRootCauses(data, fgs);
            expect(result.rootCauses[0].evidence.length).toBeGreaterThan(0);
            expect(result.rootCauses[0].evidence[0]).toContain('EXPECT_TO_HAVE_URL');
        });
    });
});
