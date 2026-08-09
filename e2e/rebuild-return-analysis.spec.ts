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

test("收益分析按真实资产观测和资金账本解释收益，并支持安全维护历史记录", async ({
  page,
}) => {
  await seedPerformanceHistory(page);
  await page.goto("/performance");

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
    "可绘制 3 / 7 天",
  );
  await expect(workspace.getByTestId("performance-trend")).toContainText(
    "缺少 4 天资产观测",
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
