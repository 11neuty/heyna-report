const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    INVOCATION_ID,
    OWNERSHIP_MARKER,
    OWNERSHIP_SCHEMA_VERSION,
    TEST_ROOT_NAME
} = require('./heyna.test-bootstrap');

const CLEANUP_REFUSED = 'HEYNA_TEST_CLEANUP_REFUSED';
const CLEANUP_FAILED = 'HEYNA_TEST_CLEANUP_FAILED';

function cleanupError(code) {
    const error = new Error(code === CLEANUP_FAILED
        ? 'HEYNA temporary test artifact cleanup could not be completed.'
        : 'HEYNA temporary test artifact cleanup was refused.');
    error.code = code;
    return error;
}

function exactMarker(value, ownership) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const keys = Object.keys(value).sort();
    if (keys.join(',') !== 'invocationId,rootName,schemaVersion') return false;
    return value.schemaVersion === OWNERSHIP_SCHEMA_VERSION
        && value.schemaVersion === ownership.schemaVersion
        && value.invocationId === ownership.invocationId
        && value.rootName === ownership.rootName;
}

function containsDirectoryLink(root, fileSystem) {
    for (const name of fileSystem.readdirSync(root)) {
        const target = path.join(root, name);
        const stat = fileSystem.lstatSync(target);
        if (stat.isSymbolicLink()) return true;
        if (stat.isDirectory() && containsDirectoryLink(target, fileSystem)) return true;
    }
    return false;
}

function validateOwnedTemporaryRoot(scope, fileSystem = fs) {
    if (!scope || scope.cleanup !== true || !scope.ownership) return null;
    if (typeof scope.root !== 'string' || !scope.root || path.resolve(scope.root) !== scope.root) {
        throw cleanupError(CLEANUP_REFUSED);
    }
    const ownership = scope.ownership;
    if (ownership.schemaVersion !== OWNERSHIP_SCHEMA_VERSION
        || ownership.markerName !== OWNERSHIP_MARKER
        || !INVOCATION_ID.test(ownership.invocationId || '')
        || !TEST_ROOT_NAME.test(ownership.rootName || '')
        || path.basename(scope.root) !== ownership.rootName) {
        throw cleanupError(CLEANUP_REFUSED);
    }

    let rootStat;
    try {
        rootStat = fileSystem.lstatSync(scope.root);
    } catch (error) {
        if (error && error.code === 'ENOENT') return null;
        throw cleanupError(CLEANUP_REFUSED);
    }
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw cleanupError(CLEANUP_REFUSED);

    let temporaryRoot;
    let parent;
    let root;
    try {
        temporaryRoot = fileSystem.realpathSync(os.tmpdir());
        parent = fileSystem.realpathSync(path.dirname(scope.root));
        root = fileSystem.realpathSync(scope.root);
    } catch (error) {
        throw cleanupError(CLEANUP_REFUSED);
    }
    if (parent !== temporaryRoot || path.dirname(root) !== temporaryRoot || path.basename(root) !== ownership.rootName) {
        throw cleanupError(CLEANUP_REFUSED);
    }

    const markerPath = path.join(root, OWNERSHIP_MARKER);
    try {
        const markerStat = fileSystem.lstatSync(markerPath);
        if (!markerStat.isFile() || markerStat.isSymbolicLink()) throw cleanupError(CLEANUP_REFUSED);
        const markerRealPath = fileSystem.realpathSync(markerPath);
        if (path.dirname(markerRealPath) !== root) throw cleanupError(CLEANUP_REFUSED);
        const marker = JSON.parse(fileSystem.readFileSync(markerPath, 'utf8'));
        if (!exactMarker(marker, ownership)) throw cleanupError(CLEANUP_REFUSED);
        if (containsDirectoryLink(root, fileSystem)) throw cleanupError(CLEANUP_REFUSED);
    } catch (error) {
        if (error && error.code === CLEANUP_REFUSED) throw error;
        throw cleanupError(CLEANUP_REFUSED);
    }
    return root;
}

function removeOwnedTemporaryRoot(scope, fileSystem = fs) {
    const root = validateOwnedTemporaryRoot(scope, fileSystem);
    if (!root) return false;
    try {
        fileSystem.rmSync(root, { recursive: true, force: true });
        return true;
    } catch (error) {
        throw cleanupError(CLEANUP_FAILED);
    }
}

class HeynaTestCleanupReporter {
    constructor(options = {}) {
        this.scope = {
            root: options.root,
            cleanup: options.cleanup === true,
            ownership: options.ownership || null
        };
        this.fileSystem = options.fileSystem || fs;
        this.logger = options.logger || console;
    }

    async onExit() {
        try {
            removeOwnedTemporaryRoot(this.scope, this.fileSystem);
        } catch (error) {
            if (this.logger && typeof this.logger.error === 'function') {
                this.logger.error(`[HEYNA TEST CLEANUP] ${error.code === CLEANUP_FAILED
                    ? 'Temporary artifact cleanup could not be completed.'
                    : 'Temporary artifact cleanup was refused.'}`);
            }
        }
    }
}

HeynaTestCleanupReporter.CLEANUP_FAILED = CLEANUP_FAILED;
HeynaTestCleanupReporter.CLEANUP_REFUSED = CLEANUP_REFUSED;
HeynaTestCleanupReporter.removeOwnedTemporaryRoot = removeOwnedTemporaryRoot;
HeynaTestCleanupReporter.validateOwnedTemporaryRoot = validateOwnedTemporaryRoot;

module.exports = HeynaTestCleanupReporter;
