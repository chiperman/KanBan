import { expect, test, type Page } from "@playwright/test";

import { chooseOverviewOption } from "./overview-control-helpers";

async function loginAsOwner(page: Page): Promise<void> {
  const response = await page.request.post("/test-doubles/owner-session");
  expect(response.ok()).toBeTruthy();
  await page.goto("/");
  await expect(page.getByTestId("view-mode")).toContainText("所有者视图");
}

async function manualState(page: Page) {
  const response = await page.request.get("/test-doubles/manual-assets");
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as {
    sources: Array<{
      id: string;
      kind: string;
      label: string;
      manualAssetClass?: string;
      total: { amount: string; currency: string };
    }>;
    baselines: Array<{
      sources: Array<{
        sourceId: string;
        total: { USD: string | null; CNY: string | null; HKD: string | null };
      }>;
    }>;
    trendObservations: Array<{
      day: string;
      complete: boolean;
      status: "complete" | "incomplete" | "expired";
      sources: Array<{
        sourceId: string;
        complete: boolean;
        status: "complete" | "incomplete" | "expired";
        total: { USD: string | null; CNY: string | null; HKD: string | null };
      }>;
    }>;
  };
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
});

test("手工资产可在来源管理中设置资产类别并正确归入分布", async ({
  page,
}) => {
  await loginAsOwner(page);
  const created = await page.request.post("/api/asset-sources/manual", {
    data: { label: "A股" },
  });
  expect(created.ok()).toBeTruthy();
  const [manualSource] = (await manualState(page)).sources.filter(
    ({ kind }) => kind === "manual",
  );
  const recorded = await page.request.patch(
    `/api/asset-sources/${encodeURIComponent(manualSource.id)}`,
    {
      data: {
        action: "manual-record",
        day: "2026-01-01",
        amount: "100000",
        currency: "CNY",
      },
    },
  );
  expect(recorded.ok()).toBeTruthy();
  await page.reload();

  await chooseOverviewOption(page, "计价货币", "CNY");
  const overview = page.getByTestId("total-asset-overview");
  await expect(overview).toContainText("当前估值：完整");
  await expect(overview.getByLabel("资产分布")).toContainText(
    "待分类100,000.00 CNY",
  );

  await page.getByRole("button", { name: "管理 A股" }).click();
  const management = page.getByRole("dialog", { name: "管理 A股" });
  await expect(management.getByRole("button", { name: "资产类别" })).toHaveText(
    "待分类",
  );
  const managementPanel = management.locator(".source-management-dialog");
  const panelScrollHeight = await managementPanel.evaluate(
    (element) => element.scrollHeight,
  );
  await management.getByRole("button", { name: "资产类别" }).click();
  const assetClassOptions = page.getByRole("listbox", { name: "资产类别" });
  await expect(assetClassOptions).toHaveCSS("position", "static");
  await expect(assetClassOptions.locator("..")).toHaveCSS("position", "fixed");
  await expect
    .poll(() =>
      managementPanel.evaluate((element) => element.scrollHeight),
    )
    .toBe(panelScrollHeight);
  await assetClassOptions.getByRole("option", { name: "证券", exact: true }).click();
  await management.getByRole("button", { name: "保存设置" }).click();

  await expect(overview).toContainText("当前估值：完整");
  await expect(overview.getByLabel("资产分布")).toContainText(
    "证券100,000.00 CNY",
  );
  await expect(overview).not.toContainText("未解释差额");
  await expect(overview).not.toContainText("现金及其他");

  const state = await manualState(page);
  expect(
    state.sources.find(({ id }) => id === manualSource.id)?.manualAssetClass,
  ).toBe("securities");
});

