import { expect, test, type CDPSession, type Page } from "@playwright/test";

interface VirtualPasskey {
  client: CDPSession;
  authenticatorId: string;
}

const PRIVATE_CARD = {
  id: "private-entry",
  kind: "markdown",
  title: "私密入口",
  markdown: "仅用于解锁所有者视图",
  span: 1,
  access: "private",
} as const;

const SECRET_TOKEN = "oauth-access-token-must-never-reach-browser";

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

async function loginAsOwner(page: Page): Promise<void> {
  await attachPasskey(page);
  await page.goto("/setup");
  await page.getByRole("button", { name: "创建所有者 Passkey" }).click();
  await expect(page.getByRole("status")).toContainText("已完成预置");
  await page.goto("/");
  await page
    .getByTestId("restricted-card")
    .getByRole("button", { name: "验证身份后查看" })
    .click();
  await page.getByRole("button", { name: "使用 Passkey 解锁" }).click();
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
      permissions: ["market-data", "account", "positions"],
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
              net_asset_value_day: "2026-05-29T00:00:00Z",
            }],
          }] },
        },
      ],
      quotePages: [{
        code: 0,
        data: {
          list: [
            { symbol: "AAPL.US", last_done: "2000", prev_close: "1950" },
            { symbol: "NVDA.US", last_done: "2000.025", prev_close: "1900" },
            { symbol: "0700.HK", last_done: "500", prev_close: "490" },
            { symbol: "MSFT.US", last_done: "1500", prev_close: "1504" },
            { symbol: "9988.HK", last_done: "112.5", prev_close: "111" },
            { symbol: "TSLA.US", last_done: "400", prev_close: "416" },
          ],
        },
      }],
      exchangeRatePages: [{
        code: 0,
        data: {
          exchanges: [{
            base_currency: "USD",
            other_currency: "HKD",
            average_rate: 7.8125,
            bid_rate: 7.8,
            offer_rate: 7.825,
          }],
        },
      }],
      profitPages: [{
        code: 0,
        data: {
          profit: "100.25",
          has_more: true,
          stock_items: [{ code: "AAPL", name: "Apple", market: "US", profit: "100.25" }],
        },
      }, {
        code: 0,
        data: {
          profit: "-50.5",
          has_more: false,
          stock_items: [{ code: "0700", name: "Tencent", market: "HK", profit: "-50.5" }],
        },
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
  await page.getByRole("radio", { name: "长桥 Longbridge" }).check();
  await page.getByRole("button", { name: "开始 OAuth 授权" }).click();
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
  await request.post("/test-doubles/cards", { data: { cards: [PRIVATE_CARD] } });
});

test("长桥 OAuth 先预览后原子保存，并展示总额、前五持仓与完整可排序详情", async ({
  page,
}) => {
  await configureLongbridge(page);
  await loginAsOwner(page);

  const responseBodies: string[] = [];
  page.on("response", async (response) => {
    if (response.url().startsWith("http://localhost:3101")) {
      responseBodies.push(await response.text().catch(() => ""));
    }
  });

  await startLongbridgeFlow(page);

  const preview = page.getByRole("dialog", { name: "确认长桥资产来源" });
  await expect(preview).toContainText("长桥证券账户 U12345");
  await expect(preview).toContainText("行情、账户、持仓（只读）");
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
  await expect(card).toContainText("最后更新：2026-01-01 00:00 UTC");
  await expect(card.getByRole("listitem")).toHaveCount(5);
  await expect(card.getByRole("listitem").first()).toContainText("NVIDIA");
  await expect(card).not.toContainText("Tesla");

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await card.getByRole("button", { name: "查看全部持仓" }).click();
  const detail = page.getByRole("dialog", { name: "长桥全部持仓" });
  await expect(detail.getByRole("row")).toHaveCount(8);
  await expect(detail.getByRole("row").nth(1)).toContainText("NVIDIA");
  await detail.getByLabel("持仓排序").selectOption("change");
  await expect(detail.getByRole("row").nth(1)).toContainText("NVIDIA");
  await expect(detail.getByRole("row").nth(6)).toContainText("Tesla");
  await expect(detail.getByRole("row").last()).toContainText("高腾微金");
  await detail.getByLabel("持仓排序").selectOption("name");
  await expect(detail.getByRole("row").nth(1)).toContainText("Alibaba");
  await expect(detail.getByRole("row").filter({ hasText: "Apple" })).toContainText("190.1234");
  await expect(detail.getByRole("row").filter({ hasText: "Apple" })).toContainText("100.25");
  await expect(detail.getByRole("row").filter({ hasText: "Tencent" })).toContainText("HKD");
  await detail.getByRole("button", { name: "关闭详情" }).click();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

  const state = await page.request.get("/test-doubles/longbridge");
  await expect(state.json()).resolves.toMatchObject({
    savedSources: 1,
    savedSecrets: 1,
    fetchedPositionPages: 2,
    fetchedProfitPages: 2,
  });

  expect(responseBodies.join("\n")).not.toContain(SECRET_TOKEN);
  expect(await page.content()).not.toContain(SECRET_TOKEN);
});

