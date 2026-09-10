import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CredentialFreeBusinessDataBackup,
  type BusinessDataBackupStore,
  type BusinessDataState,
} from "@/server/business-data-backup";

const observation = {
  sourceId: "source-test", label: "测试来源", kind: "longbridge",
  day: "2026-08-01", capturedAt: "2026-08-01T12:00:00.000Z",
  complete: true, status: "complete" as const,
  total: { USD: "0", CNY: "0", HKD: null },
};

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "kanban-backup-validation-"));
  let restored: BusinessDataState | null = null;
  const store: BusinessDataBackupStore = {
    listAssetCards: async () => [],
    listSources: async () => [{
      id: "source-test", label: "测试来源", kind: "longbridge",
      accountId: "test-owner", permissions: [], credentialReference: null,
      snapshot: { total: { amount: "0", currency: "USD" }, holdings: [], exchangeRates: [],
        syncedAt: observation.capturedAt },
      sync: { status: "current", lastSuccessfulAt: observation.capturedAt,
        lastAttemptAt: observation.capturedAt, error: null },
    }],
    listDailyAssetSnapshots: async () => [],
    listDailyAssetTrendObservations: async () => [],
    listImportedSourceHistoryObservations: async () => [observation],
    listInvestmentCashflows: async () => [],
    validateBusinessData: async () => {},
    replaceBusinessData: async (state) => { restored = state; },
  };
  const backup = new CredentialFreeBusinessDataBackup(store, directory,
    { now: () => new Date("2026-08-02T00:00:00.000Z") });
  await backup.exportBackup("valid.json");
  const document = JSON.parse(await readFile(path.join(directory, "valid.json"), "utf8"));
  async function rewrite() {
    const { format, formatVersion, createdAt, payload } = document;
    document.checksum.value = createHash("sha256")
      .update(JSON.stringify({ format, formatVersion, createdAt, payload })).digest("hex");
    await writeFile(path.join(directory, "candidate.json"), JSON.stringify(document));
  }
  return { directory, backup, document, rewrite, restored: () => restored };
}

test("备份完整保留来源历史和零金额，旧版缺失字段兼容为空", async () => {
  const f = await fixture();
  try {
    await f.backup.restore("valid.json");
    assert.deepEqual(f.restored()?.importedAssetSourceHistoryObservations, [observation]);
    f.document.formatVersion = 3;
    delete f.document.payload.importedAssetSourceHistoryObservations;
    await f.rewrite();
    await f.backup.restore("candidate.json");
    assert.deepEqual(f.restored()?.importedAssetSourceHistoryObservations, []);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test("来源历史恢复拒绝无效字段、重复日期和悬空引用，失败不替换业务数据", async () => {
  const invalid: unknown[] = [
    undefined, {}, [null],
    [{ ...observation, day: "2026-02-30" }],
    [{ ...observation, capturedAt: "2026-02-30T12:00:00Z" }],
    [{ ...observation, complete: "true" }],
    [{ ...observation, status: "unknown" }],
    [{ ...observation, complete: false }],
    [{ ...observation, total: { USD: "NaN", CNY: "0" } }],
    [{ ...observation, total: { USD: "-1", CNY: "0" } }],
    [{ ...observation, sourceId: "missing" }],
    [observation, observation],
  ];
  for (const value of invalid) {
    const f = await fixture();
    try {
      f.document.payload.importedAssetSourceHistoryObservations = value;
      await f.rewrite();
      await assert.rejects(f.backup.restore("candidate.json"), /备份/);
      assert.equal(f.restored(), null);
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  }
});
