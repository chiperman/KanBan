import { expect, test, type Page } from "@playwright/test";
import { loginAsOwner } from "../owner-auth-helpers";

async function configureDataHealth(page: Page): Promise<void> {
  const configured = await page.request.post("/test-doubles/data-health", {
    data: { action: "configure" },
  });
  expect(configured.ok()).toBeTruthy();
}

async function loginWithDataHealthFixture(page: Page): Promise<void> {
  await configureDataHealth(page);
  await loginAsOwner(page);
  await configureDataHealth(page);
}

async function chooseOption(
  page: Page,
  label: string,
  option: string,
): Promise<void> {
  const control = page
    .getByTestId("data-health-history")
    .getByRole("button", { name: label });
  await control.click();
  await page.getByRole("option", { name: option }).click();
  await expect(control).toContainText(option);
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(control).toBeFocused();
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
});

test("资产来源统一列出账户、优先显示异常并按需展开诊断", async ({
  page,
}, testInfo) => {
  await loginWithDataHealthFixture(page);
  await page.goto("/data-health");

  await expect(page).toHaveURL(/\/asset-sources#history-coverage$/);
  await page.goto("/asset-sources");
  await expect(page.getByRole("heading", { name: "资产来源" })).toBeVisible();
  const diagnostics = page.getByTestId("data-health-diagnostics");
  const sourceRows = diagnostics.locator('[data-testid^="data-health-source-"]');
  await expect(sourceRows).toHaveCount(5);
  await expect(sourceRows.nth(0)).toContainText("Beta Crypto");
  await expect(sourceRows.nth(1)).toContainText("Unknown Wallet");

  const alpha = page.getByTestId("data-health-source-source-alpha");
  await expect(alpha).toBeVisible();
  await expect(alpha.getByRole("link")).toHaveCount(1);
  await expect(alpha).toContainText("2026-03-04 20:00");
  await expect(alpha.getByRole("button", { name: /^查看 .* 异常$/ })).toHaveCount(0);

  const aShares = page.getByTestId("data-health-source-source-a-shares");
  await expect(aShares).toContainText("手工记录");
  await expect(aShares).not.toContainText("估值不完整");

  const beta = page.getByTestId("data-health-source-source-beta");
  await expect(beta).toContainText("同步失败");
  await expect(beta).toContainText("数据过期");
  await page.screenshot({ path: testInfo.outputPath("asset-sources-desktop.png"), fullPage: true });
  await expect(beta.getByText("上次同步失败：来源暂时不可用", { exact: true })).toBeHidden();
  await beta.getByRole("button", { name: "查看 Beta Crypto 异常" }).click();
  await expect(beta).toContainText("来源暂时不可用");
  await expect(beta).not.toContainText("0.00 USD");

  const unvalued = page.getByTestId("data-health-source-source-unvalued");
  await unvalued.getByRole("button", { name: "查看 Unknown Wallet 异常" }).click();
  await expect(unvalued).toContainText("未估值");
  await expect(unvalued).toContainText("来源没有可靠价格");
  await expect(unvalued).toContainText("估值不完整");
  await expect(unvalued).not.toContainText("0.00 USD");

  await expect(diagnostics).not.toContainText("自动修复");
  await expect(diagnostics).not.toContainText("调度");
  await expect(diagnostics).not.toContainText("通知");
  await expect(
    diagnostics.getByRole("button", { name: /刷新|修复|断开|删除/ }),
  ).toHaveCount(0);
});

test("来源历史默认收起并只显示异常，可按范围、来源和完整性筛选", async ({
  page,
}) => {
  await loginWithDataHealthFixture(page);
  await page.goto("/data-health");

  const history = page.getByTestId("data-health-history");
  await expect(history.getByRole("button", { name: "时间范围" })).toBeHidden();
  await history.getByRole("button", { name: "查看历史覆盖" }).click();
  await expect(history.getByRole("button", { name: "时间范围" })).toContainText("最近 30 天");
  await expect(history.getByRole("button", { name: "完整性" })).toContainText("仅不完整");
  await chooseOption(page, "时间范围", "最近 7 天");
  await chooseOption(page, "来源", "Alpha Securities");
  await expect(history).toContainText("2026-03-03");
  await expect(history).toContainText("数据缺口");
  await expect(history).toContainText("没有 Alpha Securities 观测");

  await expect(history).toContainText("数据缺口");
  await expect(history).not.toContainText("2026-03-01 · 完整");

  await chooseOption(page, "完整性", "全部状态");
  await expect(history).toContainText("2026-03-01 · 完整");
  await chooseOption(page, "完整性", "仅不完整");

  await chooseOption(page, "来源", "Unknown Wallet");
  await expect(history).toContainText("未估值");
  await expect(history).toContainText("不完整历史");

  const sourceDetail = page.getByTestId("data-health-source-source-beta").getByRole("link");
  await sourceDetail.focus();
  await expect(sourceDetail).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/asset-sources\/source-beta$/);
  await expect(page.getByRole("heading", { name: "Beta Crypto" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "刷新 Beta Crypto" }),
  ).toBeVisible();
});

