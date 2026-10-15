import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { attachPasskey, setupOwnerPasskey } from "../owner-auth-helpers";
import { chooseOverviewOption } from "../overview-control-helpers";

async function loginAsOwner(page: Page, automaticFailureCount?: number): Promise<void> {
  await attachPasskey(page);
  await setupOwnerPasskey(page);
  await page.goto("/");
  await unlockAsOwner(page, automaticFailureCount);
}

async function unlockAsOwner(page: Page, automaticFailureCount?: number): Promise<void> {
  const refreshed = automaticFailureCount === undefined
    ? null
    : waitForRefreshReport(page, automaticFailureCount);
  const [verification] = await Promise.all([
    page.waitForResponse((response) =>
      response.url().endsWith("/api/auth/login/verify"),
    ),
    page.getByRole("button", { name: "使用 Passkey 登录" }).click(),
  ]);
  expect(verification.ok()).toBeTruthy();
  await expect(page.getByTestId("workbench-shell")).toBeVisible();
  if (refreshed !== null) {
    await refreshed;
    await expect(page.getByTestId("asset-refresh-status")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "立即刷新资产" })).toBeEnabled();
  }
}

async function configure(
  request: APIRequestContext,
  action = "configure-classified",
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
  const response = await page.waitForResponse((candidate) =>
    candidate.url().endsWith("/api/asset-sources/refresh") &&
    candidate.request().method() === "POST"
  );
  expect(response.ok()).toBeTruthy();
  const report = await response.json();
  expect(report).toMatchObject({ failureCount: expectedFailureCount });
  expect(report).not.toHaveProperty("skipped");
}

async function manualRefresh(page: Page, expectedFailureCount = 0) {
  await expect(page.getByRole("button", { name: "立即刷新资产" })).toBeEnabled();
  const completed = waitForRefreshReport(page, expectedFailureCount);
  await page.getByRole("button", { name: "立即刷新资产" }).click();
  await completed;
  await expect(page.getByTestId("asset-refresh-status")).toContainText(
    expectedFailureCount === 0
      ? "刷新完成"
      : expectedFailureCount === 2
        ? "刷新失败"
        : "部分来源刷新失败",
  );
}

async function refreshMetrics(request: APIRequestContext) {
  const response = await request.get("/test-doubles/refresh");
  expect(response.ok()).toBeTruthy();
  return await response.json() as { adapterCalls: number; active: number };
}

async function latestTrendTooltip(page: Page) {
  const trend = page.getByTestId("overview-trend");
  const chart = trend.getByRole("img", { name: "近 7 日总资产趋势" });
  await chart.scrollIntoViewIfNeeded();
  await chart.focus();
  for (let index = 0; index < 7; index += 1) await chart.press("ArrowRight");
  const tooltip = trend.locator(".asset-trend-tooltip");
  await expect(tooltip).toBeVisible();
  return tooltip;
}

function sourceSummaryRow(page: Page, sourceId: string) {
  return page.getByTestId("overview-source-summary").getByRole("listitem").filter({
    has: page.locator(`a[href="/asset-sources/${sourceId}"]`),
  });
}

async function expectAnimatedAmount(root: Locator, value: string) {
  const counter = root.locator('.daily-overview__source-total [data-vibe-component="live-counter"]');
  await expect(counter).toHaveAttribute("data-counter-target", value);
  await counter.scrollIntoViewIfNeeded();
  await expect(counter).toHaveAttribute("data-counter-state", "complete");
  await expect(counter).toHaveText(value);
}

async function openHistoryCoverage(page: Page) {
  await page.goto("/asset-sources");
  const coverage = page.getByTestId("data-health-history");
  await expect(coverage.locator(".data-health-history__list")).toHaveCount(0);
  await coverage.getByRole("button", { name: "查看历史覆盖" }).click();
  return coverage;
}

