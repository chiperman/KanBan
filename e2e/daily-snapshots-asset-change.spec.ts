import {
  expect,
  test,
  type APIRequestContext,
  type CDPSession,
  type Page,
} from "@playwright/test";

import { chooseOverviewOption } from "./overview-control-helpers";

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
  await unlockAsOwner(page);
}

async function unlockAsOwner(page: Page): Promise<void> {

  const [verification] = await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith("/api/auth/login/verify"),
    ),
    page.getByRole("button", { name: "使用 Passkey 登录" }).click(),
  ]);
  expect(verification.ok()).toBeTruthy();
  await expect(page.getByTestId("view-mode")).toContainText("所有者视图");
}

async function configure(
  request: APIRequestContext,
  action = "configure",
) {
  const response = await request.post("/test-doubles/daily-snapshots", {
    data: { action },
  });
  expect(response.ok()).toBeTruthy();
}

async function setServerTime(request: APIRequestContext, iso: string) {
  const response = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "set-time", iso },
  });
  expect(response.ok()).toBeTruthy();
}

async function history(request: APIRequestContext) {
  const response = await request.get("/test-doubles/daily-snapshots");
  expect(response.ok()).toBeTruthy();
  type Observation = {
    day: string;
    capturedAt: string;
    complete: boolean;
    status?: "complete" | "incomplete" | "expired";
    total: { USD: string | null; CNY: string | null; HKD?: string | null };
    sources: Array<{
      sourceId: string;
      capturedAt: string;
      complete: boolean;
      status?: "complete" | "incomplete" | "expired";
      total: { USD: string | null; CNY: string | null; HKD?: string | null };
    }>;
  };
  return (await response.json()) as {
    /** 兼容既有测试：日初基准。 */
    days: Observation[];
    baselines: Observation[];
    trendObservations: Observation[];
  };
}

async function waitForRefreshReport(
  page: Page,
  expectedFailureCount: number,
): Promise<void> {
  while (true) {
    const response = await page.waitForResponse((candidate) =>
      candidate.url().endsWith("/api/asset-sources/refresh") &&
      candidate.request().method() === "POST"
    );
    expect(response.ok()).toBeTruthy();
    const report = await response.json().catch(() => null) as {
      failureCount?: unknown;
    } | null;
    if (report?.failureCount === expectedFailureCount) return;
  }
}

async function manualRefresh(page: Page, expectedFailureCount = 0) {
  const completed = waitForRefreshReport(page, expectedFailureCount);
  await page.getByRole("button", { name: "立即刷新资产" }).click();
  await completed;
  await expect(page.getByTestId("asset-refresh-status")).toContainText(
    expectedFailureCount === 0
      ? "同步完成"
      : `同步完成 · ${expectedFailureCount} 个来源失败`,
  );
}

async function openSourceDetail(page: Page, label: string): Promise<void> {
  await page.goto("/asset-sources");
  await page.getByRole("link", {
    name: new RegExp(`${label}.*自动账户`),
  }).click();
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
});

test("今日资产变化使用昨日最后一条完整趋势快照，不依赖正式日结任务", async ({
  page,
  request,
}) => {
  await configure(request);
  await setServerTime(request, "2026-08-05T12:00:00.000Z");
  const yesterdayObservation = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "record-complete-observation" },
  });
  expect(yesterdayObservation.ok()).toBeTruthy();
  expect((await history(request)).trendObservations).toMatchObject([{
    day: "2026-08-05",
    complete: true,
    status: "complete",
    total: { USD: "300", HKD: "2340" },
  }]);
  await setServerTime(request, "2026-08-06T12:00:00.000Z");

  await loginAsOwner(page);
  await manualRefresh(page);
  await expect(page.getByTestId("overview-current-total")).toContainText(
    "302.00 USD",
  );

  const change = page.getByRole("heading", { name: "今日资产变化" }).locator("..");
  await expect(change).toContainText("+2.00 USD");
  await expect(change).toContainText("相对昨日最后完整记录（08月05日）");
});

