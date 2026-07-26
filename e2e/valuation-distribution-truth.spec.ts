import { expect, test, type CDPSession, type Page } from "@playwright/test";

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
  await page
    .getByTestId("restricted-card")
    .first()
    .getByRole("button", { name: "验证身份后查看" })
    .click();
  await page.getByRole("button", { name: "使用 Passkey 解锁" }).click();
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
  await expect(overview).toBeVisible();
  await expect(overview).toContainText("561.34 USD");
  await expect(overview).toContainText("汇总不完整 · 1 项未估值");
  await expect(overview).toContainText("证券");
  await expect(overview).toContainText("464.04 USD");
  await expect(overview).toContainText("加密资产");
  await expect(overview).toContainText("97.30 USD");

  const alpha = page.getByTestId("asset-source-card-source-alpha");
  const beta = page.getByTestId("asset-source-card-source-beta");
  await expect(alpha).toContainText("Alpha Securities");
  await expect(beta).toContainText("Beta Crypto");
  await alpha.getByRole("button", { name: "查看全部持仓" }).click();
  let detail = page.getByRole("dialog", { name: "Alpha Securities 全部持仓" });
  await expect(detail.getByRole("row").filter({ hasText: "AAPL.US" })).toContainText(
    "200.01 USD",
  );
  await expect(detail.getByRole("row").filter({ hasText: "0700.HK" })).toContainText(
    "500 HKD",
  );
  await expect(detail.getByRole("row").filter({ hasText: "TINY.US" })).toContainText(
    "0.0000000000000001 USD",
  );
  await expect(detail).toContainText("Alpha 原生行情");
  await expect(detail).toContainText("2026-04-01 08:00 UTC");
  await detail.getByRole("button", { name: "关闭详情" }).click();

  await beta.getByRole("button", { name: "查看全部持仓" }).click();
  detail = page.getByRole("dialog", { name: "Beta Crypto 全部持仓" });
  await expect(detail.getByRole("row").filter({ hasText: "AAPL.US" })).toContainText(
    "200.03 USD",
  );
  await expect(detail.getByRole("row").filter({ hasText: "USDT" })).toContainText(
    "0.973 USD",
  );
  await expect(detail.getByRole("row").filter({ hasText: "MYST" })).toContainText(
    "未估值",
  );
  await expect(detail.getByRole("row").filter({ hasText: "MYST" })).toContainText(
    "2.5",
  );
  await detail.getByRole("button", { name: "关闭详情" }).click();

  await overview.getByLabel("计价货币").selectOption("CNY");
  await expect(overview).toContainText("3,998.65 CNY");
  await expect(overview).toContainText("USD/CNY 7.1234");
  await expect(overview).toContainText("Longbridge 账户汇率");
  await expect(overview).toContainText("2026-04-01 08:00 UTC");
  await page.reload();
  await expect(page.getByTestId("total-asset-overview")).toContainText(
    "3,998.65 CNY",
  );

  await overview.getByLabel("计价货币").selectOption("USD");
  await overview.getByLabel("分布维度").selectOption("source");
  await expect(overview).toContainText("Alpha Securities");
  await expect(overview).toContainText("264.01 USD");
  await expect(overview).toContainText("Beta Crypto");
  await expect(overview).toContainText("297.33 USD");
  await overview.getByLabel("分布维度").selectOption("currency");
  await expect(overview).toContainText("HKD");
  await expect(overview).toContainText("64.00 USD");
  await expect(overview).toContainText("USD");
  await expect(overview).toContainText("497.34 USD");
});

test("访客只收到总资产安全占位，不含估值、来源或持仓信息", async ({ page }) => {
  const responses: string[] = [];
  page.on("response", async (response) => {
    if (response.url().startsWith("http://localhost:3101")) {
      responses.push(await response.text().catch(() => ""));
    }
  });
  await page.goto("/");
  await expect(page.getByTestId("total-overview-placeholder")).toBeVisible();
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

test("反向汇率观察按正确方向折算总额与每个分组", async ({ page, request }) => {
  const configured = await request.post("/test-doubles/valuation?fx=inverse");
  expect(configured.ok()).toBeTruthy();
  await loginAsOwner(page);

  const overview = page.getByTestId("total-asset-overview");
  await overview.getByLabel("计价货币").selectOption("CNY");
  await expect(overview).toContainText("4,009.57 CNY");
  await expect(overview).toContainText("CNY/USD 0.14");
  await expect(overview).toContainText("证券");
  await expect(overview).toContainText("3,314.57 CNY");
  await expect(overview).toContainText("加密资产");
  await expect(overview).toContainText("695.00 CNY");
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
  expect(displayed.sort()).toEqual(["0.00 USD", "0.01 USD"]);

  await request.post("/test-doubles/valuation?scenario=rounding-many");
  await page.reload();
  await overview.getByLabel("分布维度").selectOption("source");
  await expect(overview).toContainText("0.02 USD");
  const manyGroups = await overview
    .locator(".distribution-item strong")
    .allTextContents();
  expect(manyGroups.sort()).toEqual([
    "0.00 USD",
    "0.00 USD",
    "0.01 USD",
    "0.01 USD",
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
  await expect(overview).toContainText("汇总不完整 · 1 项未估值");
  const source = page.getByTestId("longbridge-card");
  await expect(source.locator(".asset-total")).toHaveText("200 USD");
  await source.getByRole("button", { name: "查看全部持仓" }).click();
  const detail = page.getByRole("dialog", { name: "长桥全部持仓" });
  await expect(detail.getByRole("row").filter({ hasText: "AAPL.US" })).toContainText(
    "100 USD",
  );
  await expect(detail.getByRole("row").filter({ hasText: "0700.HK" })).toContainText(
    "缺少 HKD/USD 显式汇率",
  );
});
