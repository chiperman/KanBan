import { expect, test, type CDPSession, type Page } from "@playwright/test";

const LAYOUT_CARDS = [
  { id: "first", kind: "asset", title: "第一张卡片", body: "第一列", span: 1 },
  { id: "second", kind: "asset", title: "第二张卡片", body: "第二列", span: 1 },
  { id: "third", kind: "asset", title: "第三张卡片", body: "第三列", span: 1 },
] as const;

async function loginAsOwner(page: Page): Promise<void> {
  const client: CDPSession = await page.context().newCDPSession(page);
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
  await page.goto("/setup");
  await page.getByRole("button", { name: "创建所有者 Passkey" }).click();
  await expect(page.getByRole("status")).toContainText("已完成预置");
  await page.goto("/");
  await page.getByRole("button", { name: "使用 Passkey 登录" }).click();
  await expect(page.getByTestId("workbench-shell")).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
}

function waitForLayoutSave(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/asset-cards/layout") &&
      response.request().method() === "PUT",
    { timeout: 10_000 },
  );
}

async function reopenLayoutMode(page: Page): Promise<void> {
  await page.reload();
  const enterLayoutMode = page.getByRole("button", { name: "进入布局管理" });
  await expect(enterLayoutMode).toBeVisible();
  await enterLayoutMode.click();
  await expect(
    page.getByRole("button", { name: "退出布局管理" }),
  ).toBeVisible();
}

async function reorderThirdBeforeFirst(page: Page): Promise<void> {
  const source = page.getByTestId("card").filter({ hasText: "第三张卡片" });
  const target = page.getByTestId("card").filter({ hasText: "第一张卡片" });
  const handle = source.getByRole("button", { name: /拖动第三张卡片调整排序/ });
  const handleBox = await handle.boundingBox();
  const targetBox = await target.boundingBox();
  expect(handleBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2,
    handleBox!.y + handleBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2 + 6,
    handleBox!.y + handleBox!.height / 2,
  );
  await expect(source).toHaveClass(/card-dragging/);
  await page.mouse.move(targetBox!.x + 4, targetBox!.y + targetBox!.height / 2, {
    steps: 8,
  });
  await expect(page.getByTestId("layout-drop-slot")).toBeVisible();
  await page.mouse.up();
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
});

test("总览仅保留日常查看和快捷控制，来源摘要不展开持仓或管理操作", async ({
  page,
  request,
}) => {
  const seeded = await request.post("/test-doubles/release-acceptance", {
    data: { action: "seed" },
  });
  expect(seeded.ok()).toBeTruthy();
  await loginAsOwner(page);

  await expect(page.getByTestId("total-overview-card")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "隐藏关键信息" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "进入布局管理" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "立即锁定（退出登录）" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /立即刷新资产/ }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /添加资产来源/ })).toHaveCount(0);
  await expect(
    page.getByRole("searchbox", { name: "搜索全部持仓" }),
  ).toHaveCount(0);
  await expect(page.getByTestId("data-completeness-panel")).toHaveCount(0);
  await expect(page.getByText("NVIDIA", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /隐藏.*资产|管理.*资产/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /拖动.*调整排序/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /调整.*宽度/ })).toHaveCount(0);

  const overviewGeometry = await page.evaluate(() => {
    const totalOverview = document.querySelector<HTMLElement>(
      '[data-testid="total-overview-card"]',
    );
    const trend = document.querySelector<HTMLElement>(
      '[data-testid="total-asset-trend"]',
    );
    if (!totalOverview || !trend) return null;
    const totalOverviewTop = totalOverview.getBoundingClientRect().top;
    return trend.getBoundingClientRect().top - totalOverviewTop;
  });
  expect(overviewGeometry).not.toBeNull();
  expect(overviewGeometry!).toBeLessThan(1_200);

  await expect(
    page
      .getByTestId("card")
      .filter({ hasText: "Binance" })
      .locator(".overview-card-summary-amount"),
  ).toHaveText(/\d{1,3}(?:,\d{3})*\.\d{2} USD/);
});

