"use client";

import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import type { MarketBenchmarkComparison, MarketBenchmarkSymbol } from "@/domain/market-benchmark";
import type { ReportingCurrency } from "@/domain/valuation";
import type { DailyAssetTrendObservation } from "@/server/ports";
import { AssetTrendPanel, useAssetTrendRange, type AssetTrendRange } from "@/ui/asset-trend-panel";
import { rangeDays } from "@/domain/investment-performance-trend";
import { formatShanghaiDayLabel } from "@/ui/shanghai-date-time";
import { assetSourceTrendModel } from "./source-trend-model";
import type { AssetSourceView } from "./types";

export function AssetSourceTrend({
  source,
  history,
  reportingCurrency,
  currentDay,
  range,
  trendBenchmark,
  hasTrendContent,
  showSensitiveInfo,
  formatAmount,
}: {
  source: AssetSourceView;
  history: DailyAssetTrendObservation[];
  reportingCurrency: ReportingCurrency;
  currentDay: string;
  range?: AssetTrendRange;
  trendBenchmark?: {
    comparison: MarketBenchmarkComparison | null;
    enabledSymbols: MarketBenchmarkSymbol[];
  } | null;
  hasTrendContent: boolean;
  showSensitiveInfo: boolean;
  formatAmount: (value: string) => string;
}) {
  const isManual = source.kind === "manual";
  const manualRecords = source.trendHistory?.records ?? source.manualRecords ?? [];
  const trendCurrency = source.trendHistory?.currency ?? reportingCurrency;
  const heading = { title: assetSourceDisplayName(source) };
  const localRange = useAssetTrendRange();
  const firstDay = [
    ...history.filter(day => day.sources.some(item => item.sourceId === source.id)).map(day => day.day),
    ...manualRecords.map(record => record.day),
  ].toSorted()[0];
  const selection = range ?? { ...localRange, currentDay, firstDay };
  const trendDays = rangeDays(selection.preset, currentDay, selection.firstDay, selection.customRange);
  const sourceTrend = assetSourceTrendModel({
    currentDay,
    history,
    isManual,
    manualRecords,
    reportingCurrency: trendCurrency,
    sourceId: source.id,
    trendDays,
    trendRange: "all",
  });
  return (
    <section
      className="asset-trend source-trend"
      data-testid={`asset-source-trend-${source.id}`}
    >
      <p className="card-label">资产金额趋势{trendCurrency !== reportingCurrency ? ` · ${trendCurrency}` : ""}</p>
      {hasTrendContent ? <p className="trend-note">资产金额变化包含资金进出，不能作为收益率。</p> : null}
      <AssetTrendPanel
        range={selection}
        ariaLabel={`${heading.title}来源总额趋势`}
        benchmark={trendBenchmark === null || trendBenchmark === undefined ? null : {
          assetScopeLabel: "来源",
          comparison: trendBenchmark.comparison,
          enabledSymbols: trendBenchmark.enabledSymbols,
        }}
        currency={trendCurrency}
        formatAmount={formatAmount}
        formatDay={formatShanghaiDayLabel}
        isSensitiveHidden={!showSensitiveInfo}
        lineType={isManual ? "stepAfter" : "linear"}
        points={sourceTrend.points}
        emptyMessage={selection.firstDay === undefined ? (isManual ? "等待首条记录" : "等待首次同步") : "所选区间无可用趋势"}
        variant="source"
      />
      {showSensitiveInfo && sourceTrend.notice ? (
        <p className="trend-note">{sourceTrend.notice}</p>
      ) : null}
    </section>
  );
}