async function chooseCoverageOption(page: Page, coverage: Locator, label: string, option: string) {
  await coverage.getByRole("button", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function expectNoHorizontalOverflow(page: Page) {
  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth);
}

async function openSourceDetail(page: Page, sourceId: string): Promise<void> {
  await page.goto("/asset-sources");
  await page.locator(`a[href="/asset-sources/${sourceId}"]`).click();
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
  await expect(page.getByTestId("overview-current-total")).toContainText(
    "302.00 USD",
  );

  const change = page.getByRole("heading", { name: "今日资产变化" }).locator("..");
  await expect(change).toContainText("+2.00 USD");
  await expect(change).toContainText("较 08月05日");

  const sourceSummary = page.getByTestId("overview-source-summary");
  const alpha = sourceSummaryRow(page, "source-alpha");
  const beta = sourceSummaryRow(page, "source-beta");
  await expect(alpha).toContainText("长桥账户");
  await expectAnimatedAmount(alpha, "101.00");
  await expect(alpha).toContainText("101.00 USD");
  await expect(alpha).toContainText("今日变化");
  await expect(alpha).toContainText("+1.00 USD");
  await expect(alpha).toContainText("昨日 100.00 USD");
  await expectAnimatedAmount(beta, "201.00");
  await expect(beta).toContainText("201.00 USD");
  await expect(beta).toContainText("+1.00 USD");
  await expect(beta).toContainText("昨日 200.00 USD");

  await page.getByRole("button", { name: "隐藏关键信息" }).click();
  await expect(sourceSummary).not.toContainText("长桥账户");
  await expect(sourceSummary).not.toContainText("Beta Crypto");
  await expect(sourceSummary).not.toContainText("101.00 USD");
  await expect(sourceSummary).not.toContainText("今日变化");
});

test("当天部分成功的资产总额会作为今日变化兜底", async ({
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

  await loginAsOwner(page, 1);
  await manualRefresh(page, 1);
  expect((await history(request)).trendObservations).toEqual(expect.arrayContaining([
    expect.objectContaining({
      day: "2026-08-06",
      complete: true,
      status: "expired",
      capturedAt: "2026-08-06T12:00:00.000Z",
      total: { USD: "310", CNY: "2232", HKD: "2418" },
    }),
  ]));
  const beforeFailure = await history(request);

  await request.post("/test-doubles/daily-snapshots", {
    data: { action: "fail-all" },
  });
  await manualRefresh(page, 2);
  expect(await history(request)).toEqual(beforeFailure);

  const change = page.getByRole("heading", { name: "今日资产变化" }).locator("..");
  const issues = change.getByTestId("overview-today-change-issues");
  await expect(change).toContainText("+10.00 USD");
  await expect(change).toContainText("较 08月05日");
  await expect(change).toContainText("当前刷新有失败");
  await expect(change).toContainText("变化截至");
  await expect(issues).toHaveCount(0);
  const betaSummary = page.getByTestId("overview-source-summary")
    .getByRole("listitem")
    .filter({ hasText: "Beta Crypto" });
  await expect(betaSummary).toContainText("暂无法比较");
  await expect(betaSummary).not.toContainText("今日变化");
});

test("当天完整观测不会因后续刷新失败而失去资产变化", async ({
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
  const todayObservation = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "record-complete-observation" },
  });
  expect(todayObservation.ok()).toBeTruthy();

  await loginAsOwner(page, 0);
  const beforeFailure = await history(request);
  expect(beforeFailure.trendObservations.at(-1)).toMatchObject({
    complete: true,
    status: "complete",
    total: { USD: "302", CNY: "2174.4", HKD: "2355.6" },
  });
  await request.post("/test-doubles/daily-snapshots", {
    data: { action: "partial-failure" },
  });
  await manualRefresh(page, 1);
  expect((await history(request)).trendObservations).toEqual(expect.arrayContaining([
    expect.objectContaining({
      day: "2026-08-06",
      complete: true,
      status: "expired",
      total: { USD: "302", CNY: "2174.4", HKD: "2355.6" },
    }),
  ]));
  expect((await history(request)).baselines).toEqual(beforeFailure.baselines);

  const change = page.getByRole("heading", { name: "今日资产变化" }).locator("..");
  await expect(change).toContainText("+2.00 USD");
  await expect(change).toContainText("较 08月05日");
  await expect(change).toContainText("当前刷新有失败");
  await expect(change).toContainText("变化截至");
  await expect(change.getByTestId("overview-today-change-issues")).toHaveCount(0);
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

  await loginAsOwner(page, 0);
  expect(await refreshMetrics(request)).toMatchObject({ adapterCalls: 2, active: 0 });

  const change = page
    .getByRole("heading", { name: "自上次完整记录以来资产变化" })
    .locator("..");
  await expect(change).toContainText("+2.00 USD");
  await expect(change).toContainText("较 08月15日（3 日）");
  await manualRefresh(page);
  expect(await refreshMetrics(request)).toMatchObject({ adapterCalls: 4, active: 0 });
  await expect(change).toContainText("+4.00 USD");
  await expect(change).toContainText("较 08月15日（3 日）");
});

