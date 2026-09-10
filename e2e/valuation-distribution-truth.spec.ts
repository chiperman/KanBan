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
  await expect(page.getByRole("status")).toContainText("预置完成");
  await page.goto("/");
  await page.getByRole("button", { name: "使用 Passkey 登录" }).click();
  await expect(page.getByTestId("portfolio-overview-workspace")).toBeVisible();
}

async function chooseOption(page: Page, label: string, option: string) {
  const control = page.getByRole("button", { name: label });
  await control.click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(control).toContainText(option);
}

function overview(page: Page) {
  return page.getByTestId("portfolio-overview-workspace");
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
  const configured = await request.post("/test-doubles/valuation");
  expect(configured.ok()).toBeTruthy();
});

test("来源总额、严格长桥汇率与未估值明细在新工作区分层表达", async ({
  page,
}) => {
  await loginAsOwner(page);

  const workspace = overview(page);
  const total = workspace.getByTestId("overview-current-total");
  const confidence = workspace.getByTestId("overview-confidence");
  const sources = workspace.getByTestId("overview-source-summary");
  await expect(total).toContainText("561.34 USD");
  await expect(
    total.getByRole("heading", { name: "总资产", exact: true }),
  ).toBeVisible();
  await expect(total.locator(".vibe-metric__value")).toHaveCSS(
    "font-family",
    /Doto/,
  );
  await expect(total.locator(".vibe-metric__unit")).toHaveCSS(
    "font-family",
    /Geist Mono/,
  );
  await expect(confidence).toContainText("数据不完整");
  await expect(confidence).toContainText("未估值 1 项");
  await expect(sources).toContainText("Alpha Securities");
  await expect(sources).toContainText("264.01 USD");
  await expect(sources).toContainText("Beta Crypto");
  await expect(sources).toContainText("297.33 USD");

  await chooseOption(page, "计价货币", "CNY");
  await expect(total).toContainText("数据不足");
  await expect(total).not.toContainText("默认以 USD 计价；CNY、HKD 按长桥参考汇率折算。");
  await page.reload();
  await expect(overview(page).getByTestId("overview-current-total")).toContainText(
    "数据不足",
  );

  await page.goto("/assets");
  const assets = page.getByTestId("assets-holdings-workspace");
  await expect(assets.getByTestId("assets-source-total-source-alpha")).toContainText(
    "Alpha Securities",
  );
  await expect(assets.getByTestId("assets-source-total-source-beta")).toContainText(
    "Beta Crypto",
  );
  const holdings = assets.getByTestId("assets-holdings-table");
  await expect(holdings).toContainText("Apple Cross-source");
  await expect(holdings).toContainText("Tether");
  await expect(holdings).toContainText("Mystery Token");
  await expect(holdings).toContainText("未估值");
  await expect(holdings).toContainText("来源没有可靠价格");
});

test("未认证首页只显示登录入口，不含估值、来源或持仓信息", async ({
  page,
}) => {
  const responses: string[] = [];
  page.on("response", async (response) => {
    if (response.url().startsWith("http://localhost:3101")) {
      responses.push(await response.text().catch(() => ""));
    }
  });
  await page.goto("/");
  await expect(page.getByTestId("login-gate")).toBeVisible();
  await expect(page.getByTestId("portfolio-overview-workspace")).toHaveCount(0);
  const exposed = `${await page.content()}\n${responses.join("\n")}`;
  for (const value of [
    "561.34",
    "3998.65",
    "4385.47",
    "Alpha Securities",
    "Beta Crypto",
    "AAPL.US",
    "USDT",
    "MYST",
    "7.1234",
    "7.8125",
    "USD/HKD",
    "2026-04-01",
  ]) {
    expect(exposed).not.toContain(value);
  }
});

