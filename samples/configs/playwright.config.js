// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({

  testDir: ['./tests', './examples'],

  globalTeardown: './heyna.global-teardown.js',

  fullyParallel: false,

  forbidOnly: !!process.env.CI,

  retries: process.env.CI ? 2 : 0,

  workers: 1,

  reporter: [
    ['list'],
    ['allure-playwright']
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
