const path = require('path');
const fs = require('fs');

async function main() {
    const [projectRoot, artifactRoot, action = 'persist', encoded = 'e30='] = process.argv.slice(2);
    const options = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    const HistoryManager = require(path.join(projectRoot, 'utils', 'HistoryManager'));
    const { resolveArtifactPaths } = require(path.join(projectRoot, 'utils', 'ArtifactPaths'));
    const history = {
        enabled: true,
        rootDir: options.rootDir || 'history',
        migration: { enabled: options.migrationEnabled === true },
        retention: options.retention || { enabled: false },
        lock: {
            retryDelayMs: options.retryDelayMs ?? 20,
            maxRetries: options.maxRetries ?? 250,
            staleMs: options.staleMs ?? 30000
        }
    };
    const paths = resolveArtifactPaths({ projectRoot, artifactRoot, config: { history } });
    const lockOperations = {};
    if (options.claimReadyFile) {
        lockOperations.afterPublishLockClaim = owner => {
            fs.writeFileSync(path.join(artifactRoot, options.claimReadyFile), `${JSON.stringify(owner)}\n`, 'utf8');
        };
    }
    if (action === 'recover-boundary') {
        lockOperations.beforeRemoveStaleClaim = claim => {
            const boundaryFile = path.join(artifactRoot, options.boundaryFile || 'recovery-boundary.json');
            const continueFile = path.join(artifactRoot, options.continueFile || 'replacement-claim-ready.json');
            fs.writeFileSync(boundaryFile, `${JSON.stringify({ staleToken: claim.token })}\n`, 'utf8');
            const deadline = Date.now() + (options.boundaryTimeoutMs || 5000);
            while (!fs.existsSync(continueFile) && Date.now() < deadline) {
                // Deterministic test-only operation boundary; production never spins.
            }
            if (!fs.existsSync(continueFile)) throw new Error('Timed out waiting for replacement claim at recovery boundary.');
        };
    }
    if (action === 'recover-crash') {
        lockOperations.beforeRemoveStaleClaim = () => process.exit(options.exitCode || 77);
    }
    const manager = new HistoryManager({ paths, history, lockOperations, logger: { log() {}, error() {} } });
    manager.ensureHistoryDirectories();

    if (action === 'migrate-only') {
        const initialized = await manager.initialize();
        process.stdout.write(JSON.stringify({ migrated: initialized.migrated }));
        return;
    }

    if (action === 'orphan-lock') {
        const owner = await manager.acquireHistoryLock();
        process.stdout.write(JSON.stringify({ locked: true, token: owner.token, claimDir: owner.claimDir }));
        process.exit(0);
    }
    if (action === 'orphan-staging') {
        await manager.acquireHistoryLock();
        const runId = '20260701-000000-000-bad0cafe';
        const temporary = path.join(paths.historyTempDir, runId);
        fs.mkdirSync(temporary, { recursive: true });
        fs.writeFileSync(path.join(temporary, 'partial.json'), '{');
        const old = new Date(Date.now() - (2 * 86400000));
        fs.utimesSync(temporary, old, old);
        process.stdout.write(JSON.stringify({ locked: true, runId }));
        process.exit(0);
    }
    if (action === 'hold-lock') {
        await manager.withHistoryLock(() => new Promise(resolve => setTimeout(resolve, options.holdMs || 500)));
        process.stdout.write(JSON.stringify({ held: true }));
        return;
    }
    if (action === 'hold-lock-signal') {
        const owner = await manager.acquireHistoryLock();
        const signalFile = path.join(artifactRoot, options.signalFile || 'history-holder-ready.json');
        fs.writeFileSync(signalFile, `${JSON.stringify(owner)}\n`, 'utf8');
        try {
            await new Promise(resolve => setTimeout(resolve, options.holdMs ?? 500));
        } finally {
            manager.releaseHistoryLock(owner);
        }
        process.stdout.write(JSON.stringify({ held: true, token: owner.token }));
        return;
    }
    if (action === 'recover-boundary') {
        const recovered = manager.recoverStaleLock();
        let protectedEntries = 0;
        let busyError = null;
        try {
            await manager.withHistoryLock(() => { protectedEntries += 1; });
        } catch (error) {
            busyError = error.message;
        }
        process.stdout.write(JSON.stringify({ recovered, protectedEntries, busyError }));
        return;
    }
    if (action === 'recover-crash') {
        manager.recoverStaleLock();
        process.stdout.write(JSON.stringify({ unexpectedlyCompleted: true }));
        return;
    }
    if (action === 'critical-section') {
        let token;
        await manager.withHistoryLock(async () => {
            const claims = manager.listLockClaims();
            const own = claims.find(claim => claim.owner && claim.owner.pid === process.pid);
            token = own && own.token;
            const logFile = path.join(artifactRoot, options.logFile || 'critical-section.log');
            fs.appendFileSync(logFile, `${JSON.stringify({ event: 'enter', token, pid: process.pid })}\n`);
            await new Promise(resolve => setTimeout(resolve, options.holdMs || 25));
            fs.appendFileSync(logFile, `${JSON.stringify({ event: 'exit', token, pid: process.pid })}\n`);
        });
        process.stdout.write(JSON.stringify({ entered: true, token }));
        return;
    }
    if (action === 'fail-protected') {
        await manager.withHistoryLock(() => { throw new Error('protected operation injected'); });
        return;
    }

    const timestamp = options.timestamp || new Date().toISOString();
    const result = await manager.persistRun({
        ...(options.runId ? { runId: options.runId } : {}),
        createdAt: timestamp,
        execution: [{ testCase: options.testCase || 'TC_CHILD', status: options.status || 'PASSED', duration: 1, traceAvailable: false }],
        metadata: { executionStartTime: timestamp, executionEndTime: timestamp, project: 'Child process' }
    });
    process.stdout.write(JSON.stringify({ runId: result.runId, warnings: result.warnings }));
}

main().catch(error => {
    process.stderr.write(error.stack || error.message);
    process.exitCode = 1;
});