test("没有每日趋势观测时提示首次成功同步", async ({ page, request }) => {
  await configure(request);
  const disabled = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "disable-automatic-refresh" },
  });
  expect(disabled.ok()).toBeTruthy();

  await loginAsOwner(page);
  await expect(page.getByTestId("overview-trend")).toContainText(
    "暂无可用观察",
  );
});

test("来源趋势位于总资产金额下方且先于持仓仪表", async ({ page, request }) => {
  await configure(request);
  await loginAsOwner(page);

  await openSourceDetail(page, "source-alpha");
  const alphaCard = page.getByTestId("longbridge-card");
  const total = alphaCard.getByTestId("asset-source-total");
  const trend = alphaCard.getByTestId("asset-source-trend-source-alpha");
  const sourceMeter = alphaCard.locator(".source-meter");
  await expect(total).toHaveCount(1);
  await expect(trend).toHaveCount(1);
  await expect(sourceMeter).toHaveCount(1);

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
  await chooseOverviewOption(page, "计价货币", "HKD");
  const tooltip = await latestTrendTooltip(page);
  await expect(tooltip).toContainText("04月01日");
  await expect(tooltip).toContainText("2,340.00 HKD");
  await expect(tooltip).not.toContainText("不完整");
  await expect(tooltip).not.toContainText("过期");
  await expect(page.getByTestId("overview-trend")).toContainText("6 天未估值");
});

test("北京时间日界线建立唯一基准，同日幂等且跨日不回填", async ({
  page,
  request,
}) => {
  await configure(request);
  await loginAsOwner(page, 0);

  await expect(page.getByTestId("overview-trend")).toContainText(
    "04月01日",
  );
  expect((await history(request)).days.map(({ day }) => day)).toEqual([
    "2026-04-01",
  ]);
  expect((await history(request)).days[0].total.CNY).toBe("2174.4");
  expect((await history(request)).trendObservations[0].total.HKD).toBe("2355.6");
  await chooseOverviewOption(page, "计价货币", "CNY");
  await chooseOverviewOption(page, "计价货币", "HKD");
  await expect(await latestTrendTooltip(page)).toContainText("2,355.60 HKD");
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
  await expect(page.getByTestId("overview-trend")).toContainText(
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
  await unlockAsOwner(page, 2);
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
  await loginAsOwner(page, 0);

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
    capturedAt: "2026-04-01T15:59:55.000Z",
    complete: true,
    status: "expired",
    total: { USD: "304", CNY: "2188.8", HKD: "2371.2" },
    sources: [
      {
        sourceId: "source-alpha",
        capturedAt: "2026-04-01T15:59:55.000Z",
        complete: true,
        status: "complete",
        total: { USD: "102" },
      },
      {
        sourceId: "source-beta",
        capturedAt: "2026-04-01T15:59:55.000Z",
        complete: true,
        status: "expired",
        total: { USD: "202" },
      },
    ],
  }]);
  const afterPartialFailure = await history(request);
  expect(afterPartialFailure.baselines).toEqual(before.baselines);
  await expect(page.getByTestId("overview-current-total")).toContainText("312.00 USD");
  const tooltip = await latestTrendTooltip(page);
  await expect(tooltip).toContainText("04月01日");
  await expect(tooltip).toContainText("304.00 USD");
  await expect(tooltip).toContainText("过期");

  await request.post("/test-doubles/daily-snapshots", {
    data: { action: "fail-all" },
  });
  await setServerTime(request, "2026-04-01T15:59:58.000Z");
  await manualRefresh(page, 2);
  expect(await history(request)).toEqual(afterPartialFailure);
  await expect(page.getByTestId("overview-current-total")).toContainText("312.00 USD");
  await expect(page.getByTestId("overview-source-summary").getByText(
    /同步失败 · 数据过期/,
  )).toHaveCount(2);
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

  await loginAsOwner(page, 1);
  expect((await history(request)).baselines).toEqual([]);
  expect((await history(request)).trendObservations).toMatchObject([{
    day: "2026-04-01",
    capturedAt: "2026-04-01T15:59:50.000Z",
    complete: true,
    status: "expired",
    total: { USD: "310", CNY: "2232", HKD: "2418" },
  }]);

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
  await loginAsOwner(page, 0);

  const snapshot = await history(request);
  expect(snapshot.baselines).toEqual([]);
  expect(snapshot.trendObservations).toHaveLength(1);
  const unvalued = snapshot.trendObservations[0].sources.find(
    ({ sourceId }) => sourceId === "source-unvalued",
  );
  expect(unvalued).toMatchObject({
    complete: false,
    total: { USD: null, CNY: null },
  });
  await expect(page.getByTestId("overview-trend")).toContainText("04月01日");
  await expect(page.getByTestId("overview-trend")).toContainText("不完整");
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

  await loginAsOwner(page, 0);
  await chooseOverviewOption(page, "计价货币", "HKD");
  const overview = page.getByTestId("overview-current-total");
  await expect(overview).toContainText("数据不足");
  await expect(overview).not.toContainText("0.00 HKD");
  await expect(page.getByTestId("overview-confidence")).toContainText("数据不完整");
  await expect(page.getByTestId("overview-confidence")).toContainText("无法折算为 HKD");
  await expect(page.getByTestId("overview-trend")).toContainText("无可用趋势");
  await expect(page.getByTestId("overview-trend").getByRole("img")).toHaveCount(0);
  expect((await history(request)).trendObservations[0]).toMatchObject({
    complete: false,
    status: "incomplete",
    total: { HKD: null },
  });
});

