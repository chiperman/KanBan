import { expect, test, type CDPSession, type Page } from "@playwright/test";

const ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

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
  await expect(page.getByRole("status")).toContainText("已完成预置");
  await page.goto("/");

  await page.getByRole("button", { name: "使用 Passkey 登录" }).click();
  await expect(page.getByTestId("view-mode")).toContainText("所有者视图");
}

async function connectEthereum(page: Page): Promise<void> {
  await page.getByRole("button", { name: "添加资产来源" }).click();
  await page.getByRole("radio", { name: "Ethereum 观察钱包" }).click();
  await page.getByLabel("Ethereum 公开地址（每行一个）").fill(ADDRESS);
  await page.getByRole("button", { name: "验证公开地址" }).click();
  await page
    .getByRole("dialog", { name: "确认 Ethereum 观察钱包" })
    .getByRole("button", { name: "确认并保存" })
    .click();
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
  await page.getByRole("button", { name: `管理 ${source}` }).click();
  return page.getByRole("dialog", { name: `管理 ${source}` });
}

test.beforeEach(async ({ request }) => {
  await request.post("/test-doubles/reset");
  await request.post("/test-doubles/ethereum", {
    data: { scenario: "valid" },
  });
});

test("隐藏与恢复只改变卡片可见性，来源仍同步并计入总额与快照", async ({
  page,
}) => {
  await loginAsOwner(page);
  await connectEthereum(page);
  await expect(page.getByTestId("total-overview-card")).toContainText("5,519");

  await page.getByRole("button", { name: "隐藏 Ethereum 观察钱包" }).click();
  await expect(page.getByTestId("ethereum-watch-card")).toHaveCount(0);
  await expect(page.getByTestId("total-overview-card")).toContainText("5,519");
  await expect(page.getByRole("heading", { name: "已隐藏的资产来源" })).toBeVisible();

  const hidden = await lifecycleState(page);
  expect(hidden.cards.find(({ sourceId }) => sourceId === hidden.sources[0].id)?.hidden).toBe(true);
  expect(hidden.snapshotSourceIds).toEqual([hidden.sources[0].id]);

  const callsBeforeRefresh = (await lifecycleState(page)).refreshCalls;
  const refresh = await page.request.post("/api/asset-sources/refresh", {
    data: { mode: "all" },
  });
  await expect(refresh.json()).resolves.toEqual({ successCount: 1, failureCount: 0 });
  expect((await lifecycleState(page)).refreshCalls).toBeGreaterThan(callsBeforeRefresh);

  await page.getByRole("button", { name: "重新显示 Ethereum 观察钱包" }).click();
  await expect(page.getByTestId("ethereum-watch-card")).toBeVisible();
  await expect(page.getByTestId("ethereum-watch-card")).toContainText("5,519.00 USD");
});

test("断开删除凭证并停止同步，保留来源身份和已有快照", async ({ page }) => {
  await loginAsOwner(page);
  await connectEthereum(page);

  await expect(page.getByRole("button", { name: "断开 Ethereum 观察钱包" })).toHaveCount(0);
  const management = await openSourceManagement(page, "Ethereum 观察钱包");
  page.once("dialog", (dialog) => dialog.accept());
  await management.getByRole("button", { name: "断开 Ethereum 观察钱包" }).click();
  await expect(page.getByText("已断开 · 历史数据保留")).toBeVisible();

  const disconnected = await lifecycleState(page);
  expect(disconnected.sources).toHaveLength(1);
  expect(disconnected.sources[0].lifecycle).toBe("disconnected");
  expect(disconnected.savedSecrets).toBe(0);
  expect(disconnected.snapshotSourceIds).toEqual([disconnected.sources[0].id]);

  const callsBeforeRefresh = disconnected.refreshCalls;
  const refresh = await page.request.post("/api/asset-sources/refresh", {
    data: { mode: "all" },
  });
  await expect(refresh.json()).resolves.toEqual({ successCount: 0, failureCount: 0 });
  expect((await lifecycleState(page)).refreshCalls).toBe(callsBeforeRefresh);
  await expect(page.getByTestId("total-overview-card")).toContainText("5,519");
});

