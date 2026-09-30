import { shanghaiDay } from "@/domain/daily-asset-snapshots";

export type SourceInvestmentRecordKind = "opening" | "deposit" | "withdrawal" | "valuation";
export type SourceInvestmentCurrency = "USD" | "CNY" | "HKD";
export interface SourceInvestmentRecord {
  id: string;
  sourceId: string;
  day: string;
  kind: SourceInvestmentRecordKind;
  amount: string;
  currency: SourceInvestmentCurrency;
  recordedAt: string;
}
export type SourceInvestmentRecordInput = Pick<SourceInvestmentRecord, "id" | "day" | "kind" | "amount" | "currency">;
export class InvalidSourceInvestmentRecordError extends Error {}

export function parseSourceInvestmentRecordInput(value: unknown, capturedAt = new Date().toISOString()): SourceInvestmentRecordInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidSourceInvestmentRecordError("来源投资记录格式无效");
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !raw.id.trim() || raw.id.length > 500) throw new InvalidSourceInvestmentRecordError("来源投资记录 ID 无效");
  if (typeof raw.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.day) ||
      !Number.isFinite(Date.parse(raw.day + "T00:00:00Z")) ||
      new Date(raw.day + "T00:00:00Z").toISOString().slice(0, 10) !== raw.day ||
      !Number.isFinite(Date.parse(capturedAt)) || raw.day > shanghaiDay(capturedAt)) throw new InvalidSourceInvestmentRecordError("来源投资记录日期无效或晚于今天");
  if (raw.kind !== "opening" && raw.kind !== "deposit" && raw.kind !== "withdrawal" && raw.kind !== "valuation") throw new InvalidSourceInvestmentRecordError("来源投资记录类型无效");
  if (typeof raw.amount !== "string" || !/^(?:0|[1-9]\d{0,17})(?:\.\d{1,8})?$/.test(raw.amount) ||
      ((raw.kind === "deposit" || raw.kind === "withdrawal") && !/[1-9]/.test(raw.amount))) throw new InvalidSourceInvestmentRecordError("来源投资记录金额无效");
  if (raw.currency !== "USD" && raw.currency !== "CNY" && raw.currency !== "HKD") throw new InvalidSourceInvestmentRecordError("来源投资记录币种无效");
  return { id: raw.id, day: raw.day, kind: raw.kind, amount: raw.amount, currency: raw.currency };
}
