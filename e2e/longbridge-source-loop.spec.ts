import { expect, test, type CDPSession, type Page } from "@playwright/test";

interface VirtualPasskey {
  client: CDPSession;
  authenticatorId: string;
}

const PRIVATE_CARD = {
  id: "private-entry",
  kind: "asset",
  title: "私密入口",
  body: "仅用于解锁所有者视图",
  span: 1,
} as const;

const SECRET_TOKEN = "oauth-access-token-must-never-reach-browser";
const PRODUCTION_ACCESS_TOKEN = [
  Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
  Buffer.from(JSON.stringify({
    sub: JSON.stringify({ account_channel: "lb" }),
  })).toString("base64url"),
  "test-signature",
].join(".");
const PRODUCTION_REFRESH_TOKEN = "refresh-token-must-never-reach-browser";

async function attachPasskey(page: Page): Promise<VirtualPasskey> {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  const { authenticatorId } = (await client.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
      },
    },
  )) as { authenticatorId: string };
  return { client, authenticatorId };
}

async function colorToken(
  page: Page,
  token: "--success" | "--error",
): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
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

async function configureLongbridge(
  page: Page,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const response = await page.request.post("/test-doubles/longbridge", {
    data: {
      credentials: {
        accessToken: SECRET_TOKEN,
        refreshToken: "refresh-token-must-never-reach-browser",
      },
      permissions: ["account", "positions"],
      account: { id: "U12345", label: "长桥证券账户 U12345" },
      accountPages: [
        {
          code: 0,
          data: {
            list: [
              {
                account_channel: "lb",
                currency: "USD",
                net_assets: "123456.7891",
              },
            ],
          },
        },
      ],
      positionPages: [
        {
          code: 0,
          data: { list: [{
            account_channel: "lb",
            stock_info: [{
              symbol: "AAPL.US",
              symbol_name: "Apple",
              quantity: "10.125",
              currency: "USD",
              cost_price: "190.1234",
            }, {
              symbol: "NVDA.US",
              symbol_name: "NVIDIA",
              quantity: "20",
              currency: "USD",
              cost_price: "150.5",
            }, {
              symbol: "0700.HK",
              symbol_name: "Tencent",
              quantity: "50",
              currency: "HKD",
              cost_price: "410.75",
            }, {
              symbol: "MSFT.US",
              symbol_name: "Microsoft",
              quantity: "12",
              currency: "USD",
              cost_price: "350",
            }, {
              symbol: "9988.HK",
              symbol_name: "Alibaba",
              quantity: "80",
              currency: "USD",
              cost_price: "98.8",
            }, {
              symbol: "TSLA.US",
              symbol_name: "Tesla",
              quantity: "3.5",
              currency: "USD",
              cost_price: "390",
            }],
          }] },
        },
        {
          code: 0,
          data: { list: [{
            account_channel: "lb",
            fund_info: [{
              symbol: "HK0000038064",
              symbol_name: "高腾微金美元货币基金A",
              holding_units: "10",
              currency: "USD",
              current_net_asset_value: "15.22",
              cost_net_asset_value: "14.50",
              net_asset_value_day: "1649865600",
            }],
          }] },
        },
      ],
      quotes: [{
        symbol: "AAPL.US",
        lastDone: "10",
        prevClose: "9.5",
        timestamp: 1767225600,
      }],
      exchangeRates: [{
        base_currency: "CNY",
        other_currency: "USD",
        average_rate: "7.2",
      }, {
        base_currency: "HKD",
        other_currency: "USD",
        average_rate: "7.8",
      }],
      ...overrides,
    },
  });
  expect(response.ok()).toBeTruthy();
}

async function startLongbridgeFlow(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "添加资产来源" });
  if (!(await dialog.isVisible())) {
    await page.getByRole("button", { name: "添加资产来源" }).click();
  }
  await page.getByRole("radio", { name: "长桥 Longbridge" }).click();
  await page.getByRole("button", { name: "开始 OAuth 授权" }).click();
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
  await request.post("/test-doubles/asset-cards", { data: { assetCards: [PRIVATE_CARD] } });
});

