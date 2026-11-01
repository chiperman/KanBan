import { decimalAdd, decimalCompare, decimalDivide, decimalMultiply, decimalSubtract } from "@/domain/decimal";
import { shanghaiDay } from "@/domain/daily-asset-snapshots";
import { buildTotalValuation, type ValuationSource } from "@/domain/valuation";
import type { SourceInvestmentRecord } from "@/domain/source-investment-records";
import type { DailyAssetTrendObservation } from "@/domain/asset-history";
import type { InvestmentCashflowCurrency } from "@/domain/investment-cashflows";
import type { ManualAssetRecord } from "@/domain/manual-asset-records";

export interface SourceInvestmentHistory {
  sourceId: string;
  sourceLabel: string;
  provider: string;
  accountId: string;
  accountName: string;
  currency: InvestmentCashflowCurrency;
  openingInvestment: { day: string; amount: string };
  openingBasis: string;
  records: Array<{ id: string; day: string; kind: "valuation" | "deposit" | "withdrawal"; amount: string }>;
  importedAt: string;
  reconciliation: { asOf: string; netInvestment: string; total: string; profit: string };
}

export interface SourceInvestmentPoint {
  day: string;
  total: string | null;
  netInvestment: string;
  profit: string | null;
  returnRatio: string | null;
}

export class InvalidSourceInvestmentHistoryError extends Error {}

const dayTime = (day: string) => Date.parse(day + "T00:00:00.000Z");
function assertDay(day: unknown): asserts day is string {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      !Number.isFinite(dayTime(day)) || new Date(dayTime(day)).toISOString().slice(0, 10) !== day) {
    throw new InvalidSourceInvestmentHistoryError("来源历史日期无效");
  }
}
function assertAmount(amount: unknown, signed = false): asserts amount is string {
  if (typeof amount !== "string" || !(signed ? /^-?\d{1,18}(\.\d{1,8})?$/ : /^\d{1,18}(\.\d{1,8})?$/).test(amount)) {
    throw new InvalidSourceInvestmentHistoryError("来源历史金额无效");
  }
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 500) throw new InvalidSourceInvestmentHistoryError("来源历史身份无效");
  return value;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidSourceInvestmentHistoryError("来源历史格式无效");
  return value as Record<string, unknown>;
}

/** 导入是独立账户事实；不自动创建组合资金进出，也不补造历史汇率或组合快照。 */
export function parseSourceInvestmentHistory(value: unknown): SourceInvestmentHistory {
  const raw = object(value);
  if (typeof raw.provider !== "string" || !raw.provider.trim() || raw.provider.length > 500) throw new InvalidSourceInvestmentHistoryError("来源历史平台无效");
  if (!["CNY", "USD", "HKD"].includes(String(raw.currency))) throw new InvalidSourceInvestmentHistoryError("来源历史币种无效");
  const opening = object(raw.openingInvestment);
  assertDay(opening.day); assertAmount(opening.amount);
  if (!Array.isArray(raw.records) || raw.records.length === 0) throw new InvalidSourceInvestmentHistoryError("来源历史记录不能为空");
  const ids = new Set<string>(); const valuationDays = new Set<string>();
  const records = raw.records.map(value => {
    const row = object(value); const id = text(row.id);
    assertDay(row.day); assertAmount(row.amount);
    if (!["valuation", "deposit", "withdrawal"].includes(String(row.kind))) throw new InvalidSourceInvestmentHistoryError("来源历史操作无效");
    if (ids.has(id) || (row.kind === "valuation" && valuationDays.has(row.day))) throw new InvalidSourceInvestmentHistoryError("来源历史记录重复");
    if (row.day < opening.day!) throw new InvalidSourceInvestmentHistoryError("来源历史早于期初本金日期");
    ids.add(id); if (row.kind === "valuation") valuationDays.add(row.day);
    return { id, day: row.day, amount: row.amount, kind: row.kind as SourceInvestmentHistory["records"][number]["kind"] };
  }).sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));
  const reconciliation = object(raw.reconciliation);
  assertDay(reconciliation.asOf); assertAmount(reconciliation.netInvestment, true);
  assertAmount(reconciliation.total); assertAmount(reconciliation.profit, true);
  const importedAt = text(raw.importedAt);
  if (!Number.isFinite(Date.parse(importedAt))) throw new InvalidSourceInvestmentHistoryError("来源历史导入时间无效");
  const result: SourceInvestmentHistory = {
    sourceId: text(raw.sourceId), sourceLabel: text(raw.sourceLabel), provider: raw.provider,
    accountId: text(raw.accountId), accountName: text(raw.accountName), currency: raw.currency as InvestmentCashflowCurrency,
    openingInvestment: { day: opening.day, amount: opening.amount }, openingBasis: text(raw.openingBasis),
    records, importedAt,
    reconciliation: { asOf: reconciliation.asOf, netInvestment: reconciliation.netInvestment, total: reconciliation.total, profit: reconciliation.profit },
  };
  const last = analyzeSourceInvestmentHistory(result, [], reconciliation.asOf).current;
  if (!last || last.day !== reconciliation.asOf || last.total === null || last.profit === null ||
      decimalCompare(last.netInvestment, reconciliation.netInvestment) !== 0 ||
      decimalCompare(last.total, reconciliation.total) !== 0 || decimalCompare(last.profit, reconciliation.profit) !== 0 ||
      records.some(row => row.day > result.reconciliation.asOf)) throw new InvalidSourceInvestmentHistoryError("来源历史对账不一致");
  return result;
}

