// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const path = require('path');
const { resolveTestArtifactScope } = require('./heyna.test-bootstrap');

const testArtifactScope = resolveTestArtifactScope();
const isolatedRoot = testArtifactScope.root;

module.exports = defineConfig({

  testDir: './tests',

  metadata: { heynaTestArtifactScope: testArtifactScope },

  outputDir: path.join(isolatedRoot, 'playwright-output'),

  globalSetup: './heyna.global-setup.js',

  globalTeardown: './heyna.global-teardown.js',

  fullyParallel: false,

  forbidOnly: !!process.env.CI,

  retries: process.env.CI ? 2 : 0,

  workers: 1,

  reporter: [
    ['list'],
    ['allure-playwright', { resultsDir: path.join(isolatedRoot, 'allure-results') }],
    ['./heyna.test-cleanup-reporter.js', testArtifactScope]
  ],

  use: {
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome']
      },
    }
  ]

});
