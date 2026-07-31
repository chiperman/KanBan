import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { PROD_BASE_URL } from "../playwright.config";

const API_KEY = "bitget-browser-api-key";
const API_SECRET = "bitget-browser-secret-must-not-leak";
const PASSPHRASE = "bitget-browser-passphrase-must-not-leak";

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
  const response = await page.request.post("/test-doubles/bitget", {
    data: { scenario },
  });
  expect(response.ok()).toBeTruthy();
}

async function startBitgetFlow(page: Page, accountMode = "classic") {
  const dialog = page.getByRole("dialog", { name: "添加资产来源" });
  if (!(await dialog.isVisible())) {
    await page.getByRole("button", { name: "添加资产来源" }).click();
  }
  const provider = page.getByRole("radio", { name: "Bitget" });
  if (await provider.isVisible()) {
    await provider.click();
  }
  const accountModeLabel =
    accountMode === "uta"
      ? "Unified Trading Account (UTA)"
      : "Classic Account";
  await dialog.getByRole("button", { name: "Bitget 账户类型" }).click();
  await dialog.getByRole("option", { name: accountModeLabel }).click();
  await page.getByLabel("Bitget API Key").fill(API_KEY);
  await page.getByLabel("Bitget API Secret").fill(API_SECRET);
  await page.getByLabel("Bitget Passphrase").fill(PASSPHRASE);
  await page.getByRole("button", { name: "验证只读凭证" }).click();
}

async function state(page: Page) {
  return (await (await page.request.get("/test-doubles/bitget")).json()) as {
    savedSources: number;
    savedSecrets: number;
  };
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
});

test("Bitget 只读凭证先预览后原子保存，并展示现货、资金、Earn 与合约交易机器人持仓", async ({
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

  await startBitgetFlow(page);
  const preview = page.getByRole("dialog", {
    name: "确认 Bitget 资产来源",
  });
  await expect(preview).toContainText("Bitget 账户 · UID 770001");
  await expect(preview).toContainText(
    "现货、资金、Savings、SharkFin、On-chain Elite、普通 Futures（平台总额已含，不展开仓位）、合约交易机器人（只读）",
  );
  await expect(preview).toContainText("Classic Account");
  await expect(preview).toContainText("11,641.99 USDT");
  await expect(page.getByText(API_SECRET)).toHaveCount(0);
  await expect(page.getByText(PASSPHRASE)).toHaveCount(0);

  await preview.getByRole("button", { name: "确认并保存" }).click();
  const card = page.getByTestId("bitget-card");
  await expect(card.getByTestId("asset-source-total")).toHaveText(
    "11,641.99 USDT",
  );
  await expect(
    card.getByTestId("holding-top-list").getByRole("listitem"),
  ).toHaveCount(3);
  await expect(card).toContainText("现货");
  await expect(card.getByTestId("bitget-coverage-status")).toContainText(
    "当前总额完整 · 部分产品仅汇总",
  );
  const coverage = card.getByTestId("bitget-product-coverage");
  await expect(coverage).toContainText("08 PRODUCTS");
  const resizeHandle = page.getByRole("button", {
    name: /调整\s*Bitget 资产宽度/,
  });
  const widened = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/asset-cards/layout") &&
      response.request().method() === "PUT",
  );
  await resizeHandle.press("ArrowRight");
  await widened;
  await expect(coverage).toBeVisible();
  await coverage.locator("summary").click();
  await expect(coverage).toContainText("SharkFin");
  await expect(coverage).toContainText("Futures Bots");
  await expect(coverage).toContainText("Futures");
  await expect(coverage).toContainText("平台总额已覆盖普通合约相关权益");
  expect(responseBodies.join("\n")).not.toContain(API_SECRET);
  expect(responseBodies.join("\n")).not.toContain(PASSPHRASE);
});