test("单来源刷新失败保留最后成功数据，并提供可理解的重试", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await loginWithDataHealthFixture(page);
  await page.goto("/asset-sources/source-beta");

  const sourceTotal = page.getByTestId("asset-source-total");
  await expect(sourceTotal).toHaveText("200.00 USD");
  const totalBeforeRefresh = await sourceTotal.innerText();
  let refreshAttempts = 0;
  await page.route("**/api/asset-sources/refresh", async (route) => {
    refreshAttempts += 1;
    if (refreshAttempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "网络暂时不可用" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        successCount: 1,
        failureCount: 0,
        sources: [],
      }),
    });
  });

  const refresh = page.getByRole("button", { name: "刷新 Beta Crypto" });
  await refresh.click();
  const status = page.getByTestId(
    "asset-source-refresh-status-source-beta",
  );
  await expect(status).toHaveText("刷新失败");
  await expect(status).toHaveAttribute("title", "网络暂时不可用");
  await expect(refresh).toBeEnabled();
  await expect(sourceTotal).toHaveText(totalBeforeRefresh);

  await refresh.click();
  await expect(status).toContainText("刷新完成");
  await expect(sourceTotal).toHaveText(totalBeforeRefresh);
  expect(refreshAttempts).toBe(2);
});

test("全局刷新成功后自动收起状态提示", async ({ page }) => {
  await loginWithDataHealthFixture(page);

  await page.route("**/api/asset-sources/refresh", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        successCount: 1,
        failureCount: 0,
        sources: [],
      }),
    });
  });

  const refresh = page.getByRole("button", { name: "立即刷新资产" });
  const status = page.getByTestId("asset-refresh-status");
  await refresh.click();
  await expect(status).toContainText("刷新完成");
  await expect(status).toHaveClass(/is-visible/);
  await expect(status).toBeHidden({ timeout: 3_000 });
});

test("来源诊断在手机无横向溢出，锁定态不泄露来源或历史", async ({
  page,
}) => {
  await page.goto("/data-health");
  await expect(page).toHaveURL("/");
  await expect(page.getByTestId("data-health-diagnostics")).toHaveCount(0);
  expect(await page.content()).not.toContain("Alpha Securities");
  expect(await page.content()).not.toContain("2026-03-03");

  await page.setViewportSize({ width: 390, height: 844 });
  await loginWithDataHealthFixture(page);
  await page.goto("/data-health");
  await expect(page.getByTestId("data-health-diagnostics")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const history = page.getByTestId("data-health-history");
  await history.getByRole("button", { name: "查看历史覆盖" }).focus();
  await page.keyboard.press("Enter");
  await expectNoHorizontalOverflow(page);

  const range = page.getByRole("button", { name: "时间范围" });
  await range.focus();
  await expect(range).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
});
