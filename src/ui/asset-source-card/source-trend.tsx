"use client";

import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import { sourceTrendObservationStatus, type TrendRange } from "@/domain/daily-trend-observations";
import type { MarketBenchmarkComparison, MarketBenchmarkSymbol } from "@/domain/market-benchmark";
import type { ReportingCurrency } from "@/domain/valuation";
import type { DailyAssetTrendObservation } from "@/server/ports";
import { AssetTrendChart } from "@/ui/asset-trend-chart";
import { formatShanghaiDayLabel } from "@/ui/shanghai-date-time";
import { assetSourceTrendModel } from "./source-trend-model";
import type { AssetSourceView } from "./types";

function sourceTrendStatusLabel(
  status: "complete" | "incomplete" | "expired",
): string {
  return status === "expired"
    ? "过期"
    : status === "incomplete"
      ? "不完整"
      : "完整";
}

export function AssetSourceTrend({
  source,
  history,
  reportingCurrency,
  currentDay,
  trendDays,
  trendRange,
  trendBenchmark,
  hasTrendContent,
  showSensitiveInfo,
  formatAmount,
}: {
  source: AssetSourceView;
  history: DailyAssetTrendObservation[];
  reportingCurrency: ReportingCurrency;
  currentDay: string;
  trendDays?: readonly string[];
  trendRange: TrendRange;
  trendBenchmark?: {
    comparison: MarketBenchmarkComparison | null;
    enabledSymbols: MarketBenchmarkSymbol[];
  } | null;
  hasTrendContent: boolean;
  showSensitiveInfo: boolean;
  formatAmount: (value: string) => string;
}) {
  const isManual = source.kind === "manual";
  const heading = { title: assetSourceDisplayName(source) };
  const sourceTrend = assetSourceTrendModel({
    currentDay,
    history,
    isManual,
    manualRecords: source.manualRecords ?? [],
    reportingCurrency,
    sourceId: source.id,
    trendDays,
    trendRange,
  });
  return (
    <section
      className="asset-trend source-trend"
      data-testid={`asset-source-trend-${source.id}`}
    >
      <p className="card-label">资产金额趋势</p>
      {hasTrendContent ? <p className="trend-note">资产金额变化包含资金进出，不能作为收益率。</p> : null}
      {!showSensitiveInfo ? (
        <AssetTrendChart
          ariaLabel={`${heading.title}来源总额趋势已隐藏`}
          currency={reportingCurrency}
          formatAmount={formatAmount}
          formatDay={formatShanghaiDayLabel}
          incompleteCount={0}
          isSensitiveHidden
          points={[]}
          unavailableCount={0}
          variant="source"
        />
      ) : sourceTrend.sourceHistory.length === 0 ? (
        <p className="trend-empty">
          {isManual ? "等待首条记录" : "等待首次同步"}
        </p>
      ) : (
        <>
          <AssetTrendChart
            ariaLabel={`${heading.title}来源总额趋势`}
            benchmark={trendBenchmark === null || trendBenchmark === undefined ? null : {
              assetScopeLabel: "来源",
              comparison: trendBenchmark.comparison,
              enabledSymbols: trendBenchmark.enabledSymbols,
            }}
            currency={reportingCurrency}
            formatAmount={formatAmount}
            formatDay={formatShanghaiDayLabel}
            incompleteCount={sourceTrend.abnormalPoints.length}
            lineType={isManual ? "stepAfter" : "linear"}
            points={sourceTrend.points}
            unavailableCount={sourceTrend.unavailablePoints.length}
            variant="source"
          />
          {!isManual ? (
            <details
              className="daily-trend-details source-daily-trend-details"
              data-testid={`asset-source-daily-details-${source.id}`}
            >
              <summary>每日总额（{sourceTrend.sourceDailyDetails.length}）</summary>
              <div className="daily-trend-details-content">
                <ol className="daily-trend-detail-list">
                  {sourceTrend.sourceDailyDetails.map((observation) => {
                    const observationStatus =
                      sourceTrendObservationStatus(observation);
                    const observationAmount =
                      observation.total[reportingCurrency] ?? null;
                    const abnormal =
                      observationStatus !== "complete" ||
                      observationAmount === null;
                    return (
                      <li
                        key={observation.day}
                        data-testid={`asset-source-daily-detail-${source.id}`}
                      >
                        <time dateTime={observation.day}>
                          {formatShanghaiDayLabel(observation.day)}
                        </time>
                        <strong>
                          {observationAmount === null
                            ? "未估值"
                            : `${formatAmount(observationAmount)} ${reportingCurrency}`}
                        </strong>
                        {abnormal ? (
                          <span>
                            {observationAmount === null
                              ? `未估值 · ${sourceTrendStatusLabel(observationStatus)}`
                              : sourceTrendStatusLabel(observationStatus)}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              </div>
            </details>
          ) : null}
        </>
      )}
      {showSensitiveInfo && sourceTrend.notice ? (
        <p className="trend-note">{sourceTrend.notice}</p>
      ) : null}
    </section>
  );
}