test("今日资产变化直接列出不参与计算的问题来源", async ({
  page,
  request,
}) => {
  await configure(request);
  await setServerTime(request, "2026-08-05T12:00:00.000Z");
  const yesterdayObservation = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "record-complete-observation" },
  });
  expect(yesterdayObservation.ok()).toBeTruthy();
  await setServerTime(request, "2026-08-06T12:00:00.000Z");
  await request.post("/test-doubles/daily-snapshots", {
    data: { action: "partial-failure" },
  });

  await loginAsOwner(page);
  await manualRefresh(page, 1);

  const change = page.getByRole("heading", { name: "今日资产变化" }).locator("..");
  const issues = change.getByTestId("overview-today-change-issues");
  await expect(change).toContainText("数据不足");
  await expect(issues).toContainText("影响本次计算的来源");
  await expect(issues).toContainText("Beta Crypto");
  await expect(issues).toContainText("同步失败 · 数据过期");
  await expect(issues).toContainText("200.00 USD");
  await expect(issues).toContainText("以上数据不参与今日资产变化。");

  await page.getByRole("button", { name: "隐藏关键信息" }).click();
  await expect(issues).toContainText(
    "已隐藏 1 个问题来源；不参与今日资产变化。",
  );
  await expect(issues).not.toContainText("Beta Crypto");
  await expect(issues).not.toContainText("200.00 USD");
});

test("缺少昨日观测时回退到最近完整记录，并明确累计间隔", async ({
  page,
  request,
}) => {
  await configure(request);
  await setServerTime(request, "2026-08-15T12:00:00.000Z");
  const priorObservation = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "record-complete-observation" },
  });
  expect(priorObservation.ok()).toBeTruthy();
  await setServerTime(request, "2026-08-18T12:00:00.000Z");

  await loginAsOwner(page);
  await manualRefresh(page);

  const change = page
    .getByRole("heading", { name: "自上次完整记录以来资产变化" })
    .locator("..");
  await expect(change).toContainText("+2.00 USD");
  await expect(change).toContainText(
    "相对上次完整记录（08月15日，间隔 3 天）以来",
  );
});

test("没有每日趋势观测时提示首次成功同步", async ({ page, request }) => {
  await configure(request);
  const disabled = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "disable-automatic-refresh" },
  });
  expect(disabled.ok()).toBeTruthy();

  await loginAsOwner(page);
  await expect(page.getByTestId("total-asset-trend")).toContainText(
    "等待首次同步",
  );
});

test("来源趋势位于总资产金额下方且先于持仓仪表", async ({ page, request }) => {
  await configure(request);
  await loginAsOwner(page);

  await openSourceDetail(page, "Alpha Securities");
  const alphaCard = page.getByTestId("asset-source-card-source-alpha");
  const total = alphaCard.getByTestId("asset-source-total");
  const trend = alphaCard.getByTestId("asset-source-trend-source-alpha");
  const sourceMeter = alphaCard.locator(".source-meter");
  const [totalCount, trendCount, sourceMeterCount] = await Promise.all([
    total.count(),
    trend.count(),
    sourceMeter.count(),
  ]);
  expect(totalCount).toBe(1);
  expect(trendCount).toBe(1);
  expect(sourceMeterCount).toBe(1);

  const order = await alphaCard.evaluate((card) => {
    const children = Array.from(card.children);
    return {
      sourceMeter: children.findIndex((child) =>
        child.classList.contains("source-meter"),
      ),
      total: children.findIndex(
        (child) => child.getAttribute("data-testid") === "asset-source-total",
      ),
      trend: children.findIndex((child) =>
        child.classList.contains("source-trend"),
      ),
    };
  });
  expect(order.total).toBeGreaterThanOrEqual(0);
  expect(order.trend).toBeGreaterThan(order.total);
  expect(order.sourceMeter).toBeGreaterThan(order.trend);

  await page.getByRole("button", { name: "隐藏关键信息" }).click();
  const privateTrend = trend.locator(".asset-trend-private--source");
  const privateCopy = privateTrend.locator(".asset-trend-private-copy");
  await expect(privateCopy).toHaveJSProperty(
    "offsetWidth",
    await privateTrend.evaluate((element) => element.clientWidth),
  );
});

