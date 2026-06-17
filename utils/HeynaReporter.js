const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const EVIDENCE_DIR = path.join(ROOT, 'evidence');
const RESULT_DIR = path.join(ROOT, 'test-results');
const EXECUTION_FILE = path.join(RESULT_DIR, 'execution.json');
const METADATA_FILE = path.join(RESULT_DIR, 'metadata.json');
const RUN_LOCK_FILE = path.join(RESULT_DIR, '.heyna-run.lock');
const WRITE_LOCK_FILE = path.join(RESULT_DIR, '.heyna-write.lock');
const CONFIG_FILE = path.join(ROOT, 'heyna.config.js');

const DEFAULT_CONFIG = {
    autoCapture: true,
    screenshotMode: 'failure-only',
    autoActions: [
        'fill',
        'click',
        'check',
        'uncheck',
        'selectOption',
        'press',
        'dragAndDrop',
        'setInputFiles',
        'hover',
        'dblclick',
        'tap',
        'focus',
        'blur'
    ],
    locatorFactories: [
        'locator',
        'getByRole',
        'getByText',
        'getByLabel',
        'getByPlaceholder',
        'getByTestId',
        'getByAltText',
        'getByTitle'
    ],
    chainMethods: [
        'first',
        'last',
        'nth',
        'filter'
    ],
    importantActions: [
        'click',
        'dblclick',
        'tap',
        'setInputFiles',
        'dragAndDrop'
    ],
    apiLogging: {
        include: ['/api/', 'saucedemo.com']
    }
};

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

