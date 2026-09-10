import { expect, test, type Page } from "@playwright/test";

async function seedOverviewHistory(page: Page): Promise<void> {
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
      data: { action: "record-current-observation" },
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

async function colorToken(
  page: Page,
  token: "--success" | "--error",
): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
}

test("总览以来源总额为真相，解释今日判断并收口至收益与来源", async ({
  page,
}) => {
  await seedOverviewHistory(page);
  await page.goto("/");

  const overview = page.getByTestId("portfolio-overview-workspace");
  await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
  await expect(overview.getByTestId("overview-current-total")).toContainText(
    "300.00 USD",
  );
  await expect(overview.getByTestId("overview-confidence")).toContainText(
    "已覆盖 2 个来源",
  );
  await expect(overview.getByTestId("overview-net-investment")).toContainText(
    "115.00 USD",
  );
  await expect(overview.getByTestId("overview-investment-profit")).toContainText(
    "+185.00 USD",
  );
  await expect(overview.getByTestId("overview-trend")).toContainText(
    "可绘制 3 / 7 天",
  );
  const overviewTrend = overview.getByTestId("overview-trend");
  await expect(
    overviewTrend.getByRole("heading", {
      name: "近 7 日资产走势",
      exact: true,
    }),
  ).toBeVisible();
  await expect(overviewTrend).not.toContainText("TREND / LAST 7 DAYS");
  await expect(
    overviewTrend.getByRole("heading", { name: "短趋势", exact: true }),
  ).toHaveCount(0);
  await expect(
    overviewTrend.getByRole("link", { name: "查看长期趋势", exact: true }),
  ).toHaveAttribute("href", "/performance");
  const trendPath = overview
    .getByTestId("overview-trend")
    .locator(".recharts-line-curve");
  await expect(trendPath).toHaveCount(1);
  const trendPathData = await trendPath.getAttribute("d");
  expect(trendPathData?.match(/M/g)).toHaveLength(1);
  const trendChart = await overviewTrend
    .getByRole("img", { name: "近 7 日总资产趋势" })
    .boundingBox();
  expect(trendChart).not.toBeNull();
  expect(trendChart!.height).toBeLessThanOrEqual(200);
  await expect(overview.getByRole("link", { name: "记录资金" })).toHaveAttribute(
    "href",
    "/performance",
  );
  await expect(
    overview.getByRole("link", { name: "查看全部资产与持仓" }),
  ).toHaveAttribute("href", "/assets");

  await chooseOption(page, "计价货币", "CNY");
  await expect(overview.getByTestId("overview-current-total")).toContainText(
    "数据不足",
  );
  await expect(overview.getByTestId("overview-current-total")).toContainText(
    "长桥参考汇率",
  );
  await expect(overviewTrend).not.toContainText("短趋势");
  await expect(overviewTrend).not.toContainText("暂以 USD 观察提供");

  await chooseOption(page, "计价货币", "USD");
  await page.getByRole("button", { name: "隐藏关键信息" }).click();
  await expect(overview).not.toContainText("185.00");
  await expect(overview.getByTestId("overview-trend")).toContainText("趋势已隐藏");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty(
    "scrollWidth",
    await page.locator("body").evaluate((body) => body.clientWidth),
  );
});

test("健康状态只显示来源规模，不罗列零值异常", async ({ page }) => {
  await page.request.post("/test-doubles/reset");
  await page.request.post("/test-doubles/daily-snapshots", {
    data: { action: "configure" },
  });
  await page.request.post("/test-doubles/owner-session");
  await page.goto("/");

  const confidence = page.getByTestId("overview-confidence");
  await expect(confidence).toContainText("总额完整");
  await expect(confidence).toContainText(/已覆盖 \d+ 个来源/);
  await expect(confidence).not.toContainText("未估值 0 项");
  await expect(confidence).not.toContainText("过期来源 0 个");
});

test("没有初始投入时总览保留总额，但不把它误判为组合投资盈亏", async ({
  page,
}) => {
  await page.request.post("/test-doubles/reset");
  await page.request.post("/test-doubles/daily-snapshots", {
    data: { action: "configure" },
  });
  await page.request.post("/test-doubles/owner-session");
  await page.goto("/");

  const overview = page.getByTestId("portfolio-overview-workspace");
  await expect(overview.getByTestId("overview-current-total")).not.toContainText(
    "数据不足",
  );
  await expect(overview.getByTestId("overview-net-investment")).toContainText(
    "数据不足",
  );
  await expect(overview.getByTestId("overview-investment-profit")).toContainText(
    "数据不足",
  );
});

test("首页近 7 日趋势显示观测时保存的 CNY 和 HKD 金额", async ({
  page,
}) => {
  await page.request.post("/test-doubles/reset");
  await page.request.post(
    "/test-doubles/valuation?scenario=longbridge-option-quote-unavailable",
  );
  for (const iso of [
    "2026-03-01T04:00:00.000Z",
    "2026-03-02T04:00:00.000Z",
    "2026-03-04T04:00:00.000Z",
  ]) {
    await page.request.post("/test-doubles/daily-snapshots", {
      data: { action: "set-time", iso },
    });
    await page.request.post("/test-doubles/daily-snapshots", {
      data: { action: "record-current-observation" },
    });
  }
  await page.request.post("/test-doubles/owner-session");
  await page.goto("/");

  const trend = page.getByTestId("overview-trend");
  const trendPath = trend.locator(".recharts-line-curve");

  for (const currency of ["CNY", "HKD"]) {
    await chooseOption(page, "计价货币", currency);
    await expect(trend).toContainText("可绘制 3 / 7 天");
    await expect(trend).not.toContainText(
      "当前计价货币没有可用趋势金额",
    );
    await expect(trend).not.toContainText("暂以 USD 观察提供");
    await expect(trendPath).toHaveCount(1);
  }
});

