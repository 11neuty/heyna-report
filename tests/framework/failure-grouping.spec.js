const { test, expect } = require('@playwright/test');
const { computeFailureSignature, FAILURE_CATEGORIES } = require('../../utils/FailureClassifier');
const { groupFailures } = require('../../utils/FailureGrouping');

test.describe('computeFailureSignature', () => {
    test.describe('ASSERTION_FAILURE signatures', () => {
        test('EXPECT_TO_HAVE_URL', () => {
            const result = computeFailureSignature('expect(page).toHaveURL(expected) - Expected URL to match', FAILURE_CATEGORIES.ASSERTION_FAILURE);
            expect(result.signature).toBe('EXPECT_TO_HAVE_URL');
        });

        test('EXPECT_TO_HAVE_TEXT', () => {
            const result = computeFailureSignature('expect(locator).toHaveText("Login")', FAILURE_CATEGORIES.ASSERTION_FAILURE);
            expect(result.signature).toBe('EXPECT_TO_HAVE_TEXT');
        });

        test('EXPECT_TO_HAVE_VALUE', () => {
            const result = computeFailureSignature('expect(locator).toHaveValue("admin")', FAILURE_CATEGORIES.ASSERTION_FAILURE);
            expect(result.signature).toBe('EXPECT_TO_HAVE_VALUE');
        });

        test('EXPECT_TO_EQUAL', () => {
            const result = computeFailureSignature('expect(received).toEqual(expected) - Expected "foo" to equal "bar"', FAILURE_CATEGORIES.ASSERTION_FAILURE);
            expect(result.signature).toBe('EXPECT_TO_EQUAL');
        });

        test('EXPECT_TO_CONTAIN', () => {
            const result = computeFailureSignature('expect(array).toContain(element)', FAILURE_CATEGORIES.ASSERTION_FAILURE);
            expect(result.signature).toBe('EXPECT_TO_CONTAIN');
        });

        test('EXPECT_TO_BE', () => {
            const result = computeFailureSignature('expect(received).toBe(expected) - Expected true to be truthy.', FAILURE_CATEGORIES.ASSERTION_FAILURE);
            expect(result.signature).toBe('EXPECT_TO_BE');
        });

        test('EXPECT_FAILURE generic fallback', () => {
            const result = computeFailureSignature('expect(something).someCustomMatcher()', FAILURE_CATEGORIES.ASSERTION_FAILURE);
            expect(result.signature).toBe('EXPECT_FAILURE');
        });
    });

    test.describe('LOCATOR_FAILURE signatures', () => {
        test('STRICT_MODE_VIOLATION', () => {
            const result = computeFailureSignature('strict mode violation: locator resolved to multiple elements.', FAILURE_CATEGORIES.LOCATOR_FAILURE);
            expect(result.signature).toBe('STRICT_MODE_VIOLATION');
        });

        test('ELEMENT_NOT_VISIBLE', () => {
            const result = computeFailureSignature('Element is not visible - waiting for locator(".modal")', FAILURE_CATEGORIES.LOCATOR_FAILURE);
            expect(result.signature).toBe('ELEMENT_NOT_VISIBLE');
        });

        test('ELEMENT_NOT_ATTACHED', () => {
            const result = computeFailureSignature('element is not attached to the DOM', FAILURE_CATEGORIES.LOCATOR_FAILURE);
            expect(result.signature).toBe('ELEMENT_NOT_ATTACHED');
        });

        test('LOCATOR_NOT_FOUND', () => {
            const result = computeFailureSignature('waiting for locator("#login-button") - element not found', FAILURE_CATEGORIES.LOCATOR_FAILURE);
            expect(result.signature).toBe('LOCATOR_NOT_FOUND');
        });

        test('LOCATOR_GET_BY_ROLE', () => {
            const result = computeFailureSignature("getByRole('button', { name: 'Submit' }) - element not found", FAILURE_CATEGORIES.LOCATOR_FAILURE);
            expect(result.signature).toBe('LOCATOR_GET_BY_ROLE');
        });
    });

    test.describe('TIMEOUT_FAILURE signatures', () => {
        test('TIMEOUT', () => {
            const result = computeFailureSignature('Timeout 5000ms exceeded', FAILURE_CATEGORIES.TIMEOUT_FAILURE);
            expect(result.signature).toBe('TIMEOUT');
        });

        test('PAGE_WAIT_TIMEOUT', () => {
            const result = computeFailureSignature('page.waitForTimeout: Timeout 30000ms exceeded.', FAILURE_CATEGORIES.TIMEOUT_FAILURE);
            expect(result.signature).toBe('PAGE_WAIT_TIMEOUT');
        });

        test('LOCATOR_WAIT_TIMEOUT', () => {
            const result = computeFailureSignature('waiting for locator(".modal") - Timeout 5000ms exceeded', FAILURE_CATEGORIES.TIMEOUT_FAILURE);
            expect(result.signature).toBe('LOCATOR_WAIT_TIMEOUT');
        });
    });

    test.describe('NETWORK_FAILURE signatures', () => {
        test('NETWORK_CONNECTION_REFUSED', () => {
            const result = computeFailureSignature('net::ERR_CONNECTION_REFUSED at https://example.com', FAILURE_CATEGORIES.NETWORK_FAILURE);
            expect(result.signature).toBe('NETWORK_ERROR');
        });

        test('NETWORK_SOCKET_HANGUP', () => {
            const result = computeFailureSignature('socket hang up while making request', FAILURE_CATEGORIES.NETWORK_FAILURE);
            expect(result.signature).toBe('NETWORK_SOCKET_HANGUP');
        });

        test('NETWORK_FETCH_FAILED', () => {
            const result = computeFailureSignature('fetch failed: TypeError: Failed to fetch', FAILURE_CATEGORIES.NETWORK_FAILURE);
            expect(result.signature).toBe('NETWORK_FETCH_FAILED');
        });

        test('NETWORK_DNS_FAILURE via ENOTFOUND', () => {
            const result = computeFailureSignature('net::ERR_NAME_NOT_RESOLVED - ENOTFOUND', FAILURE_CATEGORIES.NETWORK_FAILURE);
            expect(result.signature).toBe('NETWORK_DNS_FAILURE');
        });
    });

    test.describe('API_FAILURE signatures', () => {
        test('API_STATUS_5XX', () => {
            const result = computeFailureSignature('API call failed: response status is 500', FAILURE_CATEGORIES.API_FAILURE);
            expect(result.signature).toBe('API_STATUS_5XX');
        });

        test('API_STATUS_4XX', () => {
            const result = computeFailureSignature('API request failed - status is 404', FAILURE_CATEGORIES.API_FAILURE);
            expect(result.signature).toBe('API_STATUS_4XX');
        });
    });

    test.describe('CONFIGURATION_FAILURE signatures', () => {
        test('CONFIG_EXECUTABLE_NOT_FOUND', () => {
            const result = computeFailureSignature('browserType.launch: Executable does not exist', FAILURE_CATEGORIES.CONFIGURATION_FAILURE);
            expect(result.signature).toBe('CONFIG_EXECUTABLE_NOT_FOUND');
        });

        test('CONFIG_BROWSER_LAUNCH', () => {
            const result = computeFailureSignature('browserType.launch: path to chrome not found', FAILURE_CATEGORIES.CONFIGURATION_FAILURE);
            expect(result.signature).toBe('CONFIG_BROWSER_LAUNCH');
        });

        test('CONFIG_CONTEXT_CLOSED', () => {
            const result = computeFailureSignature('context already closed - browser context was destroyed', FAILURE_CATEGORIES.CONFIGURATION_FAILURE);
            expect(result.signature).toBe('CONFIG_CONTEXT_CLOSED');
        });
    });

    test.describe('edge cases', () => {
        test('null message returns UNKNOWN_SIGNATURE', () => {
            const result = computeFailureSignature(null, FAILURE_CATEGORIES.ASSERTION_FAILURE);
            expect(result.signature).toBe('UNKNOWN_SIGNATURE');
        });

        test('empty string returns UNKNOWN_SIGNATURE', () => {
            const result = computeFailureSignature('', FAILURE_CATEGORIES.ASSERTION_FAILURE);
            expect(result.signature).toBe('UNKNOWN_SIGNATURE');
        });

        test('unknown category returns UNKNOWN_SIGNATURE', () => {
            const result = computeFailureSignature('some random error', FAILURE_CATEGORIES.UNKNOWN_FAILURE);
            expect(result.signature).toBe('UNKNOWN_SIGNATURE');
        });

        test('no matching rule returns UNKNOWN_SIGNATURE', () => {
            const result = computeFailureSignature('some random error', FAILURE_CATEGORIES.ASSERTION_FAILURE);
            expect(result.signature).toBe('UNKNOWN_SIGNATURE');
        });
    });
});

