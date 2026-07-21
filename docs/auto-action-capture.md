# Auto Action Capture

Auto Action Capture was introduced in v2.1.0 and remains part of the current development version.

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
- `page.dragAndDrop()`
- `page.setInputFiles()`
- `page.hover()`
- `locator.hover()`
- `page.dblclick()`
- `locator.dblclick()`
- `page.tap()`
- `locator.tap()`
- `page.focus()`
- `locator.focus()`
- `locator.blur()`
- `page.keyboard.press()`
- `page.mouse.click()`

Modern locator factories are supported:

- `page.getByRole()`
- `page.getByText()`
- `page.getByLabel()`
- `page.getByPlaceholder()`
- `page.getByTestId()`
- `page.getByAltText()`
- `page.getByTitle()`

Locator chaining is supported:

- `.first()`
- `.last()`
- `.nth()`
- `.filter()`

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

HEYNA REPORT loads these settings from `heyna.config.js`. See [Configuration](configuration.md) for configuration precedence, output roots, evidence, and history settings.

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

- `off`: no screenshots for passed actions
- `disabled`: legacy alias for `off`
- `failure-only`: screenshots only on failed actions
- `all`: screenshots for every captured action
- `on-step`: legacy alias for `all`
- `important-actions`: screenshots for click, upload, drag, and similar high-value actions

Failed actions always capture screenshots.

## Backward Compatibility

Manual mode is still supported:

```js
await Heyna.step(page, currentTC, 'Custom Business Step', async () => {
    await page.click('#submit');
});
```

Use manual mode for business-level steps that do not map cleanly to a single Playwright action.

## Coverage Diagnostics

HEYNA REPORT prints auto-capture coverage at the end of the run:

```text
Auto Capture Coverage
Detected Actions: 26
Captured: 26
Missed: 0
```

Coverage details are stored in:

```text
test-results/metadata.json
```