test("长桥 OAuth 回调的所有者会话允许跨站顶层导航", async ({ page }) => {
  await loginAsOwner(page);

  const session = (await page.context().cookies()).find(
    (cookie) => cookie.name === "pad_session",
  );
  expect(session).toMatchObject({ httpOnly: true, sameSite: "Lax" });
});

test("长桥 OAuth 先预览后原子保存，并展示总额与紧凑持仓", async ({
  page,
}) => {
  await configureLongbridge(page);
  await loginAsOwner(page);

  const responseBodies: string[] = [];
  const consoleErrors: string[] = [];
  const browserRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("request", (request) => browserRequests.push(request.url()));
  page.on("response", async (response) => {
    if (response.url().startsWith("http://localhost:3101")) {
      responseBodies.push(await response.text().catch(() => ""));
    }
  });

  await startLongbridgeFlow(page);

  const preview = page.getByRole("dialog", { name: "确认长桥资产来源" });
  await expect(preview).toContainText("长桥证券账户 U12345");
  await expect(preview).toContainText("账户、持仓（只读）");
  await expect(preview).toContainText("123,456.7891 USD");
  await expect(page.getByText("oauth-access-token")).toHaveCount(0);

  const beforeConfirm = await page.request.get("/test-doubles/longbridge");
  await expect(beforeConfirm.json()).resolves.toMatchObject({
    savedSources: 0,
    savedSecrets: 0,
  });

  await preview.getByRole("button", { name: "确认并保存" }).click();

  const card = page.getByTestId("longbridge-card");
  await expect(card).toContainText("123,456.7891 USD");
  await expect(card).toContainText("最后更新：2026-01-01 08:00");
  await expect(card).not.toContainText("UTC");
  const topHoldings = card.getByTestId("holding-top-list").getByRole("listitem");
  const holdingDetails = card.getByTestId("asset-holdings-detail");
  await expect(topHoldings).toHaveCount(3);
  await expect(holdingDetails).toBeHidden();
  await expect(topHoldings.first()).toContainText("高腾微金");
  await expect(card.getByRole("button", { name: "查看全部持仓" })).toHaveCount(0);

  const resizeHandle = page.getByRole("button", { name: /调整长桥资产宽度/ });
  const saveAsTwo = page.waitForResponse(
    (response) => response.url().endsWith("/api/asset-cards/layout") && response.request().method() === "PUT",
  );
  await resizeHandle.press("ArrowRight");
  await saveAsTwo;
  await expect(topHoldings).toHaveCount(5);
  await expect(holdingDetails).toBeHidden();

  const saveAsThree = page.waitForResponse(
    (response) => response.url().endsWith("/api/asset-cards/layout") && response.request().method() === "PUT",
  );
  await resizeHandle.press("ArrowRight");
  await saveAsThree;
  await expect(topHoldings).toHaveCount(0);
  await expect(holdingDetails).toBeVisible();
  await expect(holdingDetails.getByRole("row")).toHaveCount(8);
  await expect(holdingDetails.getByRole("columnheader")).toHaveText([
    "名称",
    /市值\s*\/\s*数量/,
    "现价",
    "平均成本价",
    "当日盈亏",
    "持仓盈亏",
  ]);
  const appleHolding = holdingDetails
    .locator("tbody tr")
    .filter({ hasText: "Apple" });
  await expect(appleHolding.getByRole("cell")).toContainText("+5.06");
  await expect(
    appleHolding.locator(".holding-profit-summary--today"),
  ).toContainText("+5.26%");
  const fundHolding = holdingDetails
    .locator("tbody tr")
    .filter({ hasText: "高腾微金美元货币基金A" });
  await expect(fundHolding.getByRole("cell")).toHaveText([
    /高腾微金美元货币基金A.*HK0000038064.*Longbridge 基金净值 · 2022-04-14 00:00/,
    /152.20.*10/,
    "15.220",
    "14.500",
    /—.*—/,
    /\+7.20.*\+4.97%/,
  ]);
  await expect(holdingDetails).not.toContainText(/\bUSD\b/);

  await page.getByRole("button", { name: /计价货币/ }).click();
  await page.getByRole("option", { name: "CNY" }).click();
  await expect(card.getByTestId("asset-source-total")).toHaveText(
    "888,888.88 CNY",
  );
  await expect(fundHolding.getByRole("cell")).toHaveText([
    /高腾微金美元货币基金A.*HK0000038064.*Longbridge 基金净值 · 2022-04-14 00:00/,
    /1,095.84.*10/,
    "109.584",
    "104.400",
    /—.*—/,
    /\+51.84.*\+4.97%/,
  ]);
  const profitCells = fundHolding.locator(".holding-profit-summary--position");
  await expect(profitCells).toHaveCount(1);
  const errorColor = await colorToken(page, "--error");
  await expect(profitCells).toHaveAttribute(
    "data-profit-color-scheme",
    "red-up",
  );
  await expect(profitCells).toHaveCSS("color", errorColor);

  await expect(
    page.getByTestId("total-asset-overview").getByRole("button", {
      name: "盈亏颜色",
    }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "本机设置" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "本机设置" })).toBeVisible();
  await expect(
    page.getByText("这些偏好只保存在当前浏览器"),
  ).toBeVisible();
  await page.getByRole("radio", { name: /绿涨红跌/ }).check();
  await expect(page.getByRole("radio", { name: /绿涨红跌/ })).toBeChecked();
  await page.getByRole("link", { name: "返回资产看板" }).click();
  await expect(page).toHaveURL("/");

  const updatedProfitCells = page
    .getByTestId("longbridge-card")
    .getByTestId("asset-holdings-detail")
    .locator("tbody tr")
    .filter({ hasText: "高腾微金美元货币基金A" })
    .locator(".holding-profit-summary--position");
  const successColor = await colorToken(page, "--success");
  await expect(updatedProfitCells).toHaveAttribute(
    "data-profit-color-scheme",
    "green-up",
  );
  await expect(updatedProfitCells).toHaveCSS(
    "color",
    successColor,
  );

  await page.reload();
  const reloadedProfitCells = page
    .getByTestId("longbridge-card")
    .getByTestId("asset-holdings-detail")
    .locator("tbody tr")
    .filter({ hasText: "高腾微金美元货币基金A" })
    .locator(".holding-profit-summary--position");
  await expect(reloadedProfitCells).toHaveAttribute(
    "data-profit-color-scheme",
    "green-up",
  );
  await expect(holdingDetails).toContainText("Longbridge 基金净值 · 2022-04-14 00:00");

  const state = await page.request.get("/test-doubles/longbridge");
  await expect(state.json()).resolves.toMatchObject({
    savedSources: 1,
    savedSecrets: 1,
    fetchedPositionPages: 2,
  });

  expect(responseBodies.join("\n")).not.toContain(SECRET_TOKEN);
  expect(await page.content()).not.toContain(SECRET_TOKEN);
  expect(consoleErrors).toEqual([]);
  expect(browserRequests).not.toContainEqual(expect.stringContaining("mcp.longbridge.com"));
});