test("Bitget 写权限、确认前范围变化和保存失败均不留下来源或凭证", async ({
  page,
}) => {
  await configure(page);
  await loginAsOwner(page);
  await startBitgetFlow(page);
  const preview = page.getByRole("dialog", { name: "确认 Bitget 资产来源" });
  await configure(page, "trade");
  await preview.getByRole("button", { name: "确认并保存" }).click();
  await expect(preview.getByRole("alert")).toContainText("写权限");
  expect(await state(page)).toEqual({ savedSources: 0, savedSecrets: 0 });
  await preview.getByRole("button", { name: "取消" }).click();

  for (const scenario of [
    "trade",
    "transfer",
    "withdraw",
    "read-and-write",
    "unknown-permission",
    "missing-read",
  ]) {
    await configure(page, scenario);
    const response = await page.request.post("/api/asset-sources/bitget/preview", {
      data: {
        apiKey: API_KEY,
        apiSecret: API_SECRET,
        passphrase: PASSPHRASE,
        accountMode: "classic",
      },
    });
    expect(response.status(), scenario).toBe(400);
    expect(await state(page), scenario).toEqual({
      savedSources: 0,
      savedSecrets: 0,
    });
    expect(await response.text()).not.toContain(API_SECRET);
  }

  await configure(page, "commit-failure");
  await startBitgetFlow(page);
  const failed = page.getByRole("dialog", { name: "确认 Bitget 资产来源" });
  await failed.getByRole("button", { name: "确认并保存" }).click();
  await expect(failed.getByRole("alert")).toContainText("原子事务写入失败");
  expect(await state(page)).toEqual({ savedSources: 0, savedSecrets: 0 });
});

