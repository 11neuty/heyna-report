const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const EVIDENCE_DIR = path.join(ROOT, 'evidence');
const RESULT_DIR = path.join(ROOT, 'test-results');
const EXECUTION_FILE = path.join(RESULT_DIR, 'execution.json');
const METADATA_FILE = path.join(RESULT_DIR, 'metadata.json');
const RUN_LOCK_FILE = path.join(RESULT_DIR, '.heyna-run.lock');

const defaultStepDescriptions = {
    Step01_Open_Login_Page: { stepName: 'Open Login Page', action: 'Navigate to SauceDemo login page.', expectedResult: 'Login page is displayed with username and password fields.' },
    Step02_Input_Username: { stepName: 'Input Username', action: 'Enter valid username standard_user into the username field.', expectedResult: 'Username is entered successfully.' },
    Step03_Input_Password: { stepName: 'Input Password', action: 'Enter valid password secret_sauce into the password field.', expectedResult: 'Password is entered successfully.' },
    Step04_Click_Login: { stepName: 'Click Login Button', action: 'Click the login button to submit credentials.', expectedResult: 'Authentication request is submitted.' },
    Step05_Verify_Login_Success: { stepName: 'Verify Login Success', action: 'Verify the user is redirected to the inventory page.', expectedResult: 'Inventory page is displayed after successful login.' },
    Step02_Input_Invalid_Credentials: { stepName: 'Input Invalid Credentials', action: 'Enter invalid username and password into the login form.', expectedResult: 'Invalid credentials are entered successfully.' },
    Step03_Click_Login: { stepName: 'Click Login Button', action: 'Click the login button to submit invalid credentials.', expectedResult: 'Invalid login request is submitted.' },
    Step04_Verify_Error_Message: { stepName: 'Verify Error Message', action: 'Verify the login error message is displayed.', expectedResult: 'Error message is visible for invalid credentials.' }
};

function ensureDir(folder) {
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
}

function readJson(file, fallback) {
    if (!fs.existsSync(file)) return fallback;

    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        return fallback;
    }
}