test("总览隐藏关键数据时同时遮蔽总额、来源身份和同步状态", async ({
  page,
}) => {
  await loginAsOwner(page);

  const workspace = overview(page);
  await expect(workspace.getByTestId("overview-current-total")).toContainText(
    "561.34 USD",
  );
  await expect(workspace.getByTestId("overview-source-summary")).toContainText(
    "Alpha Securities",
  );

  await page.getByRole("button", { name: "隐藏关键信息" }).click();
  await expect(
    page.getByRole("button", { name: "显示关键信息" }),
  ).toBeVisible();
  await expect(workspace.getByTestId("overview-current-total")).not.toContainText(
    "561.34 USD",
  );
  await expect(workspace.getByTestId("overview-current-total")).toContainText(
    "••••••",
  );
  await expect(workspace.getByTestId("overview-source-summary")).not.toContainText(
    "Alpha Securities",
  );
  await expect(workspace.getByTestId("overview-source-summary")).toContainText(
    "已隐藏 2 个来源的身份、金额与同步状态",
  );

  await page.getByRole("button", { name: "显示关键信息" }).click();
  await expect(workspace.getByTestId("overview-current-total")).toContainText(
    "561.34 USD",
  );
});

test("非长桥反向汇率不会回退用于报告货币，缺失时不显示零资产", async ({
  page,
  request,
}) => {
  const configured = await request.post("/test-doubles/valuation?fx=inverse");
  expect(configured.ok()).toBeTruthy();
  await loginAsOwner(page);

  await chooseOption(page, "计价货币", "CNY");
  await expect(overview(page).getByTestId("overview-current-total")).toContainText(
    "数据不足",
  );
  await expect(overview(page).getByTestId("overview-current-total")).not.toContainText(
    "默认以 USD 计价；CNY、HKD 按长桥参考汇率折算。",
  );

  const missing = await request.post(
    "/test-doubles/valuation?scenario=missing-source-fx",
  );
  expect(missing.ok()).toBeTruthy();
  await page.goto("/");
  await expect(overview(page).getByTestId("overview-current-total")).toContainText(
    "数据不足",
  );
  await expect(overview(page).getByTestId("overview-current-total")).not.toContainText(
    "0.00 USD",
  );
});

test("来源详情保留长桥现金与持仓的独立观察，不把现金伪装为证券持仓", async ({
  page,
  request,
}) => {
  const configured = await request.post(
    "/test-doubles/valuation?scenario=longbridge-cash",
  );
  expect(configured.ok()).toBeTruthy();
  await loginAsOwner(page);

  await expect(overview(page).getByTestId("overview-current-total")).toContainText(
    "782.82 USD",
  );
  await page.goto("/asset-sources/source-longbridge-cash");

  const card = page.getByTestId("longbridge-card");
  const cashBalances = card.getByTestId("asset-cash-balances");
  await expect(cashBalances).toContainText("CASH BALANCE");
  await expect(cashBalances.getByRole("listitem").nth(0)).toContainText(
    "USD CASH661.11 USD",
  );
  await expect(cashBalances.getByRole("listitem").nth(1)).toContainText(
    "HKD CASH131.05 HKD",
  );
  await expect(card.getByTestId("holding-top-list")).not.toContainText(
    "账户现金",
  );
  await expect(card.getByTestId("asset-holdings-detail")).toContainText("Apple");
  await expect(card.getByTestId("asset-holdings-detail")).not.toContainText(
    "账户现金",
  );
});

test("总资产只显示当前计价货币对应的长桥汇率", async ({
  page,
  request,
}) => {
  const configured = await request.post(
    "/test-doubles/valuation?scenario=longbridge-cash",
  );
  expect(configured.ok()).toBeTruthy();
  await loginAsOwner(page);

  const total = overview(page).getByTestId("overview-current-total");
  const rate = total.getByTestId("overview-reporting-rate");
  await expect(rate).toHaveCount(0);
  await expect(total).not.toContainText("默认以 USD 计价；CNY、HKD 按长桥参考汇率折算。");

  await chooseOption(page, "计价货币", "CNY");
  await expect(rate).toContainText("USD/CNY 7.1234");
  await expect(rate).not.toContainText("USD/HKD");

  await chooseOption(page, "计价货币", "HKD");
  await expect(rate).toContainText("USD/HKD 7.8125");
  await expect(rate).not.toContainText("USD/CNY");
});