test("生产 Bitget Classic 适配器以账户分区守恒并覆盖 SharkFin 与 On-chain Elite", async ({
  request,
}) => {
  const response = await request.post("/test-doubles/bitget/production-start", {
    data: { action: "preview-valid" },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.permissions).toEqual(["market-data", "account", "positions"]);
  expect(body.account).toEqual({
    id: "bitget:770001",
    label: "Bitget 账户 · UID 770001",
  });
  expect(body.snapshot.total).toEqual({ amount: "11641.98687228", currency: "USDT" });
  expect(body.snapshot.coverage).toEqual({
    status: "complete",
    products: [
      {
        product: "spot",
        capability: "detailed",
        freshness: "current",
        message: null,
      },
      {
        product: "funding",
        capability: "detailed",
        freshness: "current",
        message: null,
      },
      {
        product: "savings-flexible",
        capability: "detailed",
        freshness: "current",
        message: null,
      },
      {
        product: "savings-fixed",
        capability: "detailed",
        freshness: "current",
        message: null,
      },
      {
        product: "futures-bot",
        capability: "aggregate-only",
        freshness: "current",
        message: "读取平台聚合账户权益，不展开机器人订单",
      },
      {
        product: "futures",
        capability: "aggregate-only",
        freshness: "current",
        message: "平台总额已覆盖普通合约相关权益，不与 Futures Bots 重复相加；不展开仓位、保证金或未实现盈亏",
      },
      {
        product: "sharkfin",
        capability: "aggregate-only",
        freshness: "current",
        message: "读取 SharkFin 账户聚合估值，官方当前记录不提供逐仓本金",
      },
      {
        product: "onchain-elite",
        capability: "detailed",
        freshness: "current",
        message: null,
      },
    ],
    unexplainedValue: null,
    excludedPositiveAccounts: [],
  });
  expect(body.snapshot.holdings).toEqual(expect.arrayContaining([
    expect.objectContaining({ sourceAccount: "spot", sourceAsset: "BTC", quantity: "0.1" }),
    expect.objectContaining({
      sourceAccount: "funding",
      sourceAsset: "ETH",
      quantity: "1",
      valuation: expect.objectContaining({ pricedAt: "2025-12-31T23:59:58.000Z" }),
    }),
    expect.objectContaining({ sourceAccount: "earn-flexible", sourceAsset: "SOL", quantity: "5" }),
    expect.objectContaining({ sourceAccount: "earn-locked", sourceAsset: "BNB", quantity: "0.8" }),
    expect.objectContaining({
      name: "USDT · 合约交易机器人",
      sourceAccount: "trading-bot",
      sourceAsset: "USDT",
      quantity: "154.33255128",
      sourceMarketValue: { amount: "154.33255128", currency: "USDT" },
      valuation: expect.objectContaining({
        priceSource: "Bitget 合约交易机器人 usdtValue",
        pricedAt: "2025-12-31T23:59:59.000Z",
      }),
    }),
    expect.objectContaining({
      sourceAccount: "earn",
      sourceProduct: "sharkfin",
      sourceAsset: "USDT",
      quantity: "200",
      sourceMarketValue: { amount: "200", currency: "USDT" },
    }),
    expect.objectContaining({
      sourceAccount: "staking",
      sourceProduct: "onchain-elite",
      providerPositionId: "elite-eth-1",
      sourceAsset: "ETH",
      quantity: "0.1",
      sourceMarketValue: { amount: "300", currency: "USDT" },
    }),
  ]));
  expect(body.privateRequests).toEqual([
    "GET /api/v2/spot/account/info",
    "GET /api/v2/spot/account/assets?assetType=hold_only",
    "GET /api/v2/account/funding-assets",
    "GET /api/v2/account/bot-assets?accountType=futures",
    "GET /api/v2/account/all-account-balance",
    "GET /api/v2/earn/account/assets",
    "GET /api/v2/earn/savings/assets?periodType=flexible&limit=100&startTime=1764547200000&endTime=1767225600000",
    "GET /api/v2/earn/savings/assets?periodType=fixed&limit=100&startTime=1764547200000&endTime=1767225600000",
    "GET /api/v2/earn/sharkfin/account",
    "GET /api/v2/earn/elite/assets",
  ]);
  expect(body.allRequestsGet).toBeTruthy();
  expect(body.allPrivateRequestsSigned).toBeTruthy();
  expect(body.allHostsPinned).toBeTruthy();
  expect(body.earnThrottleSleeps).toEqual([100, 100, 100, 200]);
  expect(body.privateRequests.join("\n")).not.toMatch(/trade\/place|transfer|withdraw|mix|margin|loan/i);
  expect(JSON.stringify(body)).not.toContain(API_SECRET);
  expect(JSON.stringify(body)).not.toContain(PASSPHRASE);

  const persistence = await request.post("/test-doubles/bitget/persistence");
  expect(persistence.ok()).toBeTruthy();
  await expect(persistence.json()).resolves.toEqual({
    sourceKind: "bitget",
    dashboardHasOnlyReference: true,
    encryptedStoreHasNoPlaintext: true,
    committedSecretReadable: true,
    dailySnapshotCount: 1,
  });
});

test("生产 Bitget UTA 仅在纯现金范围证明完整时读取资产", async ({ request }) => {
  const valid = await request.post("/test-doubles/bitget/production-start", {
    data: { action: "preview-uta-valid" },
  });
  expect(valid.ok()).toBeTruthy();
  await expect(valid.json()).resolves.toMatchObject({
    account: { id: "bitget:770001" },
    snapshot: {
      total: { amount: "11476.694481", currency: "USD" },
      coverage: {
        status: "complete",
        products: [
          {
            product: "spot",
            capability: "detailed",
            freshness: "current",
            message: null,
          },
          {
            product: "funding",
            capability: "detailed",
            freshness: "current",
            message: null,
          },
          {
            product: "savings-flexible",
            capability: "detailed",
            freshness: "current",
            message: null,
          },
          {
            product: "savings-fixed",
            capability: "detailed",
            freshness: "current",
            message: null,
          },
          {
            product: "sharkfin",
            capability: "aggregate-only",
            freshness: "current",
            message: "读取 SharkFin 账户聚合估值，官方当前记录不提供逐仓本金",
          },
          {
            product: "onchain-elite",
            capability: "detailed",
            freshness: "current",
            message: null,
          },
        ],
      },
    },
    utaProof: {
      positionCategories: 3,
      orderCategories: 4,
    },
    btc: {
      valuation: { pricedAt: "2025-12-31T23:59:57.000Z" },
    },
  });

  for (const [action, message] of [
    ["preview-uta-write", "read-only"],
    ["preview-uta-missing-trade", "纯只读资产范围"],
    ["preview-uta-withdraw", "纯只读资产范围"],
    ["preview-uta-position", "合约持仓"],
    ["preview-uta-order-second-page", "未成交挂单"],
    ["preview-uta-debt", "debt"],
    ["preview-uta-risk", "unrealisedPnl"],
    ["preview-uta-funding-mismatch", "Funding balance"],
  ] as const) {
    const response = await request.post("/test-doubles/bitget/production-start", {
      data: { action },
    });
    expect(response.status(), action).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining(message),
    });
  }
});