test("同次观测可共享可靠汇率，不把来源单独缺少展示币种误判为不完整", async ({
  page,
  request,
}) => {
  await configure(request);
  const configured = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "remove-beta-cross-currency-rates" },
  });
  expect(configured.ok()).toBeTruthy();
  const recorded = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "record-current-observation" },
  });
  expect(recorded.ok()).toBeTruthy();
  const disabled = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "disable-automatic-refresh" },
  });
  expect(disabled.ok()).toBeTruthy();

  await loginAsOwner(page);
  const snapshot = (await history(request)).trendObservations[0];
  expect(snapshot).toMatchObject({
    complete: true,
    status: "complete",
    total: { USD: "300", CNY: "2160", HKD: "2340" },
  });
  expect(snapshot.sources.find(({ sourceId }) => sourceId === "source-beta"))
    .toMatchObject({
      complete: true,
      status: "complete",
      total: { USD: "200", CNY: "1440", HKD: "1560" },
    });
  await expect(page.getByTestId("total-asset-trend")).not.toContainText(
    "不完整或过期",
  );
});

test("北京时间日界线建立唯一基准，同日幂等且跨日不回填", async ({
  page,
  request,
}) => {
  await configure(request);
  await loginAsOwner(page);
  await expect(page.getByTestId("asset-refresh-status")).toContainText(
    "同步完成",
  );

  await expect(page.getByTestId("total-asset-trend")).toContainText(
    "04月01日",
  );
  expect((await history(request)).days.map(({ day }) => day)).toEqual([
    "2026-04-01",
  ]);
  expect((await history(request)).days[0].total.CNY).toBe("2154.3");
  expect((await history(request)).trendObservations[0].total.HKD).toBe("2355.6");
  await chooseOverviewOption(page, "计价货币", "CNY");
  await chooseOverviewOption(page, "计价货币", "HKD");
  await expect(page.getByTestId("total-asset-trend")).toContainText(
    "2,355.60 HKD",
  );
  await chooseOverviewOption(page, "计价货币", "USD");
  const persistence = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "production-persistence" },
  });
  expect(persistence.ok()).toBeTruthy();
  await expect(persistence.json()).resolves.toEqual({
    first: true,
    duplicate: false,
    count: 1,
    baselineCapturedAt: "2026-04-01T15:59:50.000Z",
    trendCapturedAt: "2026-04-01T16:00:50.000Z",
    baselineUsd: "302",
    trendUsd: "303",
  });

  await manualRefresh(page);
  expect((await history(request)).days).toHaveLength(1);

  await setServerTime(request, "2026-04-01T16:00:00.000Z");
  await manualRefresh(page);
  await expect(page.getByTestId("total-asset-trend")).toContainText(
    "04月02日",
  );
  expect((await history(request)).days.map(({ day }) => day)).toEqual([
    "2026-04-01",
    "2026-04-02",
  ]);

  await manualRefresh(page);
  expect((await history(request)).days).toHaveLength(2);

  await setServerTime(request, "2026-04-03T16:00:00.000Z");
  await request.post("/test-doubles/daily-snapshots", {
    data: { action: "fail-all" },
  });
  await page.goto("/");
  await unlockAsOwner(page);
  await expect(page.getByTestId("asset-refresh-status")).toContainText(
    "2 个来源失败",
  );
  expect((await history(request)).days.map(({ day }) => day)).toEqual([
    "2026-04-01",
    "2026-04-02",
  ]);

  await request.post("/test-doubles/daily-snapshots", {
    data: { action: "recover" },
  });
  await manualRefresh(page);
  expect((await history(request)).days.map(({ day }) => day)).toEqual([
    "2026-04-01",
    "2026-04-02",
    "2026-04-04",
  ]);

  const content = await page.locator("body").innerText();
  expect(content).not.toContain("今日资产变动");
  expect(content).not.toContain("当日盈亏");
  expect(content).not.toContain("投资收益");
});

