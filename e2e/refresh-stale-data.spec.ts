import {
  expect,
  test,
  type APIRequestContext,
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
  await page
    .getByTestId("restricted-card")
    .first()
    .getByRole("button", { name: "验证身份后查看" })
    .click();
  const [verification] = await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith("/api/auth/login/verify"),
    ),
    page.getByRole("button", { name: "使用 Passkey 解锁" }).click(),
  ]);
  expect(verification.ok()).toBeTruthy();
  await expect(page.getByTestId("view-mode")).toContainText("所有者视图");
}

async function setVisibility(page: Page, state: "visible" | "hidden") {
  await page.evaluate((nextState) => {
    const scope = window as typeof window & { __testVisibility?: string };
    scope.__testVisibility = nextState;
    if (!Object.hasOwn(document, "visibilityState")) {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => scope.__testVisibility,
      });
    }
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

async function metrics(request: APIRequestContext) {
  return (await (await request.get("/test-doubles/refresh")).json()) as {
    modes: string[];
    active: number;
  };
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
});

test("所有者页面立即同步，并按 30 秒/5 分钟节奏在可见时刷新", async ({
  page,
  request,
}) => {
  await request.post("/test-doubles/refresh", {
    data: { action: "configure", scenario: "schedule" },
  });
  await loginAsOwner(page);
  const refreshStatus = page.getByTestId("asset-refresh-status");
  await expect(refreshStatus).toContainText("同步完成");
  await request.post("/test-doubles/refresh", {
    data: { action: "reset-schedule" },
  });
  await page.clock.install();
  await page.reload();
  await expect(page.getByTestId("view-mode")).toContainText("所有者视图");
  await expect(refreshStatus).toContainText("同步完成");
  await expect(page.getByTestId("total-asset-amount")).toHaveText("302.00 USD");
  await expect.poll(async () => (await metrics(request)).modes).toEqual(["all"]);

  await page.clock.fastForward("00:00:30");
  await expect.poll(async () => (await metrics(request)).modes).toEqual([
    "all",
    "prices",
  ]);

  for (let interval = 2; interval <= 10; interval += 1) {
    await page.clock.fastForward("00:00:30");
    await expect.poll(async () => (await metrics(request)).modes.length).toBe(
      interval + 1,
    );
  }
  await expect.poll(async () => {
    const modes = (await metrics(request)).modes;
    return {
      prices: modes.filter((mode) => mode === "prices").length,
      holdings: modes.filter((mode) => mode === "holdings").length,
    };
  }).toEqual({ prices: 9, holdings: 1 });

  const beforeHidden = (await metrics(request)).modes;
  await setVisibility(page, "hidden");
  await page.clock.fastForward("00:05:00");
  expect((await metrics(request)).modes).toEqual(beforeHidden);

  await setVisibility(page, "visible");
  await expect.poll(async () => {
    const modes = (await metrics(request)).modes;
    return modes.filter((mode) => mode === "holdings").length;
  }).toBe(2);
  await page.clock.fastForward("00:00:30");
  await expect.poll(async () => {
    const modes = (await metrics(request)).modes;
    return modes.filter((mode) => mode === "prices").length;
  }).toBe(10);
});

