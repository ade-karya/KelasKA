import type { Page, Locator } from '@playwright/test';

export class HomePage {
  readonly page: Page;
  readonly logo: Locator;
  readonly textarea: Locator;
  readonly enterButton: Locator;

  constructor(page: Page) {
    this.page = page;
    // Support both legacy OpenMAIC alt and new Kelas KA branding (Kemendikdasmen/DPRD logos)
    this.logo = page
      .locator('img[alt="OpenMAIC"], img[alt="Kemendikdasmen Logo"], img[alt="DPRD Logo"]')
      .first();
    this.textarea = page.locator('textarea');
    this.enterButton = page
      .getByRole('button', { name: /enter|masuk|ruang/i })
      .or(page.locator('button:has-text("进入课堂")'));
  }

  async goto() {
    await this.page.goto('/');
  }

  async fillRequirement(text: string) {
    await this.textarea.fill(text);
  }

  async submit() {
    await this.enterButton.click();
  }
}