test("历史 HKD 金额固定使用各自观测时汇率", async ({ page, request }) => {
  await configure(request);
  await loginAsOwner(page, 0);

  await setServerTime(request, "2026-04-02T16:00:00.000Z");
  const updated = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "set-hkd-rate", rate: "8" },
  });
  expect(updated.ok()).toBeTruthy();
  await page.goto("/");
  await unlockAsOwner(page, 0);

  await chooseOverviewOption(page, "计价货币", "HKD");
  const overview = page.getByTestId("overview-current-total");
  await expect(overview).toContainText("USD/HKD 8.0000");
  const tooltip = await latestTrendTooltip(page);
  await expect(tooltip).toContainText("04月03日");
  await expect(tooltip).toContainText("2,432.00 HKD");
  const chart = page.getByTestId("overview-trend").getByRole("img");
  await chart.press("ArrowLeft");
  await chart.press("ArrowLeft");
  await expect(tooltip).toContainText("04月01日");
  await expect(tooltip).toContainText("2,355.60 HKD");
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
  await loginAsOwner(page, 0);

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
  const beforeFailure = await history(request);
  await setServerTime(request, "2026-04-01T16:59:50.000Z");

  await loginAsOwner(page, 1);
  expect(await refreshMetrics(request)).toMatchObject({ adapterCalls: 1, active: 0 });
  expect(await history(request)).toEqual(beforeFailure);
});

test("同日新增来源从首次成功同步开始加入来源趋势但不改写总基准", async ({
  page,
  request,
}) => {
  await configure(request);
  await loginAsOwner(page, 0);
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

test("首页近 7 日趋势保留真实缺口，长期分析解释区间资产变化", async ({ page, request }) => {
  await configure(request);
  const seeded = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "seed-total-trend-history" },
  });
  expect(seeded.ok()).toBeTruthy();
  await loginAsOwner(page);
  const trend = page.getByTestId("overview-trend");
  await expect(trend.getByRole("img", { name: "近 7 日总资产趋势" })).toBeVisible();
  await expect(trend).toContainText("03月01日 至 03月04日");
  await expect(trend).toContainText("4 天未估值");
  const observations = (await history(request)).trendObservations;
  expect(observations.map(({ day, total }) => ({ day, USD: total.USD }))).toEqual([
    { day: "2026-03-01", USD: "100" },
    { day: "2026-03-02", USD: "120" },
    { day: "2026-03-04", USD: "110" },
  ]);
  const path = trend.locator(".recharts-line-curve");
  await expect(path).toHaveCount(1);
  expect((await path.getAttribute("d"))?.match(/M/g)).toHaveLength(1);
  expect((await path.getAttribute("d"))?.match(/L/g)).toHaveLength(2);
  const tooltip = await latestTrendTooltip(page);
  await expect(tooltip).toContainText("110.00 USD");
  await page.getByRole("button", { name: "隐藏关键信息" }).click();
  await expect(trend.getByRole("img")).toHaveCount(0);
  await expect(trend).not.toContainText("110.00");
  await expect(trend.locator(".asset-trend-private")).toBeVisible();
  await expect(trend).toContainText("趋势已隐藏");
  await page.getByRole("button", { name: "显示关键信息" }).click();

  const invested = await page.request.post("/api/investment-cashflows", {
    data: { kind: "initial-investment", occurredAt: "2026-03-01T00:00:00.000Z", amount: "100", currency: "USD" },
  });
  expect(invested.status()).toBe(201);
  await trend.getByRole("link", { name: "查看长期趋势" }).click();
  await expect(page).toHaveURL(/\/performance$/);
  const interval = page.getByTestId("performance-interval");
  await expect(interval).toContainText("03月01日 至 03月04日");
  await expect(interval.getByText("区间资产变化", { exact: true }).locator("..")).toContainText("+10.00 USD");
  await expect(interval.getByText("资金加权收益率", { exact: true }).locator("..")).toContainText("+10.00 %");
});