test("部分失败保留最后成功数据并标记过期，手动刷新可见进行中与恢复状态", async ({
  page,
  request,
}) => {
  await request.post("/test-doubles/refresh", {
    data: { action: "configure", scenario: "partial-failure" },
  });
  await loginAsOwner(page);

  const overview = page.getByTestId("total-asset-overview");
  await expect(overview.getByTestId("total-asset-amount")).toHaveText(
    "310.00 USD",
  );
  await expect(overview).toContainText("包含 1 个过期来源");
  const alpha = page.getByTestId("asset-source-card-source-alpha");
  const beta = page.getByTestId("asset-source-card-source-beta");
  await expect(alpha).toContainText("110 USD");
  await expect(alpha).toContainText("数据当前");
  await expect(beta.getByTestId("asset-source-total")).toHaveText("200 USD");
  await expect(beta).toContainText("过期数据");
  await expect(beta).toContainText("最后成功：2026-04-01 08:00 UTC");
  await expect(beta).toContainText("Beta Crypto 同步失败：来源暂时不可用");

  await request.post("/test-doubles/refresh", {
    data: { action: "prepare-recovery", hold: true },
  });
  const refresh = page.getByRole("button", { name: "立即刷新资产" });
  await refresh.click();
  await expect(refresh).toBeDisabled();
  await expect(page.getByTestId("asset-refresh-status")).toContainText(
    "正在刷新余额与持仓",
  );
  await expect.poll(async () => (await metrics(request)).active).toBe(1);
  await request.post("/test-doubles/refresh", { data: { action: "release" } });

  await expect(page.getByTestId("asset-refresh-status")).toContainText("同步完成");
  await expect(overview.getByTestId("total-asset-amount")).toHaveText(
    "330.00 USD",
  );
  await expect(overview).not.toContainText("过期来源");
  await expect(beta.getByTestId("asset-source-total")).toHaveText("210 USD");
  await expect(beta).toContainText("数据当前");
  await expect(beta).not.toContainText("来源暂时不可用");
});

test("挂起来源超时不阻塞成功提交，刷新期间新增来源也不会被旧列表覆盖", async ({
  page,
  request,
}) => {
  await request.post("/test-doubles/refresh", {
    data: { action: "configure", scenario: "schedule" },
  });
  await loginAsOwner(page);
  await expect(page.getByTestId("asset-refresh-status")).toContainText("同步完成");
  await request.post("/test-doubles/refresh", {
    data: { action: "prepare-timeout" },
  });

  await page.getByRole("button", { name: "立即刷新资产" }).click();
  await expect.poll(async () => (await metrics(request)).active).toBe(1);
  await request.post("/test-doubles/refresh", {
    data: { action: "connect-during-refresh" },
  });

  await expect(page.getByTestId("asset-refresh-status")).toContainText(
    "同步完成 · 1 个来源失败",
  );
  await expect(page.getByTestId("total-asset-amount")).toHaveText(
    "361.00 USD",
  );
  await expect(page.getByTestId("asset-source-card-source-alpha")).toContainText(
    "110 USD",
  );
  await expect(page.getByTestId("asset-source-card-source-beta")).toContainText(
    "过期数据",
  );
  await expect(page.getByTestId("asset-source-card-source-gamma")).toContainText(
    "50 USD",
  );
});

test("访客不能触发同步，也不会收到来源刷新状态", async ({ page, request }) => {
  await request.post("/test-doubles/refresh", {
    data: { action: "configure", scenario: "partial-failure" },
  });
  const response = await request.post("/api/asset-sources/refresh", {
    data: { mode: "all" },
  });
  expect(response.status()).toBe(401);
  expect(await response.text()).not.toContain("Beta Crypto");

  await page.goto("/");
  await expect(page.getByRole("button", { name: "立即刷新资产" })).toHaveCount(0);
  const exposed = await page.content();
  for (const value of ["source-alpha", "source-beta", "过期数据", "来源暂时不可用"]) {
    expect(exposed).not.toContain(value);
  }
});

