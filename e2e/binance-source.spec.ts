import {
  expect,
  test,
  type CDPSession,
  type Page,
} from "@playwright/test";
import { PROD_BASE_URL } from "../playwright.config";

const API_KEY = "binance-browser-api-key";
const API_SECRET = "binance-browser-secret-must-not-leak";

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

  const [response] = await Promise.all([
    page.waitForResponse((candidate) =>
      candidate.url().endsWith("/api/auth/login/verify"),
    ),
    page.getByRole("button", { name: "使用 Passkey 登录" }).click(),
  ]);
  expect(response.ok()).toBeTruthy();
  await expect(page.getByTestId("view-mode")).toContainText("所有者视图");
}

async function configure(page: Page, scenario = "valid") {
  const response = await page.request.post("/test-doubles/binance", {
    data: { scenario },
  });
  expect(response.ok()).toBeTruthy();
}

async function startBinanceFlow(page: Page) {
  const dialog = page.getByRole("dialog", { name: "添加资产来源" });
  if (!(await dialog.isVisible())) {
    await page.getByRole("button", { name: "添加资产来源" }).click();
  }
  const provider = page.getByRole("radio", { name: "Binance" });
  if (await provider.isVisible()) {
    await provider.click();
  }
  await page.getByLabel("Binance API Key").fill(API_KEY);
  await page.getByLabel("Binance API Secret").fill(API_SECRET);
  await page.getByRole("button", { name: "验证只读凭证" }).click();
}

async function state(page: Page) {
  return (await (await page.request.get("/test-doubles/binance")).json()) as {
    savedSources: number;
    savedSecrets: number;
  };
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
});

test("取消添加资产来源后再次打开时只读凭证字段为空", async ({ page }) => {
  await loginAsOwner(page);

  await page.getByRole("button", { name: "添加资产来源" }).click();
  await page.getByRole("radio", { name: "Binance" }).click();
  await page.getByLabel("Binance API Key").fill(API_KEY);
  await page.getByLabel("Binance API Secret").fill(API_SECRET);
  await page
    .getByRole("dialog", { name: "添加资产来源" })
    .getByRole("button", { name: "取消" })
    .click();

  await page.getByRole("button", { name: "添加资产来源" }).click();
  await page.getByRole("radio", { name: "Binance" }).click();
  await expect(page.getByLabel("Binance API Key")).toHaveValue("");
  await expect(page.getByLabel("Binance API Secret")).toHaveValue("");
});

