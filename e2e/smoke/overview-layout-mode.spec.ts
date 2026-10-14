import { expect, test, type Page } from "@playwright/test";

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )).toBeLessThanOrEqual(0);
}

test.beforeEach(async ({ request }) => {
  expect((await request.post("/test-doubles/reset")).ok()).toBeTruthy();
  expect((await request.post("/test-doubles/release-acceptance", {
    data: { action: "seed" },
  })).ok()).toBeTruthy();
});

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`${viewport.width}px 总览保留查看与快捷操作，不恢复旧卡片编辑器`, async ({ page }) => {
    await page.setViewportSize(viewport);
    expect((await page.request.post("/test-doubles/owner-session")).ok()).toBeTruthy();
    await page.goto("/");
    await expect(page.getByTestId("portfolio-overview-workspace")).toBeVisible();
    await expect(page.getByTestId("overview-current-total")).toContainText("总资产");
    await expect(page.getByTestId("overview-trend")).toBeVisible();
    await expect(page.getByRole("button", { name: "立即刷新资产" })).toBeVisible();
    await expect(page.getByRole("button", { name: "立即锁定（退出登录）" })).toBeVisible();
    await expect(page.getByRole("button", { name: /进入布局管理|退出布局管理|拖动.*调整排序|调整.*宽度/ })).toHaveCount(0);
    await expect(page.getByTestId("layout-drop-slot")).toHaveCount(0);
    await expect(page.getByTestId("asset-holdings-detail")).toHaveCount(0);
    await expect(page.getByRole("searchbox", { name: "搜索全部持仓" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "查看全部资产与持仓" })).toHaveAttribute("href", "/assets");
    await expectNoHorizontalOverflow(page);

    const sourceLink = page.getByRole("link", { name: "查看 Binance 只读账户 的资产明细" });
    await expect(sourceLink).toBeVisible();
    await page.getByRole("button", { name: "隐藏关键信息" }).click();
    await expect(sourceLink).toHaveCount(0);
    await expect(page.getByTestId("overview-current-total")).toContainText("••••••");
    await page.reload();
    await expect(page.getByTestId("overview-current-total")).toContainText("••••••");
    await page.getByRole("button", { name: "显示关键信息" }).click();
    await sourceLink.click();
    await expect(page).toHaveURL(/\/asset-sources\/[^/]+$/);
    await expect(page.getByRole("heading", { name: "Binance 只读账户", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "刷新 Binance 只读账户" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}

test("旧布局元数据不能让锁定首页暴露资产或编辑入口", async ({ page, request }) => {
  expect((await request.post("/test-doubles/asset-cards", {
    data: { assetCards: [{ id: "legacy", kind: "asset", title: "PRIVATE-LEGACY-CARD", body: "PRIVATE-LEGACY-BODY", span: 3, startsNewRow: true }] },
  })).ok()).toBeTruthy();
  await page.goto("/");
  await expect(page.getByTestId("login-gate")).toBeVisible();
  await expect(page.getByTestId("portfolio-overview-workspace")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /布局管理|拖动.*调整排序/ })).toHaveCount(0);
  expect(await page.content()).not.toContain("PRIVATE-LEGACY-CARD");
  expect(await page.content()).not.toContain("PRIVATE-LEGACY-BODY");
  const response = await request.put("/api/asset-cards/layout", {
    data: { cards: [{ id: "legacy", span: 1 }] },
  });
  expect(response.status()).toBe(401);
});