test("布局管理模式以键盘可达入口即时保存排序、宽度、换行和隐藏，并在重开后保持", async ({
  page,
  request,
}) => {
  await request.post("/test-doubles/asset-cards", {
    data: { assetCards: LAYOUT_CARDS },
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAsOwner(page);

  const enterLayoutMode = page.getByRole("button", { name: "进入布局管理" });
  await enterLayoutMode.focus();
  await expect(enterLayoutMode).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "退出布局管理" }),
  ).toBeVisible();

  const savedOrder = waitForLayoutSave(page);
  await reorderThirdBeforeFirst(page);
  await savedOrder;
  await reopenLayoutMode(page);
  await expect(page.getByTestId("card").first()).toContainText("第三张卡片");

  const third = page.getByTestId("card").filter({ hasText: "第三张卡片" });
  const thirdWidth = third.getByRole("button", {
    name: /调整第三张卡片宽度/,
  });
  await expect(thirdWidth).toBeEnabled();
  const savedWidth = waitForLayoutSave(page);
  await thirdWidth.press("ArrowRight");
  await savedWidth;
  await reopenLayoutMode(page);
  const thirdAfterReload = page.getByTestId("card").filter({
    hasText: "第三张卡片",
  });
  await expect(thirdAfterReload).toHaveClass(/span-2/);

  const first = page.getByTestId("card").filter({ hasText: "第一张卡片" });
  const firstRowBreak = first.getByRole("button", {
    name: "强制第一张卡片换行",
  });
  await expect(firstRowBreak).toBeEnabled();
  const savedRowBreak = waitForLayoutSave(page);
  await firstRowBreak.click();
  await savedRowBreak;
  await reopenLayoutMode(page);
  const firstAfterReload = page.getByTestId("card").filter({
    hasText: "第一张卡片",
  });
  await expect(firstAfterReload).toHaveClass(/starts-new-row/);

  const second = page.getByTestId("card").filter({ hasText: "第二张卡片" });
  const savedHidden = waitForLayoutSave(page);
  await second.getByRole("button", { name: "隐藏第二张卡片" }).click();
  await savedHidden;

  await page.reload();
  await expect(page.getByRole("button", { name: "进入布局管理" })).toBeVisible();
  await expect(page.getByTestId("card").first()).toContainText("第三张卡片");
  await expect(third).toHaveClass(/span-2/);
  await expect(
    page.getByTestId("card").filter({ hasText: "第一张卡片" }),
  ).toHaveClass(/starts-new-row/);
  await expect(
    page.getByTestId("card").filter({ hasText: "第二张卡片" }),
  ).toHaveCount(0);
});

test("手机总览可明确进入和退出布局管理，且无横向溢出", async ({
  page,
  request,
}) => {
  await request.post("/test-doubles/asset-cards", {
    data: { assetCards: LAYOUT_CARDS },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsOwner(page);

  const enterLayoutMode = page.getByRole("button", { name: "进入布局管理" });
  await enterLayoutMode.focus();
  await expect(enterLayoutMode).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "退出布局管理" }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.keyboard.press("Enter");
  await expect(enterLayoutMode).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("手机总览默认及布局管理时保留分布和趋势", async ({
  page,
  request,
}) => {
  const seeded = await request.post("/test-doubles/release-acceptance", {
    data: { action: "seed" },
  });
  expect(seeded.ok()).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsOwner(page);

  const distribution = page.getByLabel("资产分布");
  const trend = page.getByTestId("total-asset-trend");
  await expect(distribution).toBeVisible();
  await expect(trend).toBeVisible();
  await expect(
    page.getByRole("button", { name: /总资产详情/ }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "进入布局管理" }).click();
  await expect(distribution).toBeVisible();
  await expect(trend).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
