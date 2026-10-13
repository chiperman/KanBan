import { createHash } from "node:crypto";
import { isAssetSourceKind } from "@/domain/asset-source-kinds";
import { parseSourceInvestmentHistory, type SourceInvestmentHistory } from "@/domain/source-investment-history";
import { parseSourceInvestmentRecordInput, type SourceInvestmentRecord } from "@/domain/source-investment-records";
import { normalizeAssetSyncState } from "@/server/asset-sync-diagnostics";

import type {
  AssetSourceSummary,
  Card,
  DailyAssetSnapshot,
  DailyAssetTrendObservation,
  ImportedAssetSourceHistoryObservation,
  InvestmentCashflow,
  InvestmentCashflowCurrency,
  FormalDailySettlement,
  ManualAssetRecord,
} from "@/server/ports";
import {
  assertInvestmentCashflowSequence,
  normalizeInvestmentCashflowInput,
} from "@/domain/investment-performance";
import { decimalCompare } from "@/domain/decimal";
import { convertCurrencyAmount } from "@/domain/valuation";

const BACKUP_FORMAT = "personal-asset-dashboard-business-data";
export const BACKUP_FORMAT_VERSION = 7;
const SUPPORTED_BACKUP_VERSIONS = new Set([1, 2, 3, 4, 5, 6, BACKUP_FORMAT_VERSION]);

export const SENSITIVE_ASSET_DATA_WARNING =
  "备份仍包含敏感资产数据，请仅存放在受保护的位置。";
export const LEGACY_HISTORY_WARNING =
  "旧版备份不包含手工多日原始记录和正式日结；恢复不会推算缺失历史，并会替换为空。";

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
  sourceInvestmentHistories?: SourceInvestmentHistory[];
  sourceInvestmentRecords?: SourceInvestmentRecord[];
  assetCards: Card[];
  assetSources: AssetSourceSummary[];
  dailyAssetSnapshots: DailyAssetSnapshot[];
  dailyAssetTrendObservations: DailyAssetTrendObservation[];
  importedAssetSourceHistoryObservations: ImportedAssetSourceHistoryObservation[];
  investmentCashflows: InvestmentCashflow[];
  manualAssetRecords: ManualAssetRecord[];
  formalDailySettlements: FormalDailySettlement[];
}

export interface BackupRestorePreview {
  /** Explicit loss consent binds to this file and current omitted facts. */
  discardConfirmation?: string;
  omittedHistory?: { manualAssetRecords: number; formalDailySettlements: number; sourceInvestmentHistories?: number; sourceInvestmentRecords?: number };
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
  restore(fileName: string, discardConfirmation?: string): Promise<BackupRestorePreview>;
}

export interface BusinessDataBackupStore {
  listSourceInvestmentHistories?(): Promise<SourceInvestmentHistory[]>;
  listSourceInvestmentRecords?(sourceId?: string): Promise<SourceInvestmentRecord[]>;
  listAssetCards(): Promise<Card[]>;
  listSources(): Promise<AssetSourceSummary[]>;
  listDailyAssetSnapshots(): Promise<DailyAssetSnapshot[]>;
  listDailyAssetTrendObservations(): Promise<DailyAssetTrendObservation[]>;
  listImportedSourceHistoryObservations(): Promise<
    ImportedAssetSourceHistoryObservation[]
  >;
  listInvestmentCashflows(): Promise<InvestmentCashflow[]>;
  listManualAssetRecords(): Promise<ManualAssetRecord[]>;
  listFormalDailySettlements(): Promise<FormalDailySettlement[]>;
  validateBusinessData(state: BusinessDataState): Promise<void>;
  replaceBusinessData(state: BusinessDataState): Promise<void>;
}

type BackupPayload = {
  sourceInvestmentHistories?: SourceInvestmentHistory[];
  sourceInvestmentRecords?: SourceInvestmentRecord[];
  assetCards: Card[];
  assetSources: Array<Omit<AssetSourceSummary, "credentialReference">>;
  dailyAssetSnapshots: DailyAssetSnapshot[];
  dailyAssetTrendObservations: DailyAssetTrendObservation[];
  importedAssetSourceHistoryObservations: ImportedAssetSourceHistoryObservation[];
  investmentCashflows: InvestmentCashflow[];
  manualAssetRecords: ManualAssetRecord[];
  formalDailySettlements: FormalDailySettlement[];
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

function assertCalendarDay(value: unknown, label: string): asserts value is string {
  assertString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`备份字段无效: ${label}`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`备份字段无效: ${label}`);
  }
}

