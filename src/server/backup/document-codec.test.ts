import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { AssetSourceSummary } from "@/server/ports";
import {
  decodeBackupDocument,
  encodeBackupDocument,
  SENSITIVE_ASSET_DATA_WARNING,
  type BusinessDataState,
} from "./document-codec";

const at = "2026-08-02T00:00:00.000Z";

function source(id: string, kind: AssetSourceSummary["kind"]): AssetSourceSummary {
  return {
    id, kind, label: id, accountId: id, permissions: [],
    credentialReference: kind === "manual" ? null : "fixture-private-reference",
    lifecycle: "connected",
    snapshot: {
      total: { amount: "0", currency: "USD" },
      holdings: [], exchangeRates: [], syncedAt: at,
    },
    sync: { status: "current", lastSuccessfulAt: at, lastAttemptAt: at, error: null },
  };
}

function businessState(): BusinessDataState {
  const observation = {
    day: "2026-08-01", capturedAt: at, complete: true,
    total: { USD: "0", CNY: "0", HKD: null },
    sources: [{
      sourceId: "automatic", kind: "longbridge", label: "automatic",
      capturedAt: at, complete: true, total: { USD: "0", CNY: "0", HKD: null },
    }],
  };
  return {
    assetCards: [{
      id: "card", kind: "asset", title: "备份卡片", body: "保留布局",
      sourceId: "automatic", span: 2, hidden: true, startsNewRow: true,
    }],
    assetSources: [source("automatic", "longbridge"), source("manual", "manual")],
    dailyAssetSnapshots: [observation],
    dailyAssetTrendObservations: [structuredClone(observation)],
    importedAssetSourceHistoryObservations: [{
      ...observation.sources[0], day: observation.day,
    }],
    investmentCashflows: [],
    manualAssetRecords: [{
      sourceId: "manual", day: observation.day, amount: "0", currency: "USD", recordedAt: at,
    }],
    formalDailySettlements: [],
    sourceInvestmentHistories: [{
      sourceId: "manual", sourceLabel: "manual", provider: "external-ledger",
      accountId: "fixture-history", accountName: "测试账户", currency: "USD",
      openingInvestment: { day: observation.day, amount: "0" }, openingBasis: "测试期初",
      importedAt: at,
      records: [{ id: "history-value", day: observation.day, kind: "valuation", amount: "0" }],
      reconciliation: { asOf: observation.day, netInvestment: "0", total: "0", profit: "0" },
    }],
    sourceInvestmentRecords: [{
      id: "local-value", sourceId: "automatic", day: observation.day,
      kind: "valuation", amount: "0", currency: "USD", recordedAt: at,
    }],
  };
}

// 独立生成各版本的校验和，避免用待测编码器验证自身的协议错误。
function signedDocument(formatVersion: number, payload: unknown): string {
  const base = {
    format: "personal-asset-dashboard-business-data",
    formatVersion,
    createdAt: at,
    ...(formatVersion === 1 ? { data: payload } : { payload }),
  };
  return JSON.stringify({
    ...base,
    checksum: {
      algorithm: "sha256",
      value: createHash("sha256").update(JSON.stringify(base)).digest("hex"),
    },
  });
}

function payload() {
  return JSON.parse(encodeBackupDocument(businessState(), at).contents).payload;
}

test("备份编码保持现有字段顺序与校验和，移除凭证引用且不修改输入", () => {
  const state = businessState();
  Object.assign(state.assetSources[0].sync, { unsafeRawError: "fixture-raw-error" });
  const before = structuredClone(state);
  const encoded = encodeBackupDocument(state, at);
  const assetSources = state.assetSources.map(({ credentialReference: _reference, ...row }) => ({
    ...row,
    sync: { status: "current", lastSuccessfulAt: at, lastAttemptAt: at, error: null },
  }));
  const expectedPayload = {
    assetCards: state.assetCards,
    assetSources,
    dailyAssetSnapshots: state.dailyAssetSnapshots,
    dailyAssetTrendObservations: state.dailyAssetTrendObservations,
    importedAssetSourceHistoryObservations: state.importedAssetSourceHistoryObservations,
    investmentCashflows: state.investmentCashflows,
    manualAssetRecords: state.manualAssetRecords,
    formalDailySettlements: state.formalDailySettlements,
    sourceInvestmentHistories: state.sourceInvestmentHistories,
    sourceInvestmentRecords: state.sourceInvestmentRecords,
  };
  const expected = JSON.parse(signedDocument(7, expectedPayload));
  assert.equal(encoded.checksum, expected.checksum.value);
  assert.equal(encoded.contents, JSON.stringify({
    format: expected.format, formatVersion: 7, createdAt: at, payload: expectedPayload,
    warning: SENSITIVE_ASSET_DATA_WARNING, checksum: expected.checksum,
  }, null, 2) + "\n");
  assert.ok(!encoded.contents.includes("fixture-private-reference"));
  assert.ok(!encoded.contents.includes("fixture-raw-error"));
  assert.deepEqual(state, before);
});