test("Bitget Savings 成功跨窗口翻页、保留旧持仓并去重，后页失败不提交部分结果", async ({
  request,
}) => {
  const success = await request.post("/test-doubles/bitget/production-start", {
    data: { action: "preview-earn-multi-page" },
  });
  expect(success.ok()).toBeTruthy();
  const body = await success.json();
  expect(body.snapshot.total).toEqual({ amount: "11651.98687228", currency: "USDT" });
  expect(body.snapshot.holdings).toEqual(expect.arrayContaining([
    expect.objectContaining({ sourceAsset: "ADA", quantity: "10" }),
    expect.objectContaining({ sourceAsset: "SOL", quantity: "5" }),
  ]));
  expect(body.savingsRequests).toHaveLength(5);
  expect(body.savingsRequests.filter((path: string) => path.includes("idLessThan=flex-page-2"))).toHaveLength(1);
  const windows = new Set(
    body.savingsRequests.map((path: string) => {
      const url = new URL(`https://api.bitget.com${path.replace(/^GET /, "")}`);
      return `${url.searchParams.get("startTime")}:${url.searchParams.get("endTime")}`;
    }),
  );
  expect(windows.size).toBe(2);

  const failed = await request.post("/test-doubles/bitget/production-start", {
    data: { action: "preview-earn-page-failure" },
  });
  expect(failed.status()).toBe(400);
  await expect(failed.json()).resolves.toMatchObject({
    error: expect.stringContaining("40014"),
    snapshotCommitted: false,
  });
});

test("Bitget Earn 总览与明细口径不一致时保留总览资产且不重复计算", async ({
  request,
}) => {
  const mismatch = await request.post("/test-doubles/bitget/production-start", {
    data: { action: "preview-earn-mismatch" },
  });
  expect(mismatch.ok()).toBeTruthy();
  const mismatchBody = await mismatch.json();
  expect(mismatchBody.snapshot.holdings).toEqual(expect.arrayContaining([
    expect.objectContaining({
      sourceAccount: "funding",
      sourceAsset: "ETH",
      quantity: "1",
    }),
    expect.objectContaining({
      sourceAccount: "earn",
      sourceAsset: "ETH",
      quantity: "2",
    }),
  ]));
  expect(mismatchBody.snapshot.holdings).not.toEqual(expect.arrayContaining([
    expect.objectContaining({
      sourceAccount: "earn-flexible",
      sourceAsset: "ETH",
    }),
  ]));
  expect(mismatchBody.snapshot.coverage.products).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        product: "savings-flexible",
        capability: "aggregate-only",
        message: "Earn 总览与逐仓明细不一致，按币种保留平台汇总资产",
      }),
      expect.objectContaining({
        product: "savings-fixed",
        capability: "aggregate-only",
        message: "Earn 总览与逐仓明细不一致，按币种保留平台汇总资产",
      }),
    ]),
  );
  expect(mismatchBody.snapshot.total).toEqual({
    amount: "17641.98687228",
    currency: "USDT",
  });
  expect(mismatchBody.snapshot.coverage.status).toBe("complete");
});