function assertStrictIsoTime(value: unknown, label: string): asserts value is string {
  assertString(value, label);
  const match = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (match === null || Number.isNaN(new Date(value).valueOf())) {
    throw new Error(`备份字段无效: ${label}`);
  }
  assertCalendarDay(match[1], label);
}

function nullableNonNegativeAmount(value: unknown, label: string): string | null {
  if (value === null) return null;
  assertString(value, label);
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new Error(`备份字段无效: ${label}`);
  }
  return value;
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

function restoredImportedSourceHistory(
  value: unknown,
): ImportedAssetSourceHistoryObservation[] {
  assertArray(value, "payload.importedAssetSourceHistoryObservations");
  return value.map((raw, index) => {
    const label = "importedAssetSourceHistoryObservations[" + index + "]";
    if (!isRecord(raw)) throw new Error("备份字段无效: " + label);
    assertCalendarDay(raw.day, label + ".day");
    assertString(raw.sourceId, label + ".sourceId");
    assertString(raw.label, label + ".label");
    assertString(raw.kind, label + ".kind");
    assertStrictIsoTime(raw.capturedAt, label + ".capturedAt");
    if (typeof raw.complete !== "boolean" || !isRecord(raw.total)) {
      throw new Error("备份字段无效: " + label);
    }
    const status = raw.status;
    if (status !== undefined && status !== "complete" &&
        status !== "incomplete" && status !== "expired") {
      throw new Error("备份字段无效: " + label + ".status");
    }
    if (status !== undefined && (status === "complete") !== raw.complete) {
      throw new Error("备份字段无效: " + label + ".complete/status");
    }
    return {
      day: raw.day,
      sourceId: raw.sourceId,
      label: raw.label,
      kind: raw.kind,
      capturedAt: raw.capturedAt,
      complete: raw.complete,
      ...(status === undefined ? {} : { status }),
      total: {
        USD: nullableNonNegativeAmount(raw.total.USD, label + ".total.USD"),
        CNY: nullableNonNegativeAmount(raw.total.CNY, label + ".total.CNY"),
        ...(raw.total.HKD === undefined ? {} : {
          HKD: nullableNonNegativeAmount(raw.total.HKD, label + ".total.HKD"),
        }),
      },
    };
  });
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

function enumValue<const T extends readonly string[]>(
  value: unknown, values: T, label: string,
): T[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new Error('备份字段无效: ' + label);
  }
  return value as T[number];
}

function signedAmount(value: unknown, label: string): string {
  assertString(value, label);
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new Error('备份字段无效: ' + label);
  }
  return value;
}

function nullableText(value: unknown, label: string): string | null {
  if (value === null || typeof value === "string") return value;
  throw new Error('备份字段无效: ' + label);
}

function nullableTime(value: unknown, label: string): string | null {
  if (value === null) return null;
  assertStrictIsoTime(value, label);
  return value;
}

function restoredManualRecords(value: unknown): ManualAssetRecord[] {
  assertArray(value, "payload.manualAssetRecords");
  return value.map((raw, index) => {
    const label = 'manualAssetRecords[' + index + ']';
    if (!isRecord(raw)) throw new Error('备份字段无效: ' + label);
    assertString(raw.sourceId, label + '.sourceId');
    assertCalendarDay(raw.day, label + '.day');
    assertString(raw.amount, label + '.amount');
    nullableNonNegativeAmount(raw.amount, label + '.amount');
    assertStrictIsoTime(raw.recordedAt, label + '.recordedAt');
    return {
      sourceId: raw.sourceId, day: raw.day, amount: raw.amount,
      currency: enumValue(raw.currency, ["USD", "CNY", "HKD"], label + '.currency'),
      recordedAt: raw.recordedAt,
    };
  });
}

const SETTLEMENT_STATUSES = ["complete", "incomplete", "missed"] as const;
const SECURITIES_MARKETS = ["US", "HK", "SH", "SZ", "SG"] as const;