test("手工资产来源在卡片内按上海自然日保存一条，并可在当天编辑总额", async ({
  page,
  request,
}) => {
  const unauthorized = await request.post("/api/asset-sources/manual", {
    data: { label: "A股", amount: "100000", currency: "CNY" },
  });
  expect(unauthorized.status()).toBe(401);

  await loginAsOwner(page);
  await expect(
    page.getByRole("button", { name: "手工记录资产" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "添加资产来源" }).click();
  const create = page.getByRole("dialog", { name: "添加资产来源" });
  await create.getByRole("radio", { name: "手工记录资产" }).click();
  await expect(
    create.getByRole("heading", { name: "创建手工资产来源" }),
  ).toBeVisible();
  await create.getByLabel("资产名称").fill("A股");
  await expect(create.getByLabel("资产总额")).toHaveCount(0);
  await create.getByRole("button", { name: "添加资产来源" }).click();

  const card = page.getByTestId("manual-asset-card");
  await expect(card).toBeVisible();
  await expect(card.getByRole("heading", { name: "A股" })).toBeVisible();
  await expect(card.getByTestId("manual-asset-unrecorded")).toHaveText(
    "0 USD",
  );
  await expect(card).toContainText("尚未添加数据 · 添加后才会计入总资产");
  const initialState = await manualState(page);
  expect(initialState.baselines).toHaveLength(0);
  expect(initialState.trendObservations).toHaveLength(0);
  const addRecord = card.getByRole("button", { name: "添加数据" });
  await expect(addRecord).toBeVisible();
  const [addRecordBox, totalBox] = await Promise.all([
    addRecord.boundingBox(),
    card.getByTestId("manual-asset-unrecorded").boundingBox(),
  ]);
  expect(addRecordBox).not.toBeNull();
  expect(totalBox).not.toBeNull();
  expect(addRecordBox!.y).toBeLessThan(totalBox!.y);
  await addRecord.click();
  const record = page.getByRole("dialog", { name: "记录 A股 数据" });
  await record.getByLabel("资产总额").fill("100000");
  await expect(record.getByLabel("币种")).toHaveText("CNY");
  await record.getByRole("button", { name: "保存数据" }).click();

  await expect(card).toContainText("无法折算 USD");
  await chooseOverviewOption(page, "计价货币", "CNY");
  await expect(card).toContainText("100,000.00");
  await expect(card).toContainText("仅记录资产总额 · 每日一条，可在下方管理历史数据");
  await expect(card.getByRole("button", { name: /刷新/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "立即刷新资产" })).toHaveCount(0);

  const management = page.getByRole("dialog", { name: "管理 A股" });
  await page.getByRole("button", { name: "管理 A股" }).click();
  await expect(management).toContainText("仅修改本看板中的显示名称");
  await expect(management.getByLabel("资产总额")).toHaveCount(0);
  await expect(
    management.getByRole("menuitem", { name: "断开来源" }),
  ).toHaveCount(0);
  await management.getByRole("button", { name: "关闭" }).click();

  await card.getByRole("button", { name: "更新今日数据" }).click();
  const update = page.getByRole("dialog", { name: "记录 A股 数据" });
  await update.getByLabel("资产总额").fill("108000");
  await update.getByLabel("资产总额").press("Enter");

  await expect(card).toContainText("108,000.00");
  await page.getByRole("button", { name: "添加资产来源" }).click();
  const secondSource = page.getByRole("dialog", { name: "添加资产来源" });
  await secondSource.getByRole("radio", { name: "手工记录资产" }).click();
  await secondSource.getByLabel("资产名称").fill("场外基金");
  await secondSource.getByRole("button", { name: "添加资产来源" }).click();
  await expect(page.getByTestId("manual-asset-card")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "添加数据" })).toBeVisible();

  const state = await manualState(page);
  const manualSources = state.sources.filter(({ kind }) => kind === "manual");
  const manual = manualSources.find(({ label }) => label === "A股")!;
  expect(manualSources).toHaveLength(2);
  expect(manual.total).toEqual({ amount: "108000", currency: "CNY" });
  const baselineRecords = state.baselines[0].sources.filter(
    ({ sourceId }) => sourceId === manual.id,
  );
  expect(baselineRecords).toHaveLength(1);
  expect(baselineRecords[0]).toMatchObject({
    sourceId: manual.id,
    total: { USD: null, CNY: "108000", HKD: null },
  });
  const trendRecords = state.trendObservations[0].sources.filter(
    ({ sourceId }) => sourceId === manual.id,
  );
  expect(trendRecords).toHaveLength(1);
  expect(trendRecords[0]).toMatchObject({
    sourceId: manual.id,
    total: { USD: null, CNY: "108000", HKD: null },
  });

  const refresh = await page.request.post("/api/asset-sources/refresh", {
    data: { mode: "all", sourceId: manual.id },
  });
  expect(refresh.status()).toBe(409);
  const disconnect = await page.request.patch(
    `/api/asset-sources/${encodeURIComponent(manual.id)}`,
    { data: { action: "disconnect" } },
  );
  expect(disconnect.status()).toBe(400);
  await expect(disconnect.json()).resolves.toEqual({
    error: "手工资产记录不支持断开",
  });
});

