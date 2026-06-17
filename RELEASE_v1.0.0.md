I am developing an open-source Playwright reporting framework called:

HEYNA REPORT

Tagline:

From Execution to Evidence.

The current Auto Action Capture implementation is working but not yet production-grade.

Current status:

✓ page.fill()
✓ page.click()
✓ page.check()
✓ page.uncheck()
✓ page.selectOption()
✓ page.press()

✓ locator.fill()
✓ locator.click()
✓ locator.check()
✓ locator.uncheck()
✓ locator.selectOption()
✓ locator.press()

However several important Playwright patterns are still not fully supported.

==================================================
OBJECTIVE
=========

Upgrade Auto Action Capture from:

v2.0.0-beta

to

v2.1.0

Production Ready Auto Capture Engine

==================================================
ISSUE 1
=======

Support Modern Playwright Locator APIs

Current implementation focuses on:

page.locator(...)

but modern Playwright commonly uses:

page.getByRole()
page.getByText()
page.getByLabel()
page.getByPlaceholder()
page.getByTestId()

Examples:

```javascript
await page
    .getByRole(
        'button',
        { name: 'Login' }
    )
    .click();

await page
    .getByLabel(
        'Username'
    )
    .fill(
        'admin'
    );

await page
    .getByPlaceholder(
        'Search'
    )
    .fill(
        'Playwright'
    );
```

These actions must be automatically captured.

==================================================
ISSUE 2
=======

Support Locator Chaining

Examples:

```javascript
await page
    .getByRole(
        'button'
    )
    .first()
    .click();

await page
    .locator('.menu')
    .nth(2)
    .click();

await page
    .locator('.card')
    .last()
    .click();
```

Auto capture must still work.

==================================================
ISSUE 3
=======

Improve Human Readable Names

Current output sometimes falls back to:

Click Element
Fill Element

Target:

```javascript
await page
    .getByLabel(
        'Username'
    )
    .fill(
        'admin'
    );
```

↓

```text
Fill Username
```

---

```javascript
await page
    .getByRole(
        'button',
        { name: 'Login' }
    )
    .click();
```

↓

```text
Click Login
```

---

```javascript
await page
    .getByPlaceholder(
        'Search'
    )
    .fill(
        'test'
    );
```

↓

```text
Fill Search
```

Priority order:

1. aria-label
2. label text
3. placeholder
4. role + accessible name
5. test id
6. id
7. name
8. fallback

Implement smart selector normalization.

==================================================
ISSUE 4
=======

Support Additional User Actions

Add support for:

```javascript
page.dragAndDrop()

page.setInputFiles()

page.hover()

page.dblclick()

page.tap()

page.focus()

page.blur()

page.keyboard.press()

page.mouse.click()
```

Generated examples:

```text
Drag Product To Cart
Upload Profile Picture
Hover Product Card
Double Click Submit
Press Enter
```

==================================================
ISSUE 5
=======

Reduce Monkey Patch Risk

Review current patch strategy.

Current implementation patches:

page
locator

Review:

* maintainability
* Playwright version compatibility
* memory usage
* performance impact

Recommend safer architecture if necessary.

==================================================
ISSUE 6
=======

Parallel Execution Validation

Validate:

workers > 1

Ensure:

execution.json

does not suffer from:

* race condition
* overwritten data
* duplicated steps

Review current lock implementation.

Improve if necessary.

==================================================
ISSUE 7
=======

Retry Awareness

Playwright retries must be visible.

Example:

```text
TC001

Attempt 1
FAILED

Attempt 2
PASSED
```

Store:

* attempt number
* retry count
* final result

Expose this in report data.

==================================================
ISSUE 8
=======

Screenshot Intelligence

Current:

failure-only

Enhance:

```javascript
screenshotMode:
'off'

screenshotMode:
'failure-only'

screenshotMode:
'all'

screenshotMode:
'important-actions'
```

Important actions:

* click
* submit
* upload
* dragAndDrop

==================================================
ISSUE 9
=======

Auto Capture Coverage Report

Add diagnostic output.

Example:

```text
Auto Capture Coverage

Detected Actions:
120

Captured:
118

Missed:
2
```

This helps validate framework quality.

==================================================
TESTING REQUIREMENTS
====================

Create automated tests proving support for:

✓ page.fill()

✓ locator.fill()

✓ getByRole()

✓ getByText()

✓ getByLabel()

✓ getByPlaceholder()

✓ getByTestId()

✓ first()

✓ last()

✓ nth()

✓ dragAndDrop()

✓ upload()

✓ hover()

✓ dblclick()

✓ keyboard.press()

✓ mouse.click()

==================================================
OUTPUT REQUIRED
===============

Provide:

1. Architecture Review
2. Identified Weaknesses
3. Recommended Design
4. File Changes
5. Full Source Code
6. Migration Guide
7. Performance Analysis
8. Test Strategy
9. Backward Compatibility Validation

Goal:

Make HEYNA REPORT Auto Action Capture production-ready and capable of capturing modern Playwright usage patterns without requiring reporting code from QA engineers.
