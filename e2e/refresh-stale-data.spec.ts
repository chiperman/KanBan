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
  await expect(page.getByRole("status")).toContainText("预置完成");
  await page.goto("/");

  const [verification] = await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith("/api/auth/login/verify"),
    ),
    page.getByRole("button", { name: "使用 Passkey 登录" }).click(),
  ]);
  expect(verification.ok()).toBeTruthy();
  await expect(page.getByTestId("workbench-shell")).toBeVisible();
}

async function metrics(request: APIRequestContext) {
  return (await (await request.get("/test-doubles/refresh")).json()) as {
    modes: string[];
    scopes: string[];
    sourceIds: Array<string | null>;
    active: number;
    adapterCalls: number;
  };
}

async function expectSummaryAmount(page: Page, sourceId: string, value: string) {
  const row = page.getByTestId("overview-source-summary").getByRole("listitem").filter({
    has: page.locator(`a[href="/asset-sources/${sourceId}"]`),
  });
  const counter = row.locator('[data-vibe-component="live-counter"]');
  await expect(counter).toHaveAttribute("data-counter-target", value);
  await counter.scrollIntoViewIfNeeded();
  await expect(counter).toHaveAttribute("data-counter-state", "complete");
  await expect(counter).toHaveText(value);
  await expect(row).toContainText(`${value} USD`);
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

async function setFocus(page: Page, focused: boolean) {
  await page.evaluate((nextFocused) => {
    const scope = window as typeof window & { __testFocused?: boolean };
    scope.__testFocused = nextFocused;
    if (!Object.hasOwn(document, "hasFocus")) {
      Object.defineProperty(document, "hasFocus", {
        configurable: true,
        value: () => scope.__testFocused === true,
      });
    }
    window.dispatchEvent(new Event(nextFocused ? "focus" : "blur"));
  }, focused);
}

async function keepOwnerSessionAlive(page: Page, now: string) {
  await page.request.post("/test-doubles/clock", { data: { now } });
  const response = await page.request.post("/api/auth/session/activity");
  expect(response.ok()).toBeTruthy();
}

async function configureRefresh(
  request: APIRequestContext,
  scenario: "schedule" | "partial-failure",
  sourceKind?: "okx" | "evm-watch-ethereum",
) {
  await request.post("/test-doubles/refresh", {
    data: { action: "configure", scenario, sourceKind },
  });
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
});

test("统一周期只在可见且聚焦时到期刷新，恢复前台事件合并为一轮", async ({
  page,
  request,
}) => {
  await configureRefresh(request, "schedule");
  await page.clock.install({ time: new Date("2026-04-02T08:00:00.000Z") });
  await loginAsOwner(page);
  await expect.poll(async () => (await metrics(request)).adapterCalls).toBe(2);
  expect((await metrics(request)).modes).toEqual(["all"]);
  expect((await metrics(request)).scopes).toEqual(["all"]);
  await expect(page.getByRole("region", { name: "总资产" })).toContainText(
    "302.00 USD",
  );
  await expect(page.getByTestId("asset-refresh-status")).toHaveCount(0);

  await page.clock.fastForward("00:00:30");
  expect((await metrics(request)).adapterCalls).toBe(2);

  // 模拟真实交互并等待续期确认，避免仅续期服务端而让页面空闲一小时。
  for (const now of ["2026-04-02T08:20:00.000Z", "2026-04-02T08:40:00.000Z"]) {
    await request.post("/test-doubles/clock", { data: { now } });
    await page.clock.setFixedTime(new Date(now));
    const acknowledged = page.waitForResponse("**/api/auth/session/activity");
    await page.keyboard.press("Shift");
    expect((await acknowledged).ok()).toBeTruthy();
  }
  await setFocus(page, false);
  await setVisibility(page, "hidden");
  await request.post("/test-doubles/clock", {
    data: { now: "2026-04-02T09:00:01.000Z" },
  });
  await page.clock.setFixedTime(new Date("2026-04-02T09:00:01.000Z"));
  expect((await metrics(request)).adapterCalls).toBe(2);

  await setVisibility(page, "visible");
  expect((await metrics(request)).adapterCalls).toBe(2);

  await Promise.all([
    setFocus(page, true),
    setVisibility(page, "visible"),
  ]);
  await expect.poll(async () => (await metrics(request)).adapterCalls).toBe(4);
  expect((await metrics(request)).modes).toEqual(["all", "all"]);
  expect((await metrics(request)).scopes).toEqual(["all", "all"]);
  await expect(page.getByTestId("asset-refresh-status")).toHaveCount(0);
});

