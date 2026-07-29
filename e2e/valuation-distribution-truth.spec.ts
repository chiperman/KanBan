import { expect, test, type CDPSession, type Page } from "@playwright/test";

import { chooseOverviewOption } from "./overview-control-helpers";

async function attachPasskey(page: Page): Promise<CDPSession> {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });
  return client;
}

async function loginAsOwner(page: Page): Promise<void> {
  await attachPasskey(page);
  await page.goto("/setup");
  await page.getByRole("button", { name: "创建所有者 Passkey" }).click();
  await expect(page.getByRole("status")).toContainText("已完成预置");
  await page.goto("/");

  await page.getByRole("button", { name: "使用 Passkey 登录" }).click();
  await expect(page.getByTestId("view-mode")).toContainText("所有者视图");
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
  const configured = await request.post("/test-doubles/valuation");
  expect(configured.ok()).toBeTruthy();
});

test("总资产使用来源原生价格与显式汇率，保留原值并正确表达未估值资产", async ({
  page,
}) => {
  await loginAsOwner(page);

  const overview = page.getByTestId("total-asset-overview");
  await expect(overview).toHaveAttribute("data-vibe-module", "asset-overview");
  await expect(overview.getByTestId("total-asset-amount")).toHaveAttribute(
    "data-vibe-component",
    "metric",
  );
  await expect(
    overview.getByRole("img", { name: /维度资产分配/ }),
  ).toHaveAttribute("data-vibe-component", "segmented-bar");
  await expect(overview).toBeVisible();
  const sourceTotal = page
    .getByTestId("asset-source-card-source-alpha")
    .getByTestId("asset-source-total");
  await expect(sourceTotal).toHaveCSS("font-family", /Doto/);
  await expect(sourceTotal.locator(".vibe-metric__unit")).toHaveCSS(
    "font-family",
    /Geist Mono/,
  );
  await expect(overview).toContainText("561.34 USD");
  await expect(overview).toContainText("当前估值：不完整 · 1 项未估值");
  await expect(overview).toContainText("证券");
  await expect(overview).toContainText("464.04 USD");
  await expect(overview).toContainText("加密资产");
  await expect(overview).toContainText("97.30 USD");
  await expect(
    page
      .getByTestId("asset-source-card-source-beta")
      .getByTestId("holding-top-list")
      .getByRole("listitem"),
  ).toContainText(["Apple Cross-source", "Tether", "Mystery Token"]);

  await chooseOverviewOption(overview, "计价货币", "CNY");
  await expect(overview).toContainText("3,998.65 CNY");
  await expect(overview).toContainText("USD/CNY 7.1234");
  await expect(overview).toContainText("Longbridge 账户汇率");
  await expect(overview).toContainText("2026-04-01 08:00 UTC");
  await page.reload();
  await expect(page.getByTestId("total-asset-overview")).toContainText(
    "3,998.65 CNY",
  );

  await chooseOverviewOption(overview, "计价货币", "USD");
  await chooseOverviewOption(overview, "分布维度", "资产来源");
  await expect(overview).toContainText("Alpha Securities");
  await expect(overview).toContainText("264.01 USD");
  await expect(overview).toContainText("Beta Crypto");
  await expect(overview).toContainText("297.33 USD");
  await expect(
    overview.getByLabel("资产分布").locator(".distribution-item"),
  ).toContainText(["Beta Crypto", "Alpha Securities"]);
  await chooseOverviewOption(overview, "分布维度", "原始币种");
  await expect(overview).toContainText("HKD");
  await expect(overview).toContainText("64.00 USD");
  await expect(overview).toContainText("USD");
  await expect(overview).toContainText("497.34 USD");
});

test("未认证首页只显示登录入口，不含估值、来源或持仓信息", async ({ page }) => {
  const responses: string[] = [];
  page.on("response", async (response) => {
    if (response.url().startsWith("http://localhost:3101")) {
      responses.push(await response.text().catch(() => ""));
    }
  });
  await page.goto("/");
  await expect(page.getByTestId("login-gate")).toBeVisible();
  await expect(page.getByTestId("card-grid")).toHaveCount(0);
  const exposed = `${await page.content()}\n${responses.join("\n")}`;
  for (const value of [
    "561.34",
    "3998.65",
    "Alpha Securities",
    "Beta Crypto",
    "AAPL.US",
    "USDT",
    "MYST",
    "7.1234",
    "2026-04-01",
  ]) {
    expect(exposed).not.toContain(value);
  }
});

