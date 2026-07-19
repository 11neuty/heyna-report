const Heyna = require('./utils/HeynaReporter');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { HeynaPdfGenerator } = require('./utils/HeynaPdfGenerator');
const { HeynaHtmlDashboardGenerator } = require('./utils/HeynaHtmlDashboardGenerator');
const HistoryManager = require('./utils/HistoryManager');

async function runTeardown(options = {}) {
    const reporter = options.reporter || Heyna;
    const pdfGenerator = options.pdfGenerator || HeynaPdfGenerator;
    const htmlGenerator = options.htmlGenerator || HeynaHtmlDashboardGenerator;
    const logger = options.logger || console;
    const failures = [];
    const artifacts = { pdf: false, dashboard: false };
    let historyResult;

    if (options.artifactRoot || options.projectRoot) reporter.configure({
        ...(options.projectRoot ? { projectRoot: options.projectRoot } : {}),
        ...(options.artifactRoot ? { artifactRoot: options.artifactRoot } : {})
    });
    const paths = options.paths || reporter.getPaths();

    const attempt = async (label, action) => {
        try {
            return await action();
        } catch (error) {
            failures.push({ label, error });
            logger.error(`[HEYNA TEARDOWN] ${label} failed: ${error.message}`);
            return undefined;
        }
    };

    try {
        await attempt('current-run finalization', async () => {
            reporter.markRunningTestsAsFailed();
            reporter.printAutoCaptureCoverage();
            reporter.updateMetadata({
                runStatus: 'COMPLETED',
                executionEndTime: new Date().toISOString()
            });
        });

        artifacts.pdf = await attempt('PDF generation', () => pdfGenerator.generate({ paths })) || false;
        artifacts.dashboard = await attempt('HTML dashboard generation', () => htmlGenerator.generate({ paths })) || false;

        historyResult = await attempt('history persistence', async () => {
            const historyManager = options.historyManager || new HistoryManager({ paths, logger });
            await historyManager.initialize();
            const persisted = await historyManager.persistRun({
                artifacts: {
                    pdf: artifacts.pdf,
                    dashboard: artifacts.dashboard ? paths.dashboardDir : false,
                    evidence: paths.evidenceDir
                }
            });
            for (const warning of (persisted && persisted.warnings) || []) {
                logger.error(`[HEYNA TEARDOWN] history warning ${warning.code}: ${warning.message}`);
            }
            return persisted;
        });
    } finally {
        await attempt('run-lock cleanup', async () => reporter.completeRun());
        if (options.cleanupArtifactRoot === true && process.env.HEYNA_CLEAN_ARTIFACT_ROOT === '1' && process.env.HEYNA_ARTIFACT_ROOT) {
            const root = path.resolve(process.env.HEYNA_ARTIFACT_ROOT);
            const relativeToTemp = path.relative(path.resolve(os.tmpdir()), root);
            if (relativeToTemp && !relativeToTemp.startsWith('..') && !path.isAbsolute(relativeToTemp)) {
                fs.rmSync(root, { recursive: true, force: true });
                if (typeof logger.log === 'function') logger.log(`[HEYNA TEARDOWN] Cleaned isolated artifact root: ${root}`);
            }
        }
    }

    if (failures.length && options.throwOnError !== false) {
        const error = new AggregateError(
            failures.map(item => item.error),
            `HEYNA teardown completed with ${failures.length} failure(s): ${failures.map(item => item.label).join(', ')}`
        );
        error.failures = failures;
        error.historyResult = historyResult;
        throw error;
    }

    return { failures, artifacts, historyResult };
}

module.exports = async function playwrightGlobalTeardown() {
    return runTeardown({ cleanupArtifactRoot: true });
};
module.exports.runTeardown = runTeardown;
