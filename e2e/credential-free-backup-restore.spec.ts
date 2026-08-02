import { expect, test } from "@playwright/test";

test("锁定状态不能导出业务数据备份", async ({ request }) => {
  const response = await request.post("/api/business-data-backups", {
    data: { action: "export" },
  });

  expect(response.status()).toBe(401);
  await expect(response.json()).resolves.toEqual({ error: "需要所有者身份" });
});

test("导出后可以恢复业务数据且来源默认断开", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/credential-free-backup-restore?action=round-trip",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    preview: {
      sourceCount: 1,
      cardCount: 1,
      snapshotRange: {
        from: "2026-07-27",
        to: "2026-07-28",
      },
      replaces: {
        sourceCount: 0,
        cardCount: 0,
        snapshotCount: 0,
      },
      warning: "备份仍包含敏感资产数据，请仅存放在受保护的位置。",
    },
    restored: {
      sourceIds: ["backup-source"],
      cardIds: ["backup-card"],
      snapshotDays: ["2026-07-27", "2026-07-28"],
      trendObservations: {
        days: ["2026-07-27", "2026-07-28"],
        latest: {
          capturedAt: "2026-07-28T02:05:00.000Z",
          totalUsd: "130",
        },
      },
      lifecycle: "disconnected",
      credentialReference: null,
    },
  });
});

test("导出文件权限为 0600 且不包含任何凭证或认证材料", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/credential-free-backup-restore?action=export-security",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    fileMode: "0600",
    warningIncluded: true,
    credentialFieldsFound: [],
    credentialValuesFound: [],
  });
});

test("损坏或不完整备份在预演阶段被拒绝且不覆盖当前数据", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/credential-free-backup-restore?action=validation",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    corruptJsonRejected: true,
    unknownVersionRejected: true,
    checksumMismatchRejected: true,
    sensitiveFieldRejected: true,
    duplicateSourceRejected: true,
    brokenReferenceRejected: true,
    currentDataPreserved: true,
  });
});

test("旧版备份可以迁移并按当前断开规则恢复", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/credential-free-backup-restore?action=legacy-version",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    sourceCount: 1,
    cardCount: 1,
    lifecycle: "disconnected",
    credentialReference: null,
  });
});

test("重复恢复同一备份保持幂等", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/credential-free-backup-restore?action=repeat-restore",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    sourceCount: 1,
    cardCount: 1,
    snapshotCount: 2,
    sourceIds: ["backup-source"],
  });
});

test("恢复事务中途失败时保留当前数据库", async ({ request }) => {
  const response = await request.post(
    "/test-doubles/credential-free-backup-restore?action=rollback",
  );

  expect(response.ok()).toBeTruthy();
  await expect(response.json()).resolves.toEqual({
    restoreRejected: true,
    currentSourceIds: ["backup-source"],
    currentCardIds: ["backup-card"],
    currentSnapshotDays: ["2026-07-27", "2026-07-28"],
  });
});