test("Binance 只读凭证先预览后原子保存，并展示现货、资金与 Earn 持仓", async ({
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

  await startBinanceFlow(page);
  const preview = page.getByRole("dialog", { name: "确认 Binance 资产来源" });
  await expect(preview).toContainText("Binance 账户 · UID 900001");
  await expect(preview).toContainText("现货、资金、Simple Earn（只读）");
  await expect(
    preview.getByText("12,849.50 USDT", { exact: true }),
  ).toBeVisible();
  expect(await state(page)).toEqual({ savedSources: 0, savedSecrets: 0 });
  expect(await page.content()).not.toContain(API_SECRET);

  await preview.getByRole("button", { name: "确认并保存" }).click();
  const card = page.getByTestId("binance-card");
  await expect(card).toContainText("Binance 资产");
  await expect(card.getByTestId("asset-source-total")).toHaveText(
    "12,849.50 USDT",
  );
  await expect(card.getByTestId("holding-top-list").getByRole("listitem")).toHaveCount(3);
  await expect(card).toContainText("现货");
  await expect(page.getByTestId("total-asset-amount")).toHaveText(
    "12,823.80 USD",
  );
  await expect(page.getByTestId("asset-source-trend-test-binance-source-1")).toContainText(
    "01月01日",
  );

  expect(await state(page)).toEqual({ savedSources: 1, savedSecrets: 1 });
  expect(responseBodies.join("\n")).not.toContain(API_SECRET);
});

test("Binance 写权限、缺失权限证明和原子保存失败均不留下来源或凭证", async ({
  page,
}) => {
  await configure(page);
  await loginAsOwner(page);
  await startBinanceFlow(page);
  const changedPermissionPreview = page.getByRole("dialog", {
    name: "确认 Binance 资产来源",
  });
  await configure(page, "trade");
  await changedPermissionPreview
    .getByRole("button", { name: "确认并保存" })
    .click();
  await expect(changedPermissionPreview.getByRole("alert")).toContainText(
    "交易或资产写权限",
  );
  expect(await state(page)).toEqual({ savedSources: 0, savedSecrets: 0 });
  await changedPermissionPreview.getByRole("button", { name: "取消" }).click();

  await configure(page, "trade");
  await startBinanceFlow(page);
  await expect(page.locator(".login-error[role=alert]")).toContainText(
    "交易或资产写权限",
  );
  expect(await state(page)).toEqual({ savedSources: 0, savedSecrets: 0 });

  for (const scenario of [
    "withdraw",
    "internal-transfer",
    "universal-transfer",
    "margin",
    "futures",
    "portfolio-margin",
    "options",
    "fix-trade",
    "unknown-write",
    "missing-proof",
    "no-reading",
  ]) {
    await configure(page, scenario);
    const response = await page.request.post("/api/asset-sources/binance/preview", {
      data: { apiKey: API_KEY, apiSecret: API_SECRET },
    });
    expect(response.status(), scenario).toBe(400);
    expect(await response.text(), scenario).not.toContain(API_SECRET);
    expect(await state(page), scenario).toEqual({ savedSources: 0, savedSecrets: 0 });
  }

  await configure(page, "commit-failure");
  await startBinanceFlow(page);
  const preview = page.getByRole("dialog", { name: "确认 Binance 资产来源" });
  await preview.getByRole("button", { name: "确认并保存" }).click();
  await expect(preview.getByRole("alert")).toContainText("原子事务写入失败");
  expect(await state(page)).toEqual({ savedSources: 0, savedSecrets: 0 });
});

test("生产 Binance 适配器只调用允许的读取端点并覆盖权限、分页、精度和未估值", async ({
  request,
}) => {
  const valid = await request.post("/test-doubles/binance/production-start", {
    data: { action: "preview-valid" },
  });
  expect(valid.ok()).toBeTruthy();
  const body = await valid.json();
  expect(body.permissions).toEqual(["market-data", "account", "positions"]);
  expect(body.snapshot.total).toEqual({ amount: "12849.5", currency: "USDT" });
  expect(body.snapshot.holdings).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceAccount: "spot", sourceAsset: "BTC", quantity: "0.1" }),
      expect.objectContaining({ sourceAccount: "funding", sourceAsset: "ETH", quantity: "1" }),
      expect.objectContaining({
        sourceAccount: "earn-flexible",
        sourceProduct: "simple-earn-flexible",
        sourceAsset: "BNB",
        providerPositionId: "BNB:BNB001",
        economicAssetKey: "binance:earn-flexible:BNB",
        positionState: "active",
        quantity: "2",
      }),
      expect.objectContaining({
        sourceAccount: "earn-locked",
        sourceProduct: "simple-earn-locked",
        sourceAsset: "XRP",
        providerPositionId: "11000000002",
        economicAssetKey: "binance:earn-locked:XRP",
        positionState: "active",
        quantity: "100",
        currentPrice: { amount: "0.5", currency: "USDT" },
      }),
    ]));
  expect(body.snapshot.coverage).toMatchObject({
    status: "complete",
    products: expect.arrayContaining([
      { product: "spot", capability: "detailed", freshness: "current", message: null },
      { product: "funding", capability: "detailed", freshness: "current", message: null },
      { product: "simple-earn-flexible", capability: "detailed", freshness: "current", message: null },
      { product: "simple-earn-locked", capability: "detailed", freshness: "current", message: null },
      { product: "dual-investment", capability: "detailed", freshness: "current", message: null },
      { product: "dual-investment-rfq", capability: "unsupported", freshness: "current", message: expect.any(String) },
      { product: "smart-arbitrage", capability: "indirect", freshness: "current", message: expect.any(String) },
    ]),
    unexplainedValue: null,
    excludedPositiveAccounts: [],
  });
  expect(body.privateRequests).toHaveLength(20);
  expect(body.privateRequests).toEqual(expect.arrayContaining([
    "GET /sapi/v1/account/apiRestrictions",
    "GET /api/v3/account?omitZeroBalances=true",
    "POST /sapi/v1/asset/get-funding-asset?needBtcValuation=true",
    "GET /sapi/v1/simple-earn/flexible/position?current=1&size=100",
    "GET /sapi/v1/simple-earn/flexible/position?current=2&size=100",
    "GET /sapi/v1/simple-earn/locked/position?current=1&size=100",
    "GET /sapi/v1/simple-earn/locked/position?current=2&size=100",
    "GET /sapi/v1/asset/wallet/balance",
    "GET /sapi/v1/simple-earn/account",
    "GET /sapi/v1/dci/product/accounts",
    "GET /sapi/v1/dci/product/positions?pageIndex=1&pageSize=100",
    "GET /sapi/v1/accumulator/product/sum-holding",
    "GET /sapi/v1/accumulator/product/position/list?pageIndex=1&pageSize=100",
    "GET /sapi/v1/bfusd/account",
    "GET /sapi/v1/rwusd/account",
    "GET /sapi/v2/eth-staking/account",
    "GET /sapi/v1/sol-staking/account",
    "GET /sapi/v1/onchain-yields/account",
    "GET /sapi/v1/onchain-yields/locked/position?pageIndex=1&pageSize=100",
    "GET /sapi/v1/soft-staking/list",
  ]));
  expect(body.privateRequests.join("\n")).not.toMatch(/margin|futures|loan|withdraw/i);
  expect(body.allRequestsSigned).toBeTruthy();
  expect(body.allHostsPinned).toBeTruthy();
  expect(body.missingReferencePriceFallsBack).toBeTruthy();
  expect(JSON.stringify(body)).not.toContain(API_SECRET);

  const priceRefresh = await request.post(
    "/test-doubles/binance/production-start",
    { data: { action: "refresh-prices" } },
  );
  expect(priceRefresh.ok()).toBeTruthy();
  await expect(priceRefresh.json()).resolves.toMatchObject({
    privateRequests: [],
    publicRequests: ["GET /api/v3/exchangeInfo", "GET /api/v3/ticker/price"],
    total: { amount: "12849.5", currency: "USDT" },
  });

  const persistence = await request.post("/test-doubles/binance/persistence");
  expect(persistence.ok()).toBeTruthy();
  await expect(persistence.json()).resolves.toEqual({
    sourceKind: "binance",
    dashboardHasOnlyReference: true,
    encryptedStoreHasNoPlaintext: true,
    committedSecretReadable: true,
    dailySnapshotCount: 1,
  });

  const rejected = await request.post("/test-doubles/binance/production-start", {
    data: { action: "preview-trade" },
  });
  expect(rejected.status()).toBe(400);
  await expect(rejected.json()).resolves.toMatchObject({
    error: expect.stringContaining("写权限"),
    privateRequests: ["GET /sapi/v1/account/apiRestrictions"],
  });

  const invalidLockedStatus = await request.post(
    "/test-doubles/binance/production-start",
    { data: { action: "preview-invalid-locked-status" } },
  );
  expect(invalidLockedStatus.status()).toBe(400);
  await expect(invalidLockedStatus.json()).resolves.toMatchObject({
    error: expect.stringContaining("非持有中仓位"),
  });

  const unsafePositionId = await request.post(
    "/test-doubles/binance/production-start",
    { data: { action: "preview-unsafe-position-id" } },
  );
  expect(unsafePositionId.status()).toBe(400);
  await expect(unsafePositionId.json()).resolves.toMatchObject({
    error: expect.stringContaining("positionId"),
  });

  const unvalued = await request.post("/test-doubles/binance/production-start", {
    data: { action: "preview-missing-price" },
  });
  expect(unvalued.ok()).toBeTruthy();
  const unvaluedBody = await unvalued.json();
  expect(unvaluedBody.snapshot.holdings).toEqual(expect.arrayContaining([
        expect.objectContaining({
          sourceAsset: "UNKNOWN",
          quantity: "8.123456789",
          currentPrice: null,
          sourceMarketValue: null,
          valuation: expect.objectContaining({ status: "unvalued" }),
        }),
      ]));

  const emptyHeldPrice = await request.post(
    "/test-doubles/binance/production-start",
    { data: { action: "preview-empty-price" } },
  );
  expect(emptyHeldPrice.ok()).toBeTruthy();
  await expect(emptyHeldPrice.json()).resolves.toMatchObject({
    snapshot: {
      total: { amount: "6849.5", currency: "USDT" },
      holdings: expect.arrayContaining([
        expect.objectContaining({
          sourceAsset: "BTC",
          currentPrice: null,
          sourceMarketValue: null,
          valuation: expect.objectContaining({ status: "unvalued" }),
        }),
      ]),
    },
  });
});

