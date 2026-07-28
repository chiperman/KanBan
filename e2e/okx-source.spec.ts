import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { PROD_BASE_URL } from "../playwright.config";

const API_KEY = "okx-browser-api-key";
const API_SECRET = "okx-browser-secret-must-not-leak";
const PASSPHRASE = "okx-browser-passphrase-must-not-leak";

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

async function configure(page: Page, scenario = "valid") {
  const response = await page.request.post("/test-doubles/okx", {
    data: { scenario },
  });
  expect(response.ok()).toBeTruthy();
}

async function startOkxFlow(page: Page) {
  const dialog = page.getByRole("dialog", { name: "添加资产来源" });
  if (!(await dialog.isVisible())) {
    await page.getByRole("button", { name: "添加资产来源" }).click();
  }
  const provider = page.getByRole("radio", { name: "OKX" });
  if (await provider.isVisible()) {
    await provider.check();
  }
  await page.getByLabel("OKX 注册区域").selectOption("eea");
  await page.getByLabel("OKX API Key").fill(API_KEY);
  await page.getByLabel("OKX API Secret").fill(API_SECRET);
  await page.getByLabel("OKX Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "验证只读凭证" }).click();
}

async function state(page: Page) {
  return (await (await page.request.get("/test-doubles/okx")).json()) as {
    savedSources: number;
    savedSecrets: number;
  };
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
});

test("OKX 只读凭证先预览后原子保存，并展示现货、资金与 Earn 持仓", async ({
  page,
}) => {
  await configure(page);
  await loginAsOwner(page);
  const responseBodies: string[] = [];
  page.on("response", async (response) => {
    if (response.url().startsWith("http://localhost:3101")) {
      responseBodies.push(await response.text().catch(() => ""));
    }
  });

  await startOkxFlow(page);
  const preview = page.getByRole("dialog", { name: "确认 OKX 资产来源" });
  await expect(preview).toContainText("OKX 账户 · UID 880001");
  await expect(preview).toContainText("现货、资金、Simple Earn Flexible（只读）");
  await expect(preview).toContainText("10,987.654321 USDT");
  await expect(page.getByText(API_SECRET)).toHaveCount(0);
  await expect(page.getByText(PASSPHRASE)).toHaveCount(0);

  await preview.getByRole("button", { name: "确认并保存" }).click();
  const card = page.getByTestId("okx-card");
  await expect(card.getByTestId("asset-source-total")).toHaveText(
    "10,987.654321 USDT",
  );
  await expect(
    card.getByTestId("holding-top-list").getByRole("listitem"),
  ).toHaveCount(3);
  await expect(card).toContainText("现货");
  expect(responseBodies.join("\n")).not.toContain(API_SECRET);
  expect(responseBodies.join("\n")).not.toContain(PASSPHRASE);
});

test("OKX 非纯 Read 权限、确认前权限变化和保存失败均不留下来源或凭证", async ({
  page,
}) => {
  await configure(page);
  await loginAsOwner(page);
  await startOkxFlow(page);
  const changedPermissionPreview = page.getByRole("dialog", {
    name: "确认 OKX 资产来源",
  });
  await configure(page, "trade");
  await changedPermissionPreview
    .getByRole("button", { name: "确认并保存" })
    .click();
  await expect(changedPermissionPreview.getByRole("alert")).toContainText(
    "非只读权限",
  );
  expect(await state(page)).toEqual({ savedSources: 0, savedSecrets: 0 });
  await changedPermissionPreview.getByRole("button", { name: "取消" }).click();

  for (const scenario of [
    "trade",
    "withdraw",
    "read-and-trade",
    "unknown-permission",
    "missing-read",
  ]) {
    await configure(page, scenario);
    const response = await page.request.post("/api/asset-sources/okx/preview", {
      data: {
        apiKey: API_KEY,
        apiSecret: API_SECRET,
        passphrase: PASSPHRASE,
      },
    });
    expect(response.status(), scenario).toBe(400);
    const responseText = await response.text();
    expect(responseText, scenario).not.toContain(API_SECRET);
    expect(responseText, scenario).not.toContain(PASSPHRASE);
    expect(await state(page), scenario).toEqual({
      savedSources: 0,
      savedSecrets: 0,
    });
  }

  await configure(page, "commit-failure");
  await startOkxFlow(page);
  const preview = page.getByRole("dialog", { name: "确认 OKX 资产来源" });
  await preview.getByRole("button", { name: "确认并保存" }).click();
  await expect(preview.getByRole("alert")).toContainText("原子事务写入失败");
  expect(await state(page)).toEqual({ savedSources: 0, savedSecrets: 0 });
});