test("同日后续成功刷新只更新每日趋势观测，失败保留最后观测并标明过期", async ({
  page,
  request,
}) => {
  await configure(request);
  await loginAsOwner(page);
  await expect(page.getByTestId("asset-refresh-status")).toContainText(
    "同步完成",
  );

  const before = await history(request);
  expect(before.baselines).toMatchObject([{
    day: "2026-04-01",
    capturedAt: "2026-04-01T15:59:50.000Z",
    total: { USD: "302" },
  }]);
  expect(before.trendObservations).toMatchObject([{
    day: "2026-04-01",
    capturedAt: "2026-04-01T15:59:50.000Z",
    total: { USD: "302" },
  }]);

  await setServerTime(request, "2026-04-01T15:59:55.000Z");
  await manualRefresh(page);
  const afterSuccess = await history(request);
  expect(afterSuccess.baselines).toMatchObject([{
    day: "2026-04-01",
    capturedAt: "2026-04-01T15:59:50.000Z",
    total: { USD: "302" },
  }]);
  expect(afterSuccess.trendObservations).toMatchObject([{
    day: "2026-04-01",
    capturedAt: "2026-04-01T15:59:55.000Z",
    total: { USD: "304" },
    sources: [
      { sourceId: "source-alpha", total: { USD: "102" } },
      { sourceId: "source-beta", total: { USD: "202" } },
    ],
  }]);

  await request.post("/test-doubles/daily-snapshots", {
    data: { action: "partial-failure" },
  });
  await setServerTime(request, "2026-04-01T15:59:57.000Z");
  await manualRefresh(page, 1);
  await expect.poll(async () =>
    (await history(request)).trendObservations,
  ).toMatchObject([{
    day: "2026-04-01",
    capturedAt: "2026-04-01T15:59:57.000Z",
    complete: false,
    status: "expired",
    total: { USD: "312" },
    sources: [
      {
        sourceId: "source-alpha",
        capturedAt: "2026-04-01T15:59:57.000Z",
        complete: true,
        status: "complete",
        total: { USD: "110" },
      },
      {
        sourceId: "source-beta",
        capturedAt: "2026-04-01T15:59:55.000Z",
        complete: false,
        status: "expired",
        total: { USD: "202" },
      },
    ],
  }]);
  const trend = page.getByTestId("total-asset-trend");
  await expect(trend).toContainText("1 天不完整或过期");
  await expect(trend).toContainText("04月01日");
  await expect(trend).toContainText("312.00 USD");
  await expect(trend).toContainText("过期");

  await request.post("/test-doubles/daily-snapshots", {
    data: { action: "fail-all" },
  });
  await setServerTime(request, "2026-04-01T15:59:58.000Z");
  await manualRefresh(page, 2);
  await expect.poll(async () =>
    (await history(request)).trendObservations,
  ).toMatchObject([{
    day: "2026-04-01",
    capturedAt: "2026-04-01T15:59:57.000Z",
    total: { USD: "312" },
    complete: false,
    status: "expired",
    sources: [
      {
        sourceId: "source-alpha",
        capturedAt: "2026-04-01T15:59:57.000Z",
        complete: false,
        status: "expired",
        total: { USD: "110" },
      },
      {
        sourceId: "source-beta",
        capturedAt: "2026-04-01T15:59:55.000Z",
        complete: false,
        status: "expired",
        total: { USD: "202" },
      },
    ],
  }]);
});