function writeJson(file, data) {
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function normalizeStatus(status) {
    const value = String(status || '').toUpperCase();
    if (value === 'PASS') return 'PASSED';
    if (value === 'FAIL' || value === 'TIMEDOUT' || value === 'INTERRUPTED') return 'FAILED';
    if (value === 'SKIP') return 'SKIPPED';
    return value || 'UNKNOWN';
}

function safeName(value) {
    return String(value).replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
}

function cleanMessage(message) {
    if (!message) return undefined;

    return String(message)
        .replace(/\u001b\[[0-9;]*m/g, '')
        .replace(/\r\n/g, '\n')
        .trim();
}

class ApiLogger {
    constructor(page, testCase, options = {}) {
        this.logs = [];
        this.requests = {};
        this.testCase = testCase;
        this.include = options.include || ['/api/', 'saucedemo.com'];

        page.on('request', request => {
            this.requests[request.url()] = Date.now();
        });

        page.on('response', response => {
            const url = response.url();
            if (!this.include.some(pattern => url.includes(pattern)) || HeynaReporter.isStaticResource(url)) return;

            const startedAt = this.requests[url];
            this.logs.push({
                method: response.request().method(),
                status: response.status(),
                duration: startedAt ? Date.now() - startedAt : 0,
                url
            });
        });
    }

    save() {
        HeynaReporter.saveApiLogs(this.testCase, this.logs);
    }
}

class HeynaReporter {
    static stepDescriptions = { ...defaultStepDescriptions };

    static configure(config = {}) {
        if (config.project) process.env.HEYNA_PROJECT = config.project;
        if (config.feature) process.env.HEYNA_FEATURE = config.feature;
        if (config.environment) process.env.ENVIRONMENT = config.environment;
        if (config.browser) process.env.BROWSER = config.browser;
        if (config.executedBy) process.env.HEYNA_EXECUTED_BY = config.executedBy;
        if (config.stepDescriptions) this.addStepDescriptions(config.stepDescriptions);
    }

    static createApiLogger(page, testCase, options = {}) {
        return new ApiLogger(page, testCase, options);
    }

    static initializeRun(metadata = {}) {
        ensureDir(RESULT_DIR);

        const hasActiveRun = fs.existsSync(RUN_LOCK_FILE);
        const shouldReset = metadata.reset === true
            || !hasActiveRun
            || !fs.existsSync(EXECUTION_FILE);

        if (shouldReset) {
            writeJson(EXECUTION_FILE, []);
            fs.writeFileSync(RUN_LOCK_FILE, new Date().toISOString());
        }

        this.updateMetadata({
            project: metadata.project || process.env.HEYNA_PROJECT || 'SauceDemo',
            feature: metadata.feature || process.env.HEYNA_FEATURE || 'Login & Authentication',
            environment: metadata.environment || process.env.ENVIRONMENT || 'QA',
            browser: metadata.browser || process.env.BROWSER || 'chromium',
            automationTool: 'Playwright',
            executedBy: metadata.executedBy || process.env.HEYNA_EXECUTED_BY || process.env.USERNAME || 'Automation Framework',
            executionStartTime: shouldReset
                ? new Date().toISOString()
                : this.getMetadata().executionStartTime || new Date().toISOString(),
            runStatus: 'IN_PROGRESS'
        });
    }

    static initializeTest(testCase, metadata = {}) {
        if (!fs.existsSync(EXECUTION_FILE)) writeJson(EXECUTION_FILE, []);
        if (!fs.existsSync(METADATA_FILE)) this.updateMetadata({});

        const data = readJson(EXECUTION_FILE, []);
        const existing = data.find(tc => tc.testCase === testCase);

        if (existing) {
            existing.status = 'RUNNING';
            existing.duration = 0;
            existing.feature = metadata.feature || existing.feature || process.env.HEYNA_FEATURE || 'Login & Authentication';
            existing.steps = [];
            existing.executionDate = new Date().toISOString();
            delete existing.errorMessage;
            delete existing.failureScreenshot;
        } else {
            data.push({
                testCase,
                status: 'RUNNING',
                duration: 0,
                feature: metadata.feature || process.env.HEYNA_FEATURE || 'Login & Authentication',
                steps: [],
                executionDate: new Date().toISOString()
            });
        }

        writeJson(EXECUTION_FILE, data);
    }

    static async step(page, testCase, stepName, action) {
        const startedAt = Date.now();

        try {
            await action();
            const screenshot = await this.captureEvidence(page, testCase, stepName);
            this.addStep(testCase, { name: stepName, status: 'PASS', duration: Date.now() - startedAt, screenshot });
        } catch (error) {
            const screenshot = await this.captureEvidence(page, testCase, stepName, 'FAILED');
            this.addStep(testCase, { name: stepName, status: 'FAIL', duration: Date.now() - startedAt, screenshot, errorMessage: cleanMessage(error.message) });
            throw error;
        }
    }

    static addStep(testCase, step) {
        const data = readJson(EXECUTION_FILE, []);
        let tc = data.find(item => item.testCase === testCase);

        if (!tc) {
            tc = {
                testCase,
                status: 'RUNNING',
                duration: 0,
                feature: process.env.HEYNA_FEATURE || 'Login & Authentication',
                steps: [],
                executionDate: new Date().toISOString()
            };
            data.push(tc);
        }

        tc.steps = Array.isArray(tc.steps) ? tc.steps : [];
        tc.steps.push(step);
        writeJson(EXECUTION_FILE, data);
    }

    static completeTest(testCase, status, duration, errorMessage, extra = {}) {
        const data = readJson(EXECUTION_FILE, []);
        let tc = data.find(item => item.testCase === testCase);

        if (!tc) {
            tc = {
                testCase,
                status: 'RUNNING',
                duration: 0,
                feature: process.env.HEYNA_FEATURE || 'Login & Authentication',
                steps: [],
                executionDate: new Date().toISOString()
            };
            data.push(tc);
        }

        tc.status = normalizeStatus(status);
        tc.duration = duration || 0;
        if (errorMessage) tc.errorMessage = cleanMessage(errorMessage);
        if (extra.failureScreenshot) tc.failureScreenshot = extra.failureScreenshot;

        console.log(`[HEYNA]\n${testCase} => ${tc.status}`);

        writeJson(EXECUTION_FILE, data);
    }

    static markRunningTestsAsFailed(message = 'Test did not complete before report generation.') {
        const data = readJson(EXECUTION_FILE, []);
        let changed = false;

        data.forEach(tc => {
            if (normalizeStatus(tc.status) === 'RUNNING') {
                tc.status = 'FAILED';
                tc.errorMessage = tc.errorMessage || message;
                changed = true;
                console.log(`[HEYNA]\n${tc.testCase} => FAILED`);
            }
        });

        if (changed) writeJson(EXECUTION_FILE, data);
    }

    static async captureEvidence(page, testCase, stepName, prefix) {
        const folder = path.join(EVIDENCE_DIR, testCase);
        ensureDir(folder);
        const screenshotPath = path.join(folder, `${Date.now()}_${prefix ? `${prefix}_` : ''}${safeName(stepName)}.png`);

        await page.screenshot({ path: screenshotPath, fullPage: true });
        return path.relative(ROOT, screenshotPath);
    }

    static saveApiLogs(testCase, logs) {
        const folder = path.join(EVIDENCE_DIR, testCase);
        ensureDir(folder);
        writeJson(path.join(folder, 'api-log.json'), this.filterApiLogs(logs));
    }

    static updateMetadata(updates = {}) {
        const current = readJson(METADATA_FILE, {});
        writeJson(METADATA_FILE, {
            project: process.env.HEYNA_PROJECT || 'SauceDemo',
            feature: process.env.HEYNA_FEATURE || 'Login & Authentication',
            environment: process.env.ENVIRONMENT || 'QA',
            browser: process.env.BROWSER || 'chromium',
            automationTool: 'Playwright',
            executedBy: process.env.HEYNA_EXECUTED_BY || process.env.USERNAME || 'Automation Framework',
            executionStartTime: new Date().toISOString(),
            ...current,
            ...updates
        });
    }

    static getMetadata() {
        return readJson(METADATA_FILE, {
            project: process.env.HEYNA_PROJECT || 'Project',
            feature: process.env.HEYNA_FEATURE || 'Feature',
            environment: process.env.ENVIRONMENT || 'QA',
            browser: process.env.BROWSER || 'chromium',
            automationTool: 'Playwright',
            executedBy: process.env.HEYNA_EXECUTED_BY || process.env.USERNAME || 'Automation Framework',
            executionStartTime: new Date().toISOString()
        });
    }

    static getExecutionData() {
        return readJson(EXECUTION_FILE, []);
    }

    static getSummary() {
        const results = this.getExecutionData();
        const total = results.length;
        const passed = results.filter(tc => normalizeStatus(tc.status) === 'PASSED').length;
        const failed = results.filter(tc => normalizeStatus(tc.status) === 'FAILED').length;
        const skipped = results.filter(tc => normalizeStatus(tc.status) === 'SKIPPED').length;
        const totalDuration = results.reduce((sum, tc) => sum + (tc.duration || 0), 0);
        const metadata = this.getMetadata();

        return {
            ...metadata,
            total,
            passed,
            failed,
            skipped,
            passRate: total ? ((passed / total) * 100).toFixed(2) : '0.00',
            totalDuration,
            executionDate: new Date(metadata.executionStartTime || Date.now()).toLocaleString()
        };
    }

    static addStepDescription(stepName, description) {
        this.stepDescriptions[stepName] = description;
    }

    static addStepDescriptions(descriptions) {
        this.stepDescriptions = { ...this.stepDescriptions, ...descriptions };
    }

    static getStepDescription(stepName) {
        return this.stepDescriptions[stepName] || {
            stepName: String(stepName).replace(/_/g, ' '),
            action: `Execute ${String(stepName).replace(/_/g, ' ')}.`,
            expectedResult: `${String(stepName).replace(/_/g, ' ')} completes successfully.`
        };
    }

    static isStaticResource(url = '') {
        const lowerUrl = url.toLowerCase().split('?')[0];
        const extensions = ['.css', '.js', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.woff', '.woff2', '.ttf', '.ico', '.webp'];
        const staticPaths = ['/static/', '/assets/', '/dist/', '/public/', '/cdn/', '/images/', '/fonts/'];
        return extensions.some(ext => lowerUrl.endsWith(ext)) || staticPaths.some(item => lowerUrl.includes(item));
    }

    static filterApiLogs(logs = []) {
        return logs.filter(log => {
            const url = log.url || '';
            const lowerUrl = url.toLowerCase();
            return !this.isStaticResource(url)
                && !lowerUrl.includes('google-analytics')
                && !lowerUrl.includes('segment')
                && !lowerUrl.includes('mixpanel')
                && !lowerUrl.includes('newrelic')
                && !lowerUrl.includes('sentry');
        });
    }

    static formatApiUrl(url = '') {
        try {
            const parsed = new URL(url);
            return `${parsed.pathname}${parsed.search}`.substring(0, 90);
        } catch (error) {
            return url.substring(0, 90);
        }
    }
}

module.exports = HeynaReporter;
module.exports.HeynaReporter = HeynaReporter;
module.exports.ApiLogger = ApiLogger;