/** 累计盈亏与 Modified Dietz 累计资金加权比例；无资产观测的日期不生成收益端点。 */
export function analyzeSourceInvestmentHistory(history: SourceInvestmentHistory, manualRecords: ManualAssetRecord[], asOf: string) {
  return analyzeSourceInvestmentAccount({history, sourceId: history.sourceId, manualRecords, records: [], observations: [], currentDay: asOf});
}

/** Source-scoped facts only. External same-day valuations win; unique local dates survive. */
export function analyzeSourceInvestmentAccount(input: {
  history: SourceInvestmentHistory | null;
  sourceId: string;
  records: SourceInvestmentRecord[];
  manualRecords: ManualAssetRecord[];
  observations: DailyAssetTrendObservation[];
  currentDay: string;
  source?: ValuationSource;
}) {
  const history = input.history?.sourceId === input.sourceId ? input.history : null;
  const records = input.records.filter(record => record.sourceId === input.sourceId && record.day <= input.currentDay);
  const opening = history?.openingInvestment ?? records.find(record => record.kind === "opening");
  const currency = history?.currency ?? records.find(record => record.kind === "opening")?.currency ?? null;
  const unavailable = (missingReason: string) => ({points: [] as SourceInvestmentPoint[], current: null, currency, opening, missingReason});
  if (!opening || !currency) return unavailable("尚未记录本账户的期初本金和完整投入、取出，无法计算收益。");
  if (records.some(record => record.currency !== currency)) return unavailable("本账户资金记录币种不一致，无法计算收益。");
  const values = new Map<string, string | null>();
  for (const observation of input.observations) {
    const source = observation.sources.find(source => source.sourceId === input.sourceId);
    if (source) values.set(observation.day, source.complete && (source.status ?? "complete") === "complete" ? source.total[currency] ?? null : null);
  }
  if (input.source?.id === input.sourceId && input.source.snapshot.total.currency === currency) {
    const day = shanghaiDay(input.source.snapshot.syncedAt);
    // A live value is an endpoint for today, never a backfill of earlier dates.
    if (day === input.currentDay) {
      const valuation = buildTotalValuation([input.source], currency, "source");
      values.set(day, valuation.incomplete ? null : valuation.amount);
    }
  }
  for (const record of input.manualRecords) if (record.sourceId === input.sourceId) {
    values.set(record.day, record.currency === currency ? record.amount : null);
  }
  for (const record of records) if (record.kind === "valuation") values.set(record.day, record.amount);
  for (const record of history?.records ?? []) if (record.kind === "valuation") values.set(record.day, record.amount);
  const allFlows = [...(history?.records ?? []), ...records].filter(row => row.kind === "deposit" || row.kind === "withdrawal");
  const points: SourceInvestmentPoint[] = [...values.entries()]
    .filter(([day]) => day >= opening.day && day <= input.currentDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, total]) => {
      const flows = allFlows.filter(row => row.day <= day);
      const signed = (row: {kind: string; amount: string}) => row.kind === "withdrawal" ? `-${row.amount}` : row.amount;
      const netInvestment = decimalAdd(opening.amount, ...flows.map(signed));
      const profit = total === null ? null : decimalSubtract(total, netInvestment);
      const span = dayTime(day) - dayTime(opening.day);
      const denominator = span <= 0 ? null : decimalAdd(opening.amount, ...flows.map(row =>
        decimalMultiply(signed(row), decimalDivide(String(dayTime(day) - dayTime(row.day)), String(span))),
      ));
      const returnRatio = profit === null ? null : span === 0 && decimalCompare(profit, "0") === 0 ? "0" :
        denominator !== null && decimalCompare(denominator, "0") > 0 ? decimalDivide(profit, denominator) : null;
      return { day, total, netInvestment, profit, returnRatio };
    });
  return { points, current: points.at(-1) ?? null, currency, opening, missingReason: points.length ? null : "已有本金记录，等待本账户的资产金额记录或刷新。" };
}
