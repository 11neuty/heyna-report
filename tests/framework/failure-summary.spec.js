const { test, expect } = require('@playwright/test');
const { generateInsights } = require('../../utils/FailureSummaryEngine');

const FAILED = 'FAILED';
const PASSED = 'PASSED';
const SKIPPED = 'SKIPPED';

test.describe('generateInsights', () => {
    test.describe('health status', () => {
        test('HEALTHY when pass rate >= 95', () => {
            const data = [
                { testCase: 'TC001', status: PASSED },
                { testCase: 'TC002', status: PASSED },
                { testCase: 'TC003', status: PASSED }
            ];
            const meta = { passRate: '100.00' };
            const result = generateInsights(data, meta, []);
            expect(result.healthStatus).toBe('HEALTHY');
            expect(result.hasFailures).toBe(false);
        });

        test('HEALTHY when no failures', () => {
            const data = [
                { testCase: 'TC001', status: PASSED }
            ];
            const meta = {};
            const result = generateInsights(data, meta, []);
            expect(result.healthStatus).toBe('HEALTHY');
        });

        test('CRITICAL when pass rate < 80', () => {
            const data = [
                { testCase: 'TC001', status: PASSED },
                { testCase: 'TC002', status: PASSED },
                { testCase: 'TC003', status: PASSED },
                { testCase: 'TC004', status: 'FAILED' }
            ];
            const meta = { passRate: '75.00' };
            const result = generateInsights(data, meta, []);
            expect(result.healthStatus).toBe('CRITICAL');
        });

        test('WARNING when pass rate >= 80', () => {
            const data = [
                { testCase: 'TC001', status: PASSED },
                { testCase: 'TC002', status: PASSED },
                { testCase: 'TC003', status: PASSED },
                { testCase: 'TC004', status: 'FAILED' }
            ];
            const meta = { passRate: '85.00' };
            const result = generateInsights(data, meta, []);
            expect(result.healthStatus).toBe('WARNING');
        });

        test('CRITICAL when pass rate well below 80', () => {
            const data = [
                { testCase: 'TC001', status: PASSED },
                { testCase: 'TC002', status: 'FAILED' }
            ];
            const meta = { passRate: '50.00' };
            const result = generateInsights(data, meta, []);
            expect(result.healthStatus).toBe('CRITICAL');
        });

        test('HEALTHY when empty execution data', () => {
            const result = generateInsights([], {}, []);
            expect(result.healthStatus).toBe('HEALTHY');
            expect(result.totalFailed).toBe(0);
            expect(result.hasFailures).toBe(false);
        });
    });

    test.describe('failure distribution', () => {
        test('single category', () => {
            const data = [
                { testCase: 'TC001', status: FAILED, failureCategory: 'ASSERTION_FAILURE' },
                { testCase: 'TC002', status: FAILED, failureCategory: 'ASSERTION_FAILURE' },
                { testCase: 'TC003', status: FAILED, failureCategory: 'ASSERTION_FAILURE' }
            ];
            const meta = { passRate: '0' };
            const result = generateInsights(data, meta, []);
            expect(result.totalFailed).toBe(3);
            expect(result.distribution).toHaveLength(1);
            expect(result.distribution[0].category).toBe('ASSERTION_FAILURE');
            expect(result.distribution[0].count).toBe(3);
            expect(result.distribution[0].percentage).toBe(100);
        });

        test('multiple categories sorted by count descending', () => {
            const data = [
                { testCase: 'TC001', status: FAILED, failureCategory: 'TIMEOUT_FAILURE' },
                { testCase: 'TC002', status: FAILED, failureCategory: 'TIMEOUT_FAILURE' },
                { testCase: 'TC003', status: FAILED, failureCategory: 'ASSERTION_FAILURE' }
            ];
            const meta = { passRate: '0' };
            const result = generateInsights(data, meta, []);
            expect(result.distribution).toHaveLength(2);
            expect(result.distribution[0].category).toBe('TIMEOUT_FAILURE');
            expect(result.distribution[0].count).toBe(2);
            expect(result.distribution[1].category).toBe('ASSERTION_FAILURE');
            expect(result.distribution[1].count).toBe(1);
        });

        test('hides categories with zero count', () => {
            const data = [
                { testCase: 'TC001', status: FAILED, failureCategory: 'NETWORK_FAILURE' }
            ];
            const meta = { passRate: '0' };
            const result = generateInsights(data, meta, []);
            const cats = result.distribution.map(d => d.category);
            expect(cats).toEqual(['NETWORK_FAILURE']);
            expect(cats).not.toContain('ASSERTION_FAILURE');
            expect(cats).not.toContain('LOCATOR_FAILURE');
        });

        test('missing failureCategory defaults to UNKNOWN_FAILURE', () => {
            const data = [
                { testCase: 'TC001', status: FAILED }
            ];
            const meta = { passRate: '0' };
            const result = generateInsights(data, meta, []);
            expect(result.distribution).toHaveLength(1);
            expect(result.distribution[0].category).toBe('UNKNOWN_FAILURE');
        });
    });

    test.describe('top recurring failures', () => {
        test('uses failureGroups top 5', () => {
            const groups = [
                { category: 'ASSERTION_FAILURE', signature: 'EXPECT_TO_HAVE_URL', occurrences: 5 },
                { category: 'TIMEOUT_FAILURE', signature: 'TIMEOUT', occurrences: 3 },
                { category: 'LOCATOR_FAILURE', signature: 'ELEMENT_NOT_FOUND', occurrences: 2 }
            ];
            const result = generateInsights([{ testCase: 'TC1', status: FAILED }], { passRate: '0' }, groups);
            expect(result.topRecurring).toHaveLength(3);
            expect(result.topRecurring[0].signature).toBe('EXPECT_TO_HAVE_URL');
            expect(result.topRecurring[0].occurrences).toBe(5);
        });

        test('limits to top 5', () => {
            const groups = Array.from({ length: 10 }, (_, i) => ({
                category: 'ASSERTION_FAILURE',
                signature: `SIG_${i}`,
                occurrences: 10 - i
            }));
            const result = generateInsights([{ testCase: 'TC1', status: FAILED }], { passRate: '0' }, groups);
            expect(result.topRecurring).toHaveLength(5);
        });

        test('returns empty array when no failureGroups', () => {
            const result = generateInsights([], {}, null);
            expect(result.topRecurring).toEqual([]);
        });
    });

    test.describe('impacted suites', () => {
        test('groups by feature field', () => {
            const data = [
                { testCase: 'TC001', status: FAILED, feature: 'Login' },
                { testCase: 'TC002', status: FAILED, feature: 'Login' },
                { testCase: 'TC003', status: FAILED, feature: 'Checkout' }
            ];
            const meta = { passRate: '0' };
            const result = generateInsights(data, meta, []);
            expect(result.impactedSuites).toHaveLength(2);
            expect(result.impactedSuites[0].suite).toBe('Login');
            expect(result.impactedSuites[0].failedCount).toBe(2);
            expect(result.impactedSuites[1].suite).toBe('Checkout');
            expect(result.impactedSuites[1].failedCount).toBe(1);
        });

        test('fallback to Uncategorized when feature missing', () => {
            const data = [
                { testCase: 'TC001', status: FAILED }
            ];
            const meta = { passRate: '0' };
            const result = generateInsights(data, meta, []);
            expect(result.impactedSuites).toHaveLength(1);
            expect(result.impactedSuites[0].suite).toBe('Uncategorized');
        });

        test('top 5 only', () => {
            const data = Array.from({ length: 10 }, (_, i) => ({
                testCase: `TC${i}`,
                status: FAILED,
                feature: `Suite_${i}`
            }));
            const meta = { passRate: '0' };
            const result = generateInsights(data, meta, []);
            expect(result.impactedSuites.length).toBeLessThanOrEqual(5);
        });
    });

    test.describe('investigation recommendations', () => {
        test('no failures recommendation', () => {
            const data = [
                { testCase: 'TC001', status: PASSED }
            ];
            const result = generateInsights(data, {}, []);
            expect(result.recommendation.text).toBe('All tests passed. No issues detected.');
        });

        test('dominant category >= 40% uses specific recommendation', () => {
            const data = [
                { testCase: 'TC001', status: FAILED, failureCategory: 'ASSERTION_FAILURE' },
                { testCase: 'TC002', status: FAILED, failureCategory: 'TIMEOUT_FAILURE' }
            ];
            const meta = { passRate: '0' };
            const result = generateInsights(data, meta, []);
            expect(result.recommendation.text).toContain('ASSERTION_FAILURE failures dominate');
            expect(result.recommendation.text).toContain('Review business rules and expected outcomes.');
        });

        test('LOCATOR_FAILURE dominant recommendation', () => {
            const data = [
                { testCase: 'TC001', status: FAILED, failureCategory: 'LOCATOR_FAILURE' },
                { testCase: 'TC002', status: FAILED, failureCategory: 'LOCATOR_FAILURE' },
                { testCase: 'TC003', status: FAILED, failureCategory: 'ASSERTION_FAILURE' }
            ];
            const meta = { passRate: '0' };
            const result = generateInsights(data, meta, []);
            expect(result.recommendation.text).toContain('LOCATOR_FAILURE failures dominate');
            expect(result.recommendation.text).toContain('Review selectors and recent UI changes.');
        });

        test('TIMEOUT_FAILURE dominant recommendation', () => {
            const data = [
                { testCase: 'TC001', status: FAILED, failureCategory: 'TIMEOUT_FAILURE' },
                { testCase: 'TC002', status: FAILED, failureCategory: 'TIMEOUT_FAILURE' }
            ];
            const meta = { passRate: '0' };
            const result = generateInsights(data, meta, []);
            expect(result.recommendation.text).toContain('TIMEOUT_FAILURE failures dominate');
            expect(result.recommendation.text).toContain('Review application response times and waiting strategy.');
        });

        test('NETWORK_FAILURE dominant recommendation', () => {
            const data = [
                { testCase: 'TC001', status: FAILED, failureCategory: 'NETWORK_FAILURE' },
                { testCase: 'TC002', status: FAILED, failureCategory: 'NETWORK_FAILURE' }
            ];
            const meta = { passRate: '0' };
            const result = generateInsights(data, meta, []);
            expect(result.recommendation.text).toContain('NETWORK_FAILURE failures dominate');
            expect(result.recommendation.text).toContain('Review environment stability and API availability.');
        });

        test('API_FAILURE dominant recommendation', () => {
            const data = [
                { testCase: 'TC001', status: FAILED, failureCategory: 'API_FAILURE' }
            ];
            const meta = { passRate: '0' };
            const result = generateInsights(data, meta, []);
            expect(result.recommendation.text).toContain('API_FAILURE failures dominate');
            expect(result.recommendation.text).toContain('Review API contracts');
        });

        test('CONFIGURATION_FAILURE dominant recommendation', () => {
            const data = [
                { testCase: 'TC001', status: FAILED, failureCategory: 'CONFIGURATION_FAILURE' },
                { testCase: 'TC002', status: FAILED, failureCategory: 'CONFIGURATION_FAILURE' },
                { testCase: 'TC003', status: FAILED, failureCategory: 'CONFIGURATION_FAILURE' }
            ];
            const meta = { passRate: '0' };
            const result = generateInsights(data, meta, []);
            expect(result.recommendation.text).toContain('CONFIGURATION_FAILURE failures dominate');
            expect(result.recommendation.text).toContain('Review browser configuration');
        });

        test('UNKNOWN_FAILURE dominant recommendation', () => {
            const data = [
                { testCase: 'TC001', status: FAILED, failureCategory: 'UNKNOWN_FAILURE' }
            ];
            const meta = { passRate: '0' };
            const result = generateInsights(data, meta, []);
            expect(result.recommendation.text).toContain('UNKNOWN_FAILURE failures dominate');
            expect(result.recommendation.text).toContain('Review raw error messages');
        });

        test('mixed categories under 40% recommendation', () => {
            const data = [
                { testCase: 'TC001', status: FAILED, failureCategory: 'ASSERTION_FAILURE' },
                { testCase: 'TC002', status: FAILED, failureCategory: 'TIMEOUT_FAILURE' },
                { testCase: 'TC003', status: FAILED, failureCategory: 'LOCATOR_FAILURE' }
            ];
            const meta = { passRate: '0' };
            const result = generateInsights(data, meta, []);
            expect(result.recommendation.text).toBe('Multiple failure types detected. Review recurring failures and failure groups first.');
        });
    });

    test.describe('edge cases', () => {
        test('skipped and passed tests are not counted as failures', () => {
            const data = [
                { testCase: 'TC001', status: PASSED },
                { testCase: 'TC002', status: SKIPPED },
                { testCase: 'TC003', status: PASSED }
            ];
            const result = generateInsights(data, {}, []);
            expect(result.totalFailed).toBe(0);
            expect(result.hasFailures).toBe(false);
        });

        test('FAILED: and FAIL statuses are recognised', () => {
            const data = [
                { testCase: 'TC001', status: 'FAILED:' },
                { testCase: 'TC002', status: 'FAIL' }
            ];
            const result = generateInsights(data, {}, []);
            expect(result.totalFailed).toBe(2);
            expect(result.hasFailures).toBe(true);
        });

        test('null execution data', () => {
            const result = generateInsights(null, {}, []);
            expect(result.totalFailed).toBe(0);
            expect(result.hasFailures).toBe(false);
            expect(result.healthStatus).toBe('HEALTHY');
        });

        test('no distribution detail when no failures', () => {
            const result = generateInsights([{ testCase: 'TC1', status: PASSED }], {}, []);
            expect(result.distribution).toEqual([]);
            expect(result.impactedSuites).toEqual([]);
        });
    });
});
