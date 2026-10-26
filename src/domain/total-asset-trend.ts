import { decimalAdd, decimalCompare } from "@/domain/decimal";
import { hasManualAssetRecord } from "@/domain/manual-asset-records";
import type { BookMember } from "@/domain/investment-books";
import { convertCurrencyAmount } from "@/domain/valuation";
import type { AssetSourceSummary } from "@/domain/asset-sources";
import type { DailyAssetTrendObservation, ImportedAssetSourceHistoryObservation } from "@/domain/asset-history";
import type { ManualAssetRecord } from "@/domain/manual-asset-records";

type TrendSource = Pick<AssetSourceSummary,
  "id" | "kind" | "label" | "hasManualRecord" | "lifecycle"
>;

/**
 * 总览按已知来源覆盖校验每种币种，不把部分账户的小计当作总资产。
 * 来源范围采用观测时保存的集合及已确认日期，不从当前连接状态或首次采集日推断。
 * 只在内存中恢复手工余额及历史折算，使用当日已存汇率，不写回历史观测或当日基准。
 */
export function projectTotalAssetTrendObservations(input: {
  observations: DailyAssetTrendObservation[];
  sources: TrendSource[];
  manualRecords: ManualAssetRecord[];
  importedHistory?: ImportedAssetSourceHistoryObservation[];
  members?: BookMember[];
}): DailyAssetTrendObservation[] {
  const sourcesById = new Map(input.sources.map(source => [source.id, source]));
  const membersById = new Map((input.members ?? []).map(member => [member.sourceId, member]));
  // 无范围证据的旧记录保守要求已知来源；持久化会冻结该集合，后续接入不追溯扩张。
  const legacyScope = input.sources.filter(hasManualAssetRecord).map(source => source.id);
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
    const expected = new Set([
      ...(observation.sourceScope ?? legacyScope),
      // 明确的日期更正也能指出旧观测漏了来源，不能把漏项当零。
      ...(input.members ?? []).filter(member => member.confirmed &&
        (member.fromDay !== null || member.toDay !== null) && sourcesById.has(member.sourceId))
        .map(member => member.sourceId),
      ...observation.sources.map(row => row.sourceId),
    ].filter(sourceId => {
      const member = membersById.get(sourceId);
      return !member?.confirmed ||
        ((member.fromDay === null || member.fromDay <= observation.day) &&
         (member.toDay === null || observation.day < member.toDay));
    }));
    const byId = new Map(observation.sources
      .filter(row => expected.has(row.sourceId))
      .map(row => [row.sourceId, row]));
    for (const sourceId of expected) {
      const row = byId.get(sourceId);
      const source = sourcesById.get(sourceId) ??
        (row && { id: row.sourceId, kind: row.kind, label: row.label });
      if (!source) continue;
      if (source.kind !== "manual") continue;
      const record = recordsBySource.get(source.id)?.find(row => row.day <= observation.day);
      if (!record) continue;
      const previous = byId.get(source.id);
      const nativeAmount = previous?.total[record.currency];
      // 原币更正后按观测日已存汇率重算，避免沿用旧余额的折算金额。
      const recordedTotal = nativeAmount != null && decimalCompare(nativeAmount, record.amount) === 0
        ? previous?.total
        : undefined;
      const total = {
        USD: recordedTotal?.USD ?? convertCurrencyAmount(record.amount, record.currency, "USD", observation.exchangeRates ?? []),
        CNY: recordedTotal?.CNY ?? convertCurrencyAmount(record.amount, record.currency, "CNY", observation.exchangeRates ?? []),
        HKD: recordedTotal?.HKD ?? convertCurrencyAmount(record.amount, record.currency, "HKD", observation.exchangeRates ?? []),
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
      if (row.kind === "longbridge" && official &&
          row.capturedAt === official.capturedAt && row.total.USD != null &&
          official.total.USD != null && decimalCompare(row.total.USD, official.total.USD) === 0) {
        // 校准仅保留美元金额；其他币种只用该组合观测已存的汇率恢复。
        return {
          ...row,
          complete: true,
          status: "complete" as const,
          total: {
            ...row.total,
            CNY: row.total.CNY ?? convertCurrencyAmount(row.total.USD, "USD", "CNY", observation.exchangeRates ?? []),
            HKD: row.total.HKD ?? convertCurrencyAmount(row.total.USD, "USD", "HKD", observation.exchangeRates ?? []),
          },
        };
      }
      return row;
    });
    const covered = expected.size > 0 && [...expected].every(sourceId => byId.has(sourceId));
    const sum = (currency: "USD" | "CNY" | "HKD") => {
      if (!covered || rows.some(row => !row.complete || row.status === "incomplete" ||
          row.total[currency] == null)) return null;
      return decimalAdd(...rows.map(row => row.total[currency]!));
    };
    const total = { USD: sum("USD"), CNY: sum("CNY"), HKD: sum("HKD") };
    const complete = total.USD !== null && total.CNY !== null && total.HKD !== null;
    return {
      ...observation,
      sourceScope: [...expected],
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
