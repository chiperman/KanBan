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
      total: { USD: "12.5", CNY: "90", HKD: null },
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
    schemaVersion: "20",
    coverageColumn: true,
    displayNameColumn: true,
    coverageStatus: "partial",
    unexplainedValue: { amount: "3", currency: "USD" },
  });
});

test("旧版 SQLite 原地升级保留业务数据且首次失败建立统一周期", async ({
  request,
}) => {
  const response = await request.post(
    "/test-doubles/sqlite-business-data-persistence?action=legacy-refresh-upgrade",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    schemaVersion: "20",
    attemptedAtBeforeRefresh: null,
    sourceAttemptedAtBeforeRefresh: [
      "2026-08-18T01:00:00.000Z",
      "2026-08-19T02:00:00.000Z",
    ],
    upgradePreserved: true,
    before: {
      sourceCount: 2,
      currentSnapshotCount: 2,
      syncStateCount: 2,
      dailyBaselineCount: 2,
      dailyTrendCount: 2,
      dailyBaselineSourceCount: 4,
      dailyTrendSourceCount: 4,
      sourceIdentities: [
        "binance:legacy-binance-account",
        "longbridge:legacy-longbridge-account",
      ],
      currentAmounts: ["123.45", "678.90"],
      baselineAmounts: ["790.00", "802.35"],
      trendAmounts: ["795", "802.35"],
    },
    firstFailure: {
      successCount: 0,
      failureCount: 2,
      attemptedAtMatchesState: true,
      inProgressCleared: true,
    },
    afterRestart: {
      attemptedAtPreserved: true,
      inProgressAt: null,
      skipped: "not-due",
      reportUsesPersistedAttemptedAt: true,
    },
  });
});

test("SQLite 在重启后保留全量刷新周期与中断诊断", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/sqlite-business-data-persistence?action=full-refresh-state",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    before: { attemptedAt: null, inProgressAt: null },
    during: {
      attemptedAt: "2026-08-20T04:00:00.000Z",
      inProgressAt: "2026-08-20T04:00:00.000Z",
    },
    afterRestart: {
      attemptedAt: "2026-08-20T04:00:00.000Z",
      inProgressAt: "2026-08-20T04:00:00.000Z",
    },
    after: {
      attemptedAt: "2026-08-20T04:00:00.000Z",
      inProgressAt: null,
    },
  });
});

test("两个 SQLite 实例对同一文件只允许一次全量刷新预占", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/sqlite-business-data-persistence?action=full-refresh-claim-race",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    claims: ["claimed", "in-progress"],
    firstState: {
      attemptedAt: "2026-08-20T04:00:00.000Z",
      inProgressAt: "2026-08-20T04:00:00.000Z",
    },
    secondState: {
      attemptedAt: "2026-08-20T04:00:00.000Z",
      inProgressAt: "2026-08-20T04:00:00.000Z",
    },
  });
});

test("首个自动来源连接以连接时间初始化全量刷新周期", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/sqlite-business-data-persistence?action=first-connection-refresh-state",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    attemptedAt: "2026-08-20T04:00:00.000Z",
    inProgressAt: null,
  });
});

test("并发首连只由首个成功来源建立周期与初始历史", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/sqlite-business-data-persistence?action=first-connection-race",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    bothSucceeded: {
      rejected: 0,
      state: {
        attemptedAt: "2026-08-20T04:00:00.000Z",
        inProgressAt: null,
      },
      sourceAccounts: ["race-first", "race-second"],
      baselineSourceAccounts: ["race-first"],
      trendSourceAccounts: ["race-first"],
    },
    firstCommitFailed: {
      rejected: 1,
      state: {
        attemptedAt: "2026-08-20T05:00:00.000Z",
        inProgressAt: null,
      },
      sourceAccounts: ["race-second"],
      baselineSourceAccounts: ["race-second"],
      trendSourceAccounts: ["race-second"],
    },
  });
});

test("最后一个自动来源断开或删除会清理周期，重新连接重新建立", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/sqlite-business-data-persistence?action=last-source-refresh-clear",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    afterFirstConnection: true,
    afterDisconnect: { attemptedAt: null, inProgressAt: null },
    afterReconnect: true,
    afterDelete: { attemptedAt: null, inProgressAt: null },
  });
});

