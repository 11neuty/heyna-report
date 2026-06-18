const { HeynaPdfGenerator } = require('./utils/HeynaPdfGenerator');
const { HeynaHtmlDashboardGenerator } = require('./utils/HeynaHtmlDashboardGenerator');

async function regenerateReport() {
    try {
        console.log('Regenerating HEYNA REPORT...');
        const pdfPath = await HeynaPdfGenerator.generate();
        const dashboardPath = await HeynaHtmlDashboardGenerator.generate();
        console.log(`PDF report regenerated successfully: ${pdfPath}`);
        console.log(`HTML dashboard regenerated successfully: ${dashboardPath}`);
    } catch (error) {
        console.error('Error generating report:', error);
        process.exit(1);
    }
}

regenerateReport();