test("首轮部分失败不冻结日初基准，首次完整同步才建立", async ({
  page,
  request,
}) => {
  await configure(request);
  const partialFailure = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "partial-failure" },
  });
  expect(partialFailure.ok()).toBeTruthy();

  await loginAsOwner(page);
  await expect(page.getByTestId("asset-refresh-status")).toContainText(
    "同步完成 · 1 个来源失败",
  );
  expect((await history(request)).baselines).toEqual([]);
  expect((await history(request)).trendObservations).toEqual([]);

  await request.post("/test-doubles/daily-snapshots", {
    data: { action: "recover" },
  });
  await setServerTime(request, "2026-04-01T15:59:55.000Z");
  await manualRefresh(page);

  const recovered = await history(request);
  expect(recovered.baselines).toMatchObject([{
    day: "2026-04-01",
    capturedAt: "2026-04-01T15:59:55.000Z",
    complete: true,
    status: "complete",
    total: { USD: "302" },
  }]);
  expect(recovered.trendObservations).toMatchObject([{
    day: "2026-04-01",
    capturedAt: "2026-04-01T15:59:55.000Z",
    complete: true,
    status: "complete",
    total: { USD: "302" },
  }]);
});

test("遗留的不完整日初基准会由同日完整快照修复", async ({
  request,
}) => {
  await configure(request);
  const response = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "production-incomplete-baseline-repair" },
  });
  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    count: 1,
    capturedAt: "2026-04-01T16:00:50.000Z",
    complete: true,
    status: "complete",
    totalUsd: "303",
    sourceCount: 2,
  });
});

test("未估值趋势不伪造零值，平台盈亏只出现在来源提供的范围", async ({
  page,
  request,
}) => {
  await configure(request);
  await request.post("/test-doubles/daily-snapshots", {
    data: { action: "add-unvalued-source" },
  });
  await loginAsOwner(page);
  await expect(page.getByTestId("asset-refresh-status")).toContainText(
    "同步完成",
  );

  const snapshot = await history(request);
  const unvalued = snapshot.days[0].sources.find(
    ({ sourceId }) => sourceId === "source-unvalued",
  );
  expect(unvalued).toMatchObject({
    complete: false,
    total: { USD: null, CNY: null },
  });
  await expect(page.getByTestId("total-asset-trend")).toContainText("04月01日");
  await expect(page.getByTestId("total-asset-trend")).toContainText("不完整");
});

test("缺少可靠 HKD 汇率时趋势金额不可用且观测不完整", async ({
  page,
  request,
}) => {
  await configure(request);
  const configured = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "remove-hkd-rate" },
  });
  expect(configured.ok()).toBeTruthy();

  await loginAsOwner(page);
  await chooseOverviewOption(page, "计价货币", "HKD");
  const overview = page.getByTestId("total-asset-overview");
  await expect(overview.getByTestId("total-asset-amount")).toHaveText(
    "无法折算 HKD",
  );
  await expect(overview).toContainText("当前估值：不完整");
  await expect(page.getByTestId("total-asset-trend")).toContainText(
    "可绘制 0 / 30 天",
  );
  await expect(page.getByTestId("total-asset-trend")).toContainText(
    "04月01日未估值",
  );
  expect((await history(request)).trendObservations[0]).toMatchObject({
    complete: false,
    status: "incomplete",
    total: { HKD: null },
  });
});

test("历史 HKD 金额固定使用各自观测时汇率", async ({ page, request }) => {
  await configure(request);
  await loginAsOwner(page);
  await expect(page.getByTestId("asset-refresh-status")).toContainText(
    "同步完成",
  );

  await setServerTime(request, "2026-04-02T16:00:00.000Z");
  const updated = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "set-hkd-rate", rate: "8" },
  });
  expect(updated.ok()).toBeTruthy();
  await page.goto("/");
  await unlockAsOwner(page);

  await chooseOverviewOption(page, "计价货币", "HKD");
  const overview = page.getByTestId("total-asset-overview");
  await expect(overview).toContainText("USD/HKD 8.0000");
  await expect(page.getByTestId("total-asset-trend")).toContainText(
    "2,355.60 HKD",
  );
  await expect(page.getByTestId("total-asset-trend")).toContainText(
    "2,432.00 HKD",
  );
  expect((await history(request)).trendObservations.map(({ total }) => total.HKD))
    .toEqual(["2355.6", "2432"]);
});