test("SQLite schema v4 升级后分离日初基准与每日趋势观测并跨重启保留", async ({
  request,
}) => {
  const response = await request.post(
    "/test-doubles/sqlite-business-data-persistence?action=schema-v4-trend-observation-migration",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    schemaVersion: "20",
    migratedTrend: {
      capturedAt: "2026-07-28T00:30:00.000Z",
      complete: false,
      total: { USD: "10", CNY: "72", HKD: null },
    },
    baseline: {
      capturedAt: "2026-07-28T00:30:00.000Z",
      complete: false,
      total: { USD: "10", CNY: "72", HKD: null },
    },
    trendAfterSuccess: {
      capturedAt: "2026-07-28T02:30:00.000Z",
      complete: false,
      total: { USD: "20", CNY: "144", HKD: null },
    },
    trendAfterFailureAndRestart: {
      capturedAt: "2026-07-28T02:30:00.000Z",
      complete: false,
      total: { USD: "20", CNY: "144", HKD: null },
      source: {
        capturedAt: "2026-07-28T02:30:00.000Z",
        complete: false,
        total: { USD: "20", CNY: "144", HKD: null },
      },
    },
  });
});

test("完整每日趋势观测不会被同日后续不完整刷新降级", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/sqlite-business-data-persistence?action=complete-trend-survives-incomplete-refresh",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    capturedAt: "2026-07-28T02:30:00.000Z",
    complete: true,
    status: "complete",
    total: { USD: "100", CNY: "720", HKD: "780" },
    source: {
      capturedAt: "2026-07-28T02:30:00.000Z",
      complete: true,
      status: "complete",
      total: { USD: "100", CNY: "720", HKD: "780" },
    },
  });
});

test("SQLite schema v6 升级后持久化 HKD 金额与观测时汇率", async ({
  request,
}) => {
  const response = await request.post(
    "/test-doubles/sqlite-business-data-persistence?action=schema-v6-hkd-fx-migration",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    schemaVersion: "20",
    hkdColumns: true,
    baseline: {
      total: { USD: "10", CNY: "72", HKD: "78" },
      exchangeRates: [
        { baseCurrency: "USD", quoteCurrency: "CNY", rate: "7.2" },
        { baseCurrency: "HKD", quoteCurrency: "USD", rate: "0.1282051282051282" },
      ],
    },
    trend: {
      total: { USD: "11", CNY: "79.2", HKD: "85.8" },
      exchangeRates: [
        { baseCurrency: "USD", quoteCurrency: "CNY", rate: "7.2" },
        { baseCurrency: "USD", quoteCurrency: "HKD", rate: "7.8" },
      ],
    },
  });
});

test("SQLite 手工来源先建卡片，再记录数据且未记录来源不进入观测", async ({
  request,
}) => {
  const response = await request.post(
    "/test-doubles/sqlite-business-data-persistence?action=manual-source-record-persistence",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    unrecorded: {
      hasManualRecord: false,
      dailySnapshots: 0,
    },
    sources: [
      {
        label: "A股",
        hasManualRecord: true,
        manualAssetClass: "securities",
        total: { amount: "108000", currency: "CNY" },
      },
      {
        label: "场外基金",
        hasManualRecord: false,
        total: { amount: "0", currency: "CNY" },
      },
    ],
    cards: 2,
    baselines: [{
      sources: ["A股"],
      total: { USD: null, CNY: "108000", HKD: null },
    }],
    trend: [{
      sources: ["A股"],
      total: { USD: null, CNY: "108000", HKD: null },
    }],
  });
});

test("SQLite schema v8 升级后可创建并记录手工资产来源", async ({
  request,
}) => {
  const response = await request.post(
    "/test-doubles/sqlite-business-data-persistence?action=schema-v8-manual-source-migration",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    schemaVersion: "20",
    hasManualRecordColumn: true,
    manualAssetClassColumn: true,
    existing: {
      id: expect.any(String),
      label: "Binance schema-v8",
    },
    manual: expect.objectContaining({
      kind: "manual",
      label: "A股",
      hasManualRecord: true,
      manualAssetClass: "securities",
      snapshot: expect.objectContaining({
        total: { amount: "108000", currency: "CNY" },
      }),
    }),
  });
});

test("SQLite schema v12 增量迁移保存资金账本且不改写资产观测", async ({
  request,
}) => {
  const response = await request.post(
    "/test-doubles/sqlite-business-data-persistence?action=schema-v12-investment-cashflow-migration",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    schemaVersion: "20",
    cashflowTable: true,
    cashflow: {
      kind: "initial-investment",
      occurredAt: "2026-08-01T00:00:00.000Z",
      amount: "10000",
      currency: "USD",
      amounts: { USD: "10000", CNY: "72000", HKD: "78000" },
      exchangeRateSources: ["Longbridge", "Longbridge"],
    },
    snapshotValuesUnchanged: true,
  });
});

