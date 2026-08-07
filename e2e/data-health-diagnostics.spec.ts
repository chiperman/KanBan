import { expect, test, type CDPSession, type Page } from "@playwright/test";

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

async function configureDataHealth(page: Page): Promise<void> {
  const configured = await page.request.post("/test-doubles/data-health", {
    data: { action: "configure" },
  });
  expect(configured.ok()).toBeTruthy();
}

async function loginWithDataHealthFixture(page: Page): Promise<void> {
  await configureDataHealth(page);
  await loginAsOwner(page);
  await expect(page.getByTestId("asset-refresh-status")).toContainText(
    "来源失败",
  );
  await configureDataHealth(page);
}

async function chooseOption(
  page: Page,
  label: string,
  option: string,
): Promise<void> {
  const control = page.getByRole("button", { name: label });
  await control.click();
  await page.getByRole("option", { name: option }).click();
  await expect(control).toContainText(option);
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

test("数据健康诊断同步、估值与历史缺口，但不提供修复操作", async ({
  page,
}) => {
  await loginWithDataHealthFixture(page);
  await page.goto("/data-health");

  await expect(page.getByRole("heading", { name: "数据健康" })).toBeVisible();
  const diagnostics = page.getByTestId("data-health-diagnostics");
  await expect(diagnostics).toContainText("只读诊断");

  const alpha = page.getByTestId("data-health-source-source-alpha");
  await expect(alpha).toContainText("数据当前");
  await expect(alpha).toContainText("估值完整");
  await expect(alpha).toContainText("最后成功");
  await expect(alpha).toContainText("2026-03-04 20:00");

  const aShares = page.getByTestId("data-health-source-source-a-shares");
  await expect(aShares).toContainText("手工记录");
  await expect(aShares).toContainText("估值完整");
  await expect(aShares).not.toContainText("估值不完整");

  const beta = page.getByTestId("data-health-source-source-beta");
  await expect(beta).toContainText("同步失败");
  await expect(beta).toContainText("数据过期");
  await expect(beta).toContainText("来源暂时不可用");
  await expect(beta).not.toContainText("0.00 USD");

  const unvalued = page.getByTestId("data-health-source-source-unvalued");
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

test("数据健康可按范围、来源与完整性筛选历史，并进入来源详情", async ({
  page,
}) => {
  await loginWithDataHealthFixture(page);
  await page.goto("/data-health");

  const history = page.getByTestId("data-health-history");
  await chooseOption(page, "时间范围", "最近 7 天");
  await chooseOption(page, "来源", "Alpha Securities");
  await expect(history).toContainText("2026-03-03");
  await expect(history).toContainText("数据缺口");
  await expect(history).toContainText("没有 Alpha Securities 观测");

  await chooseOption(page, "完整性", "仅不完整");
  await expect(history).toContainText("数据缺口");
  await expect(history).not.toContainText("2026-03-01 · 完整");

  await chooseOption(page, "来源", "Unknown Wallet");
  await expect(history).toContainText("未估值");
  await expect(history).toContainText("不完整历史");

  const sourceDetail = page.getByRole("link", {
    name: "查看 Beta Crypto 来源详情",
  });
  await sourceDetail.focus();
  await expect(sourceDetail).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/asset-sources\/source-beta$/);
  await expect(page.getByRole("heading", { name: "Beta Crypto" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "刷新 Beta Crypto" }),
  ).toBeVisible();
});

test("数据健康在手机无横向溢出，锁定态不泄露来源或历史", async ({
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

  const range = page.getByRole("button", { name: "时间范围" });
  await range.focus();
  await expect(range).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
});
