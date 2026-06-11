class BasePage {

    constructor(page) {
        this.page = page;
    }

    async waitPageLoaded() {
        await this.page.waitForLoadState(
            'networkidle'
        );
    }

}

module.exports = { BasePage };