import { decimalMultiply } from "@/domain/decimal";
import {
  createInvestmentBookIntervalAnalyzer,
  type InvestmentBookState,
} from "@/domain/investment-books";
import { type MarketBenchmarkSymbol } from "@/domain/market-benchmark";
import { AssetFinancialValue } from "@/ui/asset-financial-value";
import { AssetTrendPanel } from "@/ui/asset-trend-panel";
import { useInvestmentBookBenchmarkComparison } from "@/ui/market-benchmark";
import { MarketBenchmarkControls } from "@/ui/market-benchmark-controls";
import { formatShanghaiDayLabel, formatShanghaiFullDayLabel } from "@/ui/shanghai-date-time";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeMetric } from "@/ui/vibe/vibe-data-instrument";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { useMemo } from "react";

import { buildBookChartPoints, buildBookFundingEvents } from "./model";
import { bookMoney, type InvestmentBookSource } from "./shared";

import type { AssetTrendRangeSelection } from "@/ui/asset-trend-panel";
import type { BookAnalysis, buildBookRange } from "./model";

type PerformanceViewProps = ReturnType<typeof buildBookRange> & {
  analysis: BookAnalysis;
  state: InvestmentBookState;
  sources: InvestmentBookSource[];
  showSensitiveInfo: boolean;
  enabledSymbols: MarketBenchmarkSymbol[];
  setEnabledSymbols(value: MarketBenchmarkSymbol[]): void;
  trendRange: AssetTrendRangeSelection;
  currentDay: string;
  curve: "return" | "total";
  setCurve(value: "return" | "total"): void;
};

