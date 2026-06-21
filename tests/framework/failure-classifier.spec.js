const { test, expect } = require('@playwright/test');
const { classifyFailure, FAILURE_CATEGORIES } = require('../../utils/FailureClassifier');

test.describe('FailureClassifier', () => {
    test.describe('ASSERTION_FAILURE', () => {
        test('expect().toBe()', () => {
            const result = classifyFailure('Error: expect(received).toBe(expected) - Expected true to be truthy.');
            expect(result.category).toBe(FAILURE_CATEGORIES.ASSERTION_FAILURE);
        });

        test('toEqual mismatch', () => {
            const result = classifyFailure('Error: expect(received).toEqual(expected) - Expected "foo" to equal "bar".');
            expect(result.category).toBe(FAILURE_CATEGORIES.ASSERTION_FAILURE);
        });

        test('toContain failure', () => {
            const result = classifyFailure('expect(array).toContain(element) - Expected array to contain value.');
            expect(result.category).toBe(FAILURE_CATEGORIES.ASSERTION_FAILURE);
        });

        test('toHaveURL', () => {
            const result = classifyFailure('Error: expect(page).toHaveURL - Expected URL to be https://example.com');
            expect(result.category).toBe(FAILURE_CATEGORIES.ASSERTION_FAILURE);
        });

        test('toHaveText', () => {
            const result = classifyFailure('Error: expect(locator).toHaveText - Expected text to be "Login"');
            expect(result.category).toBe(FAILURE_CATEGORIES.ASSERTION_FAILURE);
        });
    });

    test.describe('LOCATOR_FAILURE', () => {
        test('strict mode violation', () => {
            const result = classifyFailure('Error: strict mode violation: locator resolved to multiple elements.');
            expect(result.category).toBe(FAILURE_CATEGORIES.LOCATOR_FAILURE);
        });

        test('locator not found', () => {
            const result = classifyFailure('waiting for locator("#login-button") - element not found');
            expect(result.category).toBe(FAILURE_CATEGORIES.LOCATOR_FAILURE);
        });

        test('element not visible', () => {
            const result = classifyFailure('Element is not visible - waiting for locator(".modal")');
            expect(result.category).toBe(FAILURE_CATEGORIES.LOCATOR_FAILURE);
        });

        test('element not attached', () => {
            const result = classifyFailure('element is not attached to the DOM - locator has been removed.');
            expect(result.category).toBe(FAILURE_CATEGORIES.LOCATOR_FAILURE);
        });

        test('unable to locate', () => {
            const result = classifyFailure('Unable to locate element using selector: #username');
            expect(result.category).toBe(FAILURE_CATEGORIES.LOCATOR_FAILURE);
        });

        test('getByRole pattern', () => {
            const result = classifyFailure("page.getByRole('button', { name: 'Submit' }) - element not found");
            expect(result.category).toBe(FAILURE_CATEGORIES.LOCATOR_FAILURE);
        });
    });

    test.describe('TIMEOUT_FAILURE', () => {
        test('Timeout 5000ms exceeded', () => {
            const result = classifyFailure('Timeout 5000ms exceeded while waiting for locator(".modal")');
            expect(result.category).toBe(FAILURE_CATEGORIES.TIMEOUT_FAILURE);
        });

        test('page.waitForTimeout', () => {
            const result = classifyFailure('page.waitForTimeout: Timeout 30000ms exceeded.');
            expect(result.category).toBe(FAILURE_CATEGORIES.TIMEOUT_FAILURE);
        });

        test('timed out waiting', () => {
            const result = classifyFailure('Timed out waiting for page to load after 10000ms');
            expect(result.category).toBe(FAILURE_CATEGORIES.TIMEOUT_FAILURE);
        });
    });

    test.describe('NETWORK_FAILURE', () => {
        test('net::ERR_CONNECTION_REFUSED', () => {
            const result = classifyFailure('page.goto: net::ERR_CONNECTION_REFUSED at https://example.com');
            expect(result.category).toBe(FAILURE_CATEGORIES.NETWORK_FAILURE);
        });

        test('net::ERR_NAME_NOT_RESOLVED', () => {
            const result = classifyFailure('net::ERR_NAME_NOT_RESOLVED - could not resolve hostname');
            expect(result.category).toBe(FAILURE_CATEGORIES.NETWORK_FAILURE);
        });

        test('socket hang up', () => {
            const result = classifyFailure('Error: socket hang up while making request to API');
            expect(result.category).toBe(FAILURE_CATEGORIES.NETWORK_FAILURE);
        });

        test('fetch failed', () => {
            const result = classifyFailure('fetch failed: TypeError: Failed to fetch');
            expect(result.category).toBe(FAILURE_CATEGORIES.NETWORK_FAILURE);
        });
    });

    test.describe('API_FAILURE', () => {
        test('API call failure', () => {
            const result = classifyFailure('API call failed: response status is 500');
            expect(result.category).toBe(FAILURE_CATEGORIES.API_FAILURE);
        });

        test('status is 404', () => {
            const result = classifyFailure('API request failed - status is 404');
            expect(result.category).toBe(FAILURE_CATEGORIES.API_FAILURE);
        });

        test('request aborted', () => {
            const result = classifyFailure('request aborted while calling /api/users');
            expect(result.category).toBe(FAILURE_CATEGORIES.API_FAILURE);
        });
    });

    test.describe('CONFIGURATION_FAILURE', () => {
        test('browserType.launch', () => {
            const result = classifyFailure('browserType.launch: Executable does not exist at /usr/bin/chromium');
            expect(result.category).toBe(FAILURE_CATEGORIES.CONFIGURATION_FAILURE);
        });

        test('browser not found', () => {
            const result = classifyFailure('browser.newContext: Browser not found in the system path');
            expect(result.category).toBe(FAILURE_CATEGORIES.CONFIGURATION_FAILURE);
        });

        test('fixture error', () => {
            const result = classifyFailure('fixture: browser: browserType.connect: connect ECONNREFUSED');
            expect(result.category).toBe(FAILURE_CATEGORIES.CONFIGURATION_FAILURE);
        });
    });

    test.describe('UNKNOWN_FAILURE', () => {
        test('generic error', () => {
            const result = classifyFailure('Something went wrong.');
            expect(result.category).toBe(FAILURE_CATEGORIES.UNKNOWN_FAILURE);
        });

        test('normal JavaScript error', () => {
            const result = classifyFailure('TypeError: Cannot read property of undefined');
            expect(result.category).toBe(FAILURE_CATEGORIES.UNKNOWN_FAILURE);
        });

        test('custom application error', () => {
            const result = classifyFailure('Application error: Order processing failed.');
            expect(result.category).toBe(FAILURE_CATEGORIES.UNKNOWN_FAILURE);
        });
    });

    test.describe('edge cases', () => {
        test('empty string', () => {
            const result = classifyFailure('');
            expect(result.category).toBe(FAILURE_CATEGORIES.UNKNOWN_FAILURE);
            expect(result.matchedRule).toBeNull();
        });

        test('null message', () => {
            const result = classifyFailure(null);
            expect(result.category).toBe(FAILURE_CATEGORIES.UNKNOWN_FAILURE);
            expect(result.matchedRule).toBeNull();
        });

        test('undefined message', () => {
            const result = classifyFailure(undefined);
            expect(result.category).toBe(FAILURE_CATEGORIES.UNKNOWN_FAILURE);
            expect(result.matchedRule).toBeNull();
        });

        test('whitespace only', () => {
            const result = classifyFailure('   ');
            expect(result.category).toBe(FAILURE_CATEGORIES.UNKNOWN_FAILURE);
            expect(result.matchedRule).toBeNull();
        });

        test('non-string input (number)', () => {
            const result = classifyFailure(12345);
            expect(result.category).toBe(FAILURE_CATEGORIES.UNKNOWN_FAILURE);
            expect(result.matchedRule).toBeNull();
        });
    });

    test.describe('precedence', () => {
        test('CONFIGURATION_FAILURE beats TIMEOUT_FAILURE', () => {
            const msg = 'browserType.launch: Timeout - Executable does not exist at /usr/bin/chromium';
            const result = classifyFailure(msg);
            expect(result.category).toBe(FAILURE_CATEGORIES.CONFIGURATION_FAILURE);
        });

        test('NETWORK_FAILURE beats generic timeout', () => {
            const msg = 'Timeout waiting for net::ERR_CONNECTION_REFUSED response';
            const result = classifyFailure(msg);
            expect(result.category).toBe(FAILURE_CATEGORIES.NETWORK_FAILURE);
        });
    });
});
