const FAILURE_CATEGORIES = {
    ASSERTION_FAILURE: 'ASSERTION_FAILURE',
    LOCATOR_FAILURE: 'LOCATOR_FAILURE',
    TIMEOUT_FAILURE: 'TIMEOUT_FAILURE',
    NETWORK_FAILURE: 'NETWORK_FAILURE',
    API_FAILURE: 'API_FAILURE',
    CONFIGURATION_FAILURE: 'CONFIGURATION_FAILURE',
    UNKNOWN_FAILURE: 'UNKNOWN_FAILURE'
};

const RULES = [
    {
        category: FAILURE_CATEGORIES.CONFIGURATION_FAILURE,
        patterns: [
            /browserType\.launch/i,
            /browser\.newContext/i,
            /browser\.newPage/i,
            /fixture.*browser/i,
            /executable.*does.*not.*exist/i,
            /browser.*not.*found/i,
            /context.*already.*closed/i
        ]
    },
    {
        category: FAILURE_CATEGORIES.ASSERTION_FAILURE,
        patterns: [
            /expect\s*\(/i,
            /toEqual/i,
            /toContain/i,
            /toBeTruthy/i,
            /toBeFalsy/i,
            /toBeNull/i,
            /toBeDefined/i,
            /toBeUndefined/i,
            /toBeGreaterThan/i,
            /toBeLessThan/i,
            /toMatch/i,
            /toThrow/i,
            /toHaveURL/i,
            /toHaveTitle/i,
            /toHaveText/i,
            /toHaveValue/i,
            /toHaveClass/i,
            /toHaveCount/i,
            /toHaveAttribute/i,
            /toHaveCSS/i,
            /toHaveId/i,
            /toHaveScreenshot/i,
            /call\s+to\s+locator/i
        ]
    },
    {
        category: FAILURE_CATEGORIES.NETWORK_FAILURE,
        patterns: [
            /net::ERR_/i,
            /ECONNREFUSED/i,
            /ENOTFOUND/i,
            /ECONNRESET/i,
            /ETIMEDOUT/i,
            /socket hang up/i,
            /fetch failed/i
        ]
    },
    {
        category: FAILURE_CATEGORIES.API_FAILURE,
        patterns: [
            /api.*fail/i,
            /api.*error/i,
            /status.*is\s+\d{3}/i,
            /request.*aborted/i,
            /response.*not.*ok/i,
            /response.*status.*5\d{2}/i,
            /response.*status.*4\d{2}/i
        ]
    },
    {
        category: FAILURE_CATEGORIES.TIMEOUT_FAILURE,
        patterns: [
            /timeout/i,
            /timed out/i,
            /ms exceeded/i
        ]
    },
    {
        category: FAILURE_CATEGORIES.LOCATOR_FAILURE,
        patterns: [
            /strict mode violation/i,
            /strict locator violation/i,
            /waiting for locator/i,
            /locator.*not found/i,
            /element.*not.*found/i,
            /no element/i,
            /element.*not.*visible/i,
            /element.*not.*attached/i,
            /element.*not.*stable/i,
            /element.*not.*enabled/i,
            /element.*not.*editable/i,
            /unable to locate/i,
            /cannot find/i,
            /page\.locator/i,
            /getByRole/i,
            /getByText/i,
            /getByLabel/i,
            /getByPlaceholder/i,
            /getByTestId/i,
            /getByAltText/i,
            /getByTitle/i
        ]
    }
];

function classifyFailure(errorMessage) {
    if (!errorMessage || typeof errorMessage !== 'string' || !errorMessage.trim()) {
        return {
            category: FAILURE_CATEGORIES.UNKNOWN_FAILURE,
            matchedRule: null
        };
    }

    const cleaned = String(errorMessage).trim();

    for (const rule of RULES) {
        for (const pattern of rule.patterns) {
            if (pattern.test(cleaned)) {
                return {
                    category: rule.category,
                    matchedRule: pattern.source
                };
            }
        }
    }

    return {
        category: FAILURE_CATEGORIES.UNKNOWN_FAILURE,
        matchedRule: null
    };
}

const SIGNATURE_RULES = [
    {
        category: FAILURE_CATEGORIES.ASSERTION_FAILURE,
        signature: 'EXPECT_TO_HAVE_URL',
        pattern: /toHaveURL/i
    },
    {
        category: FAILURE_CATEGORIES.ASSERTION_FAILURE,
        signature: 'EXPECT_TO_HAVE_TITLE',
        pattern: /toHaveTitle/i
    },
    {
        category: FAILURE_CATEGORIES.ASSERTION_FAILURE,
        signature: 'EXPECT_TO_HAVE_TEXT',
        pattern: /toHaveText/i
    },
    {
        category: FAILURE_CATEGORIES.ASSERTION_FAILURE,
        signature: 'EXPECT_TO_HAVE_VALUE',
        pattern: /toHaveValue/i
    },
    {
        category: FAILURE_CATEGORIES.ASSERTION_FAILURE,
        signature: 'EXPECT_TO_HAVE_CLASS',
        pattern: /toHaveClass/i
    },
    {
        category: FAILURE_CATEGORIES.ASSERTION_FAILURE,
        signature: 'EXPECT_TO_HAVE_COUNT',
        pattern: /toHaveCount/i
    },
    {
        category: FAILURE_CATEGORIES.ASSERTION_FAILURE,
        signature: 'EXPECT_TO_HAVE_ATTRIBUTE',
        pattern: /toHaveAttribute/i
    },
    {
        category: FAILURE_CATEGORIES.ASSERTION_FAILURE,
        signature: 'EXPECT_TO_HAVE_CSS',
        pattern: /toHaveCSS/i
    },
    {
        category: FAILURE_CATEGORIES.ASSERTION_FAILURE,
        signature: 'EXPECT_TO_HAVE_ID',
        pattern: /toHaveId/i
    },
    {
        category: FAILURE_CATEGORIES.ASSERTION_FAILURE,
        signature: 'EXPECT_TO_HAVE_SCREENSHOT',
        pattern: /toHaveScreenshot/i
    },
    {
        category: FAILURE_CATEGORIES.ASSERTION_FAILURE,
        signature: 'EXPECT_TO_EQUAL',
        pattern: /toEqual/i
    },
    {
        category: FAILURE_CATEGORIES.ASSERTION_FAILURE,
        signature: 'EXPECT_TO_CONTAIN',
        pattern: /toContain/i
    },
    {
        category: FAILURE_CATEGORIES.ASSERTION_FAILURE,
        signature: 'EXPECT_TO_BE_TRUTHY',
        pattern: /toBeTruthy/i
    },
    {
        category: FAILURE_CATEGORIES.ASSERTION_FAILURE,
        signature: 'EXPECT_TO_BE_FALSY',
        pattern: /toBeFalsy/i
    },
    {
        category: FAILURE_CATEGORIES.ASSERTION_FAILURE,
        signature: 'EXPECT_TO_BE_NULL',
        pattern: /toBeNull/i
    },
    {
        category: FAILURE_CATEGORIES.ASSERTION_FAILURE,
        signature: 'EXPECT_TO_BE_DEFINED',
        pattern: /toBeDefined/i
    },
    {
        category: FAILURE_CATEGORIES.ASSERTION_FAILURE,
        signature: 'EXPECT_TO_BE_UNDEFINED',
        pattern: /toBeUndefined/i
    },
    {
        category: FAILURE_CATEGORIES.ASSERTION_FAILURE,
        signature: 'EXPECT_TO_BE_GREATER_THAN',
        pattern: /toBeGreaterThan/i
    },
    {
        category: FAILURE_CATEGORIES.ASSERTION_FAILURE,
        signature: 'EXPECT_TO_BE_LESS_THAN',
        pattern: /toBeLessThan/i
    },
    {
        category: FAILURE_CATEGORIES.ASSERTION_FAILURE,
        signature: 'EXPECT_TO_MATCH',
        pattern: /toMatch/i
    },
    {
        category: FAILURE_CATEGORIES.ASSERTION_FAILURE,
        signature: 'EXPECT_TO_THROW',
        pattern: /toThrow/i
    },
    {
        category: FAILURE_CATEGORIES.ASSERTION_FAILURE,
        signature: 'EXPECT_TO_BE',
        pattern: /\btoBe\b/i
    },
    {
        category: FAILURE_CATEGORIES.ASSERTION_FAILURE,
        signature: 'EXPECT_FAILURE',
        pattern: /expect\s*\(/i
    },
    {
        category: FAILURE_CATEGORIES.LOCATOR_FAILURE,
        signature: 'STRICT_MODE_VIOLATION',
        pattern: /strict mode violation/i
    },
    {
        category: FAILURE_CATEGORIES.LOCATOR_FAILURE,
        signature: 'ELEMENT_NOT_VISIBLE',
        pattern: /element.*not.*visible/i
    },
    {
        category: FAILURE_CATEGORIES.LOCATOR_FAILURE,
        signature: 'ELEMENT_NOT_ATTACHED',
        pattern: /element.*not.*attached/i
    },
    {
        category: FAILURE_CATEGORIES.LOCATOR_FAILURE,
        signature: 'ELEMENT_NOT_STABLE',
        pattern: /element.*not.*stable/i
    },
    {
        category: FAILURE_CATEGORIES.LOCATOR_FAILURE,
        signature: 'ELEMENT_NOT_ENABLED',
        pattern: /element.*not.*enabled/i
    },
    {
        category: FAILURE_CATEGORIES.LOCATOR_FAILURE,
        signature: 'ELEMENT_NOT_EDITABLE',
        pattern: /element.*not.*editable/i
    },
    {
        category: FAILURE_CATEGORIES.LOCATOR_FAILURE,
        signature: 'LOCATOR_NOT_FOUND',
        pattern: /locator.*not found/i
    },
    {
        category: FAILURE_CATEGORIES.LOCATOR_FAILURE,
        signature: 'ELEMENT_NOT_FOUND',
        pattern: /no element/i
    },
    {
        category: FAILURE_CATEGORIES.LOCATOR_FAILURE,
        signature: 'LOCATOR_NOT_FOUND',
        pattern: /unable to locate/i
    },
    {
        category: FAILURE_CATEGORIES.LOCATOR_FAILURE,
        signature: 'LOCATOR_NOT_FOUND',
        pattern: /cannot find/i
    },
    {
        category: FAILURE_CATEGORIES.LOCATOR_FAILURE,
        signature: 'LOCATOR_WAIT_TIMEOUT',
        pattern: /waiting for locator/i
    },
    {
        category: FAILURE_CATEGORIES.LOCATOR_FAILURE,
        signature: 'LOCATOR_GET_BY_ROLE',
        pattern: /getByRole/i
    },
    {
        category: FAILURE_CATEGORIES.LOCATOR_FAILURE,
        signature: 'LOCATOR_GET_BY_TEXT',
        pattern: /getByText/i
    },
    {
        category: FAILURE_CATEGORIES.LOCATOR_FAILURE,
        signature: 'LOCATOR_GET_BY_LABEL',
        pattern: /getByLabel/i
    },
    {
        category: FAILURE_CATEGORIES.LOCATOR_FAILURE,
        signature: 'LOCATOR_GET_BY_PLACEHOLDER',
        pattern: /getByPlaceholder/i
    },
    {
        category: FAILURE_CATEGORIES.LOCATOR_FAILURE,
        signature: 'LOCATOR_GET_BY_TEST_ID',
        pattern: /getByTestId/i
    },
    {
        category: FAILURE_CATEGORIES.LOCATOR_FAILURE,
        signature: 'LOCATOR_GET_BY_ALT_TEXT',
        pattern: /getByAltText/i
    },
    {
        category: FAILURE_CATEGORIES.LOCATOR_FAILURE,
        signature: 'LOCATOR_GET_BY_TITLE',
        pattern: /getByTitle/i
    },
    {
        category: FAILURE_CATEGORIES.LOCATOR_FAILURE,
        signature: 'LOCATOR_PAGE',
        pattern: /page\.locator/i
    },
    {
        category: FAILURE_CATEGORIES.TIMEOUT_FAILURE,
        signature: 'LOCATOR_WAIT_TIMEOUT',
        pattern: /waiting for locator/i
    },
    {
        category: FAILURE_CATEGORIES.TIMEOUT_FAILURE,
        signature: 'PAGE_WAIT_TIMEOUT',
        pattern: /waitForTimeout/i
    },
    {
        category: FAILURE_CATEGORIES.TIMEOUT_FAILURE,
        signature: 'TIMEOUT',
        pattern: /timeout/i
    },
    {
        category: FAILURE_CATEGORIES.NETWORK_FAILURE,
        signature: 'NETWORK_CONNECTION_REFUSED',
        pattern: /ECONNREFUSED/i
    },
    {
        category: FAILURE_CATEGORIES.NETWORK_FAILURE,
        signature: 'NETWORK_DNS_FAILURE',
        pattern: /ENOTFOUND/i
    },
    {
        category: FAILURE_CATEGORIES.NETWORK_FAILURE,
        signature: 'NETWORK_CONNECTION_RESET',
        pattern: /ECONNRESET/i
    },
    {
        category: FAILURE_CATEGORIES.NETWORK_FAILURE,
        signature: 'NETWORK_TIMEOUT',
        pattern: /ETIMEDOUT/i
    },
    {
        category: FAILURE_CATEGORIES.NETWORK_FAILURE,
        signature: 'NETWORK_SOCKET_HANGUP',
        pattern: /socket hang up/i
    },
    {
        category: FAILURE_CATEGORIES.NETWORK_FAILURE,
        signature: 'NETWORK_FETCH_FAILED',
        pattern: /fetch failed/i
    },
    {
        category: FAILURE_CATEGORIES.NETWORK_FAILURE,
        signature: 'NETWORK_ERROR',
        pattern: /net::ERR_/i
    },
    {
        category: FAILURE_CATEGORIES.API_FAILURE,
        signature: 'API_STATUS_5XX',
        pattern: /status.*5\d{2}/i
    },
    {
        category: FAILURE_CATEGORIES.API_FAILURE,
        signature: 'API_STATUS_4XX',
        pattern: /status.*4\d{2}/i
    },
    {
        category: FAILURE_CATEGORIES.API_FAILURE,
        signature: 'API_RESPONSE_5XX',
        pattern: /response.*status.*5\d{2}/i
    },
    {
        category: FAILURE_CATEGORIES.API_FAILURE,
        signature: 'API_RESPONSE_4XX',
        pattern: /response.*status.*4\d{2}/i
    },
    {
        category: FAILURE_CATEGORIES.API_FAILURE,
        signature: 'API_REQUEST_ABORTED',
        pattern: /request.*aborted/i
    },
    {
        category: FAILURE_CATEGORIES.API_FAILURE,
        signature: 'API_RESPONSE_NOT_OK',
        pattern: /response.*not.*ok/i
    },
    {
        category: FAILURE_CATEGORIES.API_FAILURE,
        signature: 'API_FAILURE',
        pattern: /api.*fail/i
    },
    {
        category: FAILURE_CATEGORIES.API_FAILURE,
        signature: 'API_FAILURE',
        pattern: /api.*error/i
    },
    {
        category: FAILURE_CATEGORIES.CONFIGURATION_FAILURE,
        signature: 'CONFIG_EXECUTABLE_NOT_FOUND',
        pattern: /executable.*does.*not.*exist/i
    },
    {
        category: FAILURE_CATEGORIES.CONFIGURATION_FAILURE,
        signature: 'CONFIG_BROWSER_LAUNCH',
        pattern: /browserType\.launch/i
    },
    {
        category: FAILURE_CATEGORIES.CONFIGURATION_FAILURE,
        signature: 'CONFIG_BROWSER_CONTEXT',
        pattern: /browser\.newContext/i
    },
    {
        category: FAILURE_CATEGORIES.CONFIGURATION_FAILURE,
        signature: 'CONFIG_BROWSER_PAGE',
        pattern: /browser\.newPage/i
    },
    {
        category: FAILURE_CATEGORIES.CONFIGURATION_FAILURE,
        signature: 'CONFIG_FIXTURE',
        pattern: /fixture.*browser/i
    },
    {
        category: FAILURE_CATEGORIES.CONFIGURATION_FAILURE,
        signature: 'CONFIG_CONTEXT_CLOSED',
        pattern: /context.*already.*closed/i
    }
];

function computeFailureSignature(errorMessage, failureCategory) {
    if (!errorMessage || typeof errorMessage !== 'string' || !errorMessage.trim()) {
        return { signature: 'UNKNOWN_SIGNATURE', matchedRule: null };
    }

    const cleaned = String(errorMessage).trim();
    const normalizedCategory = String(failureCategory || '').toUpperCase();

    if (!normalizedCategory || normalizedCategory === FAILURE_CATEGORIES.UNKNOWN_FAILURE) {
        return { signature: 'UNKNOWN_SIGNATURE', matchedRule: null };
    }

    for (const rule of SIGNATURE_RULES) {
        if (rule.category !== normalizedCategory) continue;
        if (rule.pattern.test(cleaned)) {
            return { signature: rule.signature, matchedRule: rule.pattern.source };
        }
    }

    return { signature: 'UNKNOWN_SIGNATURE', matchedRule: null };
}

module.exports = { classifyFailure, computeFailureSignature, FAILURE_CATEGORIES };
