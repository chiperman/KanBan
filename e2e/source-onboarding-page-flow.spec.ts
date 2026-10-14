import { expect, test, type Page } from "@playwright/test";

import {
  expectCompleteHistory,
  prepareCompleteHistory,
} from "./history-observation-helpers";

const API_KEY = "ticket-04-binance-key";
const API_SECRET = "ticket-04-binance-secret-must-not-leak";
const ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const OTHER_ADDRESS = "0x1111111111111111111111111111111111111111";

async function loginAsOwner(page: Page): Promise<void> {
  const response = await page.request.post("/test-doubles/owner-session");
  expect(response.ok()).toBeTruthy();
  await page.goto("/asset-sources");
  await expect(page.getByTestId("workbench-shell")).toBeVisible();
}

async function selectBinance(page: Page): Promise<void> {
  await page.getByRole("radio", { name: "Binance" }).click();
  await page.getByLabel("Binance API Key").fill(API_KEY);
  await page.getByLabel("Binance API Secret").fill(API_SECRET);
}

async function binanceState(page: Page) {
  return (await (await page.request.get("/test-doubles/binance")).json()) as {
    savedSources: number;
    savedSecrets: number;
  };
}

async function ethereumState(page: Page) {
  return (await (await page.request.get("/test-doubles/ethereum")).json()) as {
    savedSources: number;
    savedSecrets: number;
    sources: Array<{ id: string; kind: string; lifecycle: string }>;
    cards: Array<{ sourceId: string; hidden: boolean }>;
    snapshotSourceIds: string[];
  };
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
});

