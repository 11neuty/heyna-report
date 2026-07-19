const fs = require('fs');
const os = require('os');
const path = require('path');
const Heyna = require('../../utils/HeynaReporter');
const HistoryManager = require('../../utils/HistoryManager');
const { runTeardown } = require('../../heyna.global-teardown');

async function main() {
    const projectRoot = path.resolve(__dirname, '..', '..');
    const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'heyna-lifecycle-'));
    let output;
    try {
        Heyna.configure({
            projectRoot,
            artifactRoot,
            history: {
                enabled: true,
                migration: { enabled: false },
                retention: { enabled: false },
                artifacts: { evidence: false, traces: false }
            }
        });
        const runIds = [];
        for (let index = 1; index <= 2; index += 1) {
            Heyna.initializeRun({ reset: true, project: 'Lifecycle Validation', feature: 'Issue 17' });
            Heyna.initializeTest(`TC_LIFECYCLE_${index}`);
            Heyna.completeTest(`TC_LIFECYCLE_${index}`, index === 1 ? 'TIMEDOUT' : 'INTERRUPTED', index * 10, {
                errorMessage: 'Lifecycle validation'
            });
            const result = await runTeardown({ reporter: Heyna, artifactRoot, projectRoot });
            runIds.push(result.historyResult.runId);
        }

        const manager = new HistoryManager({
            paths: Heyna.getPaths(),
            history: Heyna.getConfig().history,
            logger: { log() {}, error() {} }
        });
        const latest = await manager.getLatestRun();
        output = {
            artifactRoot,
            runIds,
            latestRunId: latest.runId,
            latestTimestamp: latest.summary.timestamp,
            temporaryEntries: fs.readdirSync(manager.paths.historyTempDir),
            lockExists: fs.existsSync(manager.paths.historyLockFile),
            reportExists: fs.existsSync(manager.paths.reportFile),
            dashboardExists: fs.existsSync(manager.paths.dashboardFile),
            runFiles: runIds.map(runId => fs.readdirSync(path.join(manager.paths.historyRunsDir, runId)).sort())
        };
    } finally {
        const resolved = path.resolve(artifactRoot);
        const relative = path.relative(path.resolve(os.tmpdir()), resolved);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(resolved).startsWith('heyna-lifecycle-')) {
            throw new Error(`Refusing to clean unsafe lifecycle root: ${resolved}`);
        }
        fs.rmSync(resolved, { recursive: true, force: true });
        if (output) output.cleaned = !fs.existsSync(resolved);
    }
    process.stdout.write(`LIFECYCLE_RESULT=${JSON.stringify(output)}\n`);
}

main().catch(error => {
    process.stderr.write(error.stack || error.message);
    process.exitCode = 1;
});