test("其他来源次日成功同步时，不为已断开来源生成新快照", async ({ page }) => {
  await page.request.post("/test-doubles/clock", {
    data: { now: "2026-01-01T15:59:00.000Z" },
  });
  await loginAsOwner(page);
  await connectEthereum(page);
  await page.getByRole("button", { name: "添加资产来源" }).click();
  await page.getByRole("radio", { name: "BNB Smart Chain 观察钱包" }).click();
  await page.getByLabel("BNB Smart Chain 公开地址（每行一个）").fill(ADDRESS);
  await page.getByRole("button", { name: "验证公开地址" }).click();
  await page
    .getByRole("dialog", { name: "确认 BNB Smart Chain 观察钱包" })
    .getByRole("button", { name: "确认并保存" })
    .click();

  page.once("dialog", (dialog) => dialog.accept());
  const management = await openSourceManagement(page, "Ethereum 观察钱包");
  await management.getByRole("button", { name: "断开 Ethereum 观察钱包" }).click();
  await page.request.post("/test-doubles/clock", {
    data: { now: "2026-01-01T16:01:00.000Z" },
  });
  const refresh = await page.request.post("/api/asset-sources/refresh", {
    data: { mode: "all" },
  });
  await expect(refresh.json()).resolves.toEqual({ successCount: 1, failureCount: 0 });

  const state = await lifecycleState(page);
  const ethereum = state.sources.find(({ kind }) => kind === "evm-watch-ethereum");
  const bsc = state.sources.find(({ kind }) => kind === "evm-watch-bsc");
  expect(ethereum).toBeDefined();
  expect(bsc).toBeDefined();
  expect(state.snapshots.find(({ day }) => day === "2026-01-02")?.sourceIds).toEqual([
    bsc!.id,
  ]);
  expect(state.snapshots.find(({ day }) => day === "2026-01-02")?.sourceIds).not.toContain(
    ethereum!.id,
  );
});

test("永久删除需要第二次确认，取消无变化，确认后清除来源及全部历史", async ({
  page,
}) => {
  await loginAsOwner(page);
  await connectEthereum(page);

  await expect(page.getByRole("button", { name: "永久删除 Ethereum 观察钱包数据" })).toHaveCount(0);
  let management = await openSourceManagement(page, "Ethereum 观察钱包");
  await management.getByRole("button", { name: "永久删除 Ethereum 观察钱包数据" }).click();
  const first = page.getByRole("dialog", { name: "永久删除来源数据" });
  await expect(first).toContainText("持仓记录、同步记录和全部资产快照");
  await first.getByRole("button", { name: "继续删除" }).click();
  const second = page.getByRole("dialog", { name: "第二次确认永久删除" });
  await second.getByRole("button", { name: "取消" }).click();

  expect((await lifecycleState(page)).sources).toHaveLength(1);
  await expect(page.getByTestId("ethereum-watch-card")).toBeVisible();

  management = await openSourceManagement(page, "Ethereum 观察钱包");
  await management.getByRole("button", { name: "永久删除 Ethereum 观察钱包数据" }).click();
  await page.getByRole("button", { name: "继续删除" }).click();
  await page.getByRole("button", { name: "确认永久删除" }).click();

  await expect(page.getByTestId("ethereum-watch-card")).toHaveCount(0);
  await expect(page.getByTestId("total-overview-card")).toHaveCount(0);
  const deleted = await lifecycleState(page);
  expect(deleted.sources).toEqual([]);
  expect(deleted.cards).toEqual([]);
  expect(deleted.savedSecrets).toBe(0);
  expect(deleted.snapshotSourceIds).toEqual([]);
});
