const Heyna = require('./utils/HeynaReporter');
const { HeynaPdfGenerator } = require('./utils/HeynaPdfGenerator');
const { HeynaHtmlDashboardGenerator } = require('./utils/HeynaHtmlDashboardGenerator');

module.exports = async () => {
    Heyna.markRunningTestsAsFailed();
    Heyna.printAutoCaptureCoverage();
    Heyna.updateMetadata({
        runStatus: 'COMPLETED',
        executionEndTime: new Date().toISOString()
    });
    await HeynaPdfGenerator.generate();
    await HeynaHtmlDashboardGenerator.generate();
};