test.describe('groupFailures', () => {
    test('identical failures are grouped together', () => {
        const data = [
            { testCase: 'TC001', status: 'FAILED', failureCategory: 'ASSERTION_FAILURE', errorMessage: 'expect(page).toHaveURL(expected) - URL mismatch' },
            { testCase: 'TC005', status: 'FAILED', failureCategory: 'ASSERTION_FAILURE', errorMessage: 'expect(page).toHaveURL(expected) - URL mismatch' }
        ];

        const groups = groupFailures(data);
        expect(groups).toHaveLength(1);
        expect(groups[0].signature).toBe('EXPECT_TO_HAVE_URL');
        expect(groups[0].occurrences).toBe(2);
        expect(groups[0].testCases).toEqual(['TC001', 'TC005']);
    });

    test('same category same signature groups together', () => {
        const data = [
            { testCase: 'TC001', status: 'FAILED', failureCategory: 'ASSERTION_FAILURE', errorMessage: 'expect(page).toHaveURL(expected) - URL 1' },
            { testCase: 'TC002', status: 'FAILED', failureCategory: 'ASSERTION_FAILURE', errorMessage: 'expect(page).toHaveURL(expected) - URL 2' }
        ];

        const groups = groupFailures(data);
        expect(groups).toHaveLength(1);
        expect(groups[0].occurrences).toBe(2);
    });

    test('different signatures create separate groups', () => {
        const data = [
            { testCase: 'TC001', status: 'FAILED', failureCategory: 'ASSERTION_FAILURE', errorMessage: 'expect(page).toHaveURL(expected)' },
            { testCase: 'TC002', status: 'FAILED', failureCategory: 'ASSERTION_FAILURE', errorMessage: 'expect(locator).toHaveText("Login")' }
        ];

        const groups = groupFailures(data);
        expect(groups).toHaveLength(2);
        expect(groups[0].occurrences).toBe(1);
        expect(groups[1].occurrences).toBe(1);
    });

    test('different categories create separate groups', () => {
        const data = [
            { testCase: 'TC001', status: 'FAILED', failureCategory: 'ASSERTION_FAILURE', errorMessage: 'expect(page).toHaveURL(expected)' },
            { testCase: 'TC002', status: 'FAILED', failureCategory: 'TIMEOUT_FAILURE', errorMessage: 'Timeout 5000ms exceeded' }
        ];

        const groups = groupFailures(data);
        expect(groups).toHaveLength(2);
    });

    test('sorts by frequency descending', () => {
        const data = [
            { testCase: 'TC001', status: 'FAILED', failureCategory: 'TIMEOUT_FAILURE', errorMessage: 'Timeout 5000ms exceeded' },
            { testCase: 'TC002', status: 'FAILED', failureCategory: 'TIMEOUT_FAILURE', errorMessage: 'Timeout 5000ms exceeded' },
            { testCase: 'TC003', status: 'FAILED', failureCategory: 'TIMEOUT_FAILURE', errorMessage: 'Timeout 5000ms exceeded' },
            { testCase: 'TC004', status: 'FAILED', failureCategory: 'ASSERTION_FAILURE', errorMessage: 'expect(page).toHaveURL(expected)' },
            { testCase: 'TC005', status: 'FAILED', failureCategory: 'ASSERTION_FAILURE', errorMessage: 'expect(page).toHaveURL(expected)' }
        ];

        const groups = groupFailures(data);
        expect(groups[0].occurrences).toBe(3);
        expect(groups[0].signature).toBe('TIMEOUT');
        expect(groups[1].occurrences).toBe(2);
        expect(groups[1].signature).toBe('EXPECT_TO_HAVE_URL');
    });

    test('empty execution data', () => {
        const groups = groupFailures([]);
        expect(groups).toHaveLength(0);
    });

    test('no failed tests', () => {
        const data = [
            { testCase: 'TC001', status: 'PASSED' },
            { testCase: 'TC002', status: 'PASSED' }
        ];

        const groups = groupFailures(data);
        expect(groups).toHaveLength(0);
    });

    test('single failure produces one group', () => {
        const data = [
            { testCase: 'TC001', status: 'FAILED', failureCategory: 'ASSERTION_FAILURE', errorMessage: 'expect(page).toHaveURL(expected)' }
        ];

        const groups = groupFailures(data);
        expect(groups).toHaveLength(1);
        expect(groups[0].occurrences).toBe(1);
        expect(groups[0].testCases).toEqual(['TC001']);
    });

    test('unknown signature fallback', () => {
        const data = [
            { testCase: 'TC001', status: 'FAILED', failureCategory: 'UNKNOWN_FAILURE', errorMessage: 'some random error' },
            { testCase: 'TC002', status: 'FAILED', failureCategory: 'UNKNOWN_FAILURE', errorMessage: 'some random error' }
        ];

        const groups = groupFailures(data);
        expect(groups).toHaveLength(1);
        expect(groups[0].signature).toBe('UNKNOWN_SIGNATURE');
        expect(groups[0].occurrences).toBe(2);
    });

    test('missing failureCategory defaults to UNKNOWN_FAILURE', () => {
        const data = [
            { testCase: 'TC001', status: 'FAILED', errorMessage: 'weird error' }
        ];

        const groups = groupFailures(data);
        expect(groups).toHaveLength(1);
        expect(groups[0].category).toBe('UNKNOWN_FAILURE');
    });

    test('missing errorMessage still groups', () => {
        const data = [
            { testCase: 'TC001', status: 'FAILED', failureCategory: 'ASSERTION_FAILURE' },
            { testCase: 'TC002', status: 'FAILED', failureCategory: 'ASSERTION_FAILURE' }
        ];

        const groups = groupFailures(data);
        expect(groups).toHaveLength(1);
        expect(groups[0].occurrences).toBe(2);
    });

    test('preserves test case order within group', () => {
        const data = [
            { testCase: 'TC008', status: 'FAILED', failureCategory: 'ASSERTION_FAILURE', errorMessage: 'expect(page).toHaveURL(expected)' },
            { testCase: 'TC001', status: 'FAILED', failureCategory: 'ASSERTION_FAILURE', errorMessage: 'expect(page).toHaveURL(expected)' }
        ];

        const groups = groupFailures(data);
        expect(groups[0].testCases).toEqual(['TC008', 'TC001']);
    });

    test('skipped and passed tests are ignored', () => {
        const data = [
            { testCase: 'TC001', status: 'PASSED' },
            { testCase: 'TC002', status: 'SKIPPED' },
            { testCase: 'TC003', status: 'FAILED', failureCategory: 'ASSERTION_FAILURE', errorMessage: 'expect(page).toHaveURL(expected)' }
        ];

        const groups = groupFailures(data);
        expect(groups).toHaveLength(1);
        expect(groups[0].testCases).toEqual(['TC003']);
    });
});
