const { applyTestArtifactScope } = require('./heyna.test-bootstrap');

module.exports = async function playwrightGlobalSetup(config) {
    const metadata = config && config.metadata;
    applyTestArtifactScope(metadata && metadata.heynaTestArtifactScope);
};
