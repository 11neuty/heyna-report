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

module.exports = { classifyFailure, FAILURE_CATEGORIES };
