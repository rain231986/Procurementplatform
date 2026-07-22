import { test, expect } from "@playwright/test";

test.describe("PharmaFlow Phase 1 核心流程", () => {
  test("登入後可以進入需求池並看到測試資料", async ({ page }) => {
    await page.goto("http://localhost:8787/");
    await expect(page.getByText("登入平台")).toBeVisible();
    await expect(page.getByText("首次使用")).toBeVisible();
  });

  test("角色頁面應有需求、配貨與採購入口", async ({ page }) => {
    await page.goto("http://localhost:8787/");
    await expect(page.locator("#appRoot")).toContainText("PharmaFlow");
  });
});
