import { expect, test, type Page } from "@playwright/test";

const ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

async function loginAsOwner(page: Page): Promise<void> {
  const client = await page.context().newCDPSession(page);
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
  await expect(page.getByTestId("view-mode")).toContainText("所有者视图");
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
});

test("添加来源先选择类型再配置，返回保留草稿而取消会清空", async ({ page }) => {
  await loginAsOwner(page);
  await page.getByRole("button", { name: "添加资产来源" }).click();

  const dialog = page.getByRole("dialog", { name: "添加资产来源" });
  await expect(dialog).toHaveAttribute("data-vibe-component", "modal");
  await expect(dialog.getByRole("heading", { name: "选择来源类型" })).toBeVisible();
  await expect(dialog.getByLabel("EVM 公开地址（每行一个）")).toHaveCount(0);

  await dialog.getByRole("radio", { name: "EVM 观察钱包" }).click();
  await expect(dialog.getByRole("heading", { name: "EVM 观察钱包" })).toBeVisible();
  await expect(dialog.getByRole("radio")).toHaveCount(0);

  const addressField = dialog.getByLabel("EVM 公开地址（每行一个）");
  await expect(dialog.getByRole("checkbox", { name: "Ethereum 观察钱包" })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "BNB Smart Chain 观察钱包" })).toBeChecked();
  await addressField.fill(ADDRESS);
  await dialog.getByRole("button", { name: "返回来源列表" }).click();
  await expect(dialog.getByRole("heading", { name: "选择来源类型" })).toBeVisible();

  await dialog.getByRole("radio", { name: "EVM 观察钱包" }).click();
  await expect(addressField).toHaveValue(ADDRESS);
  await dialog.getByRole("button", { name: "取消" }).click();

  await page.getByRole("button", { name: "添加资产来源" }).click();
  await expect(dialog.getByRole("heading", { name: "选择来源类型" })).toBeVisible();
  await dialog.getByRole("radio", { name: "EVM 观察钱包" }).click();
  await expect(dialog.getByLabel("EVM 公开地址（每行一个）")).toHaveValue("");
});

test("来源 Dialog 打开后捕获焦点，Escape 关闭并恢复触发按钮", async ({ page }) => {
  await loginAsOwner(page);
  const trigger = page.getByRole("button", { name: "添加资产来源" });
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: "添加资产来源" });
  const firstProvider = dialog.getByRole("radio").first();
  const cancel = dialog.getByRole("button", { name: "取消" });
  await expect(firstProvider).toBeFocused();

  await page.keyboard.press("Shift+Tab");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(firstProvider).toBeFocused();

  await dialog.getByRole("radio", { name: "EVM 观察钱包" }).click();
  await expect(
    dialog.getByRole("button", { name: "返回来源列表" }),
  ).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("验证只读凭证时明确显示进行态且禁用态不响应悬停", async ({ page }) => {
  const configured = await page.request.post("/test-doubles/binance", {
    data: { scenario: "valid" },
  });
  expect(configured.ok()).toBeTruthy();
  await loginAsOwner(page);

  let releasePreview: (() => void) | undefined;
  const previewGate = new Promise<void>((resolve) => {
    releasePreview = resolve;
  });
  await page.route("**/api/asset-sources/binance/preview", async (route) => {
    await previewGate;
    await route.continue();
  });

  await page.getByRole("button", { name: "添加资产来源" }).click();
  const dialog = page.getByRole("dialog", { name: "添加资产来源" });
  await dialog.getByRole("radio", { name: "Binance" }).click();
  await dialog.getByLabel("Binance API Key").fill("test-api-key");
  await dialog.getByLabel("Binance API Secret").fill("test-api-secret");
  await dialog.getByRole("button", { name: "验证只读凭证" }).click();

  const pendingButton = dialog.getByRole("button", {
    name: "正在验证只读凭证…",
  });
  await expect(pendingButton).toBeDisabled();
  await expect(pendingButton).toHaveAttribute("aria-busy", "true");
  await pendingButton.hover();
  await expect(pendingButton).toHaveCSS("opacity", "1");

  releasePreview?.();
  await expect(
    page.getByRole("dialog", { name: "确认 Binance 资产来源" }),
  ).toBeVisible();
});

test("移动端来源配置采用全屏 sheet，页头次要操作收进本机设置", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsOwner(page);

  await expect(page.getByText("EXTERNAL ACCESS / READ ONLY")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "立即锁定（退出登录）" })).toBeVisible();
  await expect(page.getByRole("button", { name: "本机设置" })).toBeVisible();
  await expect(page.getByRole("button", { name: "打开快捷命令" })).toBeHidden();

  await page.getByRole("button", { name: "本机设置" }).click();
  await expect(page.getByRole("link", { name: "本机设置" })).toBeVisible();
  await expect(page.getByRole("button", { name: "打开快捷命令" })).toBeVisible();
  await expect(page.getByRole("button", { name: "配置备用登录" })).toHaveCount(0);

  await page.getByRole("button", { name: "添加资产来源" }).click();
  const dialog = page.getByRole("dialog", { name: "添加资产来源" });
  await dialog.getByRole("radio", { name: "Binance" }).click();

  const sheet = dialog.locator(".source-dialog");
  const box = await sheet.boundingBox();
  expect(box).toMatchObject({ x: 0, y: 0, width: 390, height: 844 });
  await expect(dialog.locator(".vibe-dialog__header")).toHaveCSS("position", "sticky");
  await expect(dialog.locator(".vibe-dialog__footer")).toHaveCSS("position", "sticky");
});

test("宽屏扩展来源工作区但约束总览阅读宽度", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const seeded = await page.request.post("/test-doubles/release-acceptance", {
    data: { action: "seed" },
  });
  expect(seeded.ok()).toBeTruthy();
  await loginAsOwner(page);

  const pageWidth = await page.locator(".page-dashboard").evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  const overviewWidth = await page.getByTestId("total-overview-card").evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  expect(pageWidth).toBeGreaterThanOrEqual(1560);
  expect(overviewWidth).toBeLessThanOrEqual(1280);
  expect(pageWidth - overviewWidth).toBeGreaterThanOrEqual(240);
});
