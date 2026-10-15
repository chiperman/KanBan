import { expect, test } from "@playwright/test";

import { loginAsOwner } from "../owner-auth-helpers";

const ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
});

test("新增来源页面返回保留草稿，取消后重新进入会清空", async ({ page }) => {
  await loginAsOwner(page);
  await page.goto("/asset-sources");
  await page.getByRole("link", { name: "新增来源" }).click();
  const flow = page.getByRole("region", { name: "新增资产来源", exact: true });
  await expect(page).toHaveURL("/asset-sources/new");
  await expect(flow.getByRole("heading", { name: "选择来源类型" })).toBeVisible();
  await expect(flow.getByLabel("EVM 公开地址（每行一个）")).toHaveCount(0);
  await flow.getByRole("radio", { name: "EVM 观察钱包" }).click();
  await expect(flow.getByRole("heading", { name: "填写公开地址" })).toBeVisible();
  await expect(flow.getByRole("radio")).toHaveCount(0);
  const addressField = flow.getByLabel("EVM 公开地址（每行一个）");
  await expect(flow.getByRole("checkbox", { name: "Ethereum 观察钱包" })).toBeChecked();
  await expect(flow.getByRole("checkbox", { name: "BNB Smart Chain 观察钱包" })).toBeChecked();
  await addressField.fill(ADDRESS);
  await flow.getByRole("button", { name: "上一步" }).click();
  await expect(flow.getByRole("heading", { name: "选择来源类型" })).toBeVisible();
  await flow.getByRole("radio", { name: "EVM 观察钱包" }).click();
  await expect(addressField).toHaveValue(ADDRESS);
  await flow.getByRole("button", { name: "上一步" }).click();
  await flow.getByRole("button", { name: "取消" }).click();
  await expect(page).toHaveURL("/asset-sources");
  await page.getByRole("link", { name: "新增来源" }).click();
  await flow.getByRole("radio", { name: "EVM 观察钱包" }).click();
  await expect(addressField).toHaveValue("");
});

test("新增来源页面可用键盘选择类型、返回并取消导航", async ({ page }) => {
  await loginAsOwner(page);
  await page.goto("/asset-sources/new");
  const flow = page.getByRole("region", { name: "新增资产来源", exact: true });
  const provider = flow.getByRole("radio", { name: "EVM 观察钱包" });
  await provider.focus();
  await expect(provider).toBeFocused();
  await page.keyboard.press("Space");
  const back = flow.getByRole("button", { name: "上一步" });
  await back.focus();
  await page.keyboard.press("Enter");
  await expect(provider).toBeVisible();
  await flow.getByRole("button", { name: "取消" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/asset-sources");
  await expect(page.getByRole("link", { name: "新增来源" })).toBeVisible();
});

test("验证只读凭证时明确显示进行态且禁用态不响应悬停", async ({ page }) => {
  const configured = await page.request.post("/test-doubles/binance", { data: { scenario: "valid" } });
  expect(configured.ok()).toBeTruthy();
  await loginAsOwner(page);
  let releasePreview: (() => void) | undefined;
  const previewGate = new Promise<void>((resolve) => { releasePreview = resolve; });
  await page.route("**/api/asset-sources/binance/preview", async (route) => {
    await previewGate;
    await route.continue();
  });
  await page.goto("/asset-sources/new");
  const flow = page.getByRole("region", { name: "新增资产来源", exact: true });
  await flow.getByRole("radio", { name: "Binance" }).click();
  await flow.getByLabel("Binance API Key").fill("test-api-key");
  await flow.getByLabel("Binance API Secret").fill("test-api-secret");
  await flow.getByRole("button", { name: "验证只读凭证" }).click();
  const pendingButton = flow.getByRole("button", { name: "正在校验…" });
  await expect(pendingButton).toBeDisabled();
  await expect(pendingButton).toHaveAttribute("aria-busy", "true");
  await expect(pendingButton).toHaveCSS("opacity", "0.3");
  await pendingButton.hover();
  await expect(pendingButton).toHaveCSS("opacity", "0.3");
  releasePreview?.();
  await expect(flow.getByRole("heading", { name: "校验与范围预览" })).toBeVisible();
});

test("移动端来源配置使用独立页面，设置与全局操作保持可访问", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsOwner(page);
  await expect(page.getByRole("button", { name: "立即锁定（退出登录）" })).toBeVisible();
  await expect(page.getByRole("button", { name: "打开快捷命令" })).toBeVisible();
  await page.getByTestId("workbench-mobile-navigation").getByRole("link", { name: "设置与安全" }).click();
  await expect(page).toHaveURL("/settings");
  await expect(page.getByRole("heading", { name: "设置与安全" })).toBeVisible();
  await page.goto("/asset-sources/new");
  await page.getByRole("radio", { name: "Binance" }).click();
  const flow = page.getByRole("region", { name: "新增资产来源", exact: true });
  await expect(flow.getByLabel("Binance API Key")).toBeVisible();
  for (const control of [flow.getByLabel("Binance API Key"), flow.getByRole("button", { name: "验证只读凭证" })]) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test("宽屏总览与独立来源页面使用统一工作区宽度", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const seeded = await page.request.post("/test-doubles/release-acceptance", { data: { action: "seed" } });
  expect(seeded.ok()).toBeTruthy();
  await loginAsOwner(page);
  const overview = await page.getByTestId("portfolio-overview-workspace").boundingBox();
  expect(overview!.width).toBeGreaterThanOrEqual(1200);
  await expect(page.getByTestId("overview-source-summary")).toBeVisible();
  await page.goto("/asset-sources/new");
  const flow = await page.getByRole("region", { name: "新增资产来源", exact: true }).boundingBox();
  expect(flow!.width).toBe(overview!.width);
  expect(flow!.x).toBeGreaterThanOrEqual(0);
  expect(flow!.x + flow!.width).toBeLessThanOrEqual(1920);
});
