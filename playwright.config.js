// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const frameworkOnly = process.env.HEYNA_FRAMEWORK_ISOLATED === '1'
  || process.argv.slice(2).some(argument => String(argument).replace(/\\/g, '/').includes('tests/framework'));
if (frameworkOnly && !process.env.HEYNA_ARTIFACT_ROOT) {
  process.env.HEYNA_ARTIFACT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'heyna-framework-'));
  process.env.HEYNA_CLEAN_ARTIFACT_ROOT = '1';
}
const isolatedRoot = frameworkOnly ? process.env.HEYNA_ARTIFACT_ROOT : null;

module.exports = defineConfig({

  testDir: './tests',

  outputDir: isolatedRoot ? path.join(isolatedRoot, 'playwright-output') : 'test-results',

  globalTeardown: './heyna.global-teardown.js',

  fullyParallel: false,

  forbidOnly: !!process.env.CI,

  retries: process.env.CI ? 2 : 0,

  workers: 1,

  reporter: [
    ['list'],
    ['allure-playwright', isolatedRoot ? { resultsDir: path.join(isolatedRoot, 'allure-results') } : {}]
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
