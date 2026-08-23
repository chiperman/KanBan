import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __demoStorageOperations: string[];
  }
}

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

test("未登录可进入零落盘演示模式，且不请求或泄露真实资产数据", async ({
  page,
}) => {
  const assetApiRequests: string[] = [];
  await page.addInitScript(() => {
    const operations: string[] = [];
    const methods = ["getItem", "setItem", "removeItem", "clear"] as const;
    for (const method of methods) {
      const original = Storage.prototype[method] as (
        this: Storage,
        ...args: string[]
      ) => unknown;
      Object.defineProperty(Storage.prototype, method, {
        configurable: true,
        value(this: Storage, ...args: string[]) {
          operations.push(`${method}:${args[0] ?? ""}`);
          return original.apply(this, args);
        },
      });
    }
    Object.defineProperty(window, "__demoStorageOperations", {
      configurable: true,
      value: operations,
    });
  });
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
  await page.evaluate(() => {
    window.localStorage.setItem("demo-reporting-currency", "CNY");
    window.localStorage.setItem("demo-asset-trend-range", "90d");
    window.localStorage.setItem("demo-distribution-dimension", "currency");
    window.localStorage.setItem("pad-theme", "light");
    window.__demoStorageOperations.length = 0;
  });
  await page
    .locator(".page-header")
    .getByRole("link", { name: "进入演示模式" })
    .click();

  await expect(page).toHaveURL(/\/\?mode=demo$/);
  await expect(page.getByTestId("demo-mode-dashboard")).toBeVisible();
  await expect(page.getByText("DEMO DATA / NO PERSISTENCE")).toBeVisible();
  await expect(page.getByTestId("portfolio-overview-workspace")).toBeVisible();
  await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
  await expect(page.getByTestId("overview-source-summary").getByRole("listitem")).toHaveCount(7);
  await expect(page.getByText("CONTROL DECK")).toHaveCount(0);
  await expect(page.locator(".overview-card-summary--source")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "立即刷新资产" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "计价货币" })).toContainText("USD");
  await expect(
    page.locator('a[href="/assets"], a[href="/performance"], a[href^="/asset-sources"]'),
  ).toHaveCount(0);
  expect(await page.evaluate(() => window.__demoStorageOperations)).toEqual([]);
  const demoPreferences = await page.evaluate(() => ({
    currency: window.localStorage.getItem("demo-reporting-currency"),
    dimension: window.localStorage.getItem("demo-distribution-dimension"),
    theme: window.localStorage.getItem("pad-theme"),
    trendRange: window.localStorage.getItem("demo-asset-trend-range"),
    themeChoice: document.documentElement.dataset.themeChoice,
  }));
  expect(demoPreferences).toEqual({
    currency: "CNY",
    dimension: "currency",
    theme: "light",
    themeChoice: "system",
    trendRange: "90d",
  });
  await expect(page.locator("body")).not.toContainText(REAL_CARD_TITLE);
  expect(assetApiRequests).toEqual([]);

  await page.getByRole("link", { name: "退出演示" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByTestId("login-gate")).toBeVisible();
});
