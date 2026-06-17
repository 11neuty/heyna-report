const Heyna = require('./utils/HeynaReporter');
const { HeynaPdfGenerator } = require('./utils/HeynaPdfGenerator');

module.exports = async () => {
    Heyna.markRunningTestsAsFailed();
    Heyna.printAutoCaptureCoverage();
    Heyna.updateMetadata({
        runStatus: 'COMPLETED',
        executionEndTime: new Date().toISOString()
    });
    await HeynaPdfGenerator.generate();
};