test("长桥持仓刷新失败时保留最后成功数据并明确标记过期", async ({
  page,
}) => {
  await configureLongbridge(page);
  await loginAsOwner(page);
  await startLongbridgeFlow(page);
  await page
    .getByRole("dialog", { name: "确认长桥资产来源" })
    .getByRole("button", { name: "确认并保存" })
    .click();

  const card = page.getByTestId("longbridge-card");
  await expect(card.getByTestId("asset-source-total")).toHaveText(
    "123,456.7891 USD",
  );
  const configured = await page.request.post("/test-doubles/longbridge", {
    data: { scenario: "refresh-failure" },
  });
  expect(configured.ok()).toBeTruthy();

  await page.getByRole("button", { name: "立即刷新资产" }).click();
  await expect(page.getByTestId("asset-refresh-status")).toContainText(
    "1 个来源失败",
  );
  await expect(card.getByTestId("asset-source-total")).toHaveText(
    "123,456.7891 USD",
  );
  await expect(card).toContainText("过期数据");
  await expect(card).toContainText("长桥同步失败");
  await expect(page.getByTestId("total-asset-overview")).toContainText(
    "包含 1 个过期来源",
  );
});

test("交易权限与授权或预览失败都被拒绝且不留下来源或凭证", async ({
  page,
}) => {
  await configureLongbridge(page, {
    permissions: ["account", "positions", "trade"],
  });
  await loginAsOwner(page);
  const started = await page.request.post(
    "/api/asset-sources/longbridge/oauth/start",
  );
  expect(started.ok()).toBeTruthy();
  const tampered = await page.request.get(
    "/api/asset-sources/longbridge/oauth/callback?code=fake-authorization-code&state=tampered",
    { maxRedirects: 0 },
  );
  expect(tampered.status()).toBe(302);
  expect(tampered.headers().location).toContain("longbridge_error=");
  await startLongbridgeFlow(page);
  await expect(page.locator(".login-error[role=alert]")).toContainText(
    "检测到交易权限，已拒绝连接",
  );

  let state = await page.request.get("/test-doubles/longbridge");
  await expect(state.json()).resolves.toMatchObject({
    savedSources: 0,
    savedSecrets: 0,
  });

  await configureLongbridge(page, { previewError: "长桥账户暂时无法读取" });
  await startLongbridgeFlow(page);
  await expect(page.locator(".login-error[role=alert]")).toContainText("长桥账户暂时无法读取");
  state = await page.request.get("/test-doubles/longbridge");
  await expect(state.json()).resolves.toMatchObject({
    savedSources: 0,
    savedSecrets: 0,
  });

  await configureLongbridge(page, { commitError: "原子事务写入失败" });
  await startLongbridgeFlow(page);
  const preview = page.getByRole("dialog", { name: "确认长桥资产来源" });
  await preview.getByRole("button", { name: "确认并保存" }).click();
  await expect(preview.getByRole("alert")).toContainText("原子事务写入失败");
  state = await page.request.get("/test-doubles/longbridge");
  await expect(state.json()).resolves.toMatchObject({
    savedSources: 0,
    savedSecrets: 0,
  });
  await preview.getByRole("button", { name: "确认并保存" }).click();
  await expect(page.getByTestId("longbridge-card")).toBeVisible();

  await configureLongbridge(page);
  await startLongbridgeFlow(page);
  const concurrentPreview = page.getByRole("dialog", { name: "确认长桥资产来源" });
  await expect(concurrentPreview).toBeVisible();
  const previewId = new URL(page.url()).searchParams.get("longbridge_preview");
  expect(previewId).toBeTruthy();
  const confirmations = await Promise.all([
    page.request.post("/api/asset-sources/longbridge/confirm", { data: { id: previewId } }),
    page.request.post("/api/asset-sources/longbridge/confirm", { data: { id: previewId } }),
  ]);
  expect(confirmations.filter((response) => response.status() === 201)).toHaveLength(1);
  state = await page.request.get("/test-doubles/longbridge");
  await expect(state.json()).resolves.toMatchObject({ savedSources: 2, savedSecrets: 2 });
  await expect(concurrentPreview).toBeVisible();
});