test("生产长桥刷新保持只读边界，并在读取前拒绝非纯 scope 6 凭证", async ({
  request,
}) => {
  const prices = await request.post(
    "/test-doubles/longbridge/production-start",
    { data: { action: "refresh-prices" } },
  );
  expect(prices.ok()).toBeTruthy();
  await expect(prices.json()).resolves.toMatchObject({
    snapshot: {
      total: { amount: "20000", currency: "USD" },
      holdings: [{
        symbol: "AAPL.US",
        currentPrice: { amount: "2000", currency: "USD" },
      }],
    },
    assetRequests: [],
    quotedSymbols: ["AAPL.US"],
  });

  const holdings = await request.post(
    "/test-doubles/longbridge/production-start",
    { data: { action: "refresh-holdings" } },
  );
  expect(holdings.ok()).toBeTruthy();
  const holdingsBody = await holdings.json();
  expect(holdingsBody.assetRequests).toEqual([
    "GET /v1/asset/account",
    "GET /v1/asset/stock",
    "GET /v1/asset/fund",
    "GET /v1/asset/exchange_rates",
    "GET /v1/portfolio/profit-analysis/by-market?page=1&size=100",
    "GET /v1/portfolio/profit-analysis/by-market?page=2&size=100",
  ]);
  expect(holdingsBody.snapshot.total).toEqual({
    amount: "123456.7891",
    currency: "USD",
  });

  const rejected = await request.post(
    "/test-doubles/longbridge/production-start",
    { data: { action: "refresh-invalid" } },
  );
  expect(rejected.status()).toBe(400);
  await expect(rejected.json()).resolves.toMatchObject({
    error: expect.stringContaining("交易写权限"),
    assetRequests: [],
  });

  const missingQuote = await request.post(
    "/test-doubles/longbridge/production-start",
    { data: { action: "refresh-missing-quote" } },
  );
  expect(missingQuote.status()).toBe(400);
  await expect(missingQuote.json()).resolves.toMatchObject({
    error: expect.stringContaining("AAPL.US"),
    assetRequests: [],
  });

  const negativeResidual = await request.post(
    "/test-doubles/longbridge/production-start",
    { data: { action: "refresh-negative-residual" } },
  );
  expect(negativeResidual.ok()).toBeTruthy();
  await expect(negativeResidual.json()).resolves.toMatchObject({
    snapshot: { total: { amount: "900", currency: "USD" } },
    quotedSymbols: ["AAPL.US"],
  });

  const accountEstimate = await request.post(
    "/test-doubles/longbridge/production-start",
    { data: { action: "refresh-account-estimate" } },
  );
  expect(accountEstimate.ok()).toBeTruthy();
  await expect(accountEstimate.json()).resolves.toMatchObject({
    quotedSymbols: ["AAPL.US"],
    snapshot: {
      holdings: [{
        valuation: { priceSource: "Longbridge QuoteContext" },
      }],
    },
  });

  const rotated = await request.post(
    "/test-doubles/longbridge/production-start",
    { data: { action: "refresh-expired" } },
  );
  expect(rotated.ok()).toBeTruthy();
  await expect(rotated.json()).resolves.toMatchObject({
    credentialsRotated: true,
    tokenRequests: 1,
  });

  const rotatedToTrade = await request.post(
    "/test-doubles/longbridge/production-start",
    { data: { action: "refresh-expired-trade" } },
  );
  expect(rotatedToTrade.status()).toBe(400);
  await expect(rotatedToTrade.json()).resolves.toMatchObject({
    error: expect.stringContaining("交易写权限"),
    assetRequests: [],
    tokenRequests: 1,
  });

  const rotatedThenFailed = await request.post(
    "/test-doubles/longbridge/production-start",
    { data: { action: "refresh-expired-downstream-fail" } },
  );
  expect(rotatedThenFailed.status()).toBe(400);
  await expect(rotatedThenFailed.json()).resolves.toMatchObject({
    error: expect.stringContaining("AAPL.US"),
    credentialsRotated: true,
    assetRequests: [],
    tokenRequests: 1,
  });

  const malformedScope = await request.post(
    "/test-doubles/longbridge/production-start",
    { data: { action: "refresh-expired-malformed-scope" } },
  );
  expect(malformedScope.status()).toBe(400);
  await expect(malformedScope.json()).resolves.toMatchObject({
    error: expect.stringContaining("scope"),
    credentialsRotated: false,
    assetRequests: [],
    tokenRequests: 1,
  });
});
