import { expect, test } from "@playwright/test";

const REAL_CARD_TITLE = "REAL-ASSET-MUST-NOT-LEAK";

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
  const cards = await request.post("/test-doubles/asset-cards", {
    data: {
      assetCards: [{
        id: "real-card",
        kind: "asset",
        title: REAL_CARD_TITLE,
        body: "真实数据替身",
        span: 1,
      }],
    },
  });
  expect(cards.ok()).toBeTruthy();
});

test("未登录可从首页进入零落盘演示模式，并展示虚构来源摘要", async ({
  page,
}) => {
  const assetApiRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.pathname.startsWith("/api/asset-sources") ||
      url.pathname.startsWith("/api/asset-cards")
    ) {
      assetApiRequests.push(url.pathname);
    }
  });

  await page.goto("/");
  await expect(page.getByTestId("login-gate")).toBeVisible();
  await page.getByRole("link", { name: "进入演示模式" }).click();

  await expect(page).toHaveURL(/\/\?mode=demo$/);
  await expect(page.getByTestId("demo-mode-dashboard")).toBeVisible();
  await expect(page.getByText("DEMO DATA / NO PERSISTENCE")).toBeVisible();
  await expect(page.getByRole("heading", { name: "长桥" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Binance · 示例现货账户" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "OKX · 示例交易账户" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bitget · 示例资金账户" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ethereum · 示例观察钱包" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "BNB Smart Chain · 示例观察钱包" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "DIY 手工资产" })).toBeVisible();
  await expect(page.locator(".overview-card-summary--source")).toHaveCount(7);
  await expect(page.getByTestId("total-asset-yesterday-change")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(REAL_CARD_TITLE);

  await expect(page.getByRole("button", { name: "立即刷新资产" })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: /刷新 Binance.*示例现货账户/ }),
  ).toHaveCount(0);
  expect(assetApiRequests).toEqual([]);

  await page.getByRole("link", { name: "退出演示" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByTestId("login-gate")).toBeVisible();
});
