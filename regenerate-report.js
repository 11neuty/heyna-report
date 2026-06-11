const { HeynaPdfGenerator } = require('./utils/HeynaPdfGenerator');

async function regenerateReport() {
    try {
        console.log('Regenerating HEYNA REPORT...');
        const outputPath = await HeynaPdfGenerator.generate();
        console.log(`Report regenerated successfully: ${outputPath}`);
    } catch (error) {
        console.error('Error generating report:', error);
        process.exit(1);
    }
}

regenerateReport();