test("期权行情未接入不降低每日总额观测完整性", async ({
  page,
  request,
}) => {
  await configure(request);
  await request.post("/test-doubles/daily-snapshots", {
    data: { action: "add-option-quote-unavailable-source" },
  });
  await loginAsOwner(page);
  await expect(page.getByTestId("asset-refresh-status")).toContainText(
    "同步完成",
  );

  const snapshot = await history(request);
  const optionSource = snapshot.days[0].sources.find(
    ({ sourceId }) => sourceId === "source-option-quote-unavailable",
  );
  expect(optionSource).toMatchObject({
    complete: true,
    total: { USD: expect.any(String), CNY: expect.any(String) },
  });
  expect(snapshot.days[0].complete).toBe(true);
});

test("来源确认的首次可信快照先建基准，随后刷新全失败也不会丢失", async ({
  page,
  request,
}) => {
  const connected = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "connect-before-failed-refresh" },
  });
  expect(connected.ok()).toBeTruthy();
  expect((await history(request)).days).toMatchObject([{
    day: "2026-04-01",
    total: { USD: "88" },
  }]);

  await loginAsOwner(page);
  await expect(page.getByTestId("asset-refresh-status")).toContainText(
    "同步完成 · 1 个来源失败",
  );
  expect((await history(request)).days).toHaveLength(1);
});

test("同日新增来源从首次成功同步开始加入来源趋势但不改写总基准", async ({
  page,
  request,
}) => {
  await configure(request);
  await loginAsOwner(page);
  await expect(page.getByTestId("asset-refresh-status")).toContainText(
    "同步完成",
  );
  const original = (await history(request)).days[0];

  await request.post("/test-doubles/daily-snapshots", {
    data: { action: "add-unvalued-source" },
  });
  await manualRefresh(page);
  const updated = await history(request);
  expect(updated.days).toHaveLength(1);
  expect(updated.days[0].total).toEqual(original.total);
  expect(updated.days[0].capturedAt).toBe(original.capturedAt);
  expect(updated.days[0].sources.find(({ sourceId }) =>
    sourceId === "source-unvalued",
  )).toBeUndefined();
  expect(updated.trendObservations[0].sources.find(({ sourceId }) =>
    sourceId === "source-unvalued",
  )).toMatchObject({
    capturedAt: "2026-04-01T15:59:50.000Z",
    complete: false,
    total: { USD: null, CNY: null },
  });
});

test("未认证状态收不到日快照或来源趋势", async ({ page, request }) => {
  await configure(request);
  await page.goto("/");
  const content = await page.locator("body").innerText();
  for (const privateText of [
    "资产趋势",
    "04月01日",
    "Alpha Securities",
  ]) {
    expect(content).not.toContain(privateText);
  }
  expect((await page.content())).not.toContain("dailySnapshots");
});