test("Binance 忽略未持有交易对的空行情，预览与价格刷新均继续", async ({
  request,
}) => {
  for (const action of [
    "preview-unrelated-empty-price",
    "refresh-unrelated-empty-price",
  ]) {
    const response = await request.post(
      "/test-doubles/binance/production-start",
      { data: { action } },
    );
    expect(response.ok(), action).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({
      [action.startsWith("refresh-") ? "total" : "snapshot"]: action.startsWith("refresh-")
        ? { amount: "12849.5", currency: "USDT" }
        : { total: { amount: "12849.5", currency: "USDT" } },
    });
  }
});

test("Binance 不重复展示已由 Flexible Earn 总额包含的 LD 抵押凭证", async ({
  request,
}) => {
  const response = await request.post("/test-doubles/binance/production-start", {
    data: { action: "preview-collateral-receipt" },
  });

  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.snapshot.total).toEqual({ amount: "12849.5", currency: "USDT" });
  expect(body.snapshot.holdings).toEqual(expect.arrayContaining([
    expect.objectContaining({
      sourceAccount: "earn-flexible",
      sourceAsset: "BNB",
      quantity: "2",
    }),
    expect.objectContaining({
      sourceAccount: "spot",
      sourceAsset: "LDORPHAN",
      quantity: "4",
      valuation: expect.objectContaining({ status: "unvalued" }),
    }),
  ]));
  expect(body.snapshot.holdings).not.toEqual(expect.arrayContaining([
    expect.objectContaining({
      sourceAccount: "spot",
      sourceAsset: "LDBNB",
    }),
  ]));
});

