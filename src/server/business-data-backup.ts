import { createHash } from "node:crypto";
import path from "node:path";

import type {
  AssetSourceSummary,
  Card,
  Clock,
  DailyAssetSnapshot,
  DailyAssetTrendObservation,
  InvestmentCashflow,
  InvestmentCashflowCurrency,
} from "@/server/ports";
import {
  assertInvestmentCashflowSequence,
  normalizeInvestmentCashflowInput,
} from "@/domain/investment-performance";
import { decimalCompare } from "@/domain/decimal";
import { convertCurrencyAmount } from "@/domain/valuation";
import {
  atomicWritePrivateFile,
  ensurePrivateDirectory,
  readPrivateFile,
} from "@/server/local-data-permissions";

const BACKUP_FORMAT = "personal-asset-dashboard-business-data";
const BACKUP_FORMAT_VERSION = 3;
const SUPPORTED_BACKUP_VERSIONS = new Set([1, 2, BACKUP_FORMAT_VERSION]);

export const SENSITIVE_ASSET_DATA_WARNING =
  "备份仍包含敏感资产数据，请仅存放在受保护的位置。";

const FORBIDDEN_FIELD_NAMES = new Set([
  "apikey",
  "apisecret",
  "passphrase",
  "oauthtoken",
  "accesstoken",
  "refreshtoken",
  "codeverifier",
  "codechallenge",
  "pkce",
  "secretstore",
  "credentialreference",
  "passkey",
  "passwordsalt",
  "passwordhash",
  "passwordderivedkey",
  "totp",
  "totpsecret",
  "encryptedtotpsecret",
  "sealed",
]);

export interface BusinessDataState {
  assetCards: Card[];
  assetSources: AssetSourceSummary[];
  dailyAssetSnapshots: DailyAssetSnapshot[];
  dailyAssetTrendObservations: DailyAssetTrendObservation[];
  investmentCashflows: InvestmentCashflow[];
}

export interface BackupRestorePreview {
  sourceCount: number;
  cardCount: number;
  snapshotRange: { from: string | null; to: string | null };
  replaces: {
    sourceCount: number;
    cardCount: number;
    snapshotCount: number;
  };
  warning: string;
}

export interface BusinessDataBackup {
  exportBackup(fileName?: string): Promise<{
    fileName: string;
    checksum: string;
    warning: string;
  }>;
  previewRestore(fileName: string): Promise<BackupRestorePreview>;
  restore(fileName: string): Promise<BackupRestorePreview>;
}

export interface BusinessDataBackupStore {
  listAssetCards(): Promise<Card[]>;
  listSources(): Promise<AssetSourceSummary[]>;
  listDailyAssetSnapshots(): Promise<DailyAssetSnapshot[]>;
  listDailyAssetTrendObservations(): Promise<DailyAssetTrendObservation[]>;
  listInvestmentCashflows(): Promise<InvestmentCashflow[]>;
  validateBusinessData(state: BusinessDataState): Promise<void>;
  replaceBusinessData(state: BusinessDataState): Promise<void>;
}

type BackupPayload = {
  assetCards: Card[];
  assetSources: Array<Omit<AssetSourceSummary, "credentialReference">>;
  dailyAssetSnapshots: DailyAssetSnapshot[];
  dailyAssetTrendObservations: DailyAssetTrendObservation[];
  investmentCashflows: InvestmentCashflow[];
};

type BackupDocument = {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  createdAt: string;
  warning?: string;
  checksum: { algorithm: "sha256"; value: string };
  payload: BackupPayload;
};