test("交易权限与授权或预览失败都被拒绝且不留下来源或凭证", async ({
  page,
}) => {
  await configureLongbridge(page, {
    permissions: ["market-data", "account", "positions", "trade"],
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
    permissions: ["market-data", "account", "positions"],
    account: {
      id: expect.stringMatching(/^longbridge:[a-f0-9]{12}$/),
      label: expect.stringMatching(/^长桥账户（类型 lb · USD · [a-f0-9]{12}）$/),
    },
    snapshot: {
      total: { amount: "123456.7891", currency: "USD" },
      holdings: [
        {
          symbol: "AAPL.US",
          marketValue: "20250",
          currency: "USD",
          costPrice: "190.1234",
          platformProfit: "100.25",
        },
      ],
    },
    assetRequests: [
      "GET /v1/asset/account",
      "GET /v1/asset/stock",
      "GET /v1/asset/fund",
      "GET /v1/asset/exchange_rates",
      "GET /v1/portfolio/profit-analysis/by-market?page=1&size=100",
      "GET /v1/portfolio/profit-analysis/by-market?page=2&size=100",
    ],
    quotedSymbols: ["AAPL.US"],
  });
  expect(JSON.stringify(finishBody)).not.toContain(SECRET_TOKEN);

  const persistence = await request.post(
    "/test-doubles/longbridge/persistence",
  );
  expect(persistence.ok()).toBeTruthy();
  await expect(persistence.json()).resolves.toEqual({
    dashboardHasOnlyReference: true,
    encryptedStoreHasNoPlaintext: true,
    committedSecretReadable: true,
    failedWriteRolledBack: true,
    orphanRecovered: true,
    referencedPendingRecovered: true,
  });
});

test("访客只收到安全占位，不含长桥账户、证券、金额或更新时间", async ({
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
  await expect(page.getByTestId("view-mode")).toContainText("访客视图");
  const visitorResponses: string[] = [];
  page.on("response", async (response) => {
    if (response.url().startsWith("http://localhost:3101")) {
      visitorResponses.push(await response.text().catch(() => ""));
    }
  });
  await page.reload();
  await expect(page.getByTestId("restricted-card")).toHaveCount(2);

  const html = await page.content();
  const serverHtml = await (await page.request.get("/")).text();
  for (const privateValue of [
    "U12345",
    "AAPL.US",
    "NVIDIA",
    "123456",
    "2026-01-01T00:00",
    SECRET_TOKEN,
  ]) {
    expect(html).not.toContain(privateValue);
    expect(serverHtml).not.toContain(privateValue);
    expect(visitorResponses.join("\n")).not.toContain(privateValue);
  }
  expect((await page.request.get("/api/asset-sources/longbridge/preview?id=guess")).status()).toBe(401);
});
