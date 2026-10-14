import { expect, test, type Page } from "@playwright/test";

type Currency = "CNY" | "USD" | "HKD";

async function openManualSource(page: Page, currencies: readonly Currency[]) {
  expect((await page.request.post("/test-doubles/owner-session")).ok()).toBeTruthy();
  expect((await page.request.post("/api/asset-sources/manual", {
    data: { label: "币种验收资产" },
  })).ok()).toBeTruthy();
  const response = await page.request.get("/test-doubles/manual-assets");
  expect(response.ok()).toBeTruthy();
  const { sources } = await response.json() as { sources: Array<{ id: string; label: string }> };
  const source = sources.find(({ label }) => label === "币种验收资产");
  expect(source).toBeDefined();
  for (const [index, currency] of currencies.entries()) {
    const saved = await page.request.patch(`/api/asset-sources/${source!.id}`, {
      data: {
        action: "manual-record",
        day: `2025-12-${28 + index}`,
        amount: "1000",
        currency,
      },
    });
    expect(saved.ok()).toBeTruthy();
  }
  await page.goto(`/asset-sources/${source!.id}`);
  await expect(page.getByRole("heading", { name: "币种验收资产" })).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  expect((await request.post("/test-doubles/reset")).ok()).toBeTruthy();
});

const cases: Array<{ name: string; history: Currency[]; expected: Currency }> = [
  { name: "无历史时使用 CNY", history: [], expected: "CNY" },
  { name: "沿用多数 CNY", history: ["CNY", "CNY", "USD"], expected: "CNY" },
  { name: "沿用多数 USD", history: ["USD", "USD", "CNY"], expected: "USD" },
  { name: "沿用多数 HKD", history: ["HKD", "HKD", "CNY"], expected: "HKD" },
  { name: "平票时沿用日期最新的 HKD", history: ["USD", "HKD"], expected: "HKD" },
];

for (const scenario of cases) {
  test(`来源详情新增记录${scenario.name}，保存刷新后保留原币种`, async ({ page }) => {
    await openManualSource(page, scenario.history);
    await page.getByRole("button", { name: "添加数据", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "记录 币种验收资产 数据" });
    await expect(dialog.getByRole("button", { name: /^币种 / })).toHaveText(scenario.expected);
    await dialog.getByLabel("资产总额").fill("4321");
    await dialog.getByRole("button", { name: "保存数据" }).click();
    await expect(dialog).toBeHidden();
    const history = page.getByLabel("币种验收资产历史记录");
    await expect(history).toContainText(`4,321.00 ${scenario.expected}`);
    await page.reload();
    await expect(history).toContainText(`4,321.00 ${scenario.expected}`);
    await expect(history.getByRole("listitem")).toHaveCount(scenario.history.length + 1);
  });
}

test("编辑已有记录保留该记录币种，且新增时可手动覆盖默认币种", async ({ page }) => {
  await openManualSource(page, ["USD", "USD", "CNY"]);
  const history = page.getByLabel("币种验收资产历史记录");
  const original = history.getByRole("listitem").filter({ hasText: "2025-12-30" });
  await original.getByRole("button", { name: "编辑", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "记录 币种验收资产 数据" });
  await expect(dialog.getByRole("button", { name: /^币种 / })).toHaveText("CNY");
  await dialog.getByLabel("资产总额").fill("5555");
  await dialog.getByRole("button", { name: "保存数据" }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(original).toContainText("5,555.00 CNY");
  await expect(history.getByRole("listitem")).toHaveCount(3);

  await page.getByRole("button", { name: "添加数据", exact: true }).click();
  const currency = dialog.getByRole("button", { name: /^币种 / });
  await expect(currency).toHaveText("USD");
  await currency.click();
  await page.getByRole("option", { name: "HKD", exact: true }).click();
  await dialog.getByLabel("资产总额").fill("9876");
  await dialog.getByRole("button", { name: "保存数据" }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(history).toContainText("9,876.00 HKD");
  await expect(original).toContainText("5,555.00 CNY");
  await expect(history.getByRole("listitem")).toHaveCount(4);
});