test("备份解码保留零值与来源独立历史，仅自动来源要求重新授权", () => {
  const state = businessState();
  const { state: restored, formatVersion } = decodeBackupDocument(encodeBackupDocument(state, at).contents);
  const expected = structuredClone(state);
  expected.assetSources[0].credentialReference = null;
  expected.assetSources[0].lifecycle = "disconnected";
  expected.assetSources[0].sync.status = "expired";
  expected.assetSources[0].sync.error = "已从备份恢复，需重新授权后才能同步";
  assert.equal(formatVersion, 7);
  assert.deepEqual(restored, expected);
  assert.deepEqual(state, businessState());
});

test("备份往返保留全部受支持来源类型及手工与自动来源恢复语义", () => {
  const kinds = ["longbridge", "binance", "okx", "bitget", "bit",
    "evm-watch-ethereum", "evm-watch-bsc", "manual"] as const;
  for (const kind of kinds) {
    const state = businessState();
    state.assetSources[0] = source("automatic", kind);
    const before = structuredClone(state);
    const { state: restored } = decodeBackupDocument(encodeBackupDocument(state, at).contents);
    assert.equal(restored.assetSources[0].kind, kind);
    assert.equal(restored.assetSources[0].credentialReference, null);
    assert.equal(restored.assetSources[0].lifecycle, kind === "manual" ? "connected" : "disconnected");
    assert.equal(restored.assetSources[0].sync.status, kind === "manual" ? "current" : "expired");
    assert.deepEqual(state, before);
  }
});

test("有效校验和不能绕过来源类型校验，未知来源不被静默丢弃或转换", () => {
  for (const kind of ["fixture", "__proto__", "constructor", "manual ", null, 1, ["manual"]]) {
    const data = payload();
    data.assetSources[1].kind = kind;
    assert.throws(() => decodeBackupDocument(signedDocument(7, data)), /资产来源类型|assetSources.kind/);
  }
});

for (const version of [1, 2, 3, 4, 5, 6]) {
  test(`旧备份 v${version} 只补默认空集合，不推算缺失业务记录`, () => {
    const data = payload();
    if (version < 7) delete data.sourceInvestmentRecords;
    if (version < 6) delete data.sourceInvestmentHistories;
    if (version < 5) {
      delete data.manualAssetRecords;
      delete data.formalDailySettlements;
      delete data.dailyAssetTrendObservations;
      delete data.investmentCashflows;
    }
    if (version < 4) delete data.importedAssetSourceHistoryObservations;
    const legacy = version === 1
      ? { cards: data.assetCards, sources: data.assetSources, snapshots: data.dailyAssetSnapshots }
      : data;
    const restored = decodeBackupDocument(signedDocument(version, legacy));
    assert.equal(restored.formatVersion, version);
    assert.deepEqual(restored.state.dailyAssetSnapshots, businessState().dailyAssetSnapshots);
    assert.deepEqual(restored.state.dailyAssetTrendObservations, businessState().dailyAssetSnapshots);
    assert.equal(restored.state.importedAssetSourceHistoryObservations.length, version < 4 ? 0 : 1);
    assert.equal(restored.state.manualAssetRecords.length, version < 5 ? 0 : 1);
    assert.equal(restored.state.sourceInvestmentHistories?.length, version < 6 ? 0 : 1);
    assert.deepEqual(restored.state.sourceInvestmentRecords, []);
    assert.deepEqual(restored.state.investmentCashflows, []);
    assert.deepEqual(restored.state.formalDailySettlements, []);
  });
}

test("备份编解码拒绝深层和变体凭证字段，包括有效校验和的文档", () => {
  for (const field of ["API_Key", "access-token", "Credential_Reference", "nestedSecret"]) {
    const state = businessState();
    Object.assign(state.assetSources[0].snapshot, { extra: [{ [field]: "fixture-value" }] });
    assert.throws(() => encodeBackupDocument(state, at), /禁止的凭证或认证字段/);
    const data = payload();
    data.assetSources[0].snapshot.extra = [{ [field]: "fixture-value" }];
    assert.throws(() => decodeBackupDocument(signedDocument(7, data)), /禁止的凭证或认证字段/);
  }
});

test("备份解码拒绝损坏 JSON、未知版本、错误校验和和当前版本缺失集合", () => {
  assert.throws(() => decodeBackupDocument("{invalid"), /JSON 已损坏/);
  assert.throws(() => decodeBackupDocument(signedDocument(8, payload())), /不支持的备份格式版本/);
  const tampered = JSON.parse(encodeBackupDocument(businessState(), at).contents);
  tampered.payload.assetCards[0].title = "被修改";
  assert.throws(() => decodeBackupDocument(JSON.stringify(tampered)), /校验和不匹配/);
  for (const field of Object.keys(payload())) {
    const data = payload();
    delete data[field];
    assert.throws(() => decodeBackupDocument(signedDocument(7, data)), /备份字段无效/, field);
  }
});

test("备份解码拒绝重复身份和悬空引用，不返回部分恢复结果", () => {
  const duplicate = payload();
  duplicate.assetSources.push(duplicate.assetSources[0]);
  assert.throws(() => decodeBackupDocument(signedDocument(7, duplicate)), /资产来源 ID 重复/);
  const dangling = payload();
  dangling.assetCards[0].sourceId = "missing";
  assert.throws(() => decodeBackupDocument(signedDocument(7, dangling)), /引用完整性失败/);
});
