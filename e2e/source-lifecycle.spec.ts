import {
  expect,
  test,
  type CDPSession,
  type Locator,
  type Page,
} from "@playwright/test";

import { confirmSourceFlow, openSourceFlow } from "./source-flow-helpers";
import {
  expectCompleteHistory,
  prepareCompleteHistory,
  REPORTING_RATE_SOURCE_ID,
  seedReportingRates,
} from "./history-observation-helpers";

const ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const OTHER_ADDRESS = "0x1111111111111111111111111111111111111111";

async function attachPasskey(page: Page): Promise<CDPSession> {
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
  return client;
}

async function loginAsOwner(page: Page): Promise<void> {
  await attachPasskey(page);
  await page.goto("/setup");
  await page.getByRole("button", { name: "创建所有者 Passkey" }).click();
  await expect(page.getByRole("status")).toContainText("预置完成");
  await page.goto("/");

  await page.getByRole("button", { name: "使用 Passkey 登录" }).click();
  await expect(page.getByTestId("workbench-shell")).toBeVisible();
}

async function connectEthereum(page: Page): Promise<void> {
  await openSourceFlow(page, "EVM 观察钱包");
  await page.getByRole("checkbox", { name: "BNB Smart Chain 观察钱包" }).uncheck();
  await page.getByLabel("EVM 公开地址（每行一个）").fill(ADDRESS);
  await page.getByRole("button", { name: "验证公开地址" }).click();
  await confirmSourceFlow(page, "Ethereum");
  await expect(page.getByTestId("ethereum-watch-card")).toBeVisible();
}

async function lifecycleState(page: Page) {
  const response = await page.request.get("/test-doubles/ethereum");
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as {
    sources: Array<{ id: string; kind: string; lifecycle: string }>;
    cards: Array<{ sourceId?: string; hidden?: boolean }>;
    savedSecrets: number;
    refreshCalls: number;
    snapshotSourceIds: string[];
    snapshots: Array<{ day: string; sourceIds: string[] }>;
  };
}

async function openSourceManagement(page: Page, source: string) {
  await page.goto("/asset-sources");
  await page.getByRole("link", { name: new RegExp(`${source}.*观察钱包`) }).click();
  await expect(page).toHaveURL(/\/asset-sources\/[^/]+$/);
  return page.locator("main");
}

async function disconnectSource(
  page: Page,
  management: Locator,
  source: string,
) {
  await management.getByRole("button", { name: "断开来源" }).click();
  await page
    .getByRole("dialog", { name: `确认断开 ${source}` })
    .getByRole("button", { name: "确认断开" })
    .click();
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
  await request.post("/test-doubles/ethereum", {
    data: { scenario: "valid" },
  });
});

test("所有者可自定义资产来源名称并清空恢复默认名称", async ({ page }) => {
  await loginAsOwner(page);
  await connectEthereum(page);

  let management = await openSourceManagement(page, "Ethereum 观察钱包");
  const displayName = management.getByLabel("自定义名称");
  await expect(displayName).toHaveAttribute(
    "placeholder",
    "Ethereum 观察钱包 · 1 个地址",
  );
  await displayName.fill("长期钱包");
  await management.getByRole("button", { name: "保存名称" }).click();

  await expect(
    page.getByTestId("ethereum-watch-card").getByRole("heading", { level: 2 }),
  ).toHaveText("长期钱包");
  await page.reload();
  await expect(
    page.getByTestId("ethereum-watch-card").getByRole("heading", { level: 2 }),
  ).toHaveText("长期钱包");

  management = await openSourceManagement(page, "长期钱包");
  await management.getByLabel("自定义名称").fill("");
  await management.getByRole("button", { name: "保存名称" }).click();

  await expect(
    page.getByTestId("ethereum-watch-card").getByRole("heading", { level: 2 }),
  ).toHaveText("Ethereum 观察钱包 · 1 个地址");
});