test("长期分析区间与历史覆盖筛选独立，不截断已有观测", async ({ page, request }) => {
  await configure(request);
  const seeded = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "seed-trend-range-history" },
  });
  expect(seeded.ok()).toBeTruthy();
  await loginAsOwner(page);
  const trend = page.getByTestId("overview-trend");
  const tooltip = await latestTrendTooltip(page);
  await expect(tooltip).toContainText("03月07日");
  await expect(tooltip).toContainText("134.00 USD");
  const today = page.getByRole("heading", { name: "今日资产变化" }).locator("..");
  await expect(today).toContainText("+1.00 USD");
  await expect(today).toContainText("较 03月06日");
  const alpha = sourceSummaryRow(page, "source-alpha");
  await expect(alpha).toContainText("暂无法比较");
  expect((await history(request)).trendObservations.slice(-2).map((observation) => ({
    day: observation.day,
    amounts: observation.sources.map((source) => source.total.USD),
  }))).toEqual([
    { day: "2026-03-06", amounts: ["73", "60"] },
    { day: "2026-03-07", amounts: ["74", "60"] },
  ]);

  await trend.getByRole("link", { name: "查看长期趋势" }).click();
  const ranges = page.getByRole("group", { name: "分析区间" });
  await expect(ranges.getByRole("button", { name: "本月", exact: true })).toHaveAttribute("aria-pressed", "true");
  await ranges.getByRole("button", { name: "全部", exact: true }).click();
  await expect(page.getByTestId("performance-interval")).toContainText("02月01日 至 03月07日");
  await page.getByTestId("performance-interval").getByText("区间资产变化", { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByTestId("performance-interval").getByText("区间资产变化", { exact: true }).locator("..")).toContainText("+34.00 USD");
  await chooseOverviewOption(page, "计价货币", "HKD");
  await page.reload();
  await expect(page.getByRole("button", { name: "计价货币" })).toContainText("HKD");
  await expect(ranges.getByRole("button", { name: "本月", exact: true })).toHaveAttribute("aria-pressed", "true");

  const coverage = await openHistoryCoverage(page);
  await chooseCoverageOption(page, coverage, "完整性", "全部状态");
  const rows = coverage.locator(".data-health-history__list > li");
  await expect(rows).toHaveCount(30);
  await chooseCoverageOption(page, coverage, "时间范围", "全部已有观测");
  await expect(rows).toHaveCount(35);
  await expect(rows.first()).toContainText("2026-02-01");
  await expect(rows.last()).toContainText("2026-03-07");
  await chooseCoverageOption(page, coverage, "时间范围", "最近 7 天");
  await expect(rows).toHaveCount(7);
  expect((await history(request)).trendObservations).toHaveLength(35);
});