test("完整日初基准与长桥参考汇率可计算 CNY 和 HKD 今日资产变化", async ({
  page,
}) => {
  await page.request.post("/test-doubles/reset");
  await page.request.post(
    "/test-doubles/valuation?scenario=longbridge-option-quote-unavailable",
  );
  await page.request.post("/test-doubles/daily-snapshots", {
    data: { action: "set-time", iso: "2026-04-01T08:00:00.000Z" },
  });
  await page.request.post("/test-doubles/daily-snapshots", {
    data: { action: "record-current-observation" },
  });
  await page.request.post("/test-doubles/owner-session");
  await page.request.post("/test-doubles/valuation?scenario=longbridge-cash");
  await page.goto("/");

  const todayChange = page
    .getByTestId("portfolio-overview-workspace")
    .locator("article")
    .filter({
      has: page.getByRole("heading", { name: "今日资产变化" }),
    });

  await chooseOption(page, "计价货币", "CNY");
  await expect(todayChange).toContainText("-492,563.73 CNY");
  await expect(todayChange).not.toContainText("数据不足");
  await expect(
    page.getByTestId("overview-current-total"),
  ).toContainText(
    "USD/CNY 7.1234 · 04-01 16:00",
  );

  await chooseOption(page, "计价货币", "HKD");
  await expect(todayChange).toContainText("-540,213.13 HKD");
  await expect(todayChange).not.toContainText("数据不足");
  const todayChangeMetric = todayChange.locator(".vibe-metric");
  await expect(todayChangeMetric).toHaveAttribute(
    "data-profit-color-scheme",
    "red-up",
  );
  await expect(todayChangeMetric).toHaveAttribute(
    "data-profit-direction",
    "negative",
  );
  await expect(todayChangeMetric).toHaveCSS(
    "color",
    await colorToken(page, "--success"),
  );
  await expect(
    page.getByTestId("overview-current-total"),
  ).toContainText(
    "USD/HKD 7.8125 · 04-01 16:00",
  );
});

test("正向今日资产变化也会跟随盈亏颜色设置", async ({ page }) => {
  await page.request.post("/test-doubles/reset");
  await page.request.post("/test-doubles/valuation?scenario=longbridge-cash");
  await page.request.post("/test-doubles/daily-snapshots", {
    data: { action: "set-time", iso: "2026-04-01T08:00:00.000Z" },
  });
  await page.request.post("/test-doubles/daily-snapshots", {
    data: { action: "record-current-observation" },
  });
  await page.request.post("/test-doubles/owner-session");
  await page.request.post(
    "/test-doubles/valuation?scenario=longbridge-option-quote-unavailable",
  );
  await page.goto("/");

  const todayChangeMetric = page
    .getByTestId("portfolio-overview-workspace")
    .locator("article")
    .filter({
      has: page.getByRole("heading", { name: "今日资产变化" }),
    })
    .locator(".vibe-metric");
  await expect(todayChangeMetric).toContainText("+69,147.28 USD");
  await expect(todayChangeMetric).toHaveAttribute(
    "data-profit-color-scheme",
    "red-up",
  );
  await expect(todayChangeMetric).toHaveAttribute(
    "data-profit-direction",
    "positive",
  );
  await expect(todayChangeMetric).toHaveCSS(
    "color",
    await colorToken(page, "--error"),
  );

  await page.goto("/settings");
  await page.getByRole("radio", { name: /绿涨红跌/ }).check();
  await page.goto("/");
  await expect(todayChangeMetric).toHaveAttribute(
    "data-profit-color-scheme",
    "green-up",
  );
  await expect(todayChangeMetric).toHaveCSS(
    "color",
    await colorToken(page, "--success"),
  );
});

test("总览保留过期来源总额，标明未估值与明细仅汇总而不制造对账异常", async ({
  page,
}) => {
  await page.request.post("/test-doubles/reset");
  await page.request.post("/test-doubles/data-health", {
    data: { action: "configure" },
  });
  await page.request.post("/test-doubles/owner-session");
  await page.goto("/");

  const overview = page.getByTestId("portfolio-overview-workspace");
  await expect(overview.getByTestId("overview-current-total")).not.toContainText(
    "数据不足",
  );
  await expect(overview.getByTestId("overview-confidence")).toContainText(
    "未估值 1 项",
  );
  await expect(overview.getByTestId("overview-source-summary")).toContainText(
    "数据过期",
  );
  await expect(overview).not.toContainText("总额异常");

  await page.request.post("/test-doubles/valuation?scenario=detail-coverage-partial");
  await page.goto("/");
  await expect(overview.getByTestId("overview-source-summary")).toContainText(
    "部分仅汇总",
  );
  await expect(overview.getByTestId("overview-confidence")).toContainText(
    "已覆盖 1 个来源",
  );
});