test("生产 OKX 适配器只读取 Spot、Funding 与 Flexible，并验证签名和来源原生价格", async ({
  request,
}) => {
  const response = await request.post("/test-doubles/okx/production-start", {
    data: { action: "preview-valid" },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.permissions).toEqual(["market-data", "account", "positions"]);
  expect(body.account).toEqual({
    id: "okx:880001",
    label: "OKX 账户 · UID 880001",
  });
  expect(body.snapshot.total).toEqual({
    amount: "10987.654321",
    currency: "USDT",
  });
  expect(body.snapshot.holdings).toEqual(expect.arrayContaining([
    expect.objectContaining({
      sourceAccount: "spot",
      sourceAsset: "BTC",
      quantity: "0.1",
      currentPrice: { amount: "60000", currency: "USDT" },
    }),
    expect.objectContaining({
      sourceAccount: "funding",
      sourceAsset: "ETH",
      quantity: "1",
    }),
    expect.objectContaining({
      sourceAccount: "earn-flexible",
      sourceAsset: "SOL",
      quantity: "5",
    }),
    expect.objectContaining({
      sourceAccount: "funding",
      sourceAsset: "USDC",
      currentPrice: { amount: "0.999", currency: "USDT" },
      sourceMarketValue: { amount: "79.92", currency: "USDT" },
    }),
  ]));
  expect(body.privateRequests).toEqual([
    "GET /api/v5/account/config",
    "GET /api/v5/account/positions?instType=OPTION",
    "GET /api/v5/account/balance",
    "GET /api/v5/asset/balances",
    "GET /api/v5/finance/savings/balance",
  ]);
  expect(body.allRequestsGet).toBeTruthy();
  expect(body.allPrivateRequestsSigned).toBeTruthy();
  expect(body.allHostsPinned).toBeTruthy();
  expect(body.privateRequests.join("\n")).not.toMatch(
    /trade|transfer|withdraw|borrow|fixed-loan|purchase-redempt/i,
  );
  expect(JSON.stringify(body)).not.toContain(API_SECRET);
  expect(JSON.stringify(body)).not.toContain(PASSPHRASE);

  const persistence = await request.post("/test-doubles/okx/persistence");
  expect(persistence.ok()).toBeTruthy();
  await expect(persistence.json()).resolves.toEqual({
    sourceKind: "okx",
    dashboardHasOnlyReference: true,
    encryptedStoreHasNoPlaintext: true,
    committedSecretReadable: true,
    dailySnapshotCount: 1,
  });
});

test("OKX 确认前账户身份或范围漂移时拒绝保存", async ({ page }) => {
  await configure(page);
  await loginAsOwner(page);
  await startOkxFlow(page);
  const preview = page.getByRole("dialog", { name: "确认 OKX 资产来源" });
  await configure(page, "identity-changed");
  await preview.getByRole("button", { name: "确认并保存" }).click();
  await expect(preview.getByRole("alert")).toContainText("账户范围已变化");
  expect(await state(page)).toEqual({ savedSources: 0, savedSecrets: 0 });
});

test("生产 OKX 适配器拒绝杠杆范围并把缺价资产保留为未估值", async ({
  request,
}) => {
  for (const [action, message] of [
    ["preview-trade", "非只读权限"],
    ["preview-withdraw", "非只读权限"],
    ["preview-futures", "Spot mode"],
    ["preview-borrow", "未明确关闭"],
    ["preview-option", "Option 持仓"],
    ["preview-liability", "非零 liab"],
    ["preview-missing-liability-proof", "liab"],
  ] as const) {
    const response = await request.post(
      "/test-doubles/okx/production-start",
      { data: { action } },
    );
    expect(response.status(), action).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining(message),
    });
  }

  const missingPrice = await request.post(
    "/test-doubles/okx/production-start",
    { data: { action: "preview-missing-price" } },
  );
  expect(missingPrice.ok()).toBeTruthy();
  const body = await missingPrice.json();
  expect(body.snapshot.holdings).toEqual(expect.arrayContaining([
    expect.objectContaining({
      sourceAccount: "funding",
      sourceAsset: "UNKNOWN",
      quantity: "8.123456789",
      currentPrice: null,
      sourceMarketValue: null,
      valuation: expect.objectContaining({ status: "unvalued" }),
    }),
  ]));
  expect(body.snapshot.total).toEqual({
    amount: "10987.654321",
    currency: "USDT",
  });

  const zeroPrice = await request.post(
    "/test-doubles/okx/production-start",
    { data: { action: "preview-zero-price" } },
  );
  expect(zeroPrice.ok()).toBeTruthy();
  const zeroBody = await zeroPrice.json();
  expect(zeroBody.snapshot.holdings).toEqual(expect.arrayContaining([
    expect.objectContaining({
      sourceAsset: "BTC",
      currentPrice: null,
      sourceMarketValue: null,
      valuation: expect.objectContaining({ status: "unvalued" }),
    }),
  ]));
  expect(zeroBody.snapshot.total).toEqual({
    amount: "4987.654321",
    currency: "USDT",
  });
});

