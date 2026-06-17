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
    ],
    apiLogging: {
        include: [
            '/api/',
            'saucedemo.com'
        ]
    }
};
