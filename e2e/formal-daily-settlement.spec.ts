import {
  expect,
  test,
  type CDPSession,
  type Page,
} from "@playwright/test";

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
  const [verification] = await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith("/api/auth/login/verify"),
    ),
    page.getByRole("button", { name: "使用 Passkey 登录" }).click(),
  ]);
  expect(verification.ok()).toBeTruthy();
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
});

test("正式日结固定证券官方收盘、同窗加密价格且幂等", async ({
  request,
}) => {
  const response = await request.post("/test-doubles/formal-settlements", {
    data: { action: "run-production-shaped" },
  });

  expect(response.ok()).toBeTruthy();
  const result = await response.json();
  expect(result).toMatchObject({
    currentSecurityPrice: "217.250",
    currentSecuritySession: "post-market",
    firstRun: { outcome: "recorded" },
    secondRun: { outcome: "already-recorded" },
    dailyTrendCount: 0,
    settlements: [{
      anchor: {
        key: "securities-close:US:2026-08-05",
        kind: "securities-close",
        market: "US",
        tradingDay: "2026-08-05",
        scheduledCloseAt: "2026-08-05T20:00:00.000Z",
      },
      capturedAt: "2026-08-05T20:05:00.000Z",
      status: "complete",
      diagnostic: null,
      total: {
        USD: "313.94",
        CNY: "2260.368",
        HKD: "2448.732",
      },
      exchangeRates: [{
        baseCurrency: "USD",
        quoteCurrency: "CNY",
        rate: "7.2",
        source: "正式日结测试汇率",
        observedAt: "2026-08-05T20:05:00.000Z",
      }, {
        baseCurrency: "USD",
        quoteCurrency: "HKD",
        rate: "7.8",
        source: "正式日结测试汇率",
        observedAt: "2026-08-05T20:05:00.000Z",
      }],
      sources: [{
        sourceId: "longbridge-source",
        label: "长桥证券",
        kind: "longbridge",
        capturedAt: "2026-08-05T20:05:00.000Z",
        status: "complete",
        diagnostic: null,
        total: {
          USD: "211.94",
          CNY: "1525.968",
          HKD: "1653.132",
        },
      }, {
        sourceId: "crypto-source",
        label: "加密资产",
        kind: "crypto-fixture",
        capturedAt: "2026-08-05T20:05:00.000Z",
        status: "complete",
        diagnostic: null,
        total: {
          USD: "102",
          CNY: "734.4",
          HKD: "795.6",
        },
      }],
      holdings: [{
        sourceId: "longbridge-source",
        symbol: "NVDA.US",
        quantity: "1",
        assetClass: "securities",
        price: { amount: "211.940", currency: "USD" },
        priceBasis: "official-close",
        market: "US",
        marketTradingDay: "2026-08-05",
      }, {
        sourceId: "crypto-source",
        symbol: "BTC",
        quantity: "0.002",
        assetClass: "crypto",
        price: { amount: "51000", currency: "USD" },
        priceBasis: "capture-time",
        market: null,
        marketTradingDay: null,
      }],
    }],
  });
  expect(result.settlements).toHaveLength(1);
  expect(result.settlements[0].sources).toHaveLength(2);
  expect(result.settlements[0].holdings).toHaveLength(2);
  expect(result.settlementCountAfterSourceDeletion).toBe(0);
});

test("手工资产保留已知金额但不阻塞正式日结", async ({ request }) => {
  const response = await request.post("/test-doubles/formal-settlements", {
    data: { action: "run-with-manual-source" },
  });

  expect(response.ok()).toBeTruthy();
  const result = await response.json();
  expect(result.outcome).toBe("recorded");
  expect(result.settlement.status).toBe("incomplete");
  expect(result.settlement.sources).toEqual(expect.arrayContaining([
    expect.objectContaining({
    sourceId: "manual-source",
    status: "incomplete",
    diagnostic: "手工资产没有同一采集窗口的可验证行情",
    total: { USD: null, CNY: "100000", HKD: null },
    }),
  ]));
});

test("公开观察钱包无需凭证也能进入正式日结", async ({ request }) => {
  const response = await request.post("/test-doubles/formal-settlements", {
    data: { action: "run-with-public-evm-source" },
  });

  expect(response.ok()).toBeTruthy();
  const result = await response.json();
  expect(result.outcome).toBe("recorded");
  expect(result.settlement.status).toBe("complete");
  expect(result.settlement.sources).toHaveLength(1);
  expect(result.settlement.sources[0]).toMatchObject({
    sourceId: "public-evm-source",
    status: "complete",
  });
});

test("所有者看板把正式日结与每日趋势观测分开标注", async ({
  page,
  request,
}) => {
  const configured = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "configure" },
  });
  expect(configured.ok()).toBeTruthy();
  const seeded = await request.post("/test-doubles/formal-settlements", {
    data: { action: "seed-owner-view" },
  });
  expect(seeded.ok()).toBeTruthy();

  await loginAsOwner(page);
  const settlement = page.getByTestId("formal-daily-settlement");
  await expect(settlement).toContainText("正式日结");
  await expect(settlement).toContainText("已确认");
  await expect(settlement).toContainText("US 常规盘 · 交易日 2026-08-05");
  await expect(settlement).toContainText("证券按官方日 K 常规盘收盘记录");
  await expect(settlement).toContainText("加密资产按同一采集窗口市价记录");
  await expect(page.getByTestId("total-asset-trend")).toContainText("总资产趋势");
});