test("所有者可随时隐藏或重新显示资产金额与持仓数值", async ({ page }) => {
  await loginAsOwner(page);

  const overview = page.getByTestId("total-asset-overview");
  const alpha = page.getByTestId("asset-source-card-source-alpha");
  await expect(overview).toContainText("561.34 USD");
  await expect(alpha.getByTestId("asset-source-total")).toContainText("264.01");

  await page.getByTestId("sensitive-info-toggle").click();
  await expect(page.getByTestId("sensitive-info-toggle")).toHaveAccessibleName(
    "显示关键信息",
  );
  await expect(overview).not.toContainText("561.34 USD");
  await expect(overview).toContainText("•••••• USD");
  await expect(alpha.getByTestId("asset-source-total")).not.toContainText("264.01");
  await expect(alpha).toContainText("•••••• USD");

  await page.getByTestId("sensitive-info-toggle").click();
  await expect(page.getByTestId("sensitive-info-toggle")).toHaveAccessibleName(
    "隐藏关键信息",
  );
  await expect(overview).toContainText("561.34 USD");
  await expect(alpha.getByTestId("asset-source-total")).toContainText("264.01");
});

test("反向汇率观察按正确方向折算总额与每个分组", async ({ page, request }) => {
  const configured = await request.post("/test-doubles/valuation?fx=inverse");
  expect(configured.ok()).toBeTruthy();
  await loginAsOwner(page);

  const overview = page.getByTestId("total-asset-overview");
  await chooseOverviewOption(overview, "计价货币", "CNY");
  await expect(overview).toContainText("4,009.57 CNY");
  await expect(overview).toContainText("USD/CNY 7.1429");
  await expect(overview).toContainText("证券");
  await expect(overview).toContainText("3,314.57 CNY");
  await expect(overview).toContainText("加密资产");
  await expect(overview).toContainText("695.00 CNY");
});

test("来源总额无法折算时显示未知而不是零资产", async ({ page, request }) => {
  const configured = await request.post(
    "/test-doubles/valuation?scenario=missing-source-fx",
  );
  expect(configured.ok()).toBeTruthy();
  await loginAsOwner(page);

  const overview = page.getByTestId("total-asset-overview");
  await expect(overview.locator(".total-overview-amount")).toHaveText(
    "无法折算 USD",
  );
  await expect(overview).not.toContainText("0.00 USD");
});

test("Binance 钱包残差会同时传播到来源卡、总资产和完整性状态", async ({
  page,
  request,
}) => {
  const configured = await request.post(
    "/test-doubles/valuation?scenario=binance-coverage-partial",
  );
  expect(configured.ok()).toBeTruthy();
  await page.route("**/api/asset-sources/refresh", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ successCount: 1, failureCount: 0 }),
      contentType: "application/json",
      status: 200,
    });
  });
  await loginAsOwner(page);

  await expect(page.getByTestId("binance-coverage-status")).toContainText(
    "产品统计不完整 · 未解释 600.00 USDT · 未纳入 Trading Bots",
  );
  await expect(page.getByTestId("total-asset-overview")).toContainText(
    "当前估值：不完整 · 0 项未估值",
  );
  await expect(page.getByTestId("binance-product-coverage")).toContainText(
    "Dual Investment · 明细 · 当前",
  );
  await expect(page.getByTestId("binance-card")).toContainText(
    "USDT · 双币投资",
  );
});

test("正负对账差额与逐组舍入后的分布始终守恒", async ({ page, request }) => {
  await loginAsOwner(page);
  const overview = page.getByTestId("total-asset-overview");

  await request.post("/test-doubles/valuation?scenario=positive-residual");
  await page.reload();
  await expect(overview).toContainText("562.34 USD");
  await expect(overview).toContainText("现金及其他");
  await expect(overview).toContainText("1.00 USD");

  await request.post("/test-doubles/valuation?scenario=negative-residual");
  await page.reload();
  await expect(overview).toContainText("560.34 USD");
  await expect(overview).toContainText("估值对账差额");
  await expect(overview).toContainText("-1.00 USD");

  await request.post("/test-doubles/valuation?scenario=rounding");
  await page.reload();
  await expect(overview).toContainText("0.01 USD");
  await expect(overview.getByLabel("资产分布")).toContainText("证券");
  await expect(overview.getByLabel("资产分布")).toContainText("加密资产");
  const displayed = await overview
    .locator(".distribution-item strong")
    .allTextContents();
  expect(displayed).toEqual(["0.01 USD", "0.00 USD"]);

  await request.post("/test-doubles/valuation?scenario=rounding-many");
  await page.reload();
  await chooseOverviewOption(overview, "分布维度", "资产来源");
  await expect(overview).toContainText("0.02 USD");
  const manyGroups = await overview
    .locator(".distribution-item strong")
    .allTextContents();
  expect(manyGroups).toEqual([
    "0.01 USD",
    "0.01 USD",
    "0.00 USD",
    "0.00 USD",
  ]);
});

test("Ticket 06 旧落盘快照会迁移后在所有者页面正常显示", async ({ page, request }) => {
  const loaded = await request.post(
    "/test-doubles/longbridge/persistence?legacy=1",
  );
  expect(loaded.ok()).toBeTruthy();
  await loginAsOwner(page);

  const overview = page.getByTestId("total-asset-overview");
  await expect(overview.locator(".total-overview-amount")).toHaveText(
    "200.00 USD",
  );
  await expect(overview).toContainText("当前估值：不完整 · 1 项未估值");
  await expect(page.getByTestId("longbridge-card").locator(".asset-total")).toHaveText("200 USD");
});
