# Sample Project

This document shows how to use HEYNA REPORT in a Playwright project.

## Folder Structure

```text
sample-project/
|-- assets/
|   |-- heyna-logo.png
|-- pages/
|   |-- BasePage.js
|   |-- LoginPage.js
|-- tests/
|   |-- examples/
|   |   |-- login.spec.js
|   |-- framework/
|   |   |-- auto-capture.spec.js
|   |   |-- pdf-generator.spec.js
|-- utils/
|   |-- HeynaReporter.js
|   |-- HeynaPdfGenerator.js
|   |-- HeynaHtmlDashboardGenerator.js
|-- package.json
|-- playwright.config.js
```

## Sample Page Object

```js
// pages/LoginPage.js
const { expect } = require('@playwright/test');

class LoginPage {
    constructor(page) {
        this.page = page;
        this.usernameInput = page.locator('[data-test="username"]');
        this.passwordInput = page.locator('[data-test="password"]');
        this.loginButton = page.locator('[data-test="login-button"]');
        this.errorMessage = page.locator('[data-test="error"]');
    }

    async open() {
        await this.page.goto('https://www.saucedemo.com/');
    }

    async login(username, password) {
        await this.usernameInput.fill(username);
        await this.passwordInput.fill(password);
        await this.loginButton.click();
    }

    async verifyLoginSuccess() {
        await expect(this.page).toHaveURL(/inventory/);
    }

    async verifyLoginFailed() {
        await expect(this.errorMessage).toBeVisible();
    }
}

module.exports = { LoginPage };
```

## Sample Test

```js
// tests/examples/login.spec.js
const { test } = require('@playwright/test');
const { LoginPage } = require('../../pages/LoginPage');
const Heyna = require('../../utils/HeynaReporter');
const { HeynaPdfGenerator } = require('../../utils/HeynaPdfGenerator');

let currentTC;
let currentLogger;

test.beforeAll(async () => {
    Heyna.initializeRun({
        project: 'SauceDemo',
        feature: 'Login',
        environment: process.env.ENVIRONMENT || 'QA',
        browser: process.env.BROWSER || 'chromium',
        executedBy: 'QA Automation Team'
    });
});

test.beforeEach(async ({ page }, testInfo) => {
    currentTC = testInfo.title.replace(/\s+/g, '_');
    currentLogger = Heyna.createApiLogger(page, currentTC);
    Heyna.initializeTest(currentTC);
    Heyna.attach(page, currentTC);
});

test.afterEach(async ({ page }, testInfo) => {
    let failureScreenshot;

    if (testInfo.status === 'failed') {
        failureScreenshot = await Heyna.captureEvidence(
            page,
            currentTC,
            'Failure_Screenshot',
            'FAILED'
        );
    }

    currentLogger.save();

    Heyna.completeTest(
        currentTC,
        testInfo.status.toUpperCase(),
        testInfo.duration,
        testInfo.error ? testInfo.error.message : undefined,
        { failureScreenshot }
    );
});

test.afterAll(async () => {
    Heyna.markRunningTestsAsFailed();
    await HeynaPdfGenerator.generate();
});

test('TC001 Login Success', async ({ page }) => {
    const loginPage = new LoginPage(page);

    await test.step('Open Login Page', async () => {
        await loginPage.open();
    });

    await test.step('Login With Valid User', async () => {
        await loginPage.login('standard_user', 'secret_sauce');
    });

    await test.step('Verify Login Success', async () => {
        await loginPage.verifyLoginSuccess();
    });
});
```

## Sample Report Output

After execution, HEYNA REPORT generates:

```text
reports/HeynaReport.pdf
reports/TestExecutionReport.pdf
dashboard/index.html
```

Evidence per test case:

```text
evidence/
â””â”€â”€ TC001_Login_Success/
    â”œâ”€â”€ 1710000000000_Open_Login_Page.png
    â”œâ”€â”€ 1710000000001_Login_With_Valid_User.png
    â”œâ”€â”€ 1710000000002_Verify_Login_Success.png
    â””â”€â”€ api-log.json
```

Execution data:

```json
[
  {
    "testCase": "TC001_Login_Success",
    "status": "PASSED",
    "duration": 3200,
    "steps": [
      {
        "name": "Fill Username",
        "action": "fill",
        "target": "#username",
        "status": "PASS",
        "mode": "AUTO"
      }
    ]
  }
]
```