function sleep(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withWriteLock(callback) {
    ensureDir(RESULT_DIR);

    const timeoutAt = Date.now() + 5000;
    let lockHandle;

    while (!lockHandle) {
        try {
            lockHandle = fs.openSync(WRITE_LOCK_FILE, 'wx');
        } catch (error) {
            try {
                const age = Date.now() - fs.statSync(WRITE_LOCK_FILE).mtimeMs;
                if (age > 10000) fs.rmSync(WRITE_LOCK_FILE, { force: true });
            } catch (statError) {
                // Continue retry loop if the lock disappears between checks.
            }

            if (Date.now() > timeoutAt) {
                throw new Error('HEYNA write lock timeout.');
            }

            sleep(25);
        }
    }

    try {
        return callback();
    } finally {
        fs.closeSync(lockHandle);
        fs.rmSync(WRITE_LOCK_FILE, { force: true });
    }
}

function mutateExecution(mutator) {
    return withWriteLock(() => {
        const data = readJson(EXECUTION_FILE, []);
        const result = mutator(data) || data;
        writeJson(EXECUTION_FILE, result);
        return result;
    });
}

function mutateMetadata(mutator) {
    return withWriteLock(() => {
        const metadata = readJson(METADATA_FILE, {});
        const result = mutator(metadata) || metadata;
        writeJson(METADATA_FILE, result);
        return result;
    });
}

function normalizeStatus(status) {
    const value = String(status || '').toUpperCase();
    if (value === 'PASS') return 'PASSED';
    if (value === 'FAIL' || value === 'FAILED' || value === 'TIMEDOUT' || value === 'INTERRUPTED') return 'FAILED';
    if (value === 'SKIP' || value === 'SKIPPED') return 'SKIPPED';
    if (value === 'PASSED') return 'PASSED';
    if (value === 'RUNNING') return 'RUNNING';
    return value || 'UNKNOWN';
}

function stepStatus(status) {
    return normalizeStatus(status) === 'FAILED' ? 'FAIL' : 'PASS';
}

function safeName(value) {
    return String(value || 'Step').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
}

function cleanMessage(message) {
    if (!message) return undefined;

    return String(message)
        .replace(/\u001b\[[0-9;]*m/g, '')
        .replace(/\r\n/g, '\n')
        .trim();
}

function titleCase(value) {
    return String(value || '')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\w\S*/g, word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function loadConfig() {
    let userConfig = {};

    if (fs.existsSync(CONFIG_FILE)) {
        delete require.cache[require.resolve(CONFIG_FILE)];
        userConfig = require(CONFIG_FILE);
    }

        return {
            ...DEFAULT_CONFIG,
            ...userConfig,
            apiLogging: {
                ...DEFAULT_CONFIG.apiLogging,
                ...(userConfig.apiLogging || {})
            },
        autoActions: userConfig.autoActions || DEFAULT_CONFIG.autoActions,
        locatorFactories: userConfig.locatorFactories || DEFAULT_CONFIG.locatorFactories,
        chainMethods: userConfig.chainMethods || DEFAULT_CONFIG.chainMethods,
        importantActions: userConfig.importantActions || DEFAULT_CONFIG.importantActions
    };
}

function findOrCreateTestCase(data, testCase) {
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
    return tc;
}

class ApiLogger {
    constructor(page, testCase, options = {}) {
        const config = HeynaReporter.getConfig();

        this.logs = [];
        this.requests = {};
        this.testCase = testCase;
        this.include = options.include || config.apiLogging.include || DEFAULT_CONFIG.apiLogging.include;

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
    static config = loadConfig();
    static attachedPages = new WeakSet();

    static getConfig() {
        return this.config;
    }

    static configure(config = {}) {
        this.config = {
            ...this.config,
            ...config,
            apiLogging: {
                ...this.config.apiLogging,
                ...(config.apiLogging || {})
            },
            autoActions: config.autoActions || this.config.autoActions,
            locatorFactories: config.locatorFactories || this.config.locatorFactories,
            chainMethods: config.chainMethods || this.config.chainMethods,
            importantActions: config.importantActions || this.config.importantActions
        };

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

        const runState = withWriteLock(() => {
            const hasActiveRun = fs.existsSync(RUN_LOCK_FILE);
            const shouldReset = metadata.reset === true
                || !hasActiveRun
                || !fs.existsSync(EXECUTION_FILE);

            if (shouldReset) {
                writeJson(EXECUTION_FILE, []);
                fs.writeFileSync(RUN_LOCK_FILE, new Date().toISOString());
            }

            return { shouldReset };
        });

        const metadataUpdates = {
            project: metadata.project || process.env.HEYNA_PROJECT || 'SauceDemo',
            feature: metadata.feature || process.env.HEYNA_FEATURE || 'Login & Authentication',
            environment: metadata.environment || process.env.ENVIRONMENT || 'QA',
            browser: metadata.browser || process.env.BROWSER || 'chromium',
            automationTool: 'Playwright',
            executedBy: metadata.executedBy || process.env.HEYNA_EXECUTED_BY || process.env.USERNAME || 'Automation Framework',
            executionStartTime: runState.shouldReset
                ? new Date().toISOString()
                : this.getMetadata().executionStartTime || new Date().toISOString(),
            runStatus: 'IN_PROGRESS',
            autoCapture: this.config.autoCapture,
            screenshotMode: this.config.screenshotMode
        };

        if (runState.shouldReset) {
            metadataUpdates.autoCaptureCoverage = this.createEmptyCoverage();
        }

        this.updateMetadata(metadataUpdates);
    }

    static initializeTest(testCase, metadata = {}) {
        if (!fs.existsSync(EXECUTION_FILE)) writeJson(EXECUTION_FILE, []);
        if (!fs.existsSync(METADATA_FILE)) this.updateMetadata({});

        mutateExecution(data => {
            const existing = data.find(tc => tc.testCase === testCase);
            const retry = Number(metadata.retry || 0);
            const repeatEachIndex = Number(metadata.repeatEachIndex || 0);
            const attempt = {
                attemptNumber: retry + 1,
                retry,
                repeatEachIndex,
                status: 'RUNNING',
                duration: 0,
                steps: [],
                startedAt: new Date().toISOString()
            };

            if (existing) {
                existing.status = 'RUNNING';
                existing.duration = 0;
                existing.feature = metadata.feature || existing.feature || process.env.HEYNA_FEATURE || 'Login & Authentication';
                existing.steps = [];
                existing.attempts = Array.isArray(existing.attempts) ? existing.attempts : [];
                existing.attempts.push(attempt);
                existing.currentAttempt = attempt.attemptNumber;
                existing.retryCount = retry;
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
                    attempts: [attempt],
                    currentAttempt: attempt.attemptNumber,
                    retryCount: retry,
                    executionDate: new Date().toISOString()
                });
            }
        });
    }

    static attach(page, testCase, options = {}) {
        const config = {
            ...this.config,
            ...options,
            autoActions: options.autoActions || this.config.autoActions,
            locatorFactories: options.locatorFactories || this.config.locatorFactories,
            chainMethods: options.chainMethods || this.config.chainMethods,
            importantActions: options.importantActions || this.config.importantActions
        };

        if (!config.autoCapture || this.attachedPages.has(page)) return page;

        this.attachedPages.add(page);
        page.__heynaTestCase = testCase;
        page.__heynaConfig = config;

        this.patchPageActionMethods(page, testCase, config);
        this.patchLocatorFactories(page, testCase, config);
        this.patchInputDevices(page, testCase, config);

        return page;
    }

    static patchPageActionMethods(page, testCase, config) {
        config.autoActions.forEach(action => {
            if (typeof page[action] !== 'function' || page[action].__heynaPatched) return;

            const original = page[action].bind(page);
            const wrapped = async (...args) => {
                const target = this.createPageActionTarget(action, args);
                const name = this.createStepName(action, target);

                return this.captureAutoAction({
                    page,
                    testCase,
                    action,
                    target,
                    stepName: name,
                    execute: () => original(...args),
                    config
                });
            };

            wrapped.__heynaPatched = true;
            page[action] = wrapped;
        });
    }

    static patchLocatorFactories(page, testCase, config) {
        config.locatorFactories.forEach(factoryName => {
            if (typeof page[factoryName] !== 'function' || page[factoryName].__heynaPatched) return;

            const originalFactory = page[factoryName].bind(page);
            const wrappedFactory = (...args) => {
                const locator = originalFactory(...args);
                const target = this.createTargetDescriptor(factoryName, args);
                return this.wrapLocator(locator, page, testCase, target, config);
            };

            wrappedFactory.__heynaPatched = true;
            page[factoryName] = wrappedFactory;
        });
    }

    static patchInputDevices(page, testCase, config) {
        if (page.keyboard && typeof page.keyboard.press === 'function' && !page.keyboard.press.__heynaPatched) {
            const originalKeyboardPress = page.keyboard.press.bind(page.keyboard);
            const wrappedKeyboardPress = async (...args) => {
                const target = { type: 'keyboard', value: args[0] };
                return this.captureAutoAction({
                    page,
                    testCase,
                    action: 'press',
                    target,
                    stepName: this.createStepName('press', target),
                    execute: () => originalKeyboardPress(...args),
                    config
                });
            };

            wrappedKeyboardPress.__heynaPatched = true;
            page.keyboard.press = wrappedKeyboardPress;
        }

        if (page.mouse && typeof page.mouse.click === 'function' && !page.mouse.click.__heynaPatched) {
            const originalMouseClick = page.mouse.click.bind(page.mouse);
            const wrappedMouseClick = async (...args) => {
                const target = { type: 'mouse', value: `${args[0]}, ${args[1]}` };
                return this.captureAutoAction({
                    page,
                    testCase,
                    action: 'click',
                    target,
                    stepName: this.createStepName('click', target),
                    execute: () => originalMouseClick(...args),
                    config
                });
            };

            wrappedMouseClick.__heynaPatched = true;
            page.mouse.click = wrappedMouseClick;
        }
    }

    static wrapLocator(locator, page, testCase, target, config) {
        if (!locator || locator.__heynaProxy) return locator;

        return new Proxy(locator, {
            get: (object, property) => {
                if (property === '__heynaProxy') return true;
                if (property === '__heynaTarget') return target;

                const value = object[property];

                if (config.chainMethods.includes(property) && typeof value === 'function') {
                    return (...args) => {
                        const chainedLocator = value.apply(object, args);
                        const chainedTarget = this.extendTargetDescriptor(target, property, args);
                        return this.wrapLocator(chainedLocator, page, testCase, chainedTarget, config);
                    };
                }

                if (!config.autoActions.includes(property) || typeof value !== 'function') {
                    return typeof value === 'function' ? value.bind(object) : value;
                }

                return async (...args) => {
                    const stepName = this.createStepName(property, target);

                    return this.captureAutoAction({
                        page,
                        testCase,
                        action: property,
                        target,
                        stepName,
                        execute: () => value.apply(object, args),
                        config
                    });
                };
            }
        });
    }

    static async captureAutoAction({ page, testCase, action, target, stepName, execute, config }) {
        const startedAt = Date.now();
        const timestamp = new Date().toISOString();
        this.recordAutoCapture('detected', action);

        try {
            const result = await execute();
            const screenshot = await this.captureScreenshotByMode(page, testCase, stepName, config.screenshotMode, false, action);
            this.recordAutoCapture('captured', action);

            this.addStep(testCase, {
                name: stepName,
                action,
                target: this.targetToString(target),
                status: 'PASS',
                duration: Date.now() - startedAt,
                timestamp,
                mode: 'AUTO',
                screenshot
            });

            return result;
        } catch (error) {
            const screenshot = await this.captureEvidence(page, testCase, stepName, 'FAILED');
            this.recordAutoCapture('captured', action);

            this.addStep(testCase, {
                name: stepName,
                action,
                target: this.targetToString(target),
                status: 'FAIL',
                duration: Date.now() - startedAt,
                timestamp,
                mode: 'AUTO',
                screenshot,
                errorMessage: cleanMessage(error.message)
            });

            throw error;
        }
    }

    static async step(page, testCase, stepName, action) {
        const startedAt = Date.now();
        const timestamp = new Date().toISOString();

        try {
            const result = await action();
            const screenshot = await this.captureScreenshotByMode(page, testCase, stepName, this.config.screenshotMode, false, 'manual');
            this.addStep(testCase, { name: stepName, status: 'PASS', duration: Date.now() - startedAt, timestamp, mode: 'MANUAL', screenshot });
            return result;
        } catch (error) {
            const screenshot = await this.captureEvidence(page, testCase, stepName, 'FAILED');
            this.addStep(testCase, { name: stepName, status: 'FAIL', duration: Date.now() - startedAt, timestamp, mode: 'MANUAL', screenshot, errorMessage: cleanMessage(error.message) });
            throw error;
        }
    }

    static async captureScreenshotByMode(page, testCase, stepName, screenshotMode, isFailure, action) {
        const mode = screenshotMode || 'failure-only';

        if (isFailure) {
            return this.captureEvidence(page, testCase, stepName, 'FAILED');
        }

        if (mode === 'all' || mode === 'on-step') {
            return this.captureEvidence(page, testCase, stepName);
        }

        if (mode === 'important-actions' && this.config.importantActions.includes(action)) {
            return this.captureEvidence(page, testCase, stepName);
        }

        return undefined;
    }

    static addStep(testCase, step) {
        mutateExecution(data => {
            const tc = findOrCreateTestCase(data, testCase);
            const normalized = {
                ...step,
                status: step.status || stepStatus(step.status)
            };

            if (!normalized.screenshot) delete normalized.screenshot;
            tc.steps.push(normalized);

            if (Array.isArray(tc.attempts) && tc.attempts.length) {
                const attempt = tc.attempts[tc.attempts.length - 1];
                attempt.steps = Array.isArray(attempt.steps) ? attempt.steps : [];
                attempt.steps.push(normalized);
            }
        });
    }

    static completeTest(testCase, status, duration, errorMessage, extra = {}) {
        mutateExecution(data => {
            const tc = findOrCreateTestCase(data, testCase);

            tc.status = normalizeStatus(status);
            tc.duration = duration || 0;
            if (errorMessage) tc.errorMessage = cleanMessage(errorMessage);
            if (extra.failureScreenshot) tc.failureScreenshot = extra.failureScreenshot;

            tc.finalResult = tc.status;

            if (Array.isArray(tc.attempts) && tc.attempts.length) {
                const attempt = tc.attempts[tc.attempts.length - 1];
                attempt.status = tc.status;
                attempt.duration = duration || 0;
                attempt.finishedAt = new Date().toISOString();
                if (errorMessage) attempt.errorMessage = cleanMessage(errorMessage);
                if (extra.failureScreenshot) attempt.failureScreenshot = extra.failureScreenshot;
            }
        });

        console.log(`[HEYNA]\n${testCase} => ${normalizeStatus(status)}`);
    }

    static markRunningTestsAsFailed(message = 'Test did not complete before report generation.') {
        mutateExecution(data => {
            data.forEach(tc => {
                if (normalizeStatus(tc.status) === 'RUNNING') {
                    tc.status = 'FAILED';
                    tc.finalResult = 'FAILED';
                    tc.errorMessage = tc.errorMessage || message;
                    if (Array.isArray(tc.attempts) && tc.attempts.length) {
                        const attempt = tc.attempts[tc.attempts.length - 1];
                        attempt.status = 'FAILED';
                        attempt.errorMessage = attempt.errorMessage || message;
                        attempt.finishedAt = attempt.finishedAt || new Date().toISOString();
                    }
                    console.log(`[HEYNA]\n${tc.testCase} => FAILED`);
                }
            });
        });
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
        mutateMetadata(current => {
            return {
                project: process.env.HEYNA_PROJECT || 'SauceDemo',
                feature: process.env.HEYNA_FEATURE || 'Login & Authentication',
                environment: process.env.ENVIRONMENT || 'QA',
                browser: process.env.BROWSER || 'chromium',
                automationTool: 'Playwright',
                executedBy: process.env.HEYNA_EXECUTED_BY || process.env.USERNAME || 'Automation Framework',
                executionStartTime: new Date().toISOString(),
                ...current,
                ...updates
            };
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

    static createPageActionTarget(action, args) {
        if (action === 'dragAndDrop') {
            return {
                type: 'dragAndDrop',
                source: args[0],
                target: args[1]
            };
        }

        if (action === 'setInputFiles') {
            return {
                type: 'upload',
                value: args[0],
                files: args[1]
            };
        }

        return {
            type: 'selector',
            value: args[0]
        };
    }

    static createTargetDescriptor(factoryName, args) {
        const value = args[0];
        const options = args[1] || {};

        if (factoryName === 'getByRole') {
            return {
                type: 'role',
                role: value,
                name: options.name
            };
        }

        if (factoryName === 'getByText') return { type: 'text', value };
        if (factoryName === 'getByLabel') return { type: 'label', value };
        if (factoryName === 'getByPlaceholder') return { type: 'placeholder', value };
        if (factoryName === 'getByTestId') return { type: 'testId', value };
        if (factoryName === 'getByAltText') return { type: 'altText', value };
        if (factoryName === 'getByTitle') return { type: 'title', value };

        return {
            type: 'selector',
            value
        };
    }

    static extendTargetDescriptor(target, chainMethod, args) {
        const next = typeof target === 'object' && target !== null
            ? { ...target }
            : { type: 'selector', value: target };

        next.chain = Array.isArray(next.chain) ? [...next.chain] : [];
        next.chain.push({
            method: chainMethod,
            value: args[0]
        });

        return next;
    }

    static createStepName(action, target) {
        if (action === 'dragAndDrop') {
            return `Drag ${this.readableTarget(target.source) || 'Element'} To ${this.readableTarget(target.target) || 'Element'}`;
        }

        if (action === 'setInputFiles') {
            return `Upload ${this.readableTarget(target.value) || 'File'}`;
        }

        if (action === 'dblclick') {
            const targetName = this.readableTarget(target);
            return targetName ? `Double Click ${targetName}` : 'Double Click Element';
        }

        const targetName = this.readableTarget(target);
        const actionName = titleCase(action);

        if (!targetName) {
            return `${actionName} Element`;
        }

        return `${actionName} ${targetName}`;
    }

    static readableTarget(target) {
        if (typeof target === 'object' && target !== null) {
            if (target.type === 'keyboard') return titleCase(target.value);
            if (target.type === 'mouse') return `Mouse ${target.value}`;
            if (target.type === 'role') return titleCase(target.name || target.role);
            if (target.type === 'label') return titleCase(target.value);
            if (target.type === 'placeholder') return titleCase(target.value);
            if (target.type === 'text') return titleCase(target.value);
            if (target.type === 'testId') return titleCase(target.value);
            if (target.type === 'altText') return titleCase(target.value);
            if (target.type === 'title') return titleCase(target.value);
            if (target.type === 'upload') return this.readableTarget(target.value);
            if (target.type === 'selector') return this.readableTarget(target.value);
        }

        const selector = String(target || '').trim();
        if (!selector) return '';

        const patterns = [
            /\[aria-label=["']?([^"'\]]+)["']?\]/,
            /label=["']?([^"']+)["']?/,
            /\[placeholder=["']?([^"'\]]+)["']?\]/,
            /getByRole\([^,]+,\s*\{\s*name:\s*["']([^"']+)["']/,
            /\[data-testid=["']?([^"'\]]+)["']?\]/,
            /\[data-test=["']?([^"'\]]+)["']?\]/,
            /#([\w-]+)/,
            /\[name=["']?([^"'\]]+)["']?\]/,
            /text=["']?([^"']+)["']?/,
            /\.([\w-]+)/
        ];

        for (const pattern of patterns) {
            const match = selector.match(pattern);
            if (match) return titleCase(match[1]);
        }

        if (/^[a-z]+$/i.test(selector)) return titleCase(selector);

        return '';
    }

    static targetToString(target) {
        if (typeof target !== 'object' || target === null) return String(target || '');

        if (target.type === 'dragAndDrop') {
            return `${this.targetToString(target.source)} -> ${this.targetToString(target.target)}`;
        }

        if (target.type === 'role') {
            return `role=${target.role}${target.name ? ` name=${target.name}` : ''}${this.chainToString(target)}`;
        }

        const value = target.value == null ? '' : String(target.value);
        return `${target.type || 'target'}=${value}${this.chainToString(target)}`;
    }

    static chainToString(target) {
        if (!target || !Array.isArray(target.chain) || !target.chain.length) return '';

        return target.chain
            .map(item => item.value === undefined ? `.${item.method}()` : `.${item.method}(${item.value})`)
            .join('');
    }

    static createEmptyCoverage() {
        return {
            detected: 0,
            captured: 0,
            missed: 0,
            byAction: {}
        };
    }

    static recordAutoCapture(type, action) {
        mutateMetadata(metadata => {
            metadata.autoCaptureCoverage = metadata.autoCaptureCoverage || this.createEmptyCoverage();
            metadata.autoCaptureCoverage[type] = (metadata.autoCaptureCoverage[type] || 0) + 1;
            metadata.autoCaptureCoverage.missed = Math.max(
                0,
                (metadata.autoCaptureCoverage.detected || 0) - (metadata.autoCaptureCoverage.captured || 0)
            );
            metadata.autoCaptureCoverage.byAction = metadata.autoCaptureCoverage.byAction || {};
            metadata.autoCaptureCoverage.byAction[action] = metadata.autoCaptureCoverage.byAction[action] || {
                detected: 0,
                captured: 0
            };
            metadata.autoCaptureCoverage.byAction[action][type] =
                (metadata.autoCaptureCoverage.byAction[action][type] || 0) + 1;
        });
    }

    static getAutoCaptureCoverage() {
        const metadata = this.getMetadata();
        const coverage = metadata.autoCaptureCoverage || this.createEmptyCoverage();

        return {
            detected: coverage.detected || 0,
            captured: coverage.captured || 0,
            missed: Math.max(0, (coverage.detected || 0) - (coverage.captured || 0)),
            byAction: coverage.byAction || {}
        };
    }

    static printAutoCaptureCoverage() {
        const coverage = this.getAutoCaptureCoverage();

        console.log([
            'Auto Capture Coverage',
            `Detected Actions: ${coverage.detected}`,
            `Captured: ${coverage.captured}`,
            `Missed: ${coverage.missed}`
        ].join('\n'));
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
