import { decimalAdd, decimalCompare } from "@/domain/decimal";
import { hasManualAssetRecord } from "@/domain/manual-asset-records";
import { convertCurrencyAmount } from "@/domain/valuation";
import type {
  AssetSourceSummary,
  DailyAssetTrendObservation,
  ImportedAssetSourceHistoryObservation,
  ManualAssetRecord,
} from "@/server/ports";

type TrendSource = Pick<AssetSourceSummary,
  "id" | "kind" | "label" | "hasManualRecord" | "lifecycle"
>;

/**
 * 总览按已知来源覆盖校验每种币种，不把部分账户的小计当作总资产。
 * 没有历史接入日期时不猜测缺失来源当时为零；断开后的日期不再要求该来源。
 * 只在内存中恢复手工余额及其当日已存汇率，不写回历史观测或当日基准。
 */
export function projectTotalAssetTrendObservations(input: {
  observations: DailyAssetTrendObservation[];
  sources: TrendSource[];
  manualRecords: ManualAssetRecord[];
  importedHistory?: ImportedAssetSourceHistoryObservation[];
}): DailyAssetTrendObservation[] {
  const sources = input.sources.filter(hasManualAssetRecord);
  const lastDays = new Map<string, string>();
  for (const observation of input.observations) {
    for (const source of observation.sources) {
      if (observation.day > (lastDays.get(source.sourceId) ?? "")) {
        lastDays.set(source.sourceId, observation.day);
      }
    }
  }
  const recordsBySource = new Map<string, ManualAssetRecord[]>();
  for (const record of input.manualRecords.toSorted((a, b) => b.day.localeCompare(a.day))) {
    const records = recordsBySource.get(record.sourceId) ?? [];
    records.push(record);
    recordsBySource.set(record.sourceId, records);
  }
  const officialByDay = new Map((input.importedHistory ?? [])
    .filter(row => row.kind === "longbridge" && row.complete &&
      (row.status ?? "complete") === "complete")
    .map(row => [`${row.sourceId}:${row.day}`, row]));

  return input.observations.map(observation => {
    const expected = sources.filter(source => source.lifecycle !== "disconnected" ||
      observation.day <= (lastDays.get(source.id) ?? ""));
    const byId = new Map(observation.sources.map(row => [row.sourceId, row]));
    for (const source of expected) {
      if (source.kind !== "manual") continue;
      const record = recordsBySource.get(source.id)?.find(row => row.day <= observation.day);
      if (!record) continue;
      const previous = byId.get(source.id);
      // 已有原币金额与原件冲突时，不用另一条记录补齐缺失币种。
      const nativeAmount = previous?.total[record.currency];
      if (previous && (nativeAmount == null || decimalCompare(nativeAmount, record.amount) !== 0)) continue;
      const total = {
        USD: previous?.total.USD ?? convertCurrencyAmount(record.amount, record.currency, "USD", observation.exchangeRates ?? []),
        CNY: previous?.total.CNY ?? convertCurrencyAmount(record.amount, record.currency, "CNY", observation.exchangeRates ?? []),
        HKD: previous?.total.HKD ?? convertCurrencyAmount(record.amount, record.currency, "HKD", observation.exchangeRates ?? []),
      };
      byId.set(source.id, {
        ...previous,
        sourceId: source.id,
        kind: source.kind,
        label: previous?.label ?? source.label,
        capturedAt: previous?.capturedAt ?? record.recordedAt,
        complete: true,
        status: "complete",
        total,
      });
    }
    const rows = [...byId.values()].map(row => {
      const official = officialByDay.get(`${row.sourceId}:${observation.day}`);
      // 官方历史的美元完整性独立于缺失的其他币种，必须与已校准分量匹配。
      return row.kind === "longbridge" && official &&
          row.capturedAt === official.capturedAt && row.total.USD != null &&
          official.total.USD != null && decimalCompare(row.total.USD, official.total.USD) === 0
        ? { ...row, complete: true, status: "complete" as const }
        : row;
    });
    const covered = rows.length > 0 && expected.every(source => byId.has(source.id));
    const sum = (currency: "USD" | "CNY" | "HKD") => {
      if (!covered || rows.some(row => !row.complete || row.status === "incomplete" ||
          row.total[currency] == null)) return null;
      return decimalAdd(...rows.map(row => row.total[currency]!));
    };
    const total = { USD: sum("USD"), CNY: sum("CNY"), HKD: sum("HKD") };
    const complete = total.USD !== null && total.CNY !== null && total.HKD !== null;
    return {
      ...observation,
      sources: rows,
      total,
      complete,
      status: rows.some(row => row.status === "expired")
        ? "expired"
        : complete ? "complete" : "incomplete",
    };
  });
}

/** 折算币种的有效性独立判断；其他币种缺失不撤销本币种的完整覆盖。 */
export function totalAssetTrendStatus(
  observation: DailyAssetTrendObservation,
  currency: "USD" | "CNY" | "HKD",
): "complete" | "incomplete" | "expired" {
  if (observation.sources.some(source => source.status === "expired")) {
    return "expired";
  }
  return observation.total[currency] == null ? "incomplete" : "complete";
}
