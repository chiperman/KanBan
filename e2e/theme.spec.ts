import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
});

test("主题默认跟随系统", async ({ browser }) => {
  const darkContext = await browser.newContext({ colorScheme: "dark" });
  const darkPage = await darkContext.newPage();
  await darkPage.goto("/");
  await expect(darkPage.locator("html")).toHaveAttribute("data-theme", "dark");
  await darkContext.close();

  const lightContext = await browser.newContext({ colorScheme: "light" });
  const lightPage = await lightContext.newPage();
  await lightPage.goto("/");
  await expect(lightPage.locator("html")).toHaveAttribute("data-theme", "light");
  await lightContext.close();
});

test("所有者可以选择浅色或深色并记住选择", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "深色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByRole("button", { name: "浅色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("选择跟随系统后恢复系统主题", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByRole("button", { name: "浅色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.getByRole("button", { name: "跟随系统" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