test("手工资产历史可编辑、删除，并回退到最新保留记录", async ({
  page,
  request,
}) => {
  await request.post("/test-doubles/clock", {
    data: { now: "2026-01-04T04:00:00.000Z" },
  });
  await loginAsOwner(page);
  await page.getByRole("button", { name: "添加资产来源" }).click();
  const create = page.getByRole("dialog", { name: "添加资产来源" });
  await create.getByRole("radio", { name: "手工记录资产" }).click();
  await create.getByLabel("资产名称").fill("A股");
  await create.getByRole("button", { name: "添加资产来源" }).click();

  const card = page.getByTestId("manual-asset-card");
  await card.getByRole("button", { name: "添加数据" }).click();
  const firstRecord = page.getByRole("dialog", { name: "记录 A股 数据" });
  await firstRecord.getByLabel("记录日期").click();
  await page
    .getByRole("dialog", { name: "选择记录日期" })
    .getByRole("button", { name: "2026-01-01" })
    .click();
  await firstRecord.getByLabel("资产总额").fill("100000");
  await firstRecord.getByRole("button", { name: "保存数据" }).click();

  await card.getByRole("button", { name: "添加数据" }).click();
  const latestRecord = page.getByRole("dialog", { name: "记录 A股 数据" });
  await latestRecord.getByLabel("资产总额").fill("108000");
  await latestRecord.getByRole("button", { name: "保存数据" }).click();

  await chooseOverviewOption(page, "计价货币", "CNY");
  const history = card.getByLabel("A股历史记录");
  const latestItem = history.locator("li").filter({ hasText: "2026-01-04" });
  await expect(history).toContainText("2026-01-01100,000.00 CNY");
  await expect(latestItem).toContainText("108,000.00 CNY");

  await latestItem.getByRole("button", { name: "编辑" }).click();
  const edit = page.getByRole("dialog", { name: "记录 A股 数据" });
  await expect(edit.getByLabel("记录日期")).toBeDisabled();
  await edit.getByLabel("资产总额").fill("109000");
  await edit.getByRole("button", { name: "保存数据" }).click();
  await expect(latestItem).toContainText("109,000.00 CNY");
  await expect(history.getByRole("listitem")).toHaveCount(2);

  await latestItem.getByRole("button", { name: "删除" }).click();
  const deletion = page.getByRole("dialog", {
    name: "删除 A股 2026-01-04 数据",
  });
  await deletion.getByRole("button", { name: "删除数据" }).click();

  await expect(history).not.toContainText("2026-01-04");
  await expect(history).toContainText("2026-01-01");
  await expect(card.getByTestId("asset-source-total")).toContainText(
    "100,000.00 CNY",
  );

  const [manualSource] = (await manualState(page)).sources.filter(
    ({ kind }) => kind === "manual",
  );
  const future = await page.request.patch(
    `/api/asset-sources/${encodeURIComponent(manualSource.id)}`,
    {
      data: {
        action: "manual-record",
        day: "2026-01-05",
        amount: "120000",
        currency: "CNY",
      },
    },
  );
  expect(future.status()).toBe(400);
  await expect(future.json()).resolves.toEqual({
    error: "记录日期不能晚于今天",
  });
});