test("页面重载与多标签共享统一周期且到期只执行一轮 Adapter", async ({
  context,
  page,
  request,
}) => {
  await configureRefresh(request, "schedule");
  await page.clock.install({ time: new Date("2026-04-02T08:00:00.000Z") });
  await loginAsOwner(page);
  await expect.poll(async () => (await metrics(request)).adapterCalls).toBe(2);

  await request.post("/test-doubles/clock", {
    data: { now: "2026-04-02T08:01:00.000Z" },
  });
  await page.clock.fastForward("00:01:00");
  await page.reload();
  await expect(page.getByTestId("workbench-shell")).toBeVisible();
  expect((await metrics(request)).adapterCalls).toBe(2);

  const secondPage = await context.newPage();
  await secondPage.clock.install({
    time: new Date("2026-04-02T08:01:00.000Z"),
  });
  await secondPage.goto("/");
  await expect(secondPage.getByTestId("workbench-shell")).toBeVisible();
  expect((await metrics(request)).adapterCalls).toBe(2);

  await Promise.all([
    setVisibility(page, "visible"),
    setVisibility(secondPage, "visible"),
    setFocus(page, true),
    setFocus(secondPage, true),
  ]);
  await keepOwnerSessionAlive(page, "2026-04-02T08:20:00.000Z");
  await keepOwnerSessionAlive(page, "2026-04-02T08:40:00.000Z");
  await request.post("/test-doubles/clock", {
    data: { now: "2026-04-02T09:00:01.000Z" },
  });
  await Promise.all([
    page.clock.fastForward("00:59:01"),
    secondPage.clock.fastForward("00:59:01"),
  ]);
  await expect.poll(async () => (await metrics(request)).adapterCalls).toBe(4);
  await page.waitForTimeout(50);
  expect((await metrics(request)).adapterCalls).toBe(4);
});

test("部分失败保留最后成功数据并标记过期，手动刷新可见进行中与恢复状态", async ({
  page,
  request,
}) => {
  await request.post("/test-doubles/refresh", {
    data: { action: "configure", scenario: "partial-failure" },
  });
  await loginAsOwner(page);
  await expect.poll(async () => (await metrics(request)).adapterCalls).toBe(2);

  const overview = page.getByRole("region", { name: "总资产" });
  await expect(overview).toContainText("310.00 USD");
  await expect(overview).toContainText("过期来源 1 个");
  const sourceSummary = page.getByTestId("overview-source-summary");
  await expect(sourceSummary).toContainText("Alpha Securities");
  await expectSummaryAmount(page, "source-alpha", "110.00");
  await expect(sourceSummary).toContainText("Beta Crypto");
  await expectSummaryAmount(page, "source-beta", "200.00");
  await expect(sourceSummary).toContainText("同步失败 · 数据过期");

  await request.post("/test-doubles/refresh", {
    data: { action: "prepare-recovery", hold: true },
  });
  const refresh = page.getByRole("button", { name: "立即刷新资产" });
  const refreshStatus = page.getByTestId("asset-refresh-status");
  await refresh.click();
  await expect(refresh).toBeDisabled();
  await expect(refresh).toContainText("刷新中…");
  await expect(refreshStatus).toHaveCount(0);
  await expect.poll(async () => (await metrics(request)).active).toBe(1);
  await request.post("/test-doubles/refresh", { data: { action: "release" } });

  await expect(refreshStatus).toHaveText("刷新完成");
  await expect(refreshStatus).toHaveAttribute("data-vibe-tone", "success");
  await expect(refresh).toHaveAccessibleName("立即刷新资产");
  await expect(refresh).toBeEnabled();
  await expect(overview).toContainText("330.00 USD");
  await expect(overview).not.toContainText("过期来源 1 个");
  await expectSummaryAmount(page, "source-alpha", "120.00");
  await expectSummaryAmount(page, "source-beta", "210.00");
  await expect(sourceSummary).not.toContainText("同步失败 · 数据过期");
});