test("Bitget 全账户残差和排除账户会动态降级，P0 产品失败不伪装为零", async ({
  request,
}) => {
  const offsettingDrift = await request.post(
    "/test-doubles/bitget/production-start",
    { data: { action: "preview-offsetting-partition-drift" } },
  );
  expect(offsettingDrift.ok()).toBeTruthy();
  await expect(offsettingDrift.json()).resolves.toMatchObject({
    snapshot: {
      total: { amount: "11641.99687228", currency: "USDT" },
      coverage: {
        status: "complete",
        unexplainedValue: null,
        excludedPositiveAccounts: [],
      },
    },
  });

  const smallNetDrift = await request.post(
    "/test-doubles/bitget/production-start",
    { data: { action: "preview-small-net-drift" } },
  );
  expect(smallNetDrift.ok()).toBeTruthy();
  await expect(smallNetDrift.json()).resolves.toMatchObject({
    snapshot: {
      total: { amount: "11642.09687228", currency: "USDT" },
      coverage: {
        status: "complete",
        unexplainedValue: null,
        excludedPositiveAccounts: [],
      },
    },
  });

  const residual = await request.post("/test-doubles/bitget/production-start", {
    data: { action: "preview-all-account-residual" },
  });
  expect(residual.ok()).toBeTruthy();
  await expect(residual.json()).resolves.toMatchObject({
    snapshot: {
      total: { amount: "11741.98687228", currency: "USDT" },
      coverage: {
        status: "partial",
        unexplainedValue: { amount: "100", currency: "USDT" },
        excludedPositiveAccounts: [],
      },
    },
  });

  const futuresAggregate = await request.post("/test-doubles/bitget/production-start", {
    data: { action: "preview-positive-futures" },
  });
  expect(futuresAggregate.ok()).toBeTruthy();
  await expect(futuresAggregate.json()).resolves.toMatchObject({
    snapshot: {
      total: { amount: "11641.98687228", currency: "USDT" },
      coverage: {
        status: "complete",
        products: expect.arrayContaining([
          {
            product: "futures",
            capability: "aggregate-only",
            freshness: "current",
            message: "平台总额已覆盖普通合约相关权益，不与 Futures Bots 重复相加；不展开仓位、保证金或未实现盈亏",
          },
        ]),
        unexplainedValue: null,
        excludedPositiveAccounts: [],
      },
    },
  });

  const excludedMargin = await request.post(
    "/test-doubles/bitget/production-start",
    { data: { action: "preview-positive-margin" } },
  );
  expect(excludedMargin.ok()).toBeTruthy();
  await expect(excludedMargin.json()).resolves.toMatchObject({
    snapshot: {
      total: { amount: "11641.98687228", currency: "USDT" },
      coverage: {
        status: "partial",
        unexplainedValue: null,
        excludedPositiveAccounts: ["margin"],
      },
    },
  });

  for (const action of [
    "preview-sharkfin-failure",
    "preview-elite-failure",
  ]) {
    const failed = await request.post("/test-doubles/bitget/production-start", {
      data: { action },
    });
    expect(failed.status(), action).toBe(400);
    await expect(failed.json()).resolves.toMatchObject({
      error: expect.stringContaining("40014"),
      snapshotCommitted: false,
    });
  }
});

