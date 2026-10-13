import { expect, test, type Page } from "@playwright/test";

import { prepareCompleteHistory } from "./history-observation-helpers";

async function seedPerformanceHistory(page: Page): Promise<void> {
  await page.request.post("/test-doubles/reset");
  await page.request.post("/test-doubles/daily-snapshots", {
    data: { action: "configure" },
  });
  await page.request.post("/test-doubles/clock", {
    data: { now: "2026-03-04T12:00:00.000Z" },
  });
  await page.request.post("/test-doubles/owner-session");

  for (const input of [
    {
      kind: "initial-investment",
      occurredAt: "2026-03-01T00:00:00.000Z",
      amount: "100",
      currency: "USD",
      note: "首笔本金",
    },
    {
      kind: "external-deposit",
      occurredAt: "2026-03-02T04:00:00.000Z",
      amount: "20",
      currency: "USD",
      note: "月度追加",
    },
    {
      kind: "external-withdrawal",
      occurredAt: "2026-03-03T04:00:00.000Z",
      amount: "5",
      currency: "USD",
      note: "部分取回",
    },
  ]) {
    const response = await page.request.post("/api/investment-cashflows", {
      data: input,
    });
    expect(response.status()).toBe(201);
    expect(await response.json()).toMatchObject({
      cashflow: {
        amounts: { USD: input.amount, CNY: null, HKD: null },
        exchangeRates: [],
      },
    });
  }

  // Keep the original cashflows' missing FX evidence; asset history has its own rates.
  for (const day of ["2026-03-01", "2026-03-02", "2026-03-04"]) {
    await page.request.post("/test-doubles/daily-snapshots", {
      data: { action: "set-time", iso: `${day}T04:00:00.000Z` },
    });
    const history = await prepareCompleteHistory(
      page.request,
      ["source-alpha", "source-beta"],
      day,
    );
    for (const observations of [history.baselines, history.trendObservations]) {
      expect(observations.find((item) => item.day === day)?.total.USD).toBe("302");
    }
    // The first real refresh values the assets at 302; later refreshes preserve that fact.
    const stable = await page.request.post("/test-doubles/ethereum", {
      data: { scenario: "refresh-passthrough" },
    });
    expect(stable.ok()).toBeTruthy();
  }
  await page.request.post("/test-doubles/clock", {
    data: { now: "2026-03-04T12:00:00.000Z" },
  });
}

