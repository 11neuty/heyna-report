const { expect } = require('@playwright/test');
const { BasePage } = require('./BasePage');

class LoginPage extends BasePage {

    constructor(page) {
        super(page);

        this.usernameInput = page.locator('#user-name');
        this.passwordInput = page.locator('#password');
        this.loginButton = page.locator('#login-button');
        this.errorMessage = page.locator('[data-test="error"]');
    }

    async open() {
        await this.page.goto(
            'https://www.saucedemo.com/'
        );
    }

    async inputUsername(username) {
        await this.usernameInput.fill(username);
    }

    async inputPassword(password) {
        await this.passwordInput.fill(password);
    }

    async clickLogin() {
        await this.loginButton.click();
    }

    async verifyLoginSuccess() {
        await expect(this.page)
            .toHaveURL(/inventory/);
    }

    async verifyLoginError() {
        await expect(this.errorMessage)
            .toBeVisible();
    }
}

module.exports = { LoginPage };