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

test("旧演示查询参数仍停留在锁定入口，且不请求或泄露资产数据", async ({
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

  await page.goto("/?mode=demo");
  await expect(page.getByTestId("login-gate")).toBeVisible();
  await expect(page.getByRole("link", { name: "开始首次预置" })).toBeVisible();
  await expect(page.getByTestId("demo-mode-dashboard")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "进入演示模式" })).toHaveCount(0);
  await expect(page.getByText("DEMO DATA / NO PERSISTENCE")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(REAL_CARD_TITLE);
  expect(await page.content()).not.toMatch(
    /Longbridge|Binance|OKX|Bitget|Web3|NET ASSET|CONSOLIDATED VIEW/,
  );
  expect(assetApiRequests).toEqual([]);
});