test("Binance 默认隐藏低于 1 USDT 的持仓，并允许手动展示全部", async ({
  page,
}) => {
  await configure(page, "dust");
  await loginAsOwner(page);
  await startBinanceFlow(page);
  const preview = page.getByRole("dialog", { name: "确认 Binance 资产来源" });
  await expect(preview).toContainText("12,850.00 USDT");
  await preview.getByRole("button", { name: "确认并保存" }).click();

  const card = page.getByTestId("binance-card");
  const toggle = card.getByRole("checkbox", { name: /隐藏低于 1 USDT/ });
  await expect(toggle).toBeHidden();
  await expect(card).not.toContainText("DUST");

  const resizeHandle = page.getByRole("button", { name: /调整\s*Binance 资产宽度/ });
  for (const _ of [0, 1]) {
    const widened = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/asset-cards/layout") &&
        response.request().method() === "PUT",
    );
    await resizeHandle.press("ArrowRight");
    await widened;
  }

  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(card).toContainText("DUST");
  await expect(card.getByTestId("asset-source-total")).toHaveText(
    "12,850.00 USDT",
  );
});

test("Binance 同步失败保留最后成功数据并接入过期状态和日快照", async ({
  page,
}) => {
  await configure(page);
  await loginAsOwner(page);
  await startBinanceFlow(page);
  await page
    .getByRole("dialog", { name: "确认 Binance 资产来源" })
    .getByRole("button", { name: "确认并保存" })
    .click();
  const card = page.getByTestId("binance-card");
  await expect(card).toContainText("12,849.50 USDT");
  await expect(page.getByTestId("asset-refresh-status")).toContainText(
    "同步完成",
  );

  await page.request.post("/test-doubles/binance", {
    data: { scenario: "refresh-failure" },
  });
  await page.getByRole("button", { name: "立即刷新资产" }).click();
  await expect(page.getByTestId("asset-refresh-status")).toContainText(
    "1 个来源失败",
  );
  await expect(card).toContainText("12,849.50 USDT");
  await expect(card).toContainText("过期数据");
  await expect(card).toContainText("Binance 同步失败");
  await expect(page.getByTestId("total-asset-overview")).toContainText(
    "包含 1 个过期来源",
  );
});

test("未认证状态与生产测试替身都不能读取 Binance 私密来源或凭证", async ({
  page,
  playwright,
}) => {
  await configure(page);
  await loginAsOwner(page);
  await startBinanceFlow(page);
  await page
    .getByRole("dialog", { name: "确认 Binance 资产来源" })
    .getByRole("button", { name: "确认并保存" })
    .click();
  await expect(page.getByTestId("binance-card")).toBeVisible();
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByRole("heading", { name: "个人资产看板已锁定" })).toBeVisible();
  const publicSurface = `${await page.content()}\n${await (await page.request.get("/")).text()}`;
  for (const value of ["900001", "BTC", "12,849", API_KEY, API_SECRET]) {
    expect(publicSurface).not.toContain(value);
  }
  expect(
    (await page.request.post("/api/asset-sources/binance/preview", {
      data: { apiKey: API_KEY, apiSecret: API_SECRET },
    })).status(),
  ).toBe(401);

  const production = await playwright.request.newContext({ baseURL: PROD_BASE_URL });
  expect((await production.get("/test-doubles/binance")).status()).toBe(404);
  expect((await production.post("/test-doubles/binance/production-start")).status()).toBe(404);
  expect((await production.post("/test-doubles/binance/persistence")).status()).toBe(404);
  await production.dispose();
});