test("低频手工记录不降低完整性，并按最近记录延用趋势金额", async ({
  page,
  request,
}) => {
  await request.post("/test-doubles/clock", {
    data: { now: "2026-01-04T04:00:00.000Z" },
  });
  await loginAsOwner(page);
  const created = await page.request.post("/api/asset-sources/manual", {
    data: { label: "私募基金" },
  });
  expect(created.ok()).toBeTruthy();
  const [manualSource] = (await manualState(page)).sources.filter(
    ({ kind }) => kind === "manual",
  );

  const firstRecord = await page.request.patch(
    `/api/asset-sources/${encodeURIComponent(manualSource.id)}`,
    {
      data: {
        action: "manual-record",
        day: "2026-01-01",
        amount: "100000",
        currency: "CNY",
      },
    },
  );
  expect(firstRecord.ok()).toBeTruthy();

  const secondRecord = await page.request.patch(
    `/api/asset-sources/${encodeURIComponent(manualSource.id)}`,
    {
      data: {
        action: "manual-record",
        day: "2026-01-04",
        amount: "108000",
        currency: "CNY",
      },
    },
  );
  expect(secondRecord.ok()).toBeTruthy();

  const state = await manualState(page);
  expect(
    state.trendObservations.flatMap(({ sources }) =>
      sources.filter(({ sourceId }) => sourceId === manualSource.id),
    ),
  ).toEqual([
    expect.objectContaining({
      complete: true,
      status: "complete",
      total: { USD: null, CNY: "100000", HKD: null },
    }),
    expect.objectContaining({
      complete: true,
      status: "complete",
      total: { USD: null, CNY: "108000", HKD: null },
    }),
  ]);

  await page.goto("/");
  await chooseOverviewOption(page, "计价货币", "CNY");
  await chooseOverviewOption(page, "趋势区间", "全部");

  const totalTrend = page.getByTestId("total-asset-trend");
  const sourceTrend = page.getByTestId(
    `asset-source-trend-${manualSource.id}`,
  );
  await expect(totalTrend).toContainText("可绘制 4 / 4 天");
  await expect(sourceTrend).toContainText(
    "手工数据按最近记录延用，不影响同步完整性",
  );
  await expect(sourceTrend).not.toContainText("缺少 2 天观测，折线已断开");
});

test("手工记录拒绝非法金额和非手工来源编辑，并在文件存储中覆盖当天记录", async ({
  page,
  request,
}) => {
  await loginAsOwner(page);
  const created = await page.request.post("/api/asset-sources/manual", {
    data: { label: "A股" },
  });
  expect(created.ok()).toBeTruthy();
  const [manualSource] = (await manualState(page)).sources.filter(
    ({ kind }) => kind === "manual",
  );
  const invalid = await page.request.patch(
    `/api/asset-sources/${encodeURIComponent(manualSource.id)}`,
    {
      data: {
        action: "manual-record",
        day: "2026-01-01",
        amount: "-1",
        currency: "CNY",
      },
    },
  );
  expect(invalid.status()).toBe(400);
  await expect(invalid.json()).resolves.toEqual({
    error: "资产总额必须是最多两位小数的非负数",
  });

  const seeded = await request.post("/test-doubles/manual-assets", {
    data: { action: "seed-nonmanual" },
  });
  expect(seeded.ok()).toBeTruthy();
  const { sourceId } = await seeded.json() as { sourceId: string };
  const nonmanual = await page.request.patch(
    `/api/asset-sources/${encodeURIComponent(sourceId)}`,
    { data: { action: "manual-record", amount: "2", currency: "USD" } },
  );
  expect(nonmanual.status()).toBe(400);
  await expect(nonmanual.json()).resolves.toEqual({
    error: "只有手工资产记录可以编辑今日总额",
  });

  const persisted = await request.post("/test-doubles/manual-assets", {
    data: { action: "file-persistence" },
  });
  expect(persisted.ok()).toBeTruthy();
  await expect(persisted.json()).resolves.toEqual({
    source: { amount: "108000", currency: "CNY" },
    cards: 1,
    baseline: [{
      sourceId: expect.any(String),
      label: "A股",
      kind: "manual",
      capturedAt: "2026-01-01T08:00:00.000Z",
      complete: true,
      status: "complete",
      total: { USD: null, CNY: "108000", HKD: null },
    }],
    trend: [{
      sourceId: expect.any(String),
      label: "A股",
      kind: "manual",
      capturedAt: "2026-01-01T08:00:00.000Z",
      complete: true,
      status: "complete",
      total: { USD: null, CNY: "108000", HKD: null },
    }],
  });
});