export function BookPerformanceView({
  analysis,
  state,
  sources,
  showSensitiveInfo,
  enabledSymbols,
  setEnabledSymbols,
  trendRange,
  currentDay,
  curve,
  setCurve,
  days,
  selectedDays,
  isInterval,
  startDay,
  endDay,
}: PerformanceViewProps) {
  const bookId = analysis.book.id;
  const current = analysis.summary;
  const firstValuationDay = analysis.points.find((point) => point.total !== null)?.day;
  const startPoint = analysis.points.find((point) => point.day === startDay);
  const endPoint = analysis.points.find((point) => point.day === endDay);
  const analyzeInterval = useMemo(
    () => createInvestmentBookIntervalAnalyzer({ points: analysis.points, state, bookId, startDay }),
    [analysis.points, state, bookId, startDay],
  );
  const interval = useMemo(() => analyzeInterval(endDay), [analyzeInterval, endDay]);
  const fundingEvents = useMemo(() => buildBookFundingEvents(analysis), [analysis]);
  const selectedPoints = useMemo(
    () => analysis.points.filter((point) => selectedDays.has(point.day)),
    [analysis.points, selectedDays],
  );
  const benchmarkVisible = curve === "return" && showSensitiveInfo;
  const benchmarkDataState = useInvestmentBookBenchmarkComparison({
    enabledSymbols,
    points: selectedPoints,
    records: analysis.records,
    sources,
    visible: benchmarkVisible,
  });
  const points = useMemo(
    () => buildBookChartPoints({
      days, isInterval, startDay, analysis, analyzeInterval, curve, fundingEvents,
    }),
    [days, isInterval, startDay, analysis, analyzeInterval, curve, fundingEvents],
  );
  const metrics = [
    {
      label: isInterval ? "期末资产" : "资产总额",
      value: isInterval ? interval.total : (current?.total ?? null),
      unit: analysis.book.currency,
    },
    {
      label: isInterval ? "区间净流入" : "累计净投入",
      value: isInterval ? interval.netCashflow : (current?.netInvestment ?? null),
      unit: analysis.book.currency,
    },
    {
      label: isInterval ? "区间收益" : "累计收益",
      value: isInterval ? interval.profit : (current?.profit ?? null),
      unit: analysis.book.currency,
    },
    {
      label: isInterval ? "区间收益率" : "累计收益率",
      value:
        (isInterval ? interval.returnRatio : current?.returnRatio) == null
          ? null
          : decimalMultiply((isInterval ? interval.returnRatio : current?.returnRatio)!, "100"),
      unit: "%",
    },
  ];
  const comparisonReady =
    benchmarkVisible &&
    enabledSymbols.length > 0 &&
    benchmarkDataState.kind === "ready" &&
    benchmarkDataState.comparison.reason === null;

  return (
    <section className="source-performance" aria-label={`${analysis.book.name}投资表现`}>
      <div className="investment-books__summary-toolbar">
        <header className="source-performance__heading">
          <h2>{isInterval ? "区间表现" : "累计表现"}</h2>
          <p>
            {isInterval
              ? `${startDay} 至 ${endDay}`
              : current?.total != null
                ? `截至 ${current.day}`
                : "暂无完整资产记录"}
          </p>
        </header>
      </div>
      <div className="source-performance__metrics investment-books__metrics">
        {metrics.map((metric) => (
          <article key={metric.label}>
            <p className="card-label">{metric.label}</p>
            {metric.value == null ? (
              <p className="investment-books__metric-unavailable">数据不足</p>
            ) : (
              <VibeMetric
                animate={false}
                masked={!showSensitiveInfo}
                value={bookMoney(metric.value)}
                unit={metric.unit}
              />
            )}
          </article>
        ))}
      </div>
      {showSensitiveInfo &&
      (isInterval ? analysis.fundingMissingReason : analysis.summaryMissingReason) ? (
        <VibeNotice tone="info" role="status">
          {isInterval ? analysis.fundingMissingReason : analysis.summaryMissingReason}
        </VibeNotice>
      ) : null}
      {showSensitiveInfo &&
      isInterval &&
      (startPoint?.total == null || endPoint?.total == null) ? (
        <VibeNotice tone="info" role="status">
          所选起止日期缺少完整资产估值，区间收益暂不可算。可调整日期，或在记账记录中补齐估值。
        </VibeNotice>
      ) : showSensitiveInfo && isInterval && startDay === endDay ? (
        <VibeNotice tone="info" role="status">
          计算区间收益需选择至少两个日期。
        </VibeNotice>
      ) : null}
      {showSensitiveInfo && analysis.historyComparison ? (
        <details className="daily-trend-details investment-books__reconciliation">
          <summary>
            <span className="investment-books__reconciliation-label">
              <time dateTime={analysis.historyComparison.day}>
                {analysis.historyComparison.day}
              </time>
              <span>历史与同步差额</span>
            </span>
            <span className="investment-books__reconciliation-amount">
              <AssetFinancialValue unit={analysis.book.currency}>
                {bookMoney(analysis.historyComparison.difference)}
              </AssetFinancialValue>
            </span>
          </summary>
          <div className="daily-trend-details-content">
            <dl>
              <div>
                <dt>历史总额</dt>
                <dd>
                  <AssetFinancialValue unit={analysis.book.currency}>
                    {bookMoney(analysis.historyComparison.historicalTotal)}
                  </AssetFinancialValue>
                </dd>
              </div>
              <div>
                <dt>自动汇总</dt>
                <dd>
                  <AssetFinancialValue unit={analysis.book.currency}>
                    {bookMoney(analysis.historyComparison.automaticTotal)}
                  </AssetFinancialValue>
                </dd>
              </div>
            </dl>
            <p>
              请核对采集时间和来源范围。
              {bookId === "crypto"
                ? "有导入资产记录的日期优先采用历史总额，其余日期采用当天完整自动汇总；"
                : "历史截止日及以前采用历史总额，之后接自动汇总；"}
              差额不会补成入金，两份金额不会相加。
            </p>
          </div>
        </details>
      ) : null}
      <AssetTrendPanel
        benchmark={
          benchmarkVisible
            ? {
                assetScopeLabel: analysis.book.name,
                comparison:
                  benchmarkDataState.kind === "ready" ? benchmarkDataState.comparison : null,
                enabledSymbols,
                returnComparison: true,
              }
            : null
        }
        range={{ ...trendRange, currentDay, firstDay: analysis.firstTrendDay ?? undefined }}
        metricControls={
          <header className="source-performance__chart-toolbar investment-books__chart-heading">
            <h2>
              {curve === "return"
                ? comparisonReady
                  ? "区间收益率对比"
                  : isInterval
                    ? "区间收益率走势"
                    : "累计收益率走势"
                : "总资产趋势"}
            </h2>
            <div className="source-performance__curve-options" role="group" aria-label="趋势指标">
              {(["total", "return"] as const).map((value) => (
                <VibeButton
                  key={value}
                  type="button"
                  variant={curve === value ? "primary" : "outline"}
                  size="compact"
                  aria-pressed={curve === value}
                  onClick={() => setCurve(value)}
                >
                  {value === "return" ? "收益率" : "总资产"}
                </VibeButton>
              ))}
            </div>
          </header>
        }
        ariaLabel={`${analysis.book.name}${curve === "return" ? "收益率走势" : "总资产趋势"}`}
        currency={curve === "return" ? "%" : analysis.book.currency}
        formatAmount={bookMoney}
        formatDay={formatShanghaiDayLabel}
        dateAxisPresentation="compact"
        chartHeight={256}
        points={points}
        isSensitiveHidden={!showSensitiveInfo}
        variant="source"
      >
        {benchmarkVisible ? (
          <MarketBenchmarkControls
            assetScopeLabel={analysis.book.name}
            dataState={benchmarkDataState}
            enabledSymbols={enabledSymbols}
            formatDay={formatShanghaiFullDayLabel}
            onEnabledSymbolsChange={setEnabledSymbols}
            returnComparison
            returnLabel={isInterval ? "区间收益率" : "累计收益率"}
          />
        ) : null}
        {showSensitiveInfo &&
        firstValuationDay &&
        analysis.firstRecordDay &&
        analysis.firstRecordDay < firstValuationDay &&
        days[0] < firstValuationDay ? (
          <p className="trend-note">
            {formatShanghaiFullDayLabel(firstValuationDay)} 前缺少完整资产估值。
          </p>
        ) : null}
      </AssetTrendPanel>
      <details className="daily-trend-details">
        <summary>计算口径</summary>
        <div className="daily-trend-details-content">
          <p>
            全部日期的累计指标统一截至最近完整估值日，不混入之后的资金，趋势缺口保持为空。选择其他区间后，指标严格按所选起止日计算；缺少端点估值时留空。
          </p>
          <p>
            区间收益 = 期末资产 − 起点资产 −
            区间净流入。估值按日末计，净流入包含起点之后、终点当日及之前的入金减出金；起点当日资金已包含在起点资产中。记录列表包含所选起止日的全部生效记录。
          </p>
          <p>
            累计收益 = 资产总额 − 期初本金 − 累计入金 + 累计出金。收益率采用 Modified Dietz
            扣除入出金影响，不年化；指数对比从共同可用起点重新计算，起点见图上标记。
          </p>
          <p>
            指数不含分红，按各自本币计算，不折算汇率。使用上海当日零点前已收盘日 K，休市沿用前收盘。
          </p>
          <p>
            {bookId === "crypto"
              ? "有导入资产记录（含更正）的日期优先采用历史整本账总额，其余日期采用当天最新完整自动同步，不跨日补值；"
              : "导入历史截止日及以前采用历史整本账总额，之后采用同步或手动资产记录；"}
            同一天只计一个总额。缺少资产或汇率时留空。
          </p>
          <p>
            虚拟货币合并交易所、钱包和手动补充来源。账内互转不增加本金；三本账之间转账需分别记录一笔出金、一笔入金。
          </p>
        </div>
      </details>
    </section>
  );
}
