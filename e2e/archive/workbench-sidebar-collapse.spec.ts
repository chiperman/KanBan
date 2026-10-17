import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.request.post("/test-doubles/reset");
  await page.request.post("/test-doubles/owner-session");
  await page.setViewportSize({ width: 1440, height: 900 });
});

test("收起侧栏释放内容空间，全部入口和工具仍可用，并记住选择", async ({ page }) => {
  await page.goto("/");
  const sidebar = page.getByTestId("workbench-sidebar");
  const navigation = page.getByTestId("workbench-desktop-navigation");
  const expandedHeader = await page.getByTestId("workbench-page-header").boundingBox();
  await navigation.getByRole("button", { name: "收起资产组合导航" }).click();
  await expect(navigation.getByRole("link", { name: "资产与持仓" })).toBeHidden();

  await page.getByRole("button", { name: "收起侧边栏", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(sidebar).toHaveCSS("width", "72px");
  await expect(page.getByRole("button", { name: "展开侧边栏", exact: true })).toHaveAttribute("aria-expanded", "false");
  const compactHeader = await page.getByTestId("workbench-page-header").boundingBox();
  expect(expandedHeader!.x - compactHeader!.x).toBe(152);
  expect(compactHeader!.width - expandedHeader!.width).toBe(152);

  const holdings = navigation.getByRole("link", { name: "资产与持仓", exact: true });
  await holdings.focus();
  const tooltip = page.getByRole("tooltip", { name: "资产与持仓", exact: true });
  await expect(tooltip).toBeVisible();
  const holdingsBox = await holdings.boundingBox();
  expect((await tooltip.boundingBox())!.x).toBeGreaterThanOrEqual(holdingsBox!.x + holdingsBox!.width + 8);
  await page.keyboard.press("Escape");
  await expect(tooltip).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/assets$/);
  await page.reload();
  await expect(sidebar).toHaveCSS("width", "72px");

  for (const label of ["总览", "资产与持仓", "收益分析", "来源管理", "设置与安全"]) {
    const link = navigation.getByRole("link", { name: label, exact: true });
    await expect(link).toBeVisible();
    expect((await link.boundingBox())!.width).toBeGreaterThanOrEqual(40);
  }
  await page.getByRole("button", { name: "隐藏关键信息", exact: true }).click();
  await expect(page.getByRole("button", { name: "显示关键信息", exact: true })).toHaveAttribute("aria-pressed", "true");
  const command = page.getByRole("button", { name: "打开快捷命令", exact: true });
  await expect(command.locator("kbd")).toBeHidden();
  await command.click();
  const dialog = page.getByRole("dialog", { name: "快捷命令" });
  await expect(dialog).toBeVisible();
  const dialogBox = await dialog.locator(".command-menu-panel").boundingBox();
  expect(dialogBox!.x).toBeGreaterThan(72);
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(1440);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: /当前主题/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme-choice", "light");
  await page.getByRole("button", { name: "展开侧边栏", exact: true }).click();
  await expect(sidebar).toHaveCSS("width", "224px");
  await page.reload();
  await expect(sidebar).toHaveCSS("width", "224px");
});

test("已收起侧栏兼容窄屏和低高度窗口，底部导航始终保留文字", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("pad-sidebar-collapsed", "true"));
  await page.goto("/settings");
  for (const width of [320, 390, 640, 975, 1200, 2560]) {
    await page.setViewportSize({ width, height: 720 });
    const mobile = page.getByTestId("workbench-mobile-navigation");
    if (width < 1200) {
      await expect(mobile).toBeVisible();
      await expect(mobile.getByRole("link", { name: "资产与持仓" })).toHaveText("持仓");
      await expect(page.getByRole("button", { name: "展开侧边栏", exact: true })).toBeHidden();
    } else {
      await expect(mobile).toBeHidden();
      await expect(page.getByTestId("workbench-sidebar")).toHaveCSS("width", "72px");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    for (const control of await page.getByTestId("workbench-utilities").getByRole("button").all()) {
      const box = await control.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(40);
      expect(box!.height).toBeGreaterThanOrEqual(40);
    }
  }
  await page.setViewportSize({ width: 1440, height: 480 });
  const lock = page.getByRole("button", { name: "立即锁定（退出登录）" });
  await lock.scrollIntoViewIfNeeded();
  await lock.click();
  await expect(page.getByTestId("workbench-shell")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("敏感内容已锁定");
});

test("浏览器存储不可用时侧栏仍能收起和展开", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() { throw new DOMException("Storage unavailable", "SecurityError"); },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "收起侧边栏", exact: true }).click();
  await expect(page.getByTestId("workbench-sidebar")).toHaveCSS("width", "72px");
  await page.getByRole("button", { name: "展开侧边栏", exact: true }).click();
  await expect(page.getByTestId("workbench-sidebar")).toHaveCSS("width", "224px");
});