test("来源管理直接显示断开和永久删除操作", async ({ page }) => {
  await loginAsOwner(page);
  await connectEthereum(page);

  const management = await openSourceManagement(page, "Ethereum 观察钱包");
  await expect(management).toContainText(
    "仅修改本看板中的显示名称。清空后恢复默认名称。",
  );
  await expect(
    management.getByRole("button", { name: "保存名称" }),
  ).toBeDisabled();
  await expect(
    management.getByRole("button", { name: "更多来源操作" }),
  ).toHaveCount(0);
  await expect(management.getByRole("button", { name: "断开来源" })).toBeVisible();
  await expect(
    management.getByRole("button", { name: "永久删除数据" }),
  ).toBeVisible();

  await management.getByLabel("自定义名称").fill("长期钱包");
  await expect(
    management.getByRole("button", { name: "保存名称" }),
  ).toBeEnabled();
});

test("隐藏与恢复只改变卡片可见性，来源仍同步并计入总额与快照", async ({
  page,
}) => {
  await loginAsOwner(page);
  await connectEthereum(page);
  const originalId = (await lifecycleState(page)).sources[0].id;
  const historyBeforeHide = await prepareCompleteHistory(page.request, [originalId]);
  await expect(page.getByTestId("ethereum-watch-card")).toContainText("5,519.00 USD");
  await page.getByRole("button", { name: "隐藏来源卡片" }).click();
  await expect(page.getByRole("region", { name: "来源显示与生命周期" })).toContainText("来源卡片已隐藏");
  await page.goto("/");
  await expect(page.getByTestId("overview-current-total")).toContainText("5,519.00 USD");

  const hidden = await lifecycleState(page);
  expect(hidden.cards.find(({ sourceId }) => sourceId === hidden.sources[0].id)?.hidden).toBe(true);
  expect(hidden.snapshotSourceIds).toEqual([originalId, REPORTING_RATE_SOURCE_ID]);

  const callsBeforeRefresh = (await lifecycleState(page)).refreshCalls;
  const refresh = await page.request.post("/api/asset-sources/refresh", {
    data: { mode: "all" },
  });
  await expect(refresh.json()).resolves.toMatchObject({ successCount: 1, failureCount: 0 });
  expect((await lifecycleState(page)).refreshCalls).toBeGreaterThan(callsBeforeRefresh);
  expect(await expectCompleteHistory(page.request, [originalId])).toEqual(historyBeforeHide);

  await openSourceManagement(page, "Ethereum 观察钱包");
  await page.getByRole("button", { name: "恢复显示来源卡片" }).click();
  await expect(page.getByRole("button", { name: "隐藏来源卡片" })).toBeVisible();
  expect((await lifecycleState(page)).cards[0]?.hidden).toBe(false);
  await expect(page.getByTestId("ethereum-watch-card")).toBeVisible();
  await expect(page.getByTestId("ethereum-watch-card")).toContainText("5,519.00 USD");
});