test("Keychain 长桥快照使用 USD 总额并按官方汇率估值跨币种持仓", async ({
  request,
}) => {
  const response = await request.post(
    "/test-doubles/longbridge/production-start",
    { data: { action: "keychain-snapshot" } },
  );
  expect(response.ok()).toBeTruthy();
  const body = await response.json();

  expect(body.snapshot.total).toEqual({ amount: "74442.43", currency: "USD" });
  expect(body.snapshot.exchangeRates).toContainEqual({
    baseCurrency: "HKD",
    quoteCurrency: "USD",
    rate: "0.12751",
    source: "Longbridge 官方账户汇率",
    observedAt: expect.any(String),
  });
  expect(body.snapshot.holdings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        symbol: "700.HK",
        marketValue: "6000",
        sourceMarketValue: { amount: "765.06", currency: "USD" },
        valuation: expect.objectContaining({ status: "valued" }),
      }),
      expect.objectContaining({
        symbol: "CASH.USD",
        name: "账户现金",
        quantity: "677.82",
        currency: "USD",
        assetClass: "cash",
        marketValue: "677.82",
        sourceMarketValue: { amount: "677.82", currency: "USD" },
        cashBalances: [{
          amount: "661.11",
          availableCash: "660.54",
          currency: "USD",
          frozenCash: "0.57",
          settlingCash: "0.57",
          withdrawCash: "660.54",
        }, {
          amount: "131.05",
          availableCash: "131.05",
          currency: "HKD",
          frozenCash: "0",
          settlingCash: "0",
          withdrawCash: "131.05",
        }],
        valuation: expect.objectContaining({
          status: "valued",
          priceSource: "Longbridge 账户现金总额",
        }),
      }),
      expect.objectContaining({
        symbol: "NVDA260805C210000.US",
        quantity: "-1",
        currentPrice: null,
        marketValue: null,
        sourceMarketValue: null,
        valuation: {
          status: "quote-unavailable",
          reason: "Longbridge Open API 未接入期权行情",
        },
      }),
    ]),
  );
});