test("总资产趋势默认展示 30 日连续直线、缺失提示与区间资产变动", async ({
  page,
  request,
}) => {
  await configure(request);
  const seeded = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "seed-total-trend-history" },
  });
  expect(seeded.ok()).toBeTruthy();

  await loginAsOwner(page);
  const trend = page.getByTestId("total-asset-trend");
  await expect(
    page.getByRole("button", { name: "趋势区间" }),
  ).toBeVisible();
  await expect(
    trend.getByRole("img", { name: /最近30个上海自然日总资产趋势/ }),
  ).toBeVisible();
  await expect(trend).toContainText("可绘制 3 / 30 天");
  await expect(trend).toContainText("区间资产变动");
  await expect(trend).toContainText("03月01日 至 03月04日");
  await expect(trend).toContainText("+10.00 USD");
  await expect(trend).toContainText("资产变化比例 10.00%");
  await expect(trend.getByText("观测明细（3）")).toBeVisible();
  await expect(trend.getByTestId("daily-trend-detail").first()).toBeHidden();
  await trend.getByText("观测明细（3）").click();
  await expect(trend.getByTestId("daily-trend-detail")).toHaveCount(3);
  const trendPath = trend.locator(".recharts-line-curve");
  await expect(trendPath).toHaveCount(1);
  const trendPathData = await trendPath.getAttribute("d");
  expect(trendPathData?.match(/M/g)).toHaveLength(1);
  await expect(trend.locator(".total-trend-point-dot")).toHaveCount(0);
  await page.getByTestId("sensitive-info-toggle").click();
  await expect(
    trend.getByRole("img", { name: /最近30个上海自然日总资产趋势/ }),
  ).toHaveCount(0);
  await expect(trend).not.toContainText("+10.00 USD");
  await expect(trend.getByTestId("daily-trend-detail")).toHaveCount(0);
  await expect(trend.locator(".asset-trend-private")).toBeVisible();
  await expect(trend).toContainText("开启“显示关键信息”以查看趋势与明细");
});

test("趋势区间会记忆，且每日明细分页独立于图表区间", async ({
  page,
  request,
}) => {
  await configure(request);
  const seeded = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "seed-trend-range-history" },
  });
  expect(seeded.ok()).toBeTruthy();

  await loginAsOwner(page);
  const trend = page.getByTestId("total-asset-trend");
  await expect(
    trend.getByRole("img", { name: /最近30个上海自然日总资产趋势/ }),
  ).toBeVisible();
  await expect(trend).toContainText("02月06日 至 03月07日");
  await expect(trend).toContainText("可绘制 30 / 30 天");
  const yesterdayChange = page.getByTestId("total-asset-yesterday-change");
  await expect(yesterdayChange).toContainText("较昨日 · 03月06日");
  await expect(yesterdayChange).toContainText("+1.00 USD");
  await expect(yesterdayChange).toContainText("昨日总资产 133.00 USD");
  const sourceChanges = page.getByTestId(
    "total-asset-yesterday-source-changes",
  );
  await expect(sourceChanges).toContainText("变动来源");
  await expect(sourceChanges).toContainText("Alpha Securities");
  await expect(sourceChanges).toContainText("+1.00 USD");
  await expect(sourceChanges).not.toContainText("Beta Crypto");
  await expect(trend).not.toContainText("较昨日");
  await expect(page.locator("body")).not.toContainText("今日资产变动");
  await expect(trend.locator(".total-trend-point-dot")).toHaveCount(0);
  await trend.getByText("观测明细（35）").click();
  await expect(trend.getByTestId("daily-trend-detail")).toHaveCount(30);
  await chooseOverviewOption(page, "趋势区间", "7日");
  await expect(
    trend.getByRole("img", { name: /最近7个上海自然日总资产趋势/ }),
  ).toBeVisible();
  await expect(trend).toContainText("03月01日 至 03月07日");
  await expect(trend.getByTestId("daily-trend-detail")).toHaveCount(30);

  await page.getByRole("button", { name: "下一页每日明细" }).click();
  await expect(trend).toContainText("第 2 / 2 页");
  await expect(trend.getByTestId("daily-trend-detail")).toHaveCount(5);

  await chooseOverviewOption(page, "趋势区间", "90日");
  await expect(trend).toContainText("第 1 / 2 页");
  await expect(trend.getByTestId("daily-trend-detail")).toHaveCount(30);

  await chooseOverviewOption(page, "计价货币", "HKD");
  await page.getByRole("button", { name: "下一页每日明细" }).click();
  await expect(trend).toContainText("第 2 / 2 页");
  await chooseOverviewOption(page, "计价货币", "USD");
  await expect(trend).toContainText("第 1 / 2 页");

  await chooseOverviewOption(page, "趋势区间", "全部");
  await expect(
    trend.getByRole("img", { name: /全部上海自然日总资产趋势/ }),
  ).toBeVisible();
  await expect(trend).toContainText("02月01日 至 03月07日");

  await chooseOverviewOption(page, "趋势区间", "7日");
  await page.reload();
  await expect(
    trend.getByRole("img", { name: /最近7个上海自然日总资产趋势/ }),
  ).toBeVisible();
});