test("断开 EVM 观察钱包时保留公开地址配置、来源身份和已有快照", async ({ page }) => {
  await loginAsOwner(page);
  await connectEthereum(page);
  const originalId = (await lifecycleState(page)).sources[0].id;
  const historyBeforeDisconnect = await prepareCompleteHistory(page.request, [originalId]);

  await expect(page.getByRole("button", { name: "断开 Ethereum 观察钱包" })).toHaveCount(0);
  const management = await openSourceManagement(page, "Ethereum 观察钱包");
  let nativeDialogOpened = false;
  page.on("dialog", (dialog) => {
    nativeDialogOpened = true;
    void dialog.dismiss();
  });
  await management.getByRole("button", { name: "断开来源" }).click();
  const confirmation = page.getByRole("dialog", {
    name: "确认断开 Ethereum 观察钱包",
  });
  await expect(confirmation).toContainText(
    "停止同步；历史数据保留。",
  );
  expect(nativeDialogOpened).toBe(false);
  await confirmation.getByRole("button", { name: "确认断开" }).click();
  await expect(page.getByText("已断开；历史数据保留。")).toBeVisible();
  const sourceState = page
    .getByTestId("ethereum-watch-card")
    .locator(".source-live-state");
  await expect(sourceState).toHaveText("ETH / OFFLINE");
  await expect(sourceState).toHaveAttribute("data-vibe-tone", "muted");

  const disconnected = await lifecycleState(page);
  expect(disconnected.sources).toHaveLength(1);
  expect(disconnected.sources[0].lifecycle).toBe("disconnected");
  expect(disconnected.savedSecrets).toBe(1);
  expect(disconnected.snapshotSourceIds).toEqual([originalId, REPORTING_RATE_SOURCE_ID]);
  expect(await expectCompleteHistory(page.request, [originalId])).toEqual(historyBeforeDisconnect);

  const callsBeforeRefresh = disconnected.refreshCalls;
  const refresh = await page.request.post("/api/asset-sources/refresh", {
    data: { mode: "all" },
  });
  await expect(refresh.json()).resolves.toEqual({ successCount: 0, failureCount: 0, skipped: "no-sources" });
  expect((await lifecycleState(page)).refreshCalls).toBe(callsBeforeRefresh);
  await page.goto("/");
  await expect(page.getByTestId("overview-current-total")).toContainText("5,519");
});

test("已断开的 EVM 观察钱包恢复原卡片和历史", async ({
  page,
}) => {
  await loginAsOwner(page);
  await connectEthereum(page);
  const originalId = (await lifecycleState(page)).sources[0].id;
  const historyBeforeDisconnect = await prepareCompleteHistory(page.request, [originalId]);
  const before = await lifecycleState(page);
  const original = before.sources[0]!;

  const management = await openSourceManagement(page, "Ethereum 观察钱包");
  await disconnectSource(page, management, "Ethereum 观察钱包");
  await expect(page.getByText("已断开；历史数据保留。")).toBeVisible();

  const disconnectedManagement = await openSourceManagement(
    page,
    "Ethereum 观察钱包",
  );
  await expect(
    disconnectedManagement.getByLabel("EVM 公开地址（每行一个）"),
  ).toHaveCount(0);
  await disconnectedManagement
    .getByRole("button", { name: "恢复连接" })
    .click();

  await expect(page.getByText("已断开；历史数据保留。")).toHaveCount(0);
  const refreshResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/asset-sources/refresh") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "刷新 Ethereum 观察钱包 · 1 个地址", exact: true }).click();
  await expect((await refreshResponse).json()).resolves.toMatchObject({ successCount: 1, failureCount: 0 });
  const restored = await lifecycleState(page);
  expect(restored.sources).toHaveLength(1);
  expect(restored.sources[0]?.id).toBe(original.id);
  expect(restored.sources[0]?.lifecycle).toBe("connected");
  expect(restored.savedSecrets).toBe(1);
  expect(restored.refreshCalls).toBeGreaterThan(before.refreshCalls);
  expect(restored.cards).toEqual(before.cards);
  expect(restored.snapshotSourceIds).toEqual([original.id, REPORTING_RATE_SOURCE_ID]);
  expect(await expectCompleteHistory(page.request, [original.id])).toEqual(historyBeforeDisconnect);
});