test("OKX 同步失败保留最后成功数据并接入过期状态和日快照", async ({ page }) => {
  await configure(page);
  await loginAsOwner(page);
  await startOkxFlow(page);
  await page
    .getByRole("dialog", { name: "确认 OKX 资产来源" })
    .getByRole("button", { name: "确认并保存" })
    .click();
  const card = page.getByTestId("okx-card");
  await expect(card).toContainText("10,987.654321 USDT");
  await expect(page.getByTestId("asset-source-trend-test-okx-source-1")).toContainText(
    "01月01日",
  );

  await configure(page, "refresh-failure");
  await page.getByRole("button", { name: "立即刷新资产" }).click();
  await expect(page.getByTestId("asset-refresh-status")).toContainText(
    "1 个来源失败",
  );
  await expect(card).toContainText("10,987.654321 USDT");
  await expect(card).toContainText("过期数据");
  await expect(card).toContainText("OKX 同步失败");
  await expect(page.getByTestId("total-asset-overview")).toContainText(
    "包含 1 个过期来源",
  );
});

test("OKX 价格刷新保持公开边界，并规范化时间偏差、认证错误与区域域名", async ({
  request,
}) => {
  const priceRefresh = await request.post(
    "/test-doubles/okx/production-start",
    { data: { action: "refresh-prices" } },
  );
  expect(priceRefresh.ok()).toBeTruthy();
  await expect(priceRefresh.json()).resolves.toMatchObject({
    privateRequests: [],
    publicRequests: [
      "GET /api/v5/public/instruments?instType=SPOT",
      "GET /api/v5/market/tickers?instType=SPOT",
    ],
    total: { amount: "10987.654321", currency: "USDT" },
  });

  const olderTicker = await request.post(
    "/test-doubles/okx/production-start",
    { data: { action: "refresh-older-ticker" } },
  );
  expect(olderTicker.ok()).toBeTruthy();
  await expect(olderTicker.json()).resolves.toMatchObject({
    holdingOrder: ["BTC", "ETH", "USDT", "SOL", "BNB"],
    btc: {
      currentPrice: { amount: "60000", currency: "USDT" },
      valuation: { pricedAt: "2026-01-01T00:00:00.000Z" },
    },
  });

  const fullRefreshOlderTicker = await request.post(
    "/test-doubles/okx/production-start",
    { data: { action: "refresh-all-older-ticker" } },
  );
  expect(fullRefreshOlderTicker.ok()).toBeTruthy();
  await expect(fullRefreshOlderTicker.json()).resolves.toMatchObject({
    holdingOrder: ["BTC", "ETH", "USDT", "SOL", "BNB"],
    btc: {
      quantity: "0.1",
      currentPrice: { amount: "60000", currency: "USDT" },
      sourceMarketValue: { amount: "6000", currency: "USDT" },
      valuation: { pricedAt: "2026-01-01T00:00:00.000Z" },
    },
  });

  const timestampRetry = await request.post(
    "/test-doubles/okx/production-start",
    { data: { action: "timestamp-retry" } },
  );
  expect(timestampRetry.ok()).toBeTruthy();
  await expect(timestampRetry.json()).resolves.toMatchObject({
    timeRequests: 2,
    configRequests: 2,
    allPrivateRequestsSigned: true,
  });

  const invalidAuth = await request.post(
    "/test-doubles/okx/production-start",
    { data: { action: "invalid-auth" } },
  );
  expect(invalidAuth.status()).toBe(400);
  await expect(invalidAuth.json()).resolves.toMatchObject({
    error: expect.stringContaining("50114"),
    privateRequests: ["GET /api/v5/account/config"],
  });

  const eea = await request.post("/test-doubles/okx/production-start", {
    data: { action: "preview-eea" },
  });
  expect(eea.ok()).toBeTruthy();
  await expect(eea.json()).resolves.toMatchObject({ allHostsPinned: true });
});

test("未认证状态与生产测试替身都不能读取 OKX 私密来源或凭证", async ({
  page,
  playwright,
}) => {
  await configure(page);
  await loginAsOwner(page);
  await startOkxFlow(page);
  await page
    .getByRole("dialog", { name: "确认 OKX 资产来源" })
    .getByRole("button", { name: "确认并保存" })
    .click();
  await expect(page.getByTestId("okx-card")).toBeVisible();
  await page.getByRole("button", { name: "退出登录" }).click();
  await page.reload();
  const publicSurface = `${await page.content()}\n${await (await page.request.get("/")).text()}`;
  for (const value of [
    "880001",
    "BTC",
    "10,987",
    API_KEY,
    API_SECRET,
    PASSPHRASE,
  ]) {
    expect(publicSurface).not.toContain(value);
  }
  expect(
    (await page.request.post("/api/asset-sources/okx/preview", {
      data: {
        apiKey: API_KEY,
        apiSecret: API_SECRET,
        passphrase: PASSPHRASE,
        region: "global",
      },
    })).status(),
  ).toBe(401);

  const production = await playwright.request.newContext({ baseURL: PROD_BASE_URL });
  expect((await production.get("/test-doubles/okx")).status()).toBe(404);
  expect(
    (await production.post("/test-doubles/okx/production-start")).status(),
  ).toBe(404);
  expect((await production.post("/test-doubles/okx/persistence")).status()).toBe(404);
  await production.dispose();
});
