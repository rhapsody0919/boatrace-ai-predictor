import { test, expect } from '@playwright/test';
for (const theme of ['light', 'dark']) {
  test(`PR確認と警告表示 ${theme}`, async ({ page }) => {
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/blog-pr-preview')) return route.fulfill({ json: {
        headSha: 'a'.repeat(40), previewUrl: `https://github.com/rhapsody0919/boatrace-ai-predictor/tree/${'a'.repeat(40)}`,
      } });
      if (url.hostname === '127.0.0.1') return route.continue();
      return route.abort();
    });
    await page.goto('/__existing_fixes_test');
    await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
    await expect(page.getByRole('button', { name: '承認してマージ' })).toBeDisabled();
    await page.getByRole('button', { name: '承認するPRの版を取得' }).click();
    await expect(page.getByRole('link')).toHaveAttribute('href', /tree\/a{40}$/);
    await page.getByRole('checkbox').check();
    await expect(page.getByRole('button', { name: '承認してマージ' })).toBeEnabled();
    await expect(page.getByRole('alert')).toContainText('起動に失敗');
    await expect(page.getByRole('alert')).toContainText('対象語');
    await expect(page.getByRole('alert')).toContainText('権限不足');
    await page.screenshot({ path: test.info().outputPath(`${theme}.png`), fullPage: true });
  });
}