test("原凭证不存在时重新输入相同公开地址，恢复原卡片和历史", async ({
  page,
}) => {
  await loginAsOwner(page);
  await connectEthereum(page);
  const original = (await lifecycleState(page)).sources[0]!;
  const historyBeforeDisconnect = await prepareCompleteHistory(page.request, [original.id]);

  const management = await openSourceManagement(page, "Ethereum 观察钱包");
  await disconnectSource(page, management, "Ethereum 观察钱包");
  await expect(page.getByText("已断开；历史数据保留。")).toBeVisible();
  const credentialRemoval = await page.request.post("/test-doubles/ethereum", {
    data: { scenario: "forget-credential" },
  });
  expect(credentialRemoval.ok()).toBeTruthy();
  expect((await lifecycleState(page)).savedSecrets).toBe(0);

  const disconnectedManagement = await openSourceManagement(
    page,
    "Ethereum 观察钱包",
  );
  await disconnectedManagement
    .getByRole("button", { name: "恢复连接" })
    .click();

  await expect(disconnectedManagement.getByRole("alert")).toContainText("原连接凭证已不存在");
  await page.getByRole("link", { name: "更换授权 / 重新授权" }).click();
  await page.getByLabel("Ethereum 公开地址（每行一个）").fill(ADDRESS);
  await page.getByRole("button", { name: "验证公开地址" }).click();
  await page.getByRole("button", { name: "确认更新授权" }).click();
  await expect(page).toHaveURL(new RegExp(`/asset-sources/${original.id}$`));
  const restored = await lifecycleState(page);
  expect(restored.sources).toEqual([
    expect.objectContaining({ id: original.id, lifecycle: "connected" }),
  ]);
  expect(restored.savedSecrets).toBe(1);
  expect(restored.cards).toEqual([
    expect.objectContaining({ sourceId: original.id }),
  ]);
  expect(restored.snapshotSourceIds).toEqual([original.id, REPORTING_RATE_SOURCE_ID]);
  expect(await expectCompleteHistory(page.request, [original.id])).toEqual(historyBeforeDisconnect);
});

test("重新添加相同公开地址时恢复原来源，不创建重复卡片", async ({
  page,
}) => {
  await loginAsOwner(page);
  await connectEthereum(page);
  const original = (await lifecycleState(page)).sources[0]!;
  const historyBeforeDisconnect = await prepareCompleteHistory(page.request, [original.id]);

  const management = await openSourceManagement(page, "Ethereum 观察钱包");
  await disconnectSource(page, management, "Ethereum 观察钱包");
  await connectEthereum(page);

  const restored = await lifecycleState(page);
  expect(restored.sources).toEqual([
    expect.objectContaining({ id: original.id, lifecycle: "connected" }),
  ]);
  expect(restored.cards).toEqual([
    expect.objectContaining({ sourceId: original.id }),
  ]);
  expect(restored.snapshotSourceIds).toEqual([original.id, REPORTING_RATE_SOURCE_ID]);
  expect(await expectCompleteHistory(page.request, [original.id])).toEqual(historyBeforeDisconnect);
});