test("Keychain 瞬时认证失败只重试一次并给出统一修复命令", async ({
  request,
}) => {
  const recovered = await request.post(
    "/test-doubles/longbridge/production-start",
    { data: { action: "keychain-refresh-retry" } },
  );
  expect(recovered.ok()).toBeTruthy();
  await expect(recovered.json()).resolves.toMatchObject({
    readAssetsCalls: 2,
    snapshot: {
      total: { amount: "74442.43", currency: "USD" },
    },
  });

  const exhausted = await request.post(
    "/test-doubles/longbridge/production-start",
    { data: { action: "keychain-refresh-retry-exhausted" } },
  );
  expect(exhausted.status()).toBe(400);
  const exhaustedBody = await exhausted.json();
  expect(exhaustedBody.error).toContain("pnpm longbridge:keychain:repair");
  expect(exhaustedBody.error).not.toContain(
    "The user name or passphrase you entered is not correct",
  );
});

test("生产 OAuth 只申请并接受 account.read，交易、缺失或未知 scope 均在读取前拒绝", async ({
  request,
}) => {
  const started = await request.post(
    "/test-doubles/longbridge/production-start",
    { data: { action: "start" } },
  );
  expect(started.ok()).toBeTruthy();
  const startBody = (await started.json()) as {
    authorizationUrl: string;
    state: string;
  };
  const authorizationUrl = new URL(startBody.authorizationUrl);
  expect(`${authorizationUrl.origin}${authorizationUrl.pathname}`).toBe(
    "https://openapi.longbridge.com/oauth2/authorize",
  );
  expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
  expect(authorizationUrl.searchParams.get("client_id")).toBe(
    "browser-test-client",
  );
  expect(authorizationUrl.searchParams.get("scope")).toBe("6");
  expect(authorizationUrl.searchParams.get("state")).toBe(startBody.state);
  expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe(
    "S256",
  );
  expect(authorizationUrl.searchParams.get("code_challenge")).toMatch(
    /^[A-Za-z0-9_-]{43}$/,
  );
  expect(authorizationUrl.searchParams.has("code_verifier")).toBeFalsy();

  for (const scenario of ["trade", "missing", "unknown", "extra"] as const) {
    const rejected = await request.post(
      "/test-doubles/longbridge/production-start",
      { data: { action: "finish", scenario } },
    );
    expect(rejected.status(), scenario).toBe(400);
    const body = await rejected.json();
    expect(body.error, scenario).toContain(
      scenario === "trade" ? "交易写权限" : "授权范围",
    );
    expect(body.assetRequests, scenario).toEqual([]);
    expect(JSON.stringify(body), scenario).not.toContain(SECRET_TOKEN);
  }

  const finished = await request.post(
    "/test-doubles/longbridge/production-start",
    { data: { action: "finish", scenario: "readonly" } },
  );
  expect(finished.ok()).toBeTruthy();
  const finishBody = await finished.json();
  expect(finishBody).toMatchObject({
    permissions: ["account", "positions"],
    account: {
      id: expect.stringMatching(/^longbridge:[a-f0-9]{12}$/),
      label: expect.stringMatching(/^长桥账户（类型 lb · USD · [a-f0-9]{12}）$/),
    },
    snapshot: {
      total: { amount: "123456.7891", currency: "USD" },
      holdings: [
        {
          symbol: "AAPL.US",
          marketValue: null,
          currency: "USD",
          costPrice: "190.1234",
          platformProfit: null,
        },
      ],
    },
    assetRequests: [
      "GET /v1/asset/account",
      "GET /v1/asset/stock",
      "GET /v1/asset/fund",
    ],
  });
  expect(finishBody.assetRequests).toEqual(
    expect.arrayContaining([
      "GET /v1/asset/account",
      "GET /v1/asset/stock",
      "GET /v1/asset/fund",
    ]),
  );
  expect(
    finishBody.assetRequests.every((entry: string) => entry.startsWith("GET ")),
  ).toBeTruthy();
  expect(JSON.stringify(finishBody)).not.toContain("mcp.longbridge.com");
  expect(JSON.stringify(finishBody)).not.toContain("/v1/trade/order");
  expect(JSON.stringify(finishBody)).not.toContain(SECRET_TOKEN);
  expect(JSON.stringify(finishBody)).not.toContain(PRODUCTION_ACCESS_TOKEN);
  expect(JSON.stringify(finishBody)).not.toContain(PRODUCTION_REFRESH_TOKEN);

  const sourceAudit = await request.post(
    "/test-doubles/longbridge/production-start",
    { data: { action: "rest-source-audit" } },
  );
  expect(sourceAudit.ok()).toBeTruthy();
  await expect(sourceAudit.json()).resolves.toEqual({
    forbidden: [],
    hasMcpDependency: false,
    hasMcpEndpoint: false,
    hasSdkDependency: false,
    hasSdkReference: false,
  });

  const persistence = await request.post(
    "/test-doubles/longbridge/persistence",
  );
  expect(persistence.ok()).toBeTruthy();
  await expect(persistence.json()).resolves.toEqual({
    dashboardHasOnlyReference: true,
    encryptedStoreHasNoPlaintext: true,
    committedSecretReadable: true,
    rotatedSecretReadableAndEncrypted: true,
    failedWriteRolledBack: true,
    orphanRecovered: true,
    referencedPendingRecovered: true,
    rotatedBeforeDownstreamFailure: true,
  });
});