test("资产来源页通过独立步骤页完成只读验证、预览与保存，不泄露凭证", async ({
  page,
}) => {
  const configured = await page.request.post("/test-doubles/binance", {
    data: { scenario: "valid" },
  });
  expect(configured.ok()).toBeTruthy();
  await loginAsOwner(page);

  await page.getByRole("link", { name: "新增来源" }).click();
  await expect(page).toHaveURL("/asset-sources/new");
  await expect(page.getByRole("heading", { name: "新增资产来源" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await selectBinance(page);
  await expect(page.getByRole("heading", { name: "填写只读授权" })).toBeVisible();
  await page.getByRole("button", { name: "验证只读凭证" }).click();

  await expect(page.getByRole("heading", { name: "校验与范围预览" })).toBeVisible();
  await expect(page.getByText("现货、资金、Simple Earn（只读）")).toBeVisible();
  expect(await binanceState(page)).toEqual({ savedSources: 0, savedSecrets: 0 });
  await expect(page.locator("body")).not.toContainText(API_SECRET);

  await page.getByRole("button", { name: "确认并保存" }).click();
  await expect(page).toHaveURL("/asset-sources");
  const source = page.getByRole("link", { name: /Binance.*自动账户/ });
  await expect(source).toBeVisible();
  expect(await binanceState(page)).toEqual({ savedSources: 1, savedSecrets: 1 });
  await expect(page.locator("body")).not.toContainText(API_SECRET);

  await source.click();
  await expect(page).toHaveURL(/\/asset-sources\/[^/]+$/);
  const sourceDetailUrl = page.url();
  await page.getByRole("link", { name: "更换授权 / 重新授权" }).click();
  await expect(page.getByLabel("Binance API Key")).toHaveValue("");
  await expect(page.getByLabel("Binance API Secret")).toHaveValue("");
  await page.getByLabel("Binance API Key").fill(API_KEY);
  await page.getByLabel("Binance API Secret").fill(API_SECRET);
  await page.getByRole("button", { name: "验证只读凭证" }).click();
  await page.getByRole("button", { name: "确认更新授权" }).click();
  await expect(page).toHaveURL(sourceDetailUrl);
  expect(await binanceState(page)).toEqual({ savedSources: 1, savedSecrets: 1 });
  await expect(page.locator("body")).not.toContainText(API_SECRET);
});

test("写权限校验失败不创建来源或保存凭证", async ({ page }) => {
  const configured = await page.request.post("/test-doubles/binance", {
    data: { scenario: "trade" },
  });
  expect(configured.ok()).toBeTruthy();
  await loginAsOwner(page);
  await page.getByRole("link", { name: "新增来源" }).click();
  await selectBinance(page);

  await page.getByRole("button", { name: "验证只读凭证" }).click();
  await expect(page.locator(".asset-source-flow__notice[role=alert]")).toContainText("写权限");
  expect(await binanceState(page)).toEqual({ savedSources: 0, savedSecrets: 0 });
  await expect(page.locator("body")).not.toContainText(API_SECRET);
});

test("手工资产也通过独立流程创建，且不伪造凭证、持仓或同步", async ({
  page,
}) => {
  await loginAsOwner(page);
  await page.getByRole("link", { name: "新增来源" }).click();
  await page.getByRole("radio", { name: "手工记录资产" }).click();
  await expect(page.getByRole("heading", { name: "填写来源名称" })).toBeVisible();
  await page.getByLabel("资产名称").fill("私募基金");
  await page.getByRole("button", { name: "查看确认" }).click();

  await expect(
    page.getByRole("heading", { name: "确认手工来源" }),
  ).toBeVisible();
  await expect(page.getByText("无凭证来源", { exact: true })).toBeVisible();
  await expect(page.getByText("仅记录总额", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认创建来源" }).click();

  await expect(page).toHaveURL("/asset-sources");
  await page.getByRole("link", { name: /私募基金.*手工资产记录.*无凭证/ }).click();
  await expect(page.getByRole("heading", { name: "私募基金" })).toBeVisible();
  await expect(page.getByText("只读授权摘要", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /刷新 私募基金/ })).toHaveCount(0);
});

test("观察钱包重新授权只接受同一公开地址，并保留来源、快照和卡片", async ({
  page,
}) => {
  const configured = await page.request.post("/test-doubles/ethereum", {
    data: { scenario: "valid" },
  });
  expect(configured.ok()).toBeTruthy();
  await loginAsOwner(page);
  await page.getByRole("link", { name: "新增来源" }).click();
  await page.getByRole("radio", { name: "EVM 观察钱包" }).click();
  await page.getByRole("checkbox", { name: "BNB Smart Chain 观察钱包" }).uncheck();
  await page.getByLabel("EVM 公开地址（每行一个）").fill(ADDRESS);
  await page.getByRole("button", { name: "验证公开地址" }).click();
  await page.getByRole("button", { name: "确认并保存" }).click();

  await expect(page).toHaveURL("/asset-sources");
  const original = (await ethereumState(page)).sources.find(({ kind }) => kind === "evm-watch-ethereum")!;
  const stable = await page.request.post("/test-doubles/ethereum", {
    data: { scenario: "refresh-passthrough" },
  });
  expect(stable.ok()).toBeTruthy();
  const historyBefore = await prepareCompleteHistory(page.request, [original.id]);
  const before = await ethereumState(page);
  expect(before.snapshotSourceIds).toContain(original.id);
  await page.getByRole("link", { name: /Ethereum 观察钱包.*观察钱包/ }).click();
  await page.getByRole("link", { name: "更换授权 / 重新授权" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/asset-sources/${encodeURIComponent(original.id)}/reauthorize$`),
  );
  await expect(page.getByRole("heading", { name: "重新授权 Ethereum 观察钱包" })).toBeVisible();
  await expect(page.getByLabel(/私钥|助记词|MPC|签名/)).toHaveCount(0);

  await page.getByLabel("Ethereum 公开地址（每行一个）").fill(OTHER_ADDRESS);
  await page.getByRole("button", { name: "验证公开地址" }).click();
  await expect(page.locator(".asset-source-flow__notice[role=alert]")).toContainText(
    "与此来源不一致",
  );
  expect((await ethereumState(page)).sources).toEqual([
    expect.objectContaining({ id: original.id, lifecycle: "connected" }),
  ]);

  await page.getByLabel("Ethereum 公开地址（每行一个）").fill(ADDRESS);
  await page.getByRole("button", { name: "验证公开地址" }).click();
  await expect(page.getByRole("heading", { name: "校验与范围预览" })).toBeVisible();
  await page.getByRole("button", { name: "确认更新授权" }).click();
  await expect(page).toHaveURL(`/asset-sources/${encodeURIComponent(original.id)}`);

  const after = await ethereumState(page);
  expect(after.sources).toEqual([
    expect.objectContaining({ id: original.id, lifecycle: "connected" }),
  ]);
  expect(after.cards).toEqual([
    expect.objectContaining({ sourceId: original.id }),
  ]);
  expect(after.snapshotSourceIds).toContain(original.id);
  expect(after.sources).toEqual(before.sources);
  expect(after.cards).toEqual(before.cards);
  expect(after.savedSources).toBe(before.savedSources);
  expect(after.savedSecrets).toBe(before.savedSecrets);
  expect(await expectCompleteHistory(page.request, [original.id])).toEqual(historyBefore);
  await expect(page.locator("body")).not.toContainText(/OAuth Token|TOTP|API Secret/);
});

test("锁定状态不暴露独立接入页；手机可用键盘进入且无横向溢出", async ({
  page,
}) => {
  await page.goto("/asset-sources/new");
  await expect(page).toHaveURL("/");
  await expect(page.getByTestId("workbench-shell")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "新增资产来源" })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsOwner(page);
  const addSource = page.getByRole("link", { name: "新增来源" });
  await addSource.focus();
  await expect(addSource).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/asset-sources/new");
  const provider = page.getByRole("radio", { name: "手工记录资产" });
  await provider.focus();
  await expect(provider).toBeFocused();
  await page.keyboard.press(" ");
  await expect(page.getByRole("heading", { name: "填写来源名称" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
});
