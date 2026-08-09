import { expect, test } from "@playwright/test";

const PRIMARY_DESTINATIONS = [
  { label: "总览", path: "/" },
  { label: "资产与持仓", path: "/assets" },
  { label: "收益分析", path: "/performance" },
  { label: "资产来源", path: "/asset-sources" },
  { label: "设置与安全", path: "/settings" },
] as const;

test.beforeEach(async ({ page }) => {
  await page.request.post("/test-doubles/reset");
  await page.request.post("/test-doubles/owner-session");
});

test("五目的地应用壳在桌面、手机、键盘和返回路径中保持一致", async ({
  page,
}) => {
  await page.goto("/");

  const desktopNavigation = page.getByTestId("workbench-desktop-navigation");
  for (const destination of PRIMARY_DESTINATIONS) {
    await expect(
      desktopNavigation.getByRole("link", {
        name: destination.label,
        exact: true,
      }),
    ).toBeVisible();
  }

  const assets = desktopNavigation.getByRole("link", {
    name: "资产与持仓",
    exact: true,
  });
  await assets.focus();
  await expect(assets).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/assets$/);
  await expect(assets).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileNavigation = page.getByTestId("workbench-mobile-navigation");
  for (const destination of PRIMARY_DESTINATIONS) {
    await expect(
      mobileNavigation.getByRole("link", {
        name: destination.label,
        exact: true,
      }),
    ).toBeVisible();
  }

  await page.getByRole("button", { name: "打开快捷命令" }).click();
  await page.getByRole("searchbox", { name: "搜索命令" }).fill("收益分析");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/performance$/);

  await page.goto("/asset-sources");
  await page.getByRole("link", { name: "查看数据健康" }).click();
  await expect(page).toHaveURL(/\/data-health$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/asset-sources$/);

  await expect(page.locator("body")).toHaveJSProperty(
    "scrollWidth",
    await page.locator("body").evaluate((body) => body.clientWidth),
  );
});