test("SQLite schema v14 升级后保留旧分类未知，并跨重启持久化新分类趋势", async ({
  request,
}) => {
  const response = await request.post(
    "/test-doubles/sqlite-business-data-persistence?action=schema-v14-asset-class-trend-migration",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    schemaVersion: "20",
    assetClassColumns: true,
    oldTrendHasAssetClassTotals: true,
    persistedTrend: {
      securities: {
        complete: true,
        status: "complete",
        total: { USD: "120", CNY: "864", HKD: "936" },
      },
      crypto: {
        complete: true,
        status: "complete",
        total: { USD: "0", CNY: "0", HKD: "0" },
      },
    },
  });
});

test("SQLite schema v15 按来源类别回填历史证券与加密趋势", async ({
  request,
}) => {
  const response = await request.post(
    "/test-doubles/sqlite-business-data-persistence?action=schema-v15-source-category-trend-backfill",
  );

  expect(response.ok()).toBeTruthy();
  const expected = {
    securities: {
      complete: true,
      status: "complete",
      total: { USD: "100", CNY: "720", HKD: "780" },
    },
    crypto: {
      complete: true,
      status: "complete",
      total: { USD: "0", CNY: "0", HKD: "0" },
    },
  };
  const expectedCrypto = {
    securities: {
      complete: true,
      status: "complete",
      total: { USD: "0", CNY: "0", HKD: "0" },
    },
    crypto: {
      complete: true,
      status: "complete",
      total: { USD: "50", CNY: "360", HKD: "390" },
    },
  };
  await expect(response.json()).resolves.toEqual({
    schemaVersion: "20",
    baseline: {
      longbridge: expected,
      binance: expectedCrypto,
    },
    trend: {
      longbridge: expected,
      binance: expectedCrypto,
    },
  });
});

test("资产来源自定义名称跨 SQLite 重启保留，清空后恢复默认", async ({
  request,
}) => {
  const response = await request.post(
    "/test-doubles/sqlite-business-data-persistence?action=display-name-persistence",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    renamed: {
      displayName: "长期账户",
      label: "Binance persistence",
      accountId: "persistence",
    },
    cleared: {
      displayName: null,
      label: "Binance persistence",
      accountId: "persistence",
    },
  });
});

test("EVM 代币忽略与保留状态跨 SQLite 重启持久化", async ({
  request,
}) => {
  const response = await request.post(
    "/test-doubles/sqlite-business-data-persistence?action=evm-token-preference-persistence",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    ignoredAfterRestart: {
      ignoredAssetKeys: [
        "evm:56:0xcccccccccccccccccccccccccccccccccccccccc",
      ],
      includedAssetKeys: [],
    },
    includedAfterRestart: {
      ignoredAssetKeys: [],
      includedAssetKeys: [
        "evm:56:0xcccccccccccccccccccccccccccccccccccccccc",
      ],
    },
  });
});

test("EVM 待确认代币跨 SQLite 重启持久化", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/sqlite-business-data-persistence?action=evm-unrecognized-token-persistence",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    unrecognizedEvmTokens: [{
      sourceAsset: "evm:56:0xdddddddddddddddddddddddddddddddddddddddd",
      symbol: "WstETH",
      name: "Lido: stETH Withdrawal NFT",
      quantity: null,
      reason: "代币合约未返回可靠 decimals，数量无法读取",
    }],
  });
});

test("SQLite 旧长桥期权缺价读取时升级为行情未接入并保留账户总额", async ({
  request,
}) => {
  const response = await request.post(
    "/test-doubles/sqlite-business-data-persistence?action=longbridge-option-read-upgrade",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    rawStatus: "unvalued",
    readStatus: "quote-unavailable",
    total: { amount: "69930.10", currency: "USD" },
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
    dailySnapshotCount: 0,
    dailySourceCount: 0,
    trendSourceCount: 0,
    lockContentionHandled: true,
    rawSecretLeaked: false,
  });
});

test("每日快照按上海日期保持幂等且完整刷新包含全部来源", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/sqlite-business-data-persistence?action=daily-idempotency",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    results: [true, false, false],
    days: ["2026-07-28"],
    sourceIds: ["source-one"],
    total: { USD: "10", CNY: "72", HKD: null },
    trend: {
      sourceIds: ["source-one", "source-two"],
      total: { USD: "30", CNY: "216", HKD: null },
    },
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
      trendSourceCount: 1,
      secretRemoved: true,
    },
    deleted: {
      sourceCount: 0,
      cardCount: 0,
      dailySnapshotCount: 0,
      dailyTrendObservationCount: 0,
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
    invalidJsonRequiresMigration: true,
    recoverableErrors: true,
  });
});