test("资产卡片只刷新对应来源，并在卡片内显示状态", async ({
  page,
  request,
}) => {
  await configureRefresh(request, "schedule");
  await loginAsOwner(page);
  await expect.poll(async () => (await metrics(request)).sourceIds).toEqual([
    null,
  ]);

  await page.goto("/asset-sources/source-beta");
  const betaRefresh = page.getByRole("button", { name: "刷新 Beta Crypto" });
  await expect(betaRefresh).toBeEnabled();
  await expect(page.getByTestId("asset-source-total")).toContainText(
    "201.00 USD",
  );

  await request.post("/test-doubles/refresh", {
    data: { action: "prepare-recovery", hold: true },
  });
  const beforeManual = await metrics(request);
  await betaRefresh.click();
  await expect(betaRefresh).toBeDisabled();
  await expect(betaRefresh).toContainText("刷新中");
  const refreshIcon = betaRefresh.locator(".asset-source-refresh-icon");
  const refreshIconPath = refreshIcon.locator("path");
  await expect(refreshIcon).toHaveCSS("animation-name", "none");
  await expect(refreshIconPath).toHaveCSS(
    "animation-name",
    "asset-source-refresh-spin",
  );
  const spinGeometry = await refreshIconPath.evaluate((path) => {
    const box = (path as SVGGraphicsElement).getBBox();
    const style = getComputedStyle(path);
    const [originX, originY] = style.transformOrigin
      .split(" ")
      .map((value) => Number.parseFloat(value));
    return {
      transformBox: style.transformBox,
      originOffsetX: Math.abs(originX - box.width / 2),
      originOffsetY: Math.abs(originY - box.height / 2),
    };
  });
  expect(spinGeometry.transformBox).toBe("fill-box");
  expect(spinGeometry.originOffsetX).toBeLessThan(0.01);
  expect(spinGeometry.originOffsetY).toBeLessThan(0.01);
  await expect(
    page.getByTestId("asset-source-refresh-status-source-beta"),
  ).toContainText("正在刷新");
  await expect.poll(async () => (await metrics(request)).active).toBe(1);
  await request.post("/test-doubles/refresh", { data: { action: "release" } });

  await expect(
    page.getByTestId("asset-source-refresh-status-source-beta"),
  ).toContainText("刷新完成");
  await expect.poll(async () => (await metrics(request)).sourceIds.slice(
    beforeManual.sourceIds.length,
  )).toEqual(["source-beta"]);
  expect((await metrics(request)).scopes.slice(beforeManual.scopes.length)).toEqual([
    "all",
  ]);
  await expect(page.getByTestId("asset-source-total")).toContainText(
    "202.00 USD",
  );
  await page.goto("/asset-sources/source-alpha");
  await expect(page.getByTestId("asset-source-total")).toContainText(
    "101.00 USD",
  );
  await page.goto("/");
  await expect(page.getByRole("region", { name: "总资产" })).toContainText(
    "303.00 USD",
  );
});

test("挂起来源超时不阻塞成功提交，刷新期间新增来源也不会被旧列表覆盖", async ({
  page,
  request,
}) => {
  await request.post("/test-doubles/refresh", {
    data: { action: "configure", scenario: "schedule" },
  });
  await loginAsOwner(page);
  await expect.poll(async () => (await metrics(request)).adapterCalls).toBe(2);
  await expect(page.getByTestId("asset-refresh-status")).toHaveCount(0);
  await request.post("/test-doubles/refresh", {
    data: { action: "prepare-timeout" },
  });

  await page.getByRole("button", { name: "立即刷新资产" }).click();
  await expect.poll(async () => (await metrics(request)).active).toBe(1);
  await request.post("/test-doubles/refresh", {
    data: { action: "connect-during-refresh" },
  });

  const failedStatus = page.getByTestId("asset-refresh-status");
  await expect(failedStatus).toHaveText("部分来源刷新失败");
  const overview = page.getByRole("region", { name: "总资产" });
  await expect(overview).toContainText("361.00 USD");
  const sourceSummary = page.getByTestId("overview-source-summary");
  await expectSummaryAmount(page, "source-alpha", "110.00");
  await expect(sourceSummary).toContainText("同步失败 · 数据过期");
  await expectSummaryAmount(page, "source-beta", "201.00");
  await expectSummaryAmount(page, "source-gamma", "50.00");
});