function settlementValues(raw: Record<string, unknown>, label: string) {
  if (!isRecord(raw.total)) throw new Error('备份字段无效: ' + label + '.total');
  // 负持仓/现金可形成负净值；保留符号与精度，不重新估值历史。
  const amount = (value: unknown, currency: string) => value === null
    ? null : signedAmount(value, label + '.total.' + currency);
  return {
    capturedAt: nullableTime(raw.capturedAt, label + '.capturedAt'),
    status: enumValue(raw.status, SETTLEMENT_STATUSES, label + '.status'),
    diagnostic: nullableText(raw.diagnostic, label + '.diagnostic'),
    total: { USD: amount(raw.total.USD, "USD"), CNY: amount(raw.total.CNY, "CNY"), HKD: amount(raw.total.HKD, "HKD") },
  };
}

function restoredFormalSettlements(value: unknown): FormalDailySettlement[] {
  assertArray(value, "payload.formalDailySettlements");
  return value.map((raw, index): FormalDailySettlement => {
    const label = 'formalDailySettlements[' + index + ']';
    if (!isRecord(raw) || !isRecord(raw.anchor)) throw new Error('备份字段无效: ' + label);
    const anchor = raw.anchor;
    assertString(anchor.key, label + '.anchor.key');
    assertCalendarDay(anchor.tradingDay, label + '.anchor.tradingDay');
    assertStrictIsoTime(anchor.scheduledCloseAt, label + '.anchor.scheduledCloseAt');
    const kind = enumValue(anchor.kind, ["securities-close", "crypto-cutoff"], label + '.anchor.kind');
    const market = kind === "securities-close"
      ? enumValue(anchor.market, SECURITIES_MARKETS, label + '.anchor.market') : null;
    if ((kind === "crypto-cutoff" && anchor.market !== null) ||
        anchor.key !== (kind === "securities-close" ? kind + ':' + market : kind) + ':' + anchor.tradingDay) {
      throw new Error('备份字段无效: ' + label + '.anchor');
    }
    const anchorFields = { key: anchor.key, tradingDay: anchor.tradingDay, scheduledCloseAt: anchor.scheduledCloseAt };
    const restoredAnchor: FormalDailySettlement["anchor"] = market === null
      ? { ...anchorFields, kind: "crypto-cutoff", market: null }
      : { ...anchorFields, kind: "securities-close", market };
    assertArray(raw.exchangeRates, label + '.exchangeRates');
    const exchangeRates = raw.exchangeRates.map((rate, rateIndex) => {
      const rateLabel = label + '.exchangeRates[' + rateIndex + ']';
      if (!isRecord(rate)) throw new Error('备份字段无效: ' + rateLabel);
      assertString(rate.baseCurrency, rateLabel + '.baseCurrency');
      assertString(rate.quoteCurrency, rateLabel + '.quoteCurrency');
      assertString(rate.rate, rateLabel + '.rate');
      nullableAmount(rate.rate, rateLabel + '.rate');
      assertString(rate.source, rateLabel + '.source');
      assertStrictIsoTime(rate.observedAt, rateLabel + '.observedAt');
      return { baseCurrency: rate.baseCurrency, quoteCurrency: rate.quoteCurrency,
        rate: rate.rate, source: rate.source, observedAt: rate.observedAt };
    });
    assertArray(raw.sources, label + '.sources');
    const sources = raw.sources.map((source, sourceIndex) => {
      const sourceLabel = label + '.sources[' + sourceIndex + ']';
      if (!isRecord(source)) throw new Error('备份字段无效: ' + sourceLabel);
      assertString(source.sourceId, sourceLabel + '.sourceId');
      assertString(source.label, sourceLabel + '.label');
      assertString(source.kind, sourceLabel + '.kind');
      return { sourceId: source.sourceId, label: source.label, kind: source.kind,
        ...settlementValues(source, sourceLabel) };
    });
    assertUnique(sources.map(({ sourceId }) => sourceId), label + '.sources重复');
    assertArray(raw.holdings, label + '.holdings');
    const holdings = raw.holdings.map((holding, holdingIndex) => {
      const holdingLabel = label + '.holdings[' + holdingIndex + ']';
      if (!isRecord(holding)) throw new Error('备份字段无效: ' + holdingLabel);
      assertString(holding.sourceId, holdingLabel + '.sourceId');
      assertString(holding.symbol, holdingLabel + '.symbol');
      assertString(holding.name, holdingLabel + '.name');
      if (holding.sourceAsset !== null) assertString(holding.sourceAsset, holdingLabel + '.sourceAsset');
      let price: { amount: string; currency: string } | null = null;
      if (holding.price !== null) {
        if (!isRecord(holding.price)) throw new Error('备份字段无效: ' + holdingLabel + '.price');
        assertString(holding.price.amount, holdingLabel + '.price.amount');
        nullableNonNegativeAmount(holding.price.amount, holdingLabel + '.price.amount');
        assertString(holding.price.currency, holdingLabel + '.price.currency');
        price = { amount: holding.price.amount, currency: holding.price.currency };
      }
      if (holding.marketTradingDay !== null) assertCalendarDay(holding.marketTradingDay, holdingLabel + '.marketTradingDay');
      return {
        sourceId: holding.sourceId, sourceAsset: holding.sourceAsset,
        symbol: holding.symbol, name: holding.name,
        quantity: signedAmount(holding.quantity, holdingLabel + '.quantity'),
        assetClass: enumValue(holding.assetClass, ["securities", "crypto", "cash"], holdingLabel + '.assetClass'),
        price,
        priceBasis: enumValue(holding.priceBasis, ["official-close", "capture-time", "unavailable"], holdingLabel + '.priceBasis'),
        priceObservedAt: nullableTime(holding.priceObservedAt, holdingLabel + '.priceObservedAt'),
        market: holding.market === null ? null : enumValue(holding.market, SECURITIES_MARKETS, holdingLabel + '.market'),
        marketTradingDay: holding.marketTradingDay,
        marketValue: holding.marketValue === null ? null : signedAmount(holding.marketValue, holdingLabel + '.marketValue'),
        diagnostic: nullableText(holding.diagnostic, holdingLabel + '.diagnostic'),
      };
    });
    assertUnique(holdings.map(({ sourceId, sourceAsset, symbol }) =>
      JSON.stringify([sourceId, sourceAsset ?? symbol])), label + '.holdings重复');
    return { anchor: restoredAnchor, ...settlementValues(raw, label), exchangeRates, sources, holdings };
  });
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
  assertUnique((state.sourceInvestmentHistories ?? []).map(({ sourceId }) => sourceId), "来源投资历史重复");
  for (const history of state.sourceInvestmentHistories ?? []) {
    parseSourceInvestmentHistory(history);
    const source = state.assetSources.find(row => row.id === history.sourceId);
    if (!source || (source.kind !== "manual" && source.kind !== "longbridge") || source.label !== history.sourceLabel) {
      throw new Error("来源投资历史引用了不存在或身份不匹配的来源");
    }
  }
  assertUnique((state.sourceInvestmentRecords ?? []).map(row => row.id), "来源投资记录 ID 重复");
  const bySource = new Map<string, SourceInvestmentRecord[]>();
  for (const record of state.sourceInvestmentRecords ?? []) {
    parseSourceInvestmentRecordInput(record, record.recordedAt);
    if (!sourceIds.has(record.sourceId)) throw new Error("来源投资记录引用了不存在的来源");
    const group = bySource.get(record.sourceId) ?? [];
    group.push(record); bySource.set(record.sourceId, group);
  }
  for (const [sourceId, records] of bySource) {
    const history = (state.sourceInvestmentHistories ?? []).find(row => row.sourceId === sourceId);
    const opening = records.filter(row => row.kind === "opening");
    if (opening.length > 1 || (opening.length && history)) throw new Error("来源投资记录期初本金冲突");
    if (opening.length && records.some(row => row.day < opening[0].day)) throw new Error("来源投资记录早于期初本金");
    if (history && records.some(row => row.day < history.openingInvestment.day)) throw new Error("来源投资记录早于导入历史期初日期");
    if (records.some(row => row.currency !== records[0].currency || (history && row.currency !== history.currency))) throw new Error("来源投资记录币种冲突");
    assertUnique(records.filter(row => row.kind === "valuation").map(row => row.day), "来源同日资产金额重复");
  }
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
    state.importedAssetSourceHistoryObservations.map(
      ({ sourceId, day }) => sourceId + ":" + day,
    ),
    "导入来源历史记录重复",
  );
  for (const observation of state.importedAssetSourceHistoryObservations) {
    if (!sourceIds.has(observation.sourceId)) {
      throw new Error(
        "备份引用完整性失败: 导入历史 " + observation.day + " 引用了不存在的来源 " + observation.sourceId,
      );
    }
  }
  assertUnique(state.manualAssetRecords.map(({ sourceId, day }) => `${sourceId}:${day}`), "手工资产记录重复");
  for (const record of state.manualAssetRecords) if (!sourceIds.has(record.sourceId)) throw new Error(`备份引用完整性失败: 手工记录引用了不存在的来源 ${record.sourceId}`);
  assertUnique(state.formalDailySettlements.map(({ anchor }) => anchor.key), "正式日结锚点重复");
  for (const settlement of state.formalDailySettlements) {
    const settlementSourceIds = new Set(settlement.sources.map(({ sourceId }) => sourceId));
    for (const sourceId of settlementSourceIds) if (!sourceIds.has(sourceId)) throw new Error(`备份引用完整性失败: 正式日结引用了不存在的来源 ${sourceId}`);
    for (const holding of settlement.holdings) if (!settlementSourceIds.has(holding.sourceId)) throw new Error(`备份引用完整性失败: 正式持仓引用了不存在的日结来源 ${holding.sourceId}`);
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
      formatVersion: 1,
      createdAt: legacy.createdAt,
      warning: SENSITIVE_ASSET_DATA_WARNING,
      checksum: legacy.checksum,
      payload: {
        assetCards: legacy.data.cards,
        assetSources: legacy.data.sources,
        dailyAssetSnapshots: legacy.data.snapshots,
        dailyAssetTrendObservations: legacy.data.snapshots,
        importedAssetSourceHistoryObservations: [],
        investmentCashflows: [],
        manualAssetRecords: [],
        formalDailySettlements: [],
      },
    };
  }
  if (!isRecord(value.payload)) throw new Error("备份 payload 无效");
  assertArray(value.payload.assetCards, "payload.assetCards");
  assertArray(value.payload.assetSources, "payload.assetSources");
  assertArray(value.payload.dailyAssetSnapshots, "payload.dailyAssetSnapshots");
  const document = value as unknown as BackupDocument;
  if (document.formatVersion >= 6) assertArray(document.payload.sourceInvestmentHistories, "payload.sourceInvestmentHistories");
  else document.payload.sourceInvestmentHistories = [];
  if (document.formatVersion >= 7) assertArray(document.payload.sourceInvestmentRecords, "payload.sourceInvestmentRecords");
  else document.payload.sourceInvestmentRecords = [];
  if (document.formatVersion >= 5) {
    assertArray(document.payload.dailyAssetTrendObservations, "payload.dailyAssetTrendObservations");
    assertArray(document.payload.investmentCashflows, "payload.investmentCashflows");
  }
  if (!Array.isArray(document.payload.dailyAssetTrendObservations)) {
    document.payload.dailyAssetTrendObservations = structuredClone(
      document.payload.dailyAssetSnapshots,
    );
  }
  if (!Array.isArray(document.payload.investmentCashflows)) {
    document.payload.investmentCashflows = [];
  }
  if (document.formatVersion < 4 &&
      document.payload.importedAssetSourceHistoryObservations === undefined) {
    document.payload.importedAssetSourceHistoryObservations = [];
  }
  assertArray(document.payload.importedAssetSourceHistoryObservations,
    "payload.importedAssetSourceHistoryObservations");
  for (const field of ["manualAssetRecords", "formalDailySettlements"] as const) {
    if (document.formatVersion < 5 && document.payload[field] === undefined) {
      document.payload[field] = [];
    }
    assertArray(document.payload[field], `payload.${field}`);
  }
  return document;
}