test("锁定首页只显示登录入口，不含长桥账户、证券、金额或更新时间", async ({
  page,
}) => {
  await configureLongbridge(page);
  await loginAsOwner(page);
  await startLongbridgeFlow(page);
  await page
    .getByRole("dialog", { name: "确认长桥资产来源" })
    .getByRole("button", { name: "确认并保存" })
    .click();

  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(
    page.getByRole("heading", { name: "个人资产看板已锁定" }),
  ).toBeVisible();
  const visitorResponses: string[] = [];
  page.on("response", async (response) => {
    if (response.url().startsWith("http://localhost:3101")) {
      visitorResponses.push(await response.text().catch(() => ""));
    }
  });
  await page.reload();
  await expect(page.getByTestId("login-gate")).toBeVisible();
  await expect(page.getByTestId("card")).toHaveCount(0);

  const html = await page.content();
  const serverHtml = await (await page.request.get("/")).text();
  await expect(page.getByText("最后更新：")).toHaveCount(0);
  for (const privateValue of [
    "U12345",
    "AAPL.US",
    "NVIDIA",
    "123456",
    SECRET_TOKEN,
  ]) {
    expect(html).not.toContain(privateValue);
    expect(serverHtml).not.toContain(privateValue);
    expect(visitorResponses.join("\n")).not.toContain(privateValue);
  }
  expect((await page.request.get("/api/asset-sources/longbridge/preview?id=guess")).status()).toBe(401);
});