test("不同公开地址不能替换旧来源", async ({ page }) => {
  await loginAsOwner(page);
  await connectEthereum(page);
  const original = (await lifecycleState(page)).sources[0]!;

  const management = await openSourceManagement(page, "Ethereum 观察钱包");
  await disconnectSource(page, management, "Ethereum 观察钱包");
  const credentialRemoval = await page.request.post("/test-doubles/ethereum", {
    data: { scenario: "forget-credential" },
  });
  expect(credentialRemoval.ok()).toBeTruthy();

  const disconnectedManagement = await openSourceManagement(
    page,
    "Ethereum 观察钱包",
  );
  await disconnectedManagement
    .getByRole("button", { name: "恢复连接" })
    .click();
  await expect(disconnectedManagement.getByRole("alert")).toContainText("原连接凭证已不存在");
  await page.getByRole("link", { name: "更换授权 / 重新授权" }).click();
  await page.getByLabel("Ethereum 公开地址（每行一个）").fill(OTHER_ADDRESS);
  await page.getByRole("button", { name: "验证公开地址" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("与此来源不一致");
  const disconnected = await lifecycleState(page);
  expect(disconnected.sources).toEqual([
    expect.objectContaining({ id: original.id, lifecycle: "disconnected" }),
  ]);
  expect(disconnected.savedSecrets).toBe(0);
});

test("其他来源次日成功同步时，不为已断开来源生成新快照", async ({ page }) => {
  await page.request.post("/test-doubles/clock", {
    data: { now: "2026-01-01T15:59:00.000Z" },
  });
  await loginAsOwner(page);
  await connectEthereum(page);
  await openSourceFlow(page, "EVM 观察钱包");
  await page.getByRole("checkbox", { name: "Ethereum 观察钱包" }).uncheck();
  await page.getByLabel("EVM 公开地址（每行一个）").fill(ADDRESS);
  await page.getByRole("button", { name: "验证公开地址" }).click();
  await confirmSourceFlow(page, "BNB Smart Chain");

  const connectedIds = (await lifecycleState(page)).sources.map(({ id }) => id);
  const historyBeforeDisconnect = await prepareCompleteHistory(page.request, connectedIds);

  const management = await openSourceManagement(page, "Ethereum 观察钱包");
  await disconnectSource(page, management, "Ethereum 观察钱包");
  await page.request.post("/test-doubles/clock", {
    data: { now: "2026-01-01T16:01:00.000Z" },
  });
  await seedReportingRates(page.request);
  const refresh = await page.request.post("/api/asset-sources/refresh", {
    data: { mode: "all" },
  });
  await expect(refresh.json()).resolves.toMatchObject({ successCount: 1, failureCount: 0 });

  const state = await lifecycleState(page);
  const ethereum = state.sources.find(({ kind }) => kind === "evm-watch-ethereum");
  const bsc = state.sources.find(({ kind }) => kind === "evm-watch-bsc");
  expect(ethereum).toBeDefined();
  expect(bsc).toBeDefined();
  expect(state.snapshots.find(({ day }) => day === "2026-01-02")?.sourceIds).toEqual([
    bsc!.id,
    REPORTING_RATE_SOURCE_ID,
  ]);
  expect(state.snapshots.find(({ day }) => day === "2026-01-02")?.sourceIds).not.toContain(
    ethereum!.id,
  );
  const historyAfterRefresh = await expectCompleteHistory(page.request, [bsc!.id], "2026-01-02");
  expect(historyAfterRefresh.baselines.find(({ day }) => day === "2026-01-01"))
    .toEqual(historyBeforeDisconnect.baselines[0]);
  expect(historyAfterRefresh.trendObservations.find(({ day }) => day === "2026-01-01"))
    .toEqual(historyBeforeDisconnect.trendObservations[0]);
});

test("永久删除需要第二次确认，取消无变化，确认后清除来源及全部历史", async ({
  page,
}) => {
  await loginAsOwner(page);
  await connectEthereum(page);

  await expect(page.getByRole("button", { name: "永久删除 Ethereum 观察钱包数据" })).toHaveCount(0);
  let management = await openSourceManagement(page, "Ethereum 观察钱包");
  await management.getByRole("button", { name: "永久删除数据" }).click();
  const first = page.getByRole("dialog", { name: "永久删除来源数据" });
  await expect(first).toContainText("来源及全部历史数据");
  await first.getByRole("button", { name: "继续删除" }).click();
  const second = page.getByRole("dialog", { name: "第二次确认永久删除" });
  await second.getByRole("button", { name: "取消" }).click();

  expect((await lifecycleState(page)).sources).toHaveLength(1);
  await expect(page.getByTestId("ethereum-watch-card")).toBeVisible();

  management = await openSourceManagement(page, "Ethereum 观察钱包");
  await management.getByRole("button", { name: "永久删除数据" }).click();
  await page.getByRole("button", { name: "继续删除" }).click();
  await page.getByRole("button", { name: "确认永久删除" }).click();

  await expect(page.getByTestId("ethereum-watch-card")).toHaveCount(0);
  await page.goto("/");
  await expect(page.getByTestId("overview-current-total")).toContainText("数据不足");
  const deleted = await lifecycleState(page);
  expect(deleted.sources).toEqual([]);
  expect(deleted.cards).toEqual([]);
  expect(deleted.savedSecrets).toBe(0);
  expect(deleted.snapshotSourceIds).toEqual([]);
});