function restoredState(document: BackupDocument): BusinessDataState {
  const sources = document.payload.assetSources.map((source) => {
    if (!isRecord(source)) throw new Error("资产来源备份格式无效");
    assertString(source.id, "assetSources.id");
    assertString(source.kind, "assetSources.kind");
    if (!isAssetSourceKind(source.kind)) {
      throw new Error("资产来源类型无效或不受支持");
    }
    assertString(source.label, "assetSources.label");
    assertString(source.accountId, "assetSources.accountId");
    if (!Array.isArray(source.permissions)) throw new Error("资产来源权限格式无效");
    if (!isRecord(source.snapshot) || !Array.isArray(source.snapshot.holdings)) {
      throw new Error("资产来源快照格式无效");
    }
    if (!isRecord(source.sync)) throw new Error("资产来源同步状态格式无效");
    if (source.kind === "manual") {
      return { ...(source as unknown as Omit<AssetSourceSummary, "credentialReference">), credentialReference: null };
    }
    return {
      ...(source as unknown as Omit<AssetSourceSummary, "credentialReference">),
      credentialReference: null,
      lifecycle: "disconnected" as const,
      sync: {
        ...normalizeAssetSyncState(source.sync as unknown as AssetSourceSummary["sync"]),
        status: "expired" as const,
        error: "已从备份恢复，需重新授权后才能同步",
      },
    };
  });
  const state = {
    sourceInvestmentHistories: (document.payload.sourceInvestmentHistories ?? []).map(parseSourceInvestmentHistory),
    sourceInvestmentRecords: (document.payload.sourceInvestmentRecords ?? []).map(record => {
      if (!isRecord(record) || typeof record.sourceId !== "string" || typeof record.recordedAt !== "string" ||
          !Number.isFinite(Date.parse(record.recordedAt))) throw new Error("来源投资记录备份格式无效");
      return { ...parseSourceInvestmentRecordInput(record, record.recordedAt), sourceId: record.sourceId, recordedAt: record.recordedAt };
    }),
    assetCards: document.payload.assetCards,
    assetSources: sources,
    dailyAssetSnapshots: document.payload.dailyAssetSnapshots,
    dailyAssetTrendObservations: document.payload.dailyAssetTrendObservations,
    importedAssetSourceHistoryObservations: restoredImportedSourceHistory(
      document.payload.importedAssetSourceHistoryObservations,
    ),
    investmentCashflows: restoredCashflows(document.payload.investmentCashflows),
    manualAssetRecords: restoredManualRecords(document.payload.manualAssetRecords),
    formalDailySettlements: restoredFormalSettlements(document.payload.formalDailySettlements),
  };
  validateReferences(state);
  return state;
}