test("Bitget Earn 分页和缺价失败均不伪造完整资产", async ({ request }) => {
  for (const [action, message] of [
    ["preview-earn-cursor-repeat", "游标重复"],
    ["preview-empty-funding", "frozen"],
    ["preview-earn-missing-end-id", "endId"],
  ] as const) {
    const response = await request.post("/test-doubles/bitget/production-start", {
      data: { action },
    });
    expect(response.status(), action).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining(message) });
  }

  const missing = await request.post("/test-doubles/bitget/production-start", {
    data: { action: "preview-missing-price" },
  });
  expect(missing.ok()).toBeTruthy();
  const missingBody = await missing.json();
  expect(missingBody.snapshot.holdings).toEqual(expect.arrayContaining([
    expect.objectContaining({
      sourceAsset: "UNKNOWN",
      quantity: "8.123456789",
      currentPrice: null,
      sourceMarketValue: null,
      valuation: expect.objectContaining({ status: "quote-unavailable" }),
    }),
  ]));
  expect(missingBody.snapshot.total).toEqual({ amount: "11641.98687228", currency: "USDT" });

  const zero = await request.post("/test-doubles/bitget/production-start", {
    data: { action: "preview-zero-price" },
  });
  expect(zero.ok()).toBeTruthy();
  await expect(zero.json()).resolves.toMatchObject({
    snapshot: { total: { amount: "11641.98687228", currency: "USDT" } },
  });

  const empty = await request.post("/test-doubles/bitget/production-start", {
    data: { action: "preview-empty-price" },
  });
  expect(empty.ok()).toBeTruthy();
  await expect(empty.json()).resolves.toMatchObject({
    snapshot: {
      total: { amount: "11641.98687228", currency: "USDT" },
      holdings: expect.arrayContaining([
        expect.objectContaining({
          sourceAsset: "BTC",
          currentPrice: null,
          sourceMarketValue: null,
          valuation: expect.objectContaining({ status: "quote-unavailable" }),
        }),
      ]),
    },
  });
});

test("Bitget 忽略未持有交易对的空行情，预览与价格刷新均继续", async ({
  request,
}) => {
  for (const action of [
    "preview-unrelated-empty-last",
    "refresh-unrelated-empty-last",
  ]) {
    const response = await request.post(
      "/test-doubles/bitget/production-start",
      { data: { action } },
    );
    expect(response.ok(), action).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({
      [action.startsWith("refresh-") ? "total" : "snapshot"]: action.startsWith("refresh-")
        ? { amount: "11641.98687228", currency: "USDT" }
        : { total: { amount: "11641.98687228", currency: "USDT" } },
    });
  }
});

test("Bitget 同步失败保留最后成功数据并接入过期状态和日快照", async ({ page }) => {
  await configure(page);
  await loginAsOwner(page);
  await startBitgetFlow(page);
  await page
    .getByRole("dialog", { name: "确认 Bitget 资产来源" })
    .getByRole("button", { name: "确认并保存" })
    .click();
  const card = page.getByTestId("bitget-card");
  await expect(card).toContainText("11,641.99 USDT");
  await expect(page.getByTestId("asset-source-trend-test-bitget-source-1")).toContainText("01月01日");

  await configure(page, "refresh-failure");
  await page.getByRole("button", { name: "立即刷新资产" }).click();
  await expect(page.getByTestId("asset-refresh-status")).toContainText("1 个来源失败");
  await expect(card).toContainText("11,641.99 USDT");
  await expect(card).toContainText("过期数据");
  await expect(card).toContainText("Bitget 同步失败");
  await expect(
    card
      .getByTestId("bitget-product-coverage")
      .locator(".vibe-coverage-summary-freshness"),
  ).toHaveText("00 CURRENT / 08 STALE");
  await expect(page.getByTestId("total-asset-overview")).toContainText("包含 1 个过期来源");
});

