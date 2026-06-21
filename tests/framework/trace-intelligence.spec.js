const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const Heyna = require('../../utils/HeynaReporter');
const HeynaPdfGenerator = require('../../utils/HeynaPdfGenerator');

const PASSED = 'PASSED';
const FAILED = 'FAILED';

test.describe('trace detection', () => {
    test('detectTrace returns traceAvailable:true when trace.zip exists', async ({ page }, testInfo) => {
        const traceDir = testInfo.outputDir;
        fs.mkdirSync(traceDir, { recursive: true });
        const tracePath = path.join(traceDir, 'trace.zip');
        fs.writeFileSync(tracePath, 'fake trace content');

        const result = Heyna.detectTrace(testInfo);
        expect(result.traceAvailable).toBe(true);
        expect(result.traceFile).toBeTruthy();
        expect(result.traceSize).toBeGreaterThan(0);
        expect(result.traceModified).toBeTruthy();
    });

    test('detectTrace returns traceAvailable:false when trace.zip missing', async ({ page }, testInfo) => {
        const result = Heyna.detectTrace(testInfo);
        expect(result.traceAvailable).toBe(false);
    });

    test('detectTrace returns traceAvailable:false when testInfo null', () => {
        const result = Heyna.detectTrace(null);
        expect(result).toEqual({ traceAvailable: false });
    });

    test('detectTrace returns traceAvailable:false when testInfo.outputDir missing', () => {
        const result = Heyna.detectTrace({});
        expect(result).toEqual({ traceAvailable: false });
    });

    test('detectTrace handles corrupt file gracefully', async ({ page }, testInfo) => {
        const traceDir = testInfo.outputDir;
        fs.mkdirSync(traceDir, { recursive: true });
        const tracePath = path.join(traceDir, 'trace.zip');
        fs.writeFileSync(tracePath, '');

        const result = Heyna.detectTrace(testInfo);
        expect(result.traceAvailable).toBe(true);
        expect(result.traceSize).toBe(0);
    });
});

test.describe('completeTest trace persistence', () => {
    test('stores trace metadata on test case when trace available', async ({ page }, testInfo) => {
        const traceDir = testInfo.outputDir;
        fs.mkdirSync(traceDir, { recursive: true });
        const tracePath = path.join(traceDir, 'trace.zip');
        fs.writeFileSync(tracePath, 'trace data');

        Heyna.completeTest('TC_TraceTest', PASSED, 100, null, { testInfo });
        const data = Heyna.getExecutionData();
        const tc = data.find(t => t.testCase === 'TC_TraceTest');
        expect(tc.traceAvailable).toBe(true);
        expect(tc.traceFile).toBeTruthy();
        expect(tc.traceSize).toBeGreaterThan(0);
    });

    test('stores traceAvailable:false when no trace', () => {
        Heyna.completeTest('TC_NoTrace', PASSED, 100, null, {});
        const data = Heyna.getExecutionData();
        const tc = data.find(t => t.testCase === 'TC_NoTrace');
        expect(tc.traceAvailable).toBe(false);
        expect(tc.traceFile).toBeUndefined();
    });

    test('backward compatible - no extra.traceInfo still works', () => {
        Heyna.completeTest('TC_Legacy', PASSED, 100, null, {});
        const data = Heyna.getExecutionData();
        const tc = data.find(t => t.testCase === 'TC_Legacy');
        expect(tc.traceAvailable).toBe(false);
        expect(tc.status).toBe(PASSED);
    });

    test('does not break failureScreenshot passing', () => {
        Heyna.completeTest('TC_TraceAndScreenshot', FAILED, 200, 'Error!', {
            failureScreenshot: 'evidence/test/fail.png'
        });
        const data = Heyna.getExecutionData();
        const tc = data.find(t => t.testCase === 'TC_TraceAndScreenshot');
        expect(tc.failureScreenshot).toBe('evidence/test/fail.png');
        expect(tc.traceAvailable).toBe(false);
    });
});

test.describe('formatFileSize', () => {
    test('formatFileSize returns B for < 1024', () => {
        expect(HeynaPdfGenerator.formatFileSize(500)).toBe('500 B');
    });

    test('formatFileSize returns KB for < 1048576', () => {
        expect(HeynaPdfGenerator.formatFileSize(2048)).toBe('2.0 KB');
    });

    test('formatFileSize returns MB for >= 1048576', () => {
        const result = HeynaPdfGenerator.formatFileSize(2097152);
        expect(result).toBe('2.0 MB');
    });

    test('formatFileSize handles zero', () => {
        expect(HeynaPdfGenerator.formatFileSize(0)).toBe('0 B');
    });

    test('formatFileSize handles null', () => {
        expect(HeynaPdfGenerator.formatFileSize(null)).toBe('0 B');
    });
});

function makeMockDoc() {
    const storage = { textLines: [], values: {} };
    const methods = {};

    function chain(prop, fn) {
        methods[prop] = fn;
    }

    const mockDoc = new Proxy({}, {
        get: (target, prop) => {
            if (prop === 'y') return storage.y || 100;
            if (prop === 'page') return { width: 595, height: 841 };
            if (methods[prop]) return methods[prop];
            if (typeof prop === 'string' && !prop.startsWith('__')) {
                return (...args) => {
                    if (prop === 'text') {
                        storage.textLines.push(args[0]);
                    }
                    return mockDoc;
                };
            }
            return undefined;
        },
        set: (target, prop, value) => {
            storage[prop] = value;
            return true;
        }
    });

    storage.y = 100;
    return { mockDoc, storage };
}

test.describe('traceIntelligence PDF rendering', () => {
    test('renders no traces empty state', () => {
        const { mockDoc, storage } = makeMockDoc();
        HeynaPdfGenerator.traceIntelligence(mockDoc, []);
        expect(storage.textLines.some(l => l.includes('No trace artifacts detected'))).toBe(true);
    });

    test('renders no traces collected empty state', () => {
        const { mockDoc, storage } = makeMockDoc();
        HeynaPdfGenerator.traceIntelligence(mockDoc, [{ testCase: 'TC1', traceAvailable: false }]);
        expect(storage.textLines.some(l => l.includes('No trace artifacts were collected'))).toBe(true);
    });

    test('renders trace table with available traces', () => {
        const { mockDoc, storage } = makeMockDoc();
        const executionData = [
            {
                testCase: 'TC_WithTrace',
                traceAvailable: true,
                traceSize: 1024,
                traceFile: 'test-results/tc/trace.zip'
            }
        ];
        HeynaPdfGenerator.traceIntelligence(mockDoc, executionData);
        expect(storage.textLines.some(l => l.includes('TRACE INTELLIGENCE'))).toBe(true);
        expect(storage.textLines.some(l => l.includes('TC_WithTrace'))).toBe(true);
    });

    test('handles mixed available and unavailable traces', () => {
        const { mockDoc, storage } = makeMockDoc();
        const executionData = [
            { testCase: 'TC1', traceAvailable: true, traceSize: 512, traceFile: 't1/trace.zip' },
            { testCase: 'TC2', traceAvailable: false }
        ];
        HeynaPdfGenerator.traceIntelligence(mockDoc, executionData);
        expect(storage.textLines.some(l => l.includes('TRACE INTELLIGENCE'))).toBe(true);
        expect(storage.textLines.some(l => l.includes('TC1'))).toBe(true);
        expect(storage.textLines.some(l => l.includes('TC2'))).toBe(false);
    });
});
