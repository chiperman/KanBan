import { expect, test } from "@playwright/test";

test("空库启动后由 SQLite 持久化业务数据", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/sqlite-business-data-persistence?action=empty-startup",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    cards: [],
    sources: [],
    dailySnapshots: [],
    sqliteExists: true,
    dashboardJsonExists: false,
  });
});

test("首次启动完整导入 JSON 并保留私有备份", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/sqlite-business-data-persistence?action=json-import",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    card: {
      id: "legacy-card",
      kind: "asset",
      title: "旧资产卡片",
      body: "旧布局",
      sourceId: "legacy-source",
      hidden: true,
      span: 2,
      startsNewRow: true,
    },
    source: expect.objectContaining({
      id: "legacy-source",
      credentialReference: "opaque-reference",
      lifecycle: "disconnected",
      coverage: {
        status: "unknown",
        products: [],
        unexplainedValue: null,
        excludedPositiveAccounts: [],
      },
      holdings: [
        expect.objectContaining({
          symbol: "USD",
          quantity: "12.5",
          marketValue: "12.5",
          valuation: expect.objectContaining({ status: "valued" }),
        }),
      ],
    }),
    dailySnapshot: expect.objectContaining({
      day: "2026-07-27",
      total: { USD: "12.5", CNY: "90" },
      sourceIds: ["legacy-source"],
    }),
    databaseMode: "0600",
    backupMode: "0600",
    backupMatches: true,
  });
});

test("SQLite schema v2 自动迁移并持久化 Binance 覆盖证据", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/sqlite-business-data-persistence?action=schema-v2-migration",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    schemaVersion: "3",
    coverageColumn: true,
    coverageStatus: "partial",
    unexplainedValue: { amount: "3", currency: "USD" },
  });
});

test("迁移标记阻止第二次导入旧 JSON", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/sqlite-business-data-persistence?action=repeat-import",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    cardIds: ["legacy-card"],
    sourceIds: ["legacy-source"],
  });
});

test("连接写入失败时不留下来源、卡片、快照或凭证", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/sqlite-business-data-persistence?action=connection-rollback",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    rejected: true,
    cards: 0,
    sources: 0,
    dailySnapshots: 0,
    rawSecretLeaked: false,
  });
});

test("凭证提交失败时补偿回滚已写入的业务数据", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/sqlite-business-data-persistence?action=credential-commit-rollback",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    rejected: true,
    pendingSecretRemoved: true,
    cards: 0,
    sources: 0,
    dailySnapshots: 0,
  });
});

test("并发连接不会丢失来源且 SQLite 不含凭证正文", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/sqlite-business-data-persistence?action=concurrent-writes",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    accountIds: ["concurrent-one", "concurrent-two"],
    cardCount: 2,
    dailySnapshotCount: 1,
    dailySourceCount: 2,
    lockContentionHandled: true,
    rawSecretLeaked: false,
  });
});

test("每日快照按上海日期和来源保持幂等", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/sqlite-business-data-persistence?action=daily-idempotency",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    results: [true, false, false],
    days: ["2026-07-28"],
    sourceIds: ["source-one", "source-two"],
    total: { USD: "30", CNY: "216" },
  });
});

test("断开保留快照，永久删除清理全部来源业务数据", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/sqlite-business-data-persistence?action=source-lifecycle",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    disconnected: {
      lifecycle: "disconnected",
      hidden: true,
      sourceCount: 1,
      dailySourceCount: 1,
      secretRemoved: true,
    },
    deleted: {
      sourceCount: 0,
      cardCount: 0,
      dailySnapshotCount: 0,
    },
  });
});

test("删除非末位来源后仍可继续连接新来源", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/sqlite-business-data-persistence?action=delete-middle-source",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    accountIds: ["first", "fourth", "third"],
    cardCount: 3,
  });
});

test("损坏数据库或 JSON 迁移失败时拒绝启动并保留原数据", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/sqlite-business-data-persistence?action=startup-failures",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    corruptDatabaseRejected: true,
    corruptDatabasePreserved: true,
    invalidJsonRejected: true,
    invalidJsonPreserved: true,
    recoverableErrors: true,
  });
});
