const { test } = require('@playwright/test');
const { LoginPage } = require('../pages/LoginPage');
const Heyna = require('../utils/HeynaReporter');
const { HeynaPdfGenerator } = require('../utils/HeynaPdfGenerator');

let currentTC;
let currentLogger;

test.beforeAll(
    async () => {

        Heyna.initializeRun({
            project: 'SauceDemo',
            feature: 'Login & Authentication',
            environment: process.env.ENVIRONMENT || 'QA',
            browser: process.env.BROWSER || 'chromium'
        });

    }
);

test.beforeEach(
    async (
        { page },
        testInfo
    ) => {

        currentTC =
            testInfo.title
                .replace(
                    /\s+/g,
                    '_'
                );

        currentLogger =
            Heyna.createApiLogger(
                page,
                currentTC
            );

        Heyna
            .initializeTest(
                currentTC
            );

    }
);

test.afterEach(
    async ({ page }, testInfo) => {

        let failureScreenshot;

        if (
            testInfo.status === 'failed'
        ) {

            failureScreenshot = await Heyna.captureEvidence(
                page,
                currentTC,
                'Failure_Screenshot',
                'FAILED'
            );

        }

        currentLogger.save();

        Heyna
            .completeTest(

                currentTC,

                testInfo.status
                    .toUpperCase(),

                testInfo.duration,

                testInfo.error
                    ? testInfo.error.message
                    : undefined,

                {
                    failureScreenshot
                }

            );

    }
);

test('TC001_LoginSuccess', async ({ page }) => {

    const loginPage = new LoginPage(page);

    await test.step('Open Login Page', async () => {

        await Heyna.step(
            page,
            currentTC,
            'Step01_Open_Login_Page',
            async () => {
                await loginPage.open();
            }
        );

    });

    await test.step('Input Username', async () => {

        await Heyna.step(
            page,
            currentTC,
            'Step02_Input_Username',
            async () => {
                await loginPage.inputUsername(
                    'standard_user'
                );
            }
        );

    });

    await test.step('Input Password', async () => {

        await Heyna.step(
            page,
            currentTC,
            'Step03_Input_Password',
            async () => {
                await loginPage.inputPassword(
                    'secret_sauce'
                );
            }
        );

    });

    await test.step('Click Login', async () => {

        await Heyna.step(
            page,
            currentTC,
            'Step04_Click_Login',
            async () => {
                await loginPage.clickLogin();
            }
        );

    });

    await test.step('Verify Login Success', async () => {

        await Heyna.step(
            page,
            currentTC,
            'Step05_Verify_Login_Success',
            async () => {
                await loginPage.verifyLoginSuccess();
            }
        );

    });

});

test('TC002_LoginFailed', async ({ page }) => {

    const loginPage = new LoginPage(page);

    await test.step(
        'Open Login Page',
        async () => {

            await Heyna.step(
                page,
                currentTC,
                'Step01_Open_Login_Page',
                async () => {

                    await loginPage.open();

                }
            );

        }
    );

    await test.step(
        'Input Invalid Credentials',
        async () => {

            await Heyna.step(
                page,
                currentTC,
                'Step02_Input_Invalid_Credentials',
                async () => {

                    await loginPage.inputUsername(
                        'invalid_user'
                    );

                    await loginPage.inputPassword(
                        'invalid_password'
                    );

                }
            );

        }
    );

    await test.step(
        'Click Login',
        async () => {

            await Heyna.step(
                page,
                currentTC,
                'Step03_Click_Login',
                async () => {

                    await loginPage.clickLogin();

                }
            );

        }
    );

    await test.step(
        'Verify Error Message',
        async () => {

            await Heyna.step(
                page,
                currentTC,
                'Step04_Verify_Error_Message',
                async () => {

                    await loginPage.verifyLoginError();

                }
            );

        }
    );

});

test.afterAll(
    async () => {

        Heyna.markRunningTestsAsFailed();

        await HeynaPdfGenerator
            .generate();

    }
);
