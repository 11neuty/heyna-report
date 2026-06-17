# Auto Action Capture

Auto Action Capture allows QA engineers to write native Playwright code while HEYNA REPORT automatically records execution steps.

## Supported Actions

- `page.fill()`
- `locator.fill()`
- `page.click()`
- `locator.click()`
- `page.check()`
- `locator.check()`
- `page.uncheck()`
- `locator.uncheck()`
- `page.selectOption()`
- `locator.selectOption()`
- `page.press()`
- `locator.press()`

## Enable Auto Capture

Call `Heyna.attach(page, testCase)` after `Heyna.initializeTest(testCase)`.

```js
test.beforeEach(async ({ page }, testInfo) => {
    const currentTC = testInfo.title.replace(/\s+/g, '_');

    Heyna.initializeTest(currentTC);
    Heyna.attach(page, currentTC);
});
```

## Native Playwright Syntax

```js
await page.fill('#username', 'admin');
await page.fill('#password', 'secret');
await page.click('#login');
```

Generated steps:

```text
Fill Username
Fill Password
Click Login
```

## Configuration

```js
module.exports = {
    autoCapture: true,
    screenshotMode: 'failure-only',
    autoActions: [
        'fill',
        'click',
        'check',
        'uncheck',
        'selectOption',
        'press'
    ]
};
```

## Screenshot Modes

- `disabled`: no screenshots for passed actions
- `failure-only`: screenshots only on failed actions
- `on-step`: screenshots for every captured action

Failed actions always capture screenshots.

## Backward Compatibility

Manual mode is still supported:

```js
await Heyna.step(page, currentTC, 'Custom Business Step', async () => {
    await page.click('#submit');
});
```

Use manual mode for business-level steps that do not map cleanly to a single Playwright action.
