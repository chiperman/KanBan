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
  await expect(page.getByRole("status")).toContainText("预置完成");
  await page.goto("/");
  await page.getByRole("button", { name: "使用 Passkey 登录" }).click();
  await expect(page.getByTestId("workbench-shell")).toBeVisible();
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
  await request.post("/test-doubles/data-health", {
    data: { action: "configure" },
  });
});

test("设置与安全集中低频入口，计价货币属于总览且隐私开关全局可用", async ({
  page,
}) => {
  await loginAsOwner(page);
  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "设置与安全" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "登录保护" })).toBeVisible();
  await expect(page.getByText("唯一所有者 Passkey 已启用")).toBeVisible();
  await expect(page.getByRole("heading", { name: "TOTP 登录" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "备份与恢复" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "本机数据" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "默认偏好" })).toBeVisible();
  await expect(page.getByRole("button", { name: "导出业务数据备份" })).toBeVisible();
  await expect(page.getByLabel("要恢复的本机备份文件名")).toBeVisible();
  await expect(
    page.getByText("资金账本及对应的长桥参考汇率观察", { exact: false }),
  ).toBeVisible();

  await expect(page.getByLabel("计价货币")).toHaveCount(0);
  await expect(page.getByTestId("global-sensitive-info-toggle")).toBeVisible();

  await page.goto("/");
  await expect(page.getByLabel("计价货币")).toBeVisible();
  await expect(page.getByTestId("global-sensitive-info-toggle")).toBeVisible();
});

test("备份与恢复入口不回显外部来源凭证，且可用键盘预演恢复", async ({
  page,
}) => {
  await loginAsOwner(page);
  await page.goto("/settings");

  const security = await page.request.post(
    "/test-doubles/credential-free-backup-restore?action=export-security",
  );
  expect(security.ok()).toBeTruthy();
  await expect(security.json()).resolves.toMatchObject({
    credentialFieldsFound: [],
    credentialValuesFound: [],
  });

  const exportBackup = page.getByRole("button", {
    name: "导出业务数据备份",
  });
  await exportBackup.focus();
  await expect(exportBackup).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("已导出本机备份");
  await expect(page.locator("body")).not.toContainText("opaque-secret-reference");

  const previewRestore = page.getByRole("button", { name: "预演恢复" });
  await previewRestore.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("将恢复", { exact: false })).toBeVisible();

  const restore = page.getByRole("button", { name: "恢复此业务数据备份" });
  await restore.focus();
  await expect(restore).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "确认恢复业务数据" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(restore).toBeFocused();

  await page.keyboard.press("Enter");
  const confirmRestore = page.getByRole("button", { name: "确认恢复" });
  await confirmRestore.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("status").filter({ hasText: "已恢复业务数据" }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "资金账本" }),
  ).toBeVisible();
});

test("旧备份明确展示丢弃范围，只有确认后才发送丢弃凭据", async ({ page }) => {
  await loginAsOwner(page);
  await page.goto("/settings");
  const requests: Array<{action: string; discardConfirmation?: string}> = [];
  // This verifies the confirmation UI contract; real decoding/restore uses the SQLite suite.
  await page.route("**/api/business-data-backups", async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    await route.fulfill({ json: { sourceCount: 1, cardCount: 1, snapshotRange: { from: null, to: null }, replaces: { sourceCount: 2, cardCount: 2, snapshotCount: 3 }, warning: "敏感资产数据", omittedHistory: { manualAssetRecords: 7, formalDailySettlements: 9 }, discardConfirmation: "isolated-confirmation" } });
  });
  await page.getByLabel("备份文件名").fill("legacy.json");
  await page.getByRole("button", { name: "预演恢复" }).click();
  await page.getByRole("button", { name: "恢复此业务数据备份" }).click();
  const dialog = page.getByRole("dialog", { name: "确认恢复业务数据" });
  await expect(dialog).toContainText("7 条手工记录、9 条正式日结");
  expect(requests.map((request) => request.action)).toEqual(["preview"]);
  await page.keyboard.press("Escape");
  expect(requests).toHaveLength(1);
  await page.getByRole("button", { name: "恢复此业务数据备份" }).click();
  await dialog.getByRole("button", { name: "确认恢复" }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toMatchObject({ action: "restore", discardConfirmation: "isolated-confirmation" });
});

test("设置与安全在锁定态不泄露内容，手机端保持键盘可用且无横向溢出", async ({
  page,
}) => {
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("workbench-shell")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "设置与安全" })).toHaveCount(0);
  expect(await page.content()).not.toContain("Alpha Securities");

  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsOwner(page);
  await page.goto("/settings");
  await expectNoHorizontalOverflow(page);

  const settingsLink = page
    .getByTestId("workbench-mobile-navigation")
    .getByRole("link", { name: "设置与安全" });
  await settingsLink.focus();
  await expect(settingsLink).toBeFocused();
  await expect(settingsLink).toHaveCSS("outline-style", "solid");

  const configureRecovery = page.getByRole("button", {
    name: "配置 TOTP 登录",
  });
  await configureRecovery.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "配置 TOTP 登录" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(configureRecovery).toBeFocused();
});