/** 文档编解码不访问文件或数据库；导出脱敏，导入通过全部文档校验后才返回。 */
export function encodeBackupDocument(
  state: BusinessDataState,
  createdAt: string,
): { contents: string; checksum: string } {
  const assetSources = state.assetSources.map(
    ({ credentialReference: _credentialReference, ...source }) => ({
      ...source, sync: normalizeAssetSyncState(source.sync),
    }),
  );
  const base = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt,
    payload: {
      assetCards: state.assetCards,
      assetSources,
      dailyAssetSnapshots: state.dailyAssetSnapshots,
      dailyAssetTrendObservations: state.dailyAssetTrendObservations,
      importedAssetSourceHistoryObservations: state.importedAssetSourceHistoryObservations,
      investmentCashflows: state.investmentCashflows,
      manualAssetRecords: state.manualAssetRecords,
      formalDailySettlements: state.formalDailySettlements,
      sourceInvestmentHistories: state.sourceInvestmentHistories ?? [],
      sourceInvestmentRecords: state.sourceInvestmentRecords ?? [],
    },
  } satisfies Pick<BackupDocument, "format" | "formatVersion" | "createdAt" | "payload">;
  const checksum = checksumFor(base);
  const document: BackupDocument = {
    ...base,
    warning: SENSITIVE_ASSET_DATA_WARNING,
    checksum: { algorithm: "sha256", value: checksum },
  };
  assertCredentialFree(document);
  return { contents: `${JSON.stringify(document, null, 2)}\n`, checksum };
}

export function decodeBackupDocument(
  contents: string,
): { state: BusinessDataState; formatVersion: number } {
  const document = parseDocument(contents);
  return { state: restoredState(document), formatVersion: document.formatVersion };
}