test("来源详情趋势跨过缺失日期连接已有观测", async ({ page, request }) => {
  await configure(request);
  const seeded = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "seed-source-trend-gap" },
  });
  expect(seeded.ok()).toBeTruthy();

  await loginAsOwner(page);
  await openSourceDetail(page, "Alpha Securities");
  const alphaTrend = page.getByTestId("asset-source-trend-source-alpha");
  await expect(
    alphaTrend.getByRole("img", { name: "Alpha Securities来源总额趋势" }),
  ).toHaveCount(1);
  await expect(alphaTrend).toContainText(
    /缺少 \d+ 天观测，趋势线已跨过缺口连接/,
  );
  const alphaPath = await alphaTrend
    .locator(".recharts-line-curve")
    .getAttribute("d");
  // 三个有效观测应位于同一条路径：一个起点加两段直线。
  expect(alphaPath?.match(/[ML]/g)).toHaveLength(3);

  await openSourceDetail(page, "Beta Crypto");
  const betaTrend = page.getByTestId("asset-source-trend-source-beta");
  await expect(
    betaTrend.getByRole("img", { name: "Beta Crypto来源总额趋势" }),
  ).toHaveCount(1);
});

test("移动端可查看总资产每日观测明细且不产生横向溢出", async ({
  page,
  request,
}) => {
  await configure(request);
  const seeded = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "seed-total-trend-history" },
  });
  expect(seeded.ok()).toBeTruthy();

  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsOwner(page);

  const totalTrend = page.getByTestId("total-asset-trend");
  const totalDailyDetails = totalTrend.locator(".daily-trend-details");
  await totalDailyDetails.getByText(/观测明细（/).click();
  await expect(
    totalTrend.getByTestId("daily-trend-detail").first(),
  ).toBeVisible();

  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth);
});

test("移动端总资产趋势入口、键盘操作与窄屏图保持可访问", async ({
  page,
  request,
}) => {
  await configure(request);
  const seeded = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "seed-trend-range-history" },
  });
  expect(seeded.ok()).toBeTruthy();

  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsOwner(page);
  const overviewCard = page.getByTestId("total-overview-card");
  const trend = page.getByTestId("total-asset-trend");
  await expect(trend).toBeVisible();
  await expect(
    overviewCard.getByRole("button", { name: /总资产详情/ }),
  ).toHaveCount(0);
  await expect(trend.getByTestId("daily-trend-detail").first()).toBeHidden();

  const trendRange = overviewCard.getByRole("button", { name: "趋势区间" });
  await trendRange.focus();
  await expect(trendRange).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("option", { name: "7日", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await chooseOverviewOption(page, "趋势区间", "7日");
  await expect(
    trend.getByRole("img", { name: /最近7个上海自然日总资产趋势/ }),
  ).toBeVisible();

  const totalChart = trend.locator("svg.recharts-surface");
  await totalChart.focus();
  await expect(totalChart).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(trend.locator(".asset-trend-tooltip")).toBeVisible();
  await trend.getByText("观测明细（35）").click();
  const nextDetailPage = trend.getByRole("button", { name: "下一页每日明细" });
  await nextDetailPage.focus();
  await page.keyboard.press("Enter");
  await expect(trend).toContainText("第 2 / 2 页");

  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth);
});