type LegacyBackupDocument = {
  format: typeof BACKUP_FORMAT;
  formatVersion: 1;
  createdAt: string;
  checksum: { algorithm: "sha256"; value: string };
  data: {
    cards: Card[];
    sources: Array<Omit<AssetSourceSummary, "credentialReference">>;
    snapshots: DailyAssetSnapshot[];
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedFieldName(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function assertCredentialFree(value: unknown, location = "backup"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertCredentialFree(item, `${location}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = normalizedFieldName(key);
    if (
      FORBIDDEN_FIELD_NAMES.has(normalized) ||
      normalized.includes("secret") ||
      normalized.includes("credential") ||
      normalized.includes("password") ||
      normalized.includes("passphrase") ||
      normalized.includes("passkey") ||
      normalized.includes("totp") ||
      normalized.includes("pkce") ||
      normalized === "token" ||
      normalized.endsWith("token")
    ) {
      throw new Error(`备份包含禁止的凭证或认证字段: ${location}.${key}`);
    }
    assertCredentialFree(child, `${location}.${key}`);
  }
}

function checksumInput(document: Pick<BackupDocument, "format" | "formatVersion" | "createdAt" | "payload">): string {
  return JSON.stringify({
    format: document.format,
    formatVersion: document.formatVersion,
    createdAt: document.createdAt,
    payload: document.payload,
  });
}

function checksumFor(document: Pick<BackupDocument, "format" | "formatVersion" | "createdAt" | "payload">): string {
  return createHash("sha256").update(checksumInput(document)).digest("hex");
}

function checksumForParsedDocument(document: Record<string, unknown>): string {
  const contents = document.formatVersion === 1
    ? {
        format: document.format,
        formatVersion: document.formatVersion,
        createdAt: document.createdAt,
        data: document.data,
      }
    : {
        format: document.format,
        formatVersion: document.formatVersion,
        createdAt: document.createdAt,
        payload: document.payload,
      };
  return createHash("sha256").update(JSON.stringify(contents)).digest("hex");
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`备份字段无效: ${label}`);
  }
}

function assertArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error(`备份字段无效: ${label}`);
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`备份唯一约束失败: ${label}`);
  }
}

function assertIsoTime(value: unknown, label: string): asserts value is string {
  assertString(value, label);
  if (Number.isNaN(new Date(value).valueOf())) {
    throw new Error(`备份字段无效: ${label}`);
  }
}

function nullableAmount(
  value: unknown,
  label: string,
): string | null {
  if (value === null) return null;
  assertString(value, label);
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || decimalCompare(value, "0") <= 0) {
    throw new Error(`备份字段无效: ${label}`);
  }
  return value;
}

function isLongbridgeReferencePair(
  baseCurrency: string,
  quoteCurrency: string,
): boolean {
  return (
    (baseCurrency === "USD" &&
      (quoteCurrency === "CNY" || quoteCurrency === "HKD")) ||
    (quoteCurrency === "USD" &&
      (baseCurrency === "CNY" || baseCurrency === "HKD"))
  );
}

function restoredCashflows(value: unknown): InvestmentCashflow[] {
  assertArray(value, "payload.investmentCashflows");
  const cashflows = value.map((raw, index) => {
    if (!isRecord(raw)) {
      throw new Error(`备份字段无效: payload.investmentCashflows[${index}]`);
    }
    assertString(raw.id, `investmentCashflows[${index}].id`);
    assertString(raw.kind, `investmentCashflows[${index}].kind`);
    assertString(raw.occurredAt, `investmentCashflows[${index}].occurredAt`);
    assertString(raw.amount, `investmentCashflows[${index}].amount`);
    assertString(raw.currency, `investmentCashflows[${index}].currency`);
    if (raw.note !== null && typeof raw.note !== "string") {
      throw new Error(`备份字段无效: investmentCashflows[${index}].note`);
    }
    const normalized = normalizeInvestmentCashflowInput({
      kind: raw.kind as InvestmentCashflow["kind"],
      occurredAt: raw.occurredAt,
      amount: raw.amount,
      currency: raw.currency as InvestmentCashflowCurrency,
      note: raw.note,
    });
    if (!isRecord(raw.amounts)) {
      throw new Error(`备份字段无效: investmentCashflows[${index}].amounts`);
    }
    const amounts = {
      USD: nullableAmount(raw.amounts.USD, `investmentCashflows[${index}].amounts.USD`),
      CNY: nullableAmount(raw.amounts.CNY, `investmentCashflows[${index}].amounts.CNY`),
      HKD: nullableAmount(raw.amounts.HKD, `investmentCashflows[${index}].amounts.HKD`),
    };
    assertArray(raw.exchangeRates, `investmentCashflows[${index}].exchangeRates`);
    const exchangeRates = raw.exchangeRates.map((rate, rateIndex) => {
      if (!isRecord(rate)) {
        throw new Error(
          `备份字段无效: investmentCashflows[${index}].exchangeRates[${rateIndex}]`,
        );
      }
      assertString(
        rate.baseCurrency,
        `investmentCashflows[${index}].exchangeRates[${rateIndex}].baseCurrency`,
      );
      assertString(
        rate.quoteCurrency,
        `investmentCashflows[${index}].exchangeRates[${rateIndex}].quoteCurrency`,
      );
      assertString(
        rate.rate,
        `investmentCashflows[${index}].exchangeRates[${rateIndex}].rate`,
      );
      assertString(
        rate.source,
        `investmentCashflows[${index}].exchangeRates[${rateIndex}].source`,
      );
      assertIsoTime(
        rate.observedAt,
        `investmentCashflows[${index}].exchangeRates[${rateIndex}].observedAt`,
      );
      if (
        !rate.source.startsWith("Longbridge") ||
        !isLongbridgeReferencePair(rate.baseCurrency, rate.quoteCurrency) ||
        !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(rate.rate) ||
        decimalCompare(rate.rate, "0") <= 0
      ) {
        throw new Error(
          `备份字段无效: investmentCashflows[${index}].exchangeRates[${rateIndex}]`,
        );
      }
      return {
        baseCurrency: rate.baseCurrency,
        quoteCurrency: rate.quoteCurrency,
        rate: rate.rate,
        source: rate.source,
        observedAt: rate.observedAt,
      };
    });
    assertUnique(
      exchangeRates.map(({ baseCurrency, quoteCurrency }) =>
        `USD/${baseCurrency === "USD" ? quoteCurrency : baseCurrency}`,
      ),
      `investmentCashflows[${index}].exchangeRates 货币对重复`,
    );
    const expectedAmounts = (["USD", "CNY", "HKD"] as const).reduce(
      (expected, currency) => {
        expected[currency] = convertCurrencyAmount(
          normalized.amount,
          normalized.currency,
          currency,
          exchangeRates,
        );
        return expected;
      },
      {} as Record<InvestmentCashflowCurrency, string | null>,
    );
    if (
      (["USD", "CNY", "HKD"] as const).some(
        (currency) => amounts[currency] !== expectedAmounts[currency],
      )
    ) {
      throw new Error(`备份字段无效: investmentCashflows[${index}].amounts`);
    }
    assertIsoTime(raw.createdAt, `investmentCashflows[${index}].createdAt`);
    assertIsoTime(raw.updatedAt, `investmentCashflows[${index}].updatedAt`);
    return {
      id: raw.id,
      ...normalized,
      amounts,
      exchangeRates,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  });
  assertUnique(cashflows.map(({ id }) => id), "资金记录 ID 重复");
  assertInvestmentCashflowSequence(cashflows);
  return cashflows;
}

function validateReferences(state: BusinessDataState): void {
  assertUnique(state.assetSources.map(({ id }) => id), "资产来源 ID 重复");
  assertUnique(state.assetCards.map(({ id }) => id), "资产卡片 ID 重复");
  assertUnique(state.dailyAssetSnapshots.map(({ day }) => day), "日初基准日期重复");
  assertUnique(
    state.dailyAssetTrendObservations.map(({ day }) => day),
    "每日趋势观测日期重复",
  );
  const sourceIds = new Set(state.assetSources.map(({ id }) => id));
  for (const card of state.assetCards) {
    if (card.sourceId !== undefined && !sourceIds.has(card.sourceId)) {
      throw new Error(`备份引用完整性失败: 资产卡片 ${card.id} 引用了不存在的来源`);
    }
  }
  for (const snapshot of state.dailyAssetSnapshots) {
    assertUnique(
      snapshot.sources.map(({ sourceId }) => sourceId),
      `${snapshot.day} 的来源快照重复`,
    );
    for (const source of snapshot.sources) {
      if (!sourceIds.has(source.sourceId)) {
        throw new Error(
          `备份引用完整性失败: ${snapshot.day} 引用了不存在的来源 ${source.sourceId}`,
        );
      }
    }
  }
  for (const observation of state.dailyAssetTrendObservations) {
    assertUnique(
      observation.sources.map(({ sourceId }) => sourceId),
      `${observation.day} 的趋势来源观测重复`,
    );
    for (const source of observation.sources) {
      if (!sourceIds.has(source.sourceId)) {
        throw new Error(
          `备份引用完整性失败: ${observation.day} 的趋势观测引用了不存在的来源 ${source.sourceId}`,
        );
      }
    }
  }
  assertUnique(
    state.investmentCashflows.map(({ id }) => id),
    "资金记录 ID 重复",
  );
  assertInvestmentCashflowSequence(state.investmentCashflows);
}

function parseDocument(contents: string): BackupDocument {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch (error) {
    throw new Error("备份 JSON 已损坏", { cause: error });
  }
  assertCredentialFree(value);
  if (!isRecord(value)) throw new Error("备份格式无效");
  if (value.format !== BACKUP_FORMAT) throw new Error("备份格式标识无效");
  if (
    typeof value.formatVersion !== "number" ||
    !SUPPORTED_BACKUP_VERSIONS.has(value.formatVersion)
  ) {
    throw new Error(`不支持的备份格式版本: ${String(value.formatVersion)}`);
  }
  assertString(value.createdAt, "createdAt");
  if (!isRecord(value.checksum) || value.checksum.algorithm !== "sha256") {
    throw new Error("备份校验和格式无效");
  }
  assertString(value.checksum.value, "checksum.value");
  if (checksumForParsedDocument(value) !== value.checksum.value) {
    throw new Error("备份校验和不匹配");
  }
  if (value.formatVersion === 1) {
    if (!isRecord(value.data)) throw new Error("旧版备份 data 无效");
    assertArray(value.data.cards, "data.cards");
    assertArray(value.data.sources, "data.sources");
    assertArray(value.data.snapshots, "data.snapshots");
    const legacy = value as unknown as LegacyBackupDocument;
    return {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: legacy.createdAt,
      warning: SENSITIVE_ASSET_DATA_WARNING,
      checksum: legacy.checksum,
      payload: {
        assetCards: legacy.data.cards,
        assetSources: legacy.data.sources,
        dailyAssetSnapshots: legacy.data.snapshots,
        dailyAssetTrendObservations: legacy.data.snapshots,
        investmentCashflows: [],
      },
    };
  }
  if (!isRecord(value.payload)) throw new Error("备份 payload 无效");
  assertArray(value.payload.assetCards, "payload.assetCards");
  assertArray(value.payload.assetSources, "payload.assetSources");
  assertArray(value.payload.dailyAssetSnapshots, "payload.dailyAssetSnapshots");
  const document = value as unknown as BackupDocument;
  if (!Array.isArray(document.payload.dailyAssetTrendObservations)) {
    document.payload.dailyAssetTrendObservations = structuredClone(
      document.payload.dailyAssetSnapshots,
    );
  }
  if (!Array.isArray(document.payload.investmentCashflows)) {
    document.payload.investmentCashflows = [];
  }
  return document;
}

function restoredState(document: BackupDocument): BusinessDataState {
  const sources = document.payload.assetSources.map((source) => {
    if (!isRecord(source)) throw new Error("资产来源备份格式无效");
    assertString(source.id, "assetSources.id");
    assertString(source.kind, "assetSources.kind");
    assertString(source.label, "assetSources.label");
    assertString(source.accountId, "assetSources.accountId");
    if (!Array.isArray(source.permissions)) throw new Error("资产来源权限格式无效");
    if (!isRecord(source.snapshot) || !Array.isArray(source.snapshot.holdings)) {
      throw new Error("资产来源快照格式无效");
    }
    if (!isRecord(source.sync)) throw new Error("资产来源同步状态格式无效");
    return {
      ...(source as unknown as Omit<AssetSourceSummary, "credentialReference">),
      credentialReference: null,
      lifecycle: "disconnected" as const,
      sync: {
        ...(source.sync as unknown as AssetSourceSummary["sync"]),
        status: "expired" as const,
        error: "已从备份恢复，需重新授权后才能同步",
      },
    };
  });
  const state = {
    assetCards: document.payload.assetCards,
    assetSources: sources,
    dailyAssetSnapshots: document.payload.dailyAssetSnapshots,
    dailyAssetTrendObservations: document.payload.dailyAssetTrendObservations,
    investmentCashflows: restoredCashflows(document.payload.investmentCashflows),
  };
  validateReferences(state);
  return state;
}

export class CredentialFreeBusinessDataBackup implements BusinessDataBackup {
  constructor(
    private readonly store: BusinessDataBackupStore,
    private readonly backupDirectory: string,
    private readonly clock: Clock,
  ) {}

  private backupPath(fileName: string): string {
    if (
      path.basename(fileName) !== fileName ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(fileName)
    ) {
      throw new Error("备份文件名无效");
    }
    return path.join(this.backupDirectory, fileName);
  }

  private async decode(fileName: string): Promise<BusinessDataState> {
    const document = parseDocument(await readPrivateFile(this.backupPath(fileName)));
    const state = restoredState(document);
    await this.store.validateBusinessData(state);
    return state;
  }

  private async previewFor(state: BusinessDataState): Promise<BackupRestorePreview> {
    const [currentSources, currentCards, currentSnapshots] = await Promise.all([
      this.store.listSources(),
      this.store.listAssetCards(),
      this.store.listDailyAssetSnapshots(),
    ]);
    const days = state.dailyAssetSnapshots.map(({ day }) => day).sort();
    return {
      sourceCount: state.assetSources.length,
      cardCount: state.assetCards.length,
      snapshotRange: {
        from: days[0] ?? null,
        to: days.at(-1) ?? null,
      },
      replaces: {
        sourceCount: currentSources.length,
        cardCount: currentCards.length,
        snapshotCount: currentSnapshots.length,
      },
      warning: SENSITIVE_ASSET_DATA_WARNING,
    };
  }

  async exportBackup(fileName?: string) {
    const createdAt = this.clock.now().toISOString();
    const resolvedFileName = fileName ?? `asset-dashboard-${createdAt.replace(/[:.]/g, "-")}.json`;
    const [
      assetCards,
      sources,
      dailyAssetSnapshots,
      dailyAssetTrendObservations,
      investmentCashflows,
    ] = await Promise.all([
      this.store.listAssetCards(),
      this.store.listSources(),
      this.store.listDailyAssetSnapshots(),
      this.store.listDailyAssetTrendObservations(),
      this.store.listInvestmentCashflows(),
    ]);
    const assetSources = sources.map(
      ({ credentialReference: _credentialReference, ...source }) => source,
    );
    const base = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt,
      payload: {
        assetCards,
        assetSources,
        dailyAssetSnapshots,
        dailyAssetTrendObservations,
        investmentCashflows,
      },
    } satisfies Pick<BackupDocument, "format" | "formatVersion" | "createdAt" | "payload">;
    const checksum = checksumFor(base);
    const document: BackupDocument = {
      ...base,
      warning: SENSITIVE_ASSET_DATA_WARNING,
      checksum: { algorithm: "sha256", value: checksum },
    };
    assertCredentialFree(document);
    await ensurePrivateDirectory(this.backupDirectory);
    await atomicWritePrivateFile(
      this.backupPath(resolvedFileName),
      `${JSON.stringify(document, null, 2)}\n`,
    );
    return {
      fileName: resolvedFileName,
      checksum,
      warning: SENSITIVE_ASSET_DATA_WARNING,
    };
  }

  async previewRestore(fileName: string): Promise<BackupRestorePreview> {
    return this.previewFor(await this.decode(fileName));
  }

  async restore(fileName: string): Promise<BackupRestorePreview> {
    const state = await this.decode(fileName);
    const preview = await this.previewFor(state);
    await this.store.replaceBusinessData(state);
    return preview;
  }
}
