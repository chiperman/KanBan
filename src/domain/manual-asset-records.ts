import type {
  AssetSourceSummary,
  CreateManualAssetSourceInput,
  ManualAssetClass,
  ManualAssetRecord,
  ManualAssetRecordInput,
} from "@/server/ports";

export class InvalidManualAssetRecordError extends Error {}

export function hasManualAssetRecord(
  source: Pick<AssetSourceSummary, "kind" | "hasManualRecord">,
): boolean {
  return source.kind !== "manual" || source.hasManualRecord !== false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeLabel(value: unknown): string {
  if (typeof value !== "string") {
    throw new InvalidManualAssetRecordError("资产名称无效");
  }
  const label = value.trim();
  if (label.length === 0) {
    throw new InvalidManualAssetRecordError("请输入资产名称");
  }
  if ([...label].length > 40) {
    throw new InvalidManualAssetRecordError("资产名称不能超过 40 个字符");
  }
  if (/[\u0000-\u001f\u007f]/.test(label)) {
    throw new InvalidManualAssetRecordError("资产名称不能包含控制字符");
  }
  return label;
}

function normalizeAmount(value: unknown): string {
  if (typeof value !== "string") {
    throw new InvalidManualAssetRecordError("资产总额无效");
  }
  const amount = value.trim();
  if (!/^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/.test(amount)) {
    throw new InvalidManualAssetRecordError("资产总额必须是最多两位小数的非负数");
  }
  return amount;
}

function normalizeCurrency(value: unknown): ManualAssetRecordInput["currency"] {
  if (
    value !== "USD" &&
    value !== "CNY" &&
    value !== "HKD"
  ) {
    throw new InvalidManualAssetRecordError("手工资产仅支持 USD、CNY 或 HKD");
  }
  return value;
}

export function parseManualAssetRecordDay(value: unknown): string {
  if (typeof value !== "string") {
    throw new InvalidManualAssetRecordError("记录日期无效");
  }
  const day = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new InvalidManualAssetRecordError("记录日期必须是 YYYY-MM-DD");
  }
  const date = new Date(`${day}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== Number(day.slice(0, 4)) ||
    date.getUTCMonth() + 1 !== Number(day.slice(5, 7)) ||
    date.getUTCDate() !== Number(day.slice(8, 10))
  ) {
    throw new InvalidManualAssetRecordError("记录日期无效");
  }
  return day;
}

export function assertManualAssetRecordNotFuture(
  day: string,
  currentDay: string,
): void {
  if (day > currentDay) {
    throw new InvalidManualAssetRecordError("记录日期不能晚于今天");
  }
}

export function parseManualAssetClass(
  value: unknown,
): ManualAssetClass | null {
  if (value === null || value === "") return null;
  if (
    value === "securities" ||
    value === "crypto" ||
    value === "cash" ||
    value === "other"
  ) {
    return value;
  }
  throw new InvalidManualAssetRecordError("手工资产类别无效");
}

export function parseManualAssetRecordInput(
  value: unknown,
): ManualAssetRecordInput {
  if (!isRecord(value)) {
    throw new InvalidManualAssetRecordError("手工资产记录格式无效");
  }
  return {
    day: parseManualAssetRecordDay(value.day),
    amount: normalizeAmount(value.amount),
    currency: normalizeCurrency(value.currency),
  };
}

export function parseCreateManualAssetSourceInput(
  value: unknown,
): CreateManualAssetSourceInput {
  if (!isRecord(value)) {
    throw new InvalidManualAssetRecordError("手工资产记录格式无效");
  }
  return {
    label: normalizeLabel(value.label),
  };
}

export function defaultManualAssetRecordCurrency(
  records: readonly ManualAssetRecord[] | undefined,
): ManualAssetRecord["currency"] {
  const latestFirst = records?.toSorted((left, right) => right.day.localeCompare(left.day)) ?? [];
  const counts = new Map<ManualAssetRecord["currency"], number>();
  for (const record of latestFirst) {
    counts.set(record.currency, (counts.get(record.currency) ?? 0) + 1);
  }
  return latestFirst.reduce<ManualAssetRecord["currency"]>(
    (preferred, record) =>
      (counts.get(record.currency) ?? 0) > (counts.get(preferred) ?? 0)
        ? record.currency
        : preferred,
    latestFirst[0]?.currency ?? "CNY",
  );
}
