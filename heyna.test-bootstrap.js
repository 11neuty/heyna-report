const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TEST_ROOT_PREFIX = 'heyna-framework-test-';
const TEST_ROOT_NAME = /^heyna-framework-test-[A-Za-z0-9_-]{6,}$/;
const OWNERSHIP_MARKER = '.heyna-test-root.json';
const OWNERSHIP_SCHEMA_VERSION = '1.0.0';
const INVOCATION_ID = /^[a-f0-9]{64}$/;
const STALE_INTERNAL_VARIABLES = Object.freeze([
    'HEYNA_TEST_COMMAND_ROOT',
    'HEYNA_CLEAN_ARTIFACT_ROOT',
    'HEYNA_FRAMEWORK_ISOLATED',
    'HEYNA_FRAMEWORK_ONLY',
    'HEYNA_FRAMEWORK_ISOLATION'
]);

function boundedRoot(value, label) {
    if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
        throw new TypeError(`${label} must be a non-empty filesystem path.`);
    }
    return path.resolve(value);
}

function ownedScope(root, invocationId) {
    const rootName = path.basename(root);
    if (!TEST_ROOT_NAME.test(rootName) || !INVOCATION_ID.test(invocationId)) {
        throw new Error('HEYNA test artifact ownership could not be established.');
    }
    const marker = { schemaVersion: OWNERSHIP_SCHEMA_VERSION, invocationId, rootName };
    try {
        fs.writeFileSync(path.join(root, OWNERSHIP_MARKER), `${JSON.stringify(marker, null, 2)}\n`, {
            encoding: 'utf8',
            flag: 'wx'
        });
    } catch (error) {
        try { fs.rmdirSync(root); } catch (cleanupError) { /* Leave only the newly-created empty root. */ }
        throw new Error('HEYNA test artifact ownership could not be established.');
    }
    return Object.freeze({
        root,
        cleanup: true,
        ownership: Object.freeze({ ...marker, markerName: OWNERSHIP_MARKER })
    });
}

function resolveTestArtifactScope(options = {}) {
    const environment = options.environment || process.env;
    const explicitRoot = environment.HEYNA_ARTIFACT_ROOT;
    if (explicitRoot) {
        return Object.freeze({
            root: boundedRoot(explicitRoot, 'HEYNA_ARTIFACT_ROOT'),
            cleanup: false,
            ownership: null
        });
    }

    const createTemporaryRoot = options.createTemporaryRoot
        || (() => fs.mkdtempSync(path.join(os.tmpdir(), TEST_ROOT_PREFIX)));
    const createInvocationId = options.createInvocationId
        || (() => crypto.randomBytes(32).toString('hex'));
    const root = boundedRoot(createTemporaryRoot(), 'temporary artifact root');
    return ownedScope(root, createInvocationId());
}

function applyTestArtifactScope(scope, environment = process.env) {
    if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
        throw new TypeError('Playwright metadata must contain a test artifact scope.');
    }
    const root = boundedRoot(scope.root, 'test artifact scope root');
    if (typeof scope.cleanup !== 'boolean') throw new TypeError('test artifact scope cleanup must be boolean.');
    if (scope.cleanup && (!scope.ownership || typeof scope.ownership !== 'object')) {
        throw new TypeError('owned test artifact scope must contain ownership metadata.');
    }
    environment.HEYNA_ARTIFACT_ROOT = root;
    for (const name of STALE_INTERNAL_VARIABLES) delete environment[name];
    return Object.freeze({
        root,
        cleanup: scope.cleanup,
        ownership: scope.ownership ? Object.freeze({ ...scope.ownership }) : null
    });
}

module.exports = {
    INVOCATION_ID,
    OWNERSHIP_MARKER,
    OWNERSHIP_SCHEMA_VERSION,
    STALE_INTERNAL_VARIABLES,
    TEST_ROOT_NAME,
    TEST_ROOT_PREFIX,
    applyTestArtifactScope,
    resolveTestArtifactScope
};
