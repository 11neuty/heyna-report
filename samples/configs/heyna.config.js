module.exports = {
    autoCapture: true,
    screenshotMode: 'failure-only',
    autoActions: [
        'fill',
        'click',
        'check',
        'uncheck',
        'selectOption',
        'press',
        'dragAndDrop',
        'setInputFiles',
        'hover',
        'dblclick',
        'tap',
        'focus',
        'blur'
    ],
    locatorFactories: [
        'locator',
        'getByRole',
        'getByText',
        'getByLabel',
        'getByPlaceholder',
        'getByTestId',
        'getByAltText',
        'getByTitle'
    ],
    chainMethods: [
        'first',
        'last',
        'nth',
        'filter'
    ],
    importantActions: [
        'click',
        'dblclick',
        'tap',
        'setInputFiles',
        'dragAndDrop'
    ],
    apiLogging: {
        include: [
            '/api/',
            'saucedemo.com'
        ]
    }
};