test("未认证状态不能触发同步，也不会收到来源刷新状态", async ({ page, request }) => {
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

test("单来源刷新拒绝无效目标和范围组合", async ({ page, request }) => {
  await configureRefresh(request, "schedule");
  await loginAsOwner(page);

  const missing = await page.request.post("/api/asset-sources/refresh", {
    data: { mode: "all", sourceId: "source-missing" },
  });
  expect(missing.status()).toBe(404);
  await expect(missing.json()).resolves.toEqual({ error: "资产来源不存在" });

  const conflicting = await page.request.post("/api/asset-sources/refresh", {
    data: { mode: "all", scope: "non-evm", sourceId: "source-alpha" },
  });
  expect(conflicting.status()).toBe(400);
  await expect(conflicting.json()).resolves.toEqual({
    error: "单来源刷新不能同时指定来源范围",
  });
});

test("统一刷新批量目标拒绝歧义组合并保留意图目标", async ({ page, request }) => {
  await configureRefresh(request, "schedule");
  await loginAsOwner(page);
  await expect.poll(async () => (await metrics(request)).adapterCalls).toBe(2);
  await expect.poll(async () => (await metrics(request)).active).toBe(0);
  await request.post("/test-doubles/refresh", {
    data: { action: "reset-schedule" },
  });

  const invalidRequests = [
    { mode: "all", sourceIds: ["source-alpha"] },
    {
      mode: "all",
      intent: { reason: "manual-source", sourceId: "source-alpha" },
      sourceId: "source-alpha",
      sourceIds: ["source-alpha"],
    },
    {
      mode: "all",
      scope: "all",
      intent: { reason: "manual-source", sourceId: "source-alpha" },
      sourceIds: ["source-alpha"],
    },
    {
      mode: "all",
      intent: { reason: "manual-source", sourceId: "source-alpha" },
      sourceIds: ["source-beta"],
    },
  ];
  for (const data of invalidRequests) {
    const response = await page.request.post("/api/asset-sources/refresh", { data });
    expect(response.status()).toBe(400);
  }
  expect(await metrics(request)).toMatchObject({
    modes: [],
    scopes: [],
    sourceIds: [],
  });

  const merged = await page.request.post("/api/asset-sources/refresh", {
    data: {
      mode: "all",
      intent: { reason: "manual-source", sourceId: "source-alpha" },
      sourceIds: ["source-alpha", "source-beta"],
    },
  });
  expect(merged.ok()).toBeTruthy();
  await expect(merged.json()).resolves.toMatchObject({
    successCount: 2,
    failureCount: 0,
  });
  expect(await metrics(request)).toMatchObject({
    modes: ["all"],
    scopes: ["all"],
    sourceIds: ["source-alpha"],
  });
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
      total: { amount: "1000", currency: "USD" },
      holdings: [{
        symbol: "AAPL.US",
        currentPrice: { amount: "100", currency: "USD" },
      }],
    },
    assetRequests: [],
  });

  const expiredPrices = await request.post(
    "/test-doubles/longbridge/production-start",
    { data: { action: "refresh-prices-expired" } },
  );
  expect(expiredPrices.ok()).toBeTruthy();
  await expect(expiredPrices.json()).resolves.toMatchObject({
    assetRequests: [],
    credentialsRotated: false,
    tokenRequests: 0,
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
  ]);
  expect(holdingsBody.snapshot.total).toEqual({
    amount: "123456.7891",
    currency: "USD",
  });
  expect(holdingsBody.quotedSymbols).toEqual([]);

  const rejected = await request.post(
    "/test-doubles/longbridge/production-start",
    { data: { action: "refresh-invalid" } },
  );
  expect(rejected.status()).toBe(400);
  await expect(rejected.json()).resolves.toMatchObject({
    error: expect.stringContaining("交易写权限"),
    assetRequests: [],
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