test("来源详情趋势跨过缺失日期连接已有观测", async ({ page, request }) => {
  await configure(request);
  const seeded = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "seed-source-trend-gap" },
  });
  expect(seeded.ok()).toBeTruthy();

  await loginAsOwner(page);
  await openSourceDetail(page, "source-alpha");
  const alphaTrend = page.getByTestId("asset-source-trend-source-alpha");
  await expect(
    alphaTrend.getByRole("img", { name: "长桥账户来源总额趋势" }),
  ).toHaveCount(1);
  await expect(alphaTrend).toContainText(
    /缺少 \d+ 天观测/,
  );
  const alphaPath = await alphaTrend
    .locator(".recharts-line-curve")
    .getAttribute("d");
  // 三个有效观测应位于同一条路径：一个起点加两段直线。
  expect(alphaPath?.match(/[ML]/g)).toHaveLength(3);

  await openSourceDetail(page, "source-beta");
  const betaTrend = page.getByTestId("asset-source-trend-source-beta");
  await expect(
    betaTrend.getByRole("img", { name: "Beta Crypto来源总额趋势" }),
  ).toHaveCount(1);
});

test("来源详情筛选资产观测，市场指数位于组合分析", async ({
  page,
  request,
}) => {
  await configure(request, "configure-longbridge");
  const seeded = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "seed-source-trend-gap", keepSourcesConnected: true },
  });
  expect(seeded.ok()).toBeTruthy();
  await request.post("/test-doubles/refresh", { data: { action: "anchor-full-refresh" } });

  await loginAsOwner(page);
  await page.goto("/asset-sources/source-alpha");

  const analysis = page.getByRole("region", { name: "来源分析" });
  const range = analysis.getByRole("group", { name: "分析区间" });
  await expect(range.getByRole("button", { name: "本月" }))
    .toHaveAttribute("aria-pressed", "true");

  await range.getByRole("button", { name: "全部" }).click();
  await expect(range.getByRole("button", { name: "全部" }))
    .toHaveAttribute("aria-pressed", "true");

  await range.getByRole("button", { name: "自定义" }).click();
  const dialog = page.getByRole("dialog", { name: "选择来源分析区间" });
  await expect(dialog.getByLabel("开始日期")).toHaveText("2026 / 03 / 01");
  await expect(dialog.getByLabel("结束日期")).toHaveText("2026 / 03 / 04");

  await dialog.getByLabel("开始日期").click();
  await page.getByRole("dialog", { name: "选择记录日期" })
    .getByRole("button", { name: "2026-03-02" })
    .click();
  await dialog.getByLabel("结束日期").click();
  await page.getByRole("dialog", { name: "选择记录日期" })
    .getByRole("button", { name: "2026-03-04" })
    .click();
  await dialog.getByRole("button", { name: "应用区间" }).click();
  await expect(analysis).toContainText("已选 03月02日 至 03月04日");

  const performance = analysis.getByTestId("source-investment-performance");
  const curves = performance.getByRole("group", { name: "收益曲线类型" });
  await expect(performance.getByText("累计收益", { exact: true }).locator("..")).toContainText("数据不足");
  await expect(performance).toContainText("尚未记录本账户的期初本金");
  await expect(performance.getByRole("img")).toHaveCount(0);
  await expect(curves.getByRole("button", { name: "收益率曲线", exact: true })).toHaveAttribute("aria-pressed", "true");
  await curves.getByRole("button", { name: "累计收益曲线", exact: true }).click();
  await expect(curves.getByRole("button", { name: "累计收益曲线", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(performance.getByRole("img")).toHaveCount(0);
  const sourceTrend = analysis.getByTestId("asset-source-trend-source-alpha");
  await expect(sourceTrend.getByRole("img", { name: "长桥账户来源总额趋势" })).toBeVisible();
  const details = sourceTrend.getByTestId("asset-source-daily-details-source-alpha");
  await details.locator("summary").click();
  const days = details.getByTestId("asset-source-daily-detail-source-alpha");
  await expect(days).toHaveCount(2);
  await expect(days.filter({ hasText: "03月02日" })).toContainText("120.00 USD");
  await expect(days.filter({ hasText: "03月04日" })).toContainText("110.00 USD");
  await expect(analysis.getByTestId("performance-benchmark")).toHaveCount(0);
  await page.reload();
  await expect(range).toContainText("已选 03月02日 至 03月04日");

  await page.goto("/performance");
  await page.getByRole("group", { name: "分析区间" }).getByRole("button", { name: "自定义", exact: true }).click();
  const portfolioDialog = page.getByRole("dialog", { name: "自定义分析区间" });
  await portfolioDialog.getByLabel("开始日期").click();
  await page.getByRole("dialog", { name: "选择记录日期" }).getByRole("button", { name: "2026-03-02", exact: true }).click();
  await portfolioDialog.getByLabel("结束日期").click();
  await page.getByRole("dialog", { name: "选择记录日期" }).getByRole("button", { name: /^2026-03-04/ }).click();
  await portfolioDialog.getByRole("button", { name: "应用区间" }).click();
  const benchmark = page.getByTestId("performance-benchmark");
  const chart = page.getByRole("img", { name: "组合资产与市场价格指数趋势" });
  await expect(benchmark).toContainText("基准起点 03月02日");
  await expect(chart).toBeVisible();
  await expect(chart.locator(".recharts-line-curve")).toHaveCount(3);

  const controls = benchmark.getByRole("group", { name: "市场指数" });
  await controls.getByRole("button", { name: "标普 500" }).click();
  await expect(controls.getByRole("button", { name: "标普 500" }))
    .toHaveAttribute("aria-pressed", "false");
  await expect(chart.locator(".recharts-line-curve")).toHaveCount(2);

  await page.getByRole("button", { name: "隐藏关键信息" }).click();
  await expect(benchmark).toHaveCount(0);
  await expect(chart).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth);
});

