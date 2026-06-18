const fs = require('fs');
const { test, expect } = require('@playwright/test');
const Heyna = require('../../utils/HeynaReporter');

let currentTC;
let currentLogger;

test.beforeAll(async () => {
    Heyna.initializeRun({
        project: 'HEYNA REPORT',
        feature: 'Auto Action Capture v2.1',
        environment: process.env.ENVIRONMENT || 'QA',
        browser: process.env.BROWSER || 'chromium'
    });
});

test.beforeEach(async ({ page }, testInfo) => {
    currentTC = testInfo.title.replace(/\s+/g, '_');
    currentLogger = Heyna.createApiLogger(page, currentTC);

    Heyna.initializeTest(currentTC, {
        retry: testInfo.retry,
        repeatEachIndex: testInfo.repeatEachIndex
    });
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


test('TC003_AutoCaptureModernPlaywrightPatterns', async ({ page }, testInfo) => {
    const uploadFile = testInfo.outputPath('profile-picture.txt');
    fs.writeFileSync(uploadFile, 'heyna upload sample');

    await page.setContent(`
        <html>
            <body>
                <label for="username">Username</label>
                <input id="username" name="username" />

                <input placeholder="Search" />
                <input data-testid="email-field" />
                <input id="file-upload" type="file" aria-label="Profile Picture" />

                <button type="button">Login</button>
                <button type="button">Cancel</button>
                <button type="button">Submit</button>
                <button type="button">Submit</button>

                <a href="#">Help Link</a>
                <div class="menu"><button type="button">Menu 1</button></div>
                <div class="menu"><button type="button">Menu 2</button></div>
                <div class="menu"><button type="button">Menu 3</button></div>
                <div class="card">First Card</div>
                <div class="card">Last Product Card</div>

                <input id="remember-me" type="checkbox" />
                <select id="country"><option value="id">Indonesia</option></select>
                <input id="keyboard-target" />

                <div id="product" draggable="true">Product</div>
                <div id="cart">Cart</div>
            </body>
        </html>
    `);

    await page.fill('#keyboard-target', '');
    await page.fill('[name="username"]', 'page-fill');
    await page.locator('#username').fill('locator-fill');
    await page.getByLabel('Username').fill('admin');
    await page.getByPlaceholder('Search').fill('Playwright');
    await page.getByTestId('email-field').fill('qa@example.com');
    await page.getByRole('button', { name: 'Login' }).click();
    await page.getByText('Help Link').click();
    await page.getByRole('button').first().click();
    await page.locator('.menu').nth(2).click();
    await page.locator('.card').last().hover();
    await page.getByRole('button', { name: 'Submit' }).last().dblclick();
    await page.check('#remember-me');
    await page.uncheck('#remember-me');
    await page.selectOption('#country', 'id');
    await page.setInputFiles('#file-upload', uploadFile);
    await page.dragAndDrop('#product', '#cart');
    await page.focus('#keyboard-target');
    await page.keyboard.press('Enter');
    await page.mouse.click(20, 20);

    const results = Heyna.getExecutionData();
    const tc = results.find(item => item.testCase === currentTC);
    const stepNames = (tc.steps || []).map(step => step.name);

    expect(stepNames).toContain('Fill Username');
    expect(stepNames).toContain('Fill Search');
    expect(stepNames).toContain('Click Login');
    expect(stepNames).toContain('Upload File Upload');
    expect(stepNames).toContain('Drag Product To Cart');
    expect(stepNames).toContain('Press Enter');
});