test("期权行情缺失与明细仅汇总不会否定来源账户总额", async ({
  page,
  request,
}) => {
  const optionConfigured = await request.post(
    "/test-doubles/valuation?scenario=longbridge-option-quote-unavailable",
  );
  expect(optionConfigured.ok()).toBeTruthy();
  await loginAsOwner(page);

  await expect(overview(page).getByTestId("overview-current-total")).toContainText(
    "69,930.10 USD",
  );
  await expect(overview(page).getByTestId("overview-confidence")).toContainText(
    "总额完整",
  );
  await page.getByRole("link", { name: "查看 长桥美股 来源详情" }).click();
  const optionCard = page.getByTestId("longbridge-card");
  await expect(optionCard).toContainText("NVDA260805C210000.US");
  await expect(optionCard).toContainText("期权行情未接入");
  await expect(optionCard).toContainText("现价不可用");
  await expect(optionCard).toContainText("账户总额已包含");
  await expect(optionCard).not.toContainText("含 1 项未估值资产");

  const coverageConfigured = await request.post(
    "/test-doubles/valuation?scenario=detail-coverage-partial",
  );
  expect(coverageConfigured.ok()).toBeTruthy();
  await page.goto("/");
  await expect(overview(page).getByTestId("overview-current-total")).toContainText(
    "150.00 USD",
  );
  await expect(overview(page).getByTestId("overview-confidence")).toContainText(
    "总额完整",
  );
  await expect(overview(page).getByTestId("overview-source-summary")).toContainText(
    "部分仅汇总",
  );
});

test("平台账户总额与持仓明细存在差异时，总览保留总额并在来源详情解释", async ({
  page,
  request,
}) => {
  const configured = await request.post(
    "/test-doubles/valuation?scenario=binance-authoritative-total",
  );
  expect(configured.ok()).toBeTruthy();
  await loginAsOwner(page);

  const workspace = overview(page);
  await expect(workspace.getByTestId("overview-current-total")).toContainText(
    "17,165.60 USD",
  );
  await expect(workspace.getByTestId("overview-source-summary")).toContainText(
    "17,165.60 USD",
  );
  await expect(workspace.getByTestId("overview-source-summary")).not.toContainText(
    "无法折算",
  );
  await expect(workspace.getByTestId("overview-confidence")).toContainText(
    "总额完整",
  );
  await expect(workspace).not.toContainText("总额异常");
  await page.goto("/asset-sources/source-binance-authoritative-total");
  await expect(
    page.getByTestId("binance-coverage-status"),
  ).toContainText("持仓明细待对账 · 明细差额 600.50 USDT");
});

test("来源覆盖不完整时保留最后成功总额并明确标注覆盖限制", async ({
  page,
  request,
}) => {
  const configured = await request.post(
    "/test-doubles/valuation?scenario=binance-coverage-partial",
  );
  expect(configured.ok()).toBeTruthy();
  await loginAsOwner(page);

  const workspace = overview(page);
  await expect(workspace.getByTestId("overview-current-total")).not.toContainText(
    "数据不足",
  );
  await expect(workspace.getByTestId("overview-confidence")).toContainText(
    "数据不完整",
  );
  await expect(workspace.getByTestId("overview-source-summary")).toContainText(
    "来源总额可读 · 明细覆盖不完整",
  );
  await page.goto("/asset-sources/source-binance-partial");
  const coverage = page.getByTestId("binance-product-coverage");
  await expect(page.getByTestId("binance-coverage-status")).toContainText(
    "当前总额不完整 · 未解释 600.00 USDT · 未纳入 Trading Bots",
  );
  await coverage.locator("summary").click();
  await expect(coverage).toContainText("Dual Investment");
  await expect(coverage).toContainText("Smart Arbitrage");
});

test("旧快照迁移后仍可读取来源总额，期权缺价降级为行情未接入", async ({
  page,
  request,
}) => {
  const loaded = await request.post(
    "/test-doubles/longbridge/persistence?legacy=1",
  );
  expect(loaded.ok()).toBeTruthy();
  await loginAsOwner(page);
  await expect(overview(page).getByTestId("overview-current-total")).toContainText(
    "200.00 USD",
  );
  await expect(overview(page).getByTestId("overview-confidence")).toContainText(
    "未估值 1 项",
  );

  await request.post("/test-doubles/reset");
  const optionLoaded = await request.post(
    "/test-doubles/longbridge/persistence?legacy=option",
  );
  expect(optionLoaded.ok()).toBeTruthy();
  await page.request.post("/test-doubles/owner-session");
  await page.goto("/");
  await expect(overview(page).getByTestId("overview-confidence")).toContainText(
    "总额完整",
  );
  await expect(overview(page).getByTestId("overview-source-summary")).toContainText(
    "来源账户/平台总额",
  );
});