test("移动端可查看历史观测覆盖与真实缺口且不横向溢出", async ({ page, request }) => {
  await configure(request);
  const seeded = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "seed-total-trend-history" },
  });
  expect(seeded.ok()).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsOwner(page);
  const coverage = await openHistoryCoverage(page);
  await chooseCoverageOption(page, coverage, "时间范围", "全部已有观测");
  await chooseCoverageOption(page, coverage, "完整性", "全部状态");
  const rows = coverage.locator(".data-health-history__list > li");
  await expect(rows).toHaveCount(4);
  await expect(rows.filter({ hasText: "2026-03-03" })).toHaveAttribute("data-state", "gap");
  await expect(rows.filter({ hasText: "2026-03-03" })).toContainText("没有每日趋势观测");
  await expect(rows.filter({ hasText: "2026-03-04" })).toHaveAttribute("data-state", "complete");
  expect((await history(request)).trendObservations.map(({ day }) => day)).toEqual([
    "2026-03-01", "2026-03-02", "2026-03-04",
  ]);
  await expectNoHorizontalOverflow(page);
});

test("移动端来源摘要将变化置于当前金额下方且不横向溢出", async ({
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
  await page.setViewportSize({ width: 390, height: 844 });

  await loginAsOwner(page, 0);
  await manualRefresh(page);

  const alpha = sourceSummaryRow(page, "source-alpha");
  await expectAnimatedAmount(alpha, "102.00");
  const total = alpha.locator(".daily-overview__source-total");
  const sourceChange = alpha.locator(".daily-overview__source-change");
  const detail = alpha.getByRole("link", { name: "查看 长桥账户 的资产明细" });
  const [totalBox, changeBox, detailBox] = await Promise.all([
    total.boundingBox(),
    sourceChange.boundingBox(),
    detail.boundingBox(),
  ]);
  expect(changeBox?.y).toBeGreaterThan(totalBox?.y ?? 0);
  expect(detailBox?.y).toBeGreaterThan(changeBox?.y ?? 0);

  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth);
});

test("移动端近 7 日趋势与长期分析入口保持键盘可访问", async ({ page, request }) => {
  await configure(request);
  const seeded = await request.post("/test-doubles/daily-snapshots", {
    data: { action: "seed-trend-range-history" },
  });
  expect(seeded.ok()).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsOwner(page);
  const trend = page.getByTestId("overview-trend");
  const chart = trend.getByRole("img", { name: "近 7 日总资产趋势" });
  await chart.scrollIntoViewIfNeeded();
  await chart.focus();
  await expect(chart).toBeFocused();
  await chart.press("ArrowRight");
  await expect(trend.locator(".asset-trend-tooltip")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const link = trend.getByRole("link", { name: "查看长期趋势" });
  await link.focus();
  await expect(link).toBeFocused();
  await link.press("Enter");
  await expect(page).toHaveURL(/\/performance$/);
  const all = page.getByRole("group", { name: "分析区间" }).getByRole("button", { name: "全部", exact: true });
  await all.focus();
  await expect(all).toBeFocused();
  await all.press("Enter");
  await expect(all).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("performance-interval")).toContainText("02月01日 至 03月07日");
  await expectNoHorizontalOverflow(page);
});