async function chooseOption(page: Page, label: string, option: string) {
  await page.getByRole("button", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("收益分析提供预设与自定义分析区间，并默认选择本月", async ({ page }) => {
  await seedPerformanceHistory(page);
  await page.goto("/performance");

  const trend = page.getByTestId("performance-trend");
  const rangeGroup = trend.getByRole("group", { name: "分析区间" });
  await expect(rangeGroup.getByRole("button")).toHaveText([
    "本月",
    "近 1 月",
    "近 6 月",
    "本年",
    "近 1 年",
    "全部",
    "自定义",
  ]);
  await expect(
    rangeGroup.getByRole("button", { name: "本月", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "收益分析范围" })).toHaveCount(0);
  await expect(trend).toContainText(
    "完整 3 / 4 天",
  );

  for (const [label, totalDays] of [
    ["本月", 4],
    ["近 1 月", 29],
    ["近 6 月", 182],
    ["本年", 63],
    ["近 1 年", 366],
    ["全部", 4],
  ] as const) {
    const option = rangeGroup.getByRole("button", { name: label, exact: true });
    await option.click();
    await expect(option).toHaveAttribute("aria-pressed", "true");
    await expect(trend).toContainText(
      `完整 3 / ${totalDays} 天`,
    );
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty(
    "scrollWidth",
    await page.locator("body").evaluate((body) => body.clientWidth),
  );
});

test("收益分析支持自定义起止日期，并按所选连续上海自然日解释区间", async ({
  page,
}) => {
  await seedPerformanceHistory(page);
  await page.goto("/performance");

  const trend = page.getByTestId("performance-trend");
  const rangeGroup = trend.getByRole("group", { name: "分析区间" });
  await rangeGroup.getByRole("button", { name: "自定义", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "自定义分析区间" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "开始日期" }).click();
  await page.getByRole("button", { name: "2026-03-02" }).click();
  await page.getByRole("button", { name: "结束日期" }).click();
  await page.getByRole("button", { name: "2026-03-04，今天" }).click();
  await page.getByRole("button", { name: "应用区间" }).click();

  await expect(
    rangeGroup.getByRole("button", { name: "自定义", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(rangeGroup).toContainText("已选 03月02日 至 03月04日");
  await expect(trend).toContainText("完整 2 / 3 天");
  await expect(trend).toContainText("03月02日 至 03月04日");
  await expect(page.getByTestId("performance-interval")).toContainText(
    "03月02日 至 03月04日",
  );
});

test("收益分析趋势跨过缺失日期连接已有观测", async ({ page }) => {
  await seedPerformanceHistory(page);
  await page.goto("/performance");
  await page
    .getByTestId("performance-trend")
    .getByRole("button", { name: "本年", exact: true })
    .click();

  const trend = page.getByTestId("performance-trend");
  await expect(trend).toContainText("完整 3 / 63 天");
  await expect(trend).toContainText("结论仅基于完整总资产。");
  const trendPath = trend.locator(".recharts-line-curve");
  await expect(trendPath).toHaveCount(1);
  const trendPathData = await trendPath.getAttribute("d");
  expect(trendPathData?.match(/M/g)).toHaveLength(1);
});

test("收益分析只展示我的完整资产走势，不再切换来源或分类口径", async ({
  page,
}) => {
  await page.request.post("/test-doubles/reset");
  await page.request.post("/test-doubles/daily-snapshots", {
    data: { action: "configure-classified" },
  });
  await page.request.post("/test-doubles/daily-snapshots", {
    data: { action: "seed-classified-performance-history" },
  });
  await page.request.post("/test-doubles/owner-session");

  await page.goto("/performance");
  const trend = page.getByTestId("performance-trend");
  const interval = page.getByTestId("performance-interval");

  await expect(trend.getByRole("heading", { name: "我的资产走势" })).toBeVisible();
  await expect(trend.getByRole("group", { name: "数据口径" })).toHaveCount(0);
  await expect(trend.getByRole("group", { name: "资产分类" })).toHaveCount(0);
  await expect(interval.getByRole("heading", { name: "区间结论" })).toBeVisible();
  await expect(interval).toContainText("区间净外部投入");
  await expect(interval).toContainText("区间投资盈亏");
});

test("收益分析按真实资产观测和资金账本解释收益，并支持安全维护历史记录", async ({
  page,
}) => {
  await seedPerformanceHistory(page);
  await page.goto("/performance");
  const fullYear = page
    .getByTestId("performance-trend")
    .getByRole("button", { name: "本年", exact: true });
  await fullYear.click();
  await expect(fullYear).toHaveAttribute("aria-pressed", "true");

  const workspace = page.getByTestId("investment-performance-workspace");
  await expect(page.getByRole("heading", { name: "收益分析" })).toBeVisible();
  await expect(workspace.getByTestId("performance-current-total")).toContainText(
    "302.00 USD",
  );
  await expect(workspace.getByTestId("performance-net-investment")).toContainText(
    "115.00 USD",
  );
  await expect(workspace.getByTestId("performance-current-profit")).toContainText(
    "+187.00 USD",
  );
  await expect(workspace.getByTestId("performance-interval")).toContainText(
    "03月01日 至 03月04日",
  );
  await expect(workspace.getByTestId("performance-interval")).toContainText(
    "-15.00 USD",
  );
  await expect(workspace.getByTestId("performance-trend")).toContainText(
    "完整 3 / 63 天",
  );

  await page.getByRole("button", { name: "新增资金记录" }).click();
  await chooseOption(page, "资金类型", "外部入金");
  await page.getByLabel("发生时间").fill("2026-03-03T06:00");
  await page.getByLabel("金额").fill("20");
  await chooseOption(page, "原始币种", "USD");
  await page.getByLabel("备注").fill("历史补录");
  await page.getByRole("button", { name: "保存资金记录" }).click();
  await expect(workspace.getByTestId("performance-net-investment")).toContainText(
    "135.00 USD",
  );
  await expect(workspace.getByTestId("performance-current-profit")).toContainText(
    "+167.00 USD",
  );
  await expect(workspace.getByText("历史补录", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "新增资金记录" })).toBeHidden();

  await page.getByRole("button", { name: /编辑资金记录.*历史补录/ }).click();
  await expect(page.getByRole("dialog", { name: "编辑资金记录" })).toBeVisible();
  await expect(page.getByLabel("金额")).toHaveValue("20");
  await page.getByLabel("金额").fill("10");
  const updateResponse = page.waitForResponse((response) =>
    response.request().method() === "PATCH"
    && response.url().includes("/api/investment-cashflows/"),
  );
  await page.getByRole("button", { name: "保存资金记录" }).click();
  const updated = await updateResponse;
  expect(updated.status()).toBe(200);
  expect(await updated.json()).toMatchObject({ cashflow: { amount: "10" } });
  await expect(page.getByRole("dialog", { name: "编辑资金记录" })).toBeHidden();
  await workspace.getByTestId("performance-net-investment").scrollIntoViewIfNeeded();
  await expect(workspace.getByTestId("performance-net-investment")).toContainText(
    "125.00 USD",
  );

  await page.getByRole("button", { name: /删除资金记录.*历史补录/ }).click();
  await expect(
    page.getByRole("dialog", { name: "永久删除资金记录" }),
  ).toContainText("将永久删除 外部入金记录");
  await page.getByRole("button", { name: "永久删除这条记录" }).click();
  await expect(workspace.getByText("历史补录", { exact: true })).toHaveCount(0);
  await workspace.getByTestId("performance-net-investment").scrollIntoViewIfNeeded();
  await expect(workspace.getByTestId("performance-net-investment")).toContainText(
    "115.00 USD",
  );

  await chooseOption(page, "计价货币", "CNY");
  await expect(workspace.getByTestId("performance-current-profit")).toContainText(
    "+1,346.40 CNY",
  );
  await expect(workspace.getByTestId("performance-current-profit")).toContainText(
    "按当前汇率折算",
  );
  await expect(workspace.getByTestId("performance-interval")).toContainText(
    "区间资金缺少汇率证据。",
  );
  await expect(workspace.getByTestId("performance-interval")).toContainText(
    "数据不足",
  );

  await page.getByRole("button", { name: "隐藏关键信息" }).click();
  await expect(workspace).not.toContainText("首笔本金");
  await expect(workspace).not.toContainText("1,346.40");
  await expect(workspace.getByTestId("performance-trend")).toContainText(
    "趋势已隐藏",
  );
  const hiddenTrend = workspace
    .getByTestId("performance-trend")
    .locator(".asset-trend-private--total");
  const hiddenTrendCopy = hiddenTrend.locator(".asset-trend-private-copy");
  await expect(hiddenTrendCopy).toHaveJSProperty(
    "offsetWidth",
    await hiddenTrend.evaluate((element) => element.clientWidth),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  const command = await page.getByRole("button", {
    name: "打开快捷命令",
  }).boundingBox();
  const mobileNavigation = await page.getByTestId(
    "workbench-mobile-navigation",
  ).boundingBox();
  expect(command).not.toBeNull();
  expect(mobileNavigation).not.toBeNull();
  expect(command!.y + command!.height).toBeLessThanOrEqual(
    mobileNavigation!.y - 8,
  );
  await expect(page.locator("body")).toHaveJSProperty(
    "scrollWidth",
    await page.locator("body").evaluate((body) => body.clientWidth),
  );
});

test("市场价格指数接口保留所有者与长桥来源边界", async ({ request }) => {
  await request.post("/test-doubles/reset");

  expect(
    (await request.get("/api/market-benchmarks/candles")).status(),
  ).toBe(401);

  await request.post("/test-doubles/owner-session");
  expect(
    (await request.get("/api/market-benchmarks/candles")).status(),
  ).toBe(409);

  const loaded = await request.post(
    "/test-doubles/longbridge/persistence?legacy=1",
  );
  expect(loaded.ok()).toBeTruthy();

  const response = await request.get("/api/market-benchmarks/candles");
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  expect(body.candles[".SPX.US"]).toHaveLength(180);
  expect(body.candles[".NDX.US"]).toHaveLength(180);
});

test("旧长桥历史保留来源实际观测，不伪造组合完整性", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/longbridge/persistence?legacy=history",
  );
  expect(response.ok()).toBeTruthy();

  const body = await response.json();
  expect(body.observation).toMatchObject({
    complete: false,
    status: "incomplete",
    total: { USD: "100", CNY: "720", HKD: null },
  });
  expect(body.source).toMatchObject({
    complete: true,
    status: "complete",
    total: { USD: "100", CNY: "720", HKD: null },
    assetClassTotals: {
      securities: {
        complete: true,
        total: { USD: "100", CNY: "720", HKD: null },
      },
    },
  });
});

test("收益分析将早期长桥金额作为统一资产走势的补充历史", async ({
  page,
}) => {
  await page.request.post("/test-doubles/reset");
  await page.request.post("/test-doubles/daily-snapshots", {
    data: { action: "configure-classified" },
  });
  await page.request.post("/test-doubles/daily-snapshots", {
    data: { action: "seed-classified-performance-history" },
  });
  await page.request.post("/test-doubles/owner-session");
  const loaded = await page.request.post(
    "/test-doubles/longbridge/persistence?legacy=1",
  );
  expect(loaded.ok()).toBeTruthy();

  const history = await page.request.post("/test-doubles/daily-snapshots", {
    data: { action: "seed-imported-source-history" },
  });
  expect(history.ok()).toBeTruthy();

  await page.goto("/performance");

  const trend = page.getByTestId("performance-trend");
  await trend.getByRole("button", { name: "全部", exact: true }).click();
  const chart = trend.getByRole("img", { name: /我的资产走势.*早期实际记录/ });
  await expect(chart).toBeVisible();
  await expect(trend.getByRole("img")).toHaveCount(1);
  await expect(chart.locator(".recharts-line-curve")).toHaveCount(2);
  await expect(trend).toContainText("早期记录");
  await expect(trend).toContainText("完整总资产");
  await expect(trend.getByTestId("performance-benchmark")).toHaveCount(0);
  await expect(trend.getByRole("group", { name: "数据口径" })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty(
    "scrollWidth",
    await page.locator("body").evaluate((body) => body.clientWidth),
  );

  await page.getByRole("button", { name: "隐藏关键信息" }).click();
  await expect(trend.getByTestId("performance-benchmark")).toHaveCount(0);
});

test("近期范围未包含早期记录时，资产走势仍可显示市场对比", async ({
  page,
}) => {
  await seedPerformanceHistory(page);
  const loaded = await page.request.post(
    "/test-doubles/longbridge/persistence?legacy=1",
  );
  expect(loaded.ok()).toBeTruthy();

  const history = await page.request.post("/test-doubles/daily-snapshots", {
    data: { action: "seed-imported-source-history" },
  });
  expect(history.ok()).toBeTruthy();

  await page.goto("/performance");
  const trend = page.getByTestId("performance-trend");
  const rangeGroup = trend.getByRole("group", { name: "分析区间" });

  await rangeGroup.getByRole("button", { name: "近 1 月", exact: true }).click();
  const chart = trend.getByRole("img", {
    name: "组合资产与市场价格指数趋势",
  });

  await expect(rangeGroup.getByRole("button", { name: "近 1 月", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await expect(trend).toContainText("完整 3 / 29 天");
  await expect(chart).toContainText("02月04日");
  expect(
    (await chart.locator(".recharts-line-curve").first().getAttribute("d"))?.match(/M/g),
  ).toHaveLength(1);
});

test("长桥价格指数读取失败时不伪造对比数值", async ({ page }) => {
  await seedPerformanceHistory(page);
  const loaded = await page.request.post(
    "/test-doubles/longbridge/persistence?legacy=1",
  );
  expect(loaded.ok()).toBeTruthy();
  await page.route("**/api/market-benchmarks/candles", (route) =>
    route.fulfill({
      body: JSON.stringify({ error: "读取失败" }),
      contentType: "application/json",
      status: 500,
    }),
  );

  await page.goto("/performance");
  const benchmark = page.getByTestId("performance-benchmark");
  await expect(benchmark).toContainText("指数读取失败");
  await expect(page.getByTestId("performance-trend").locator(".recharts-line-curve")).toHaveCount(1);
  await expect(page.getByTestId("performance-trend").getByRole("img")).toHaveCount(1);
});