test("Bitget 价格刷新保持公开边界并规范化时间与认证错误", async ({ request }) => {
  const price = await request.post("/test-doubles/bitget/production-start", {
    data: { action: "refresh-prices" },
  });
  expect(price.ok()).toBeTruthy();
  await expect(price.json()).resolves.toMatchObject({
    privateRequests: [],
    publicRequests: [
      "GET /api/v2/spot/public/symbols",
      "GET /api/v2/spot/market/tickers",
    ],
    total: { amount: "11641.98687228", currency: "USDT" },
    coverage: {
      status: "complete",
      products: expect.arrayContaining([
        expect.objectContaining({
          product: "sharkfin",
          freshness: "current",
        }),
      ]),
    },
  });

  for (const action of ["refresh-older-ticker", "refresh-all-older-ticker"]) {
    const response = await request.post("/test-doubles/bitget/production-start", {
      data: { action },
    });
    expect(response.ok()).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({
      holdingOrder: ["BTC", "ETH", "USDT", "SOL", "BNB"],
      btc: {
        currentPrice: { amount: "60000", currency: "USDT" },
        sourceMarketValue: { amount: "6000", currency: "USDT" },
      },
    });
  }

  const retry = await request.post("/test-doubles/bitget/production-start", {
    data: { action: "timestamp-retry" },
  });
  expect(retry.ok()).toBeTruthy();
  await expect(retry.json()).resolves.toMatchObject({
    timeRequests: 2,
    accountInfoRequests: 2,
    allPrivateRequestsSigned: true,
  });

  const invalid = await request.post("/test-doubles/bitget/production-start", {
    data: { action: "invalid-auth" },
  });
  expect(invalid.status()).toBe(400);
  await expect(invalid.json()).resolves.toMatchObject({
    error: expect.stringContaining("40006"),
    privateRequests: ["GET /api/v2/spot/account/info"],
  });

  const transient = await request.post("/test-doubles/bitget/production-start", {
    data: { action: "transient-retry" },
  });
  expect(transient.ok()).toBeTruthy();
  await expect(transient.json()).resolves.toMatchObject({
    accountInfoRequests: 2,
    retrySleeps: [250],
  });

  for (const action of ["http-429-retry", "http-500-retry"] as const) {
    const response = await request.post("/test-doubles/bitget/production-start", {
      data: { action },
    });
    expect(response.ok(), action).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({
      accountInfoRequests: 2,
      retrySleeps: [250],
    });
  }

  const exhausted = await request.post("/test-doubles/bitget/production-start", {
    data: { action: "transient-exhausted" },
  });
  expect(exhausted.status()).toBe(400);
  await expect(exhausted.json()).resolves.toMatchObject({
    error: expect.stringContaining("25000"),
    accountInfoRequests: 3,
    retrySleeps: [250, 750],
  });

  for (const [action, code] of [
    ["permission-error", "40014"],
    ["uta-permission-error", "25620"],
    ["ip-error", "40018"],
    ["region-error", "40000"],
  ] as const) {
    const response = await request.post("/test-doubles/bitget/production-start", {
      data: { action },
    });
    expect(response.status(), action).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining(code),
      accountInfoRequests: 1,
      retrySleeps: [],
    });
  }
});

test("未认证状态与生产测试替身都不能读取 Bitget 私密来源或凭证", async ({
  page,
  playwright,
}) => {
  await configure(page);
  await loginAsOwner(page);
  await startBitgetFlow(page);
  await page
    .getByRole("dialog", { name: "确认 Bitget 资产来源" })
    .getByRole("button", { name: "确认并保存" })
    .click();
  await expect(page.getByTestId("bitget-card")).toBeVisible();
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByTestId("login-gate")).toBeVisible();
  await page.reload();
  const publicSurface = `${await page.content()}\n${await (await page.request.get("/")).text()}`;
  for (const value of ["770001", "BTC", "10,987", API_KEY, API_SECRET, PASSPHRASE]) {
    expect(publicSurface).not.toContain(value);
  }
  expect((await page.request.post("/api/asset-sources/bitget/preview", {
    data: {
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      passphrase: PASSPHRASE,
      accountMode: "classic",
    },
  })).status()).toBe(401);

  const production = await playwright.request.newContext({ baseURL: PROD_BASE_URL });
  expect((await production.get("/test-doubles/bitget")).status()).toBe(404);
  expect((await production.post("/test-doubles/bitget/production-start")).status()).toBe(404);
  expect((await production.post("/test-doubles/bitget/persistence")).status()).toBe(404);
  await production.dispose();
});
