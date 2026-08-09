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
    "来源账户总额",
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
  await expect(overview.getByTestId("overview-confidence")).toContainText(
    "长桥参考汇率",
  );

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
    "来源账户总额",
  );
});
