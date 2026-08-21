import { expect, test, type Page } from "@playwright/test";

async function seedPerformanceHistory(page: Page): Promise<void> {
  await page.request.post("/test-doubles/reset");
  await page.request.post("/test-doubles/daily-snapshots", {
    data: { action: "configure" },
  });
  for (const iso of [
    "2026-03-01T04:00:00.000Z",
    "2026-03-02T04:00:00.000Z",
    "2026-03-04T04:00:00.000Z",
  ]) {
    await page.request.post("/test-doubles/daily-snapshots", {
      data: { action: "set-time", iso },
    });
    await page.request.post("/test-doubles/daily-snapshots", {
      data: { action: "record-complete-observation" },
    });
  }
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
  }
}

async function chooseOption(page: Page, label: string, option: string) {
  await page.getByRole("button", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("收益分析直接提供六个分析区间并默认选择本月", async ({ page }) => {
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
  ]);
  await expect(
    rangeGroup.getByRole("button", { name: "本月", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "收益分析范围" })).toHaveCount(0);
  await expect(trend).toContainText(
    "可绘制 3 / 4 天",
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
      `可绘制 3 / ${totalDays} 天`,
    );
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty(
    "scrollWidth",
    await page.locator("body").evaluate((body) => body.clientWidth),
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
  await expect(trend).toContainText("缺少 60 天资产观测");
  await expect(trend).toContainText("趋势线已跨过缺口连接");
  const trendPath = trend.locator(".recharts-line-curve");
  await expect(trendPath).toHaveCount(1);
  const trendPathData = await trendPath.getAttribute("d");
  expect(trendPathData?.match(/M/g)).toHaveLength(1);
});

test("收益分析按证券或加密资产查看分类走势和资产变动，不伪造分类收益", async ({
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
  const assetScope = trend.getByRole("group", { name: "资产范围" });
  const interval = page.getByTestId("performance-interval");

  await assetScope.getByRole("button", { name: "证券", exact: true }).click();
  await expect(
    assetScope.getByRole("button", { name: "证券", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(trend.getByRole("heading", { name: "证券走势" })).toBeVisible();
  await expect(trend).toContainText("分类趋势按资产来源归类");
  await expect(trend).toContainText("缺少 1 天证券观测");
  await expect(interval.getByRole("heading", { name: "证券区间资产变动" })).toBeVisible();
  await expect(interval).toContainText("+20.00 USD");
  await expect(interval).not.toContainText("区间净外部投入");
  await expect(interval).toContainText("不计算分类收益或收益率");

  await assetScope.getByRole("button", { name: "加密资产", exact: true }).click();
  await expect(
    assetScope.getByRole("button", { name: "加密资产", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(trend.getByRole("heading", { name: "加密资产走势" })).toBeVisible();
  await expect(interval.getByRole("heading", { name: "加密资产区间资产变动" })).toBeVisible();
  await expect(interval).toContainText("-20.00 USD");
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
    "300.00 USD",
  );
  await expect(workspace.getByTestId("performance-net-investment")).toContainText(
    "115.00 USD",
  );
  await expect(workspace.getByTestId("performance-current-profit")).toContainText(
    "+185.00 USD",
  );
  await expect(workspace.getByTestId("performance-interval")).toContainText(
    "03月01日 至 03月04日",
  );
  await expect(workspace.getByTestId("performance-interval")).toContainText(
    "-15.00 USD",
  );
  await expect(workspace.getByTestId("performance-trend")).toContainText(
    "可绘制 3 / 63 天",
  );
  await expect(workspace.getByTestId("performance-trend")).toContainText(
    "缺少 60 天资产观测",
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
    "+165.00 USD",
  );
  await expect(workspace.getByText("历史补录", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /编辑资金记录.*历史补录/ }).click();
  await page.getByLabel("金额").fill("10");
  await page.getByRole("button", { name: "保存资金记录" }).click();
  await expect(workspace.getByTestId("performance-net-investment")).toContainText(
    "125.00 USD",
  );

  await page.getByRole("button", { name: /删除资金记录.*历史补录/ }).click();
  await expect(
    page.getByRole("dialog", { name: "永久删除资金记录" }),
  ).toContainText("不会改写任何资产观测");
  await page.getByRole("button", { name: "永久删除这条记录" }).click();
  await expect(workspace.getByText("历史补录", { exact: true })).toHaveCount(0);
  await expect(workspace.getByTestId("performance-net-investment")).toContainText(
    "115.00 USD",
  );

  await chooseOption(page, "计价货币", "CNY");
  await expect(workspace.getByTestId("performance-current-profit")).toContainText(
    "数据不足",
  );

  await page.getByRole("button", { name: "隐藏关键信息" }).click();
  await expect(workspace).not.toContainText("首笔本金");
  await expect(workspace).not.toContainText("185.00");
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
