"use client";

import { useMemo } from "react";
import { useLongbridgeRealtime } from "@/ui/use-longbridge-realtime";
import { LongbridgeRealtimeNotice } from "@/ui/longbridge-realtime-notice";
import { VibeLiveCounter } from "@/ui/vibe/vibe-live-counter";

import {
  analyzeCurrentInvestmentPerformance,
  longbridgeReferenceRates,
  type PortfolioObservation,
} from "@/domain/investment-performance";
import {
  decimalCompare,
  decimalSubtract,
  decimalToFixed,
} from "@/domain/decimal";
import {
  convertCurrencyAmount,
  buildTotalValuation,
  sourceReportingConversionRates,
  type ReportingCurrency,
} from "@/domain/valuation";
import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import { daysForTrendRange, totalTrendObservationStatus } from "@/domain/daily-trend-observations";
import { portfolioSourceTotal } from "@/domain/evm-token-preferences";
import { hasManualAssetRecord } from "@/domain/manual-asset-records";
import type {
  AssetSourceSummary,
  DailyAssetSourceSnapshot,
  DailyAssetTrendObservation,
  InvestmentCashflow,
} from "@/server/ports";
import { AssetGlobalRefreshControl } from "@/ui/asset-refresh-controls";
import { sourceSyncStatus } from "@/ui/asset-source-status";
import { AssetTrendChart } from "@/ui/asset-trend-chart";
import type { ProfitColorScheme } from "@/ui/profit-color-scheme";
import {
  VibeMetric,
  VibeStatusTag,
} from "@/ui/vibe/vibe-data-instrument";
import { VibeLink } from "@/ui/vibe/vibe-button";
import {
  VibeSelect,
  type VibeSelectOption,
} from "@/ui/vibe/vibe-field";
import {
  formatShanghaiDateTime,
  formatShanghaiDayLabel,
  formatShanghaiShortDateTime,
} from "@/ui/shanghai-date-time";
import {
  useWorkbenchDisplayPreferences,
} from "@/ui/workbench-display-preferences";
import { WorkbenchPageHeader } from "@/ui/workbench-page-header";

type OverviewSource = Omit<
  AssetSourceSummary,
  "credentialReference" | "permissions"
>;

type SourceComparison =
  | { state: "changed"; change: string; previousAmount: string }
  | { state: "scope-change" }
  | { state: "unavailable" };

const CURRENCY_OPTIONS: readonly VibeSelectOption<ReportingCurrency>[] = [
  { value: "USD", label: "USD" },
  { value: "CNY", label: "CNY" },
  { value: "HKD", label: "HKD" },
];

function amount(value: string): string {
  const [integer, fraction] = decimalToFixed(value, 2).split(".");
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

function signedAmount(value: string): string {
  return `${decimalCompare(value, "0") >= 0 ? "+" : ""}${amount(value)}`;
}

function profitDirection(
  value: string,
): "positive" | "negative" | "neutral" {
  const comparison = decimalCompare(value, "0");
  return comparison > 0 ? "positive" : comparison < 0 ? "negative" : "neutral";
}

function sourceHealth(source: OverviewSource): {
  label: string;
  tone: "error" | "success" | "warning";
} {
  if (source.lifecycle === "disconnected") {
    return { label: "已断开 · 保留最后快照", tone: "warning" };
  }
  const sync = sourceSyncStatus(source);
  if (sync !== null) return sync;
  if (source.snapshot.coverage?.status === "unknown") {
    return { label: "来源总额可读 · 覆盖待确认", tone: "warning" };
  }
  if (source.snapshot.coverage?.status === "partial") {
    return { label: "来源总额可读 · 明细覆盖不完整", tone: "warning" };
  }
  if (
    source.snapshot.coverage?.products.some(
      (product) =>
        product.capability === "aggregate-only" &&
        product.freshness === "current",
    )
  ) {
    return { label: "来源账户/平台总额 · 部分仅汇总", tone: "success" };
  }
  return { label: "来源账户/平台总额 · 当前", tone: "success" };
}

function MetricValue({
  currency,
  hidden,
  profitColorScheme,
  signed = false,
  value,
}: {
  currency: ReportingCurrency;
  hidden: boolean;
  profitColorScheme?: ProfitColorScheme;
  signed?: boolean;
  value: string | null;
}) {
  if (hidden) {
    return <span className="daily-overview__private">••••••</span>;
  }
  if (value === null) {
    return <span className="daily-overview__unavailable">数据不足</span>;
  }
  return (
    <VibeMetric
      className={profitColorScheme ? "profit-color-value" : undefined}
      data-profit-color-scheme={profitColorScheme}
      data-profit-direction={
        profitColorScheme ? profitDirection(value) : undefined
      }
      unit={currency}
      value={signed ? signedAmount(value) : amount(value)}
    />
  );
}

function SourceDetailArrowIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
    >
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

function sourceTotalInCurrency(
  source: OverviewSource,
  currency: ReportingCurrency,
  reportingRates: OverviewSource["snapshot"]["exchangeRates"],
): string | null {
  const total = portfolioSourceTotal(source);
  return convertCurrencyAmount(
    total.amount,
    total.currency,
    currency,
    sourceReportingConversionRates(source, reportingRates),
  );
}

function latestCompletedPriorObservation(
  observations: DailyAssetTrendObservation[],
  currentDay: string,
): DailyAssetTrendObservation | null {
  return observations
    .filter(
      (observation) =>
        observation.day < currentDay &&
        observation.complete &&
        (observation.status === undefined || observation.status === "complete"),
    )
    .toSorted(
      (left, right) =>
        right.day.localeCompare(left.day) ||
        right.capturedAt.localeCompare(left.capturedAt),
    )
    .at(0) ?? null;
}

function sourceComparison(
  currentAmount: string | null,
  currentComparable: boolean,
  priorObservation: DailyAssetTrendObservation | null,
  priorSource: DailyAssetSourceSnapshot | undefined,
  currency: ReportingCurrency,
): SourceComparison {
  if (!currentComparable || currentAmount === null || priorObservation === null) {
    return { state: "unavailable" };
  }
  if (priorSource === undefined) {
    return { state: "scope-change" };
  }
  const previousAmount = priorSource.total[currency] ?? null;
  const previousComplete =
    priorSource.complete &&
    (priorSource.status === undefined || priorSource.status === "complete");
  if (!previousComplete || previousAmount === null) {
    return { state: "unavailable" };
  }
  return {
    state: "changed",
    change: decimalSubtract(currentAmount, previousAmount),
    previousAmount,
  };
}

function daysBetweenShanghaiDays(startDay: string, endDay: string): number {
  const start = Date.parse(`${startDay}T00:00:00.000Z`);
  const end = Date.parse(`${endDay}T00:00:00.000Z`);
  return Math.round((end - start) / 86_400_000);
}

export function DailyOverviewWorkspace({
  cashflows,
  currentDay,
  currentObservedAt,
  demoMode = false,
  profitColorScheme,
  sources,
  trendObservations,
}: {
  cashflows: InvestmentCashflow[];
  currentDay: string;
  currentObservedAt: string;
  demoMode?: boolean;
  profitColorScheme: ProfitColorScheme;
  sources: OverviewSource[];
  trendObservations: DailyAssetTrendObservation[];
}) {
  const {
    currency,
    setCurrency,
    showSensitiveInfo,
  } = useWorkbenchDisplayPreferences();

  const { liveSources, state: realtimeState, retry } = useLongbridgeRealtime(sources, !demoMode);
  const recordedSources = useMemo(
    () => liveSources.filter(hasManualAssetRecord),
    [liveSources],
  );
  const refreshEnabled = recordedSources.some(
    (source) =>
      source.kind !== "manual" && source.lifecycle !== "disconnected",
  );
  const usdValuation = useMemo(
    () => buildTotalValuation(recordedSources, "USD", "source"),
    [recordedSources],
  );
  const longbridgeRates = useMemo(
    () => longbridgeReferenceRates(recordedSources),
    [recordedSources],
  );
  const currentTotals = useMemo(() => {
    const complete =
      usdValuation.amount !== null &&
      !usdValuation.incomplete &&
      usdValuation.expiredCount === 0 &&
      recordedSources.length > 0 &&
      recordedSources.every(
        (source) =>
          source.lifecycle !== "disconnected" && source.sync.status === "current",
      );
    return (["USD", "CNY", "HKD"] as const).reduce(
      (totals, reportingCurrency) => {
        const amount = usdValuation.amount === null
          ? null
          : reportingCurrency === "USD"
            ? usdValuation.amount
            : convertCurrencyAmount(
              usdValuation.amount,
              "USD",
              reportingCurrency,
              longbridgeRates,
            );
        totals[reportingCurrency] = amount === null
          ? null
          : {
            amount,
            complete,
            observedAt: currentObservedAt,
          };
        return totals;
      },
      {} as Record<ReportingCurrency, PortfolioObservation | null>,
    );
  }, [currentObservedAt, longbridgeRates, recordedSources, usdValuation]);
  const current = currentTotals[currency];
  const recordedTodayObservation = useMemo(
    () =>
      trendObservations
        .filter(
          (observation) =>
            observation.day === currentDay &&
            observation.total[currency] !== null,
        )
        .toSorted((left, right) => right.capturedAt.localeCompare(left.capturedAt))
        .at(0) ?? null,
    [currentDay, trendObservations],
  );
  const recordedTodayTotal = recordedTodayObservation?.total[currency] ?? null;
  const changeEndpoint = current?.complete
    ? current
    : recordedTodayObservation !== null && recordedTodayTotal !== null
      ? {
          amount: recordedTodayTotal,
          complete: true,
          observedAt: recordedTodayObservation.capturedAt,
        }
      : null;
  const usesRecordedTodayObservation =
    !current?.complete && changeEndpoint !== null;
  const analysis = useMemo(
    () =>
      analyzeCurrentInvestmentPerformance({
        currency,
        asOf: currentObservedAt,
        currentUsdTotal: currentTotals.USD,
        cashflows,
        exchangeRates: longbridgeRates,
      }),
    [cashflows, currency, currentTotals.USD, currentObservedAt, longbridgeRates],
  );
  const priorObservation = latestCompletedPriorObservation(
    trendObservations,
    currentDay,
  );
  const daysSincePriorObservation = priorObservation === null
    ? null
    : daysBetweenShanghaiDays(priorObservation.day, currentDay);
  const intervalFallback = daysSincePriorObservation !== null &&
    daysSincePriorObservation > 1;
  const comparisonTotal = priorObservation?.total[currency];
  const todayChange = changeEndpoint !== null &&
    comparisonTotal != null
    ? decimalSubtract(changeEndpoint.amount, comparisonTotal)
    : null;
  const trend = useMemo(() => {
    const firstTrendDay = trendObservations
      .map((observation) => observation.day)
      .toSorted()
      .at(0);
    const days = daysForTrendRange("7d", currentDay, firstTrendDay);
    const observationsByDay = new Map(
      trendObservations.map((observation) => [observation.day, observation]),
    );
    const points = days.map((day) => {
      const observation = observationsByDay.get(day);
      const status = observation
        ? totalTrendObservationStatus(observation.sources)
        : "incomplete";
      return {
        day,
        amount: observation?.total[currency] ?? null,
        observed: observation !== undefined,
        status,
      };
    });
    return {
      firstDay: points.find((point) => point.observed)?.day ?? null,
      incompleteCount: points.filter((point) => point.status !== "complete").length,
      points,
      unavailableCount: points.filter((point) => point.amount === null).length,
    };
  }, [currency, currentDay, trendObservations]);
  const sourceSummaries = useMemo(
    () => {
      const priorSourcesById = new Map(
        priorObservation?.sources.map((source) => [source.sourceId, source]),
      );
      return recordedSources
        .map((source) => {
          const health = sourceHealth(source);
          const valuation = buildTotalValuation(
            [source],
            currency,
            "source",
            recordedSources,
          );
          const sourceAmount = sourceTotalInCurrency(
            source,
            currency,
            longbridgeRates,
          );
          return {
            source,
            amount: sourceAmount,
            health,
            comparison: sourceComparison(
              sourceAmount,
              health.tone === "success" && !valuation.incomplete,
              priorObservation,
              priorSourcesById.get(source.id),
              currency,
            ),
          };
        })
        .toSorted((left, right) => {
          if (left.amount === null) return right.amount === null ? 0 : 1;
          if (right.amount === null) return -1;
          return decimalCompare(right.amount, left.amount);
        });
    },
    [currency, longbridgeRates, priorObservation, recordedSources],
  );
  const todayChangeIssueSources = useMemo(
    () =>
      sourceSummaries.flatMap(({ amount: sourceAmount, health, source }) => {
        const valuation = buildTotalValuation(
          [source],
          "USD",
          "source",
          recordedSources,
        );
        const hasIssue =
          health.tone !== "success" ||
          sourceAmount === null ||
          valuation.incomplete;
        if (!hasIssue) return [];
        return [{
          amount: sourceAmount,
          label: assetSourceDisplayName(source),
          status: sourceAmount === null
            ? `无法折算为 ${currency}`
            : valuation.incomplete && health.tone === "success"
              ? "估值不完整"
              : health.label,
          tone: source.sync.error !== null ? "error" : health.tone,
        }];
      }),
    [currency, recordedSources, sourceSummaries],
  );
  const currentReason = current === null
    ? currency === "USD"
      ? "总额数据不完整。"
      : `无法折算为 ${currency}。`
    : !current.complete
      ? "总额为最近成功值。"
      : null;
  const reportingRate = currency === "USD"
    ? null
    : usdValuation.exchangeRateObservations.find(
      (rate) => rate.quoteCurrency === currency,
    ) ?? null;
  return (
    <div
      className="daily-overview"
      data-testid="portfolio-overview-workspace"
    >
      <WorkbenchPageHeader
        actionsLabel="总览快捷操作"
        eyebrow="PORTFOLIO / TODAY"
        title="总览"
        actions={
          <>
            <VibeSelect
              fieldId="overview-reporting-currency"
              label="计价货币"
              onValueChange={setCurrency}
              options={CURRENCY_OPTIONS}
              value={currency}
              variant="compact"
            />
            {demoMode ? null : <AssetGlobalRefreshControl />}
          </>
        }
      />

      <section className="daily-overview__current" aria-labelledby="overview-total-title">
        <article data-testid="overview-current-total">
          <p className="card-label">CURRENT / CONSOLIDATED</p>
          <h2 id="overview-total-title">总资产</h2>
          <MetricValue
            currency={currency}
            hidden={!showSensitiveInfo}
            value={current?.amount ?? null}
          />
          {reportingRate === null ? null : (
            <p data-testid="overview-reporting-rate">
              {reportingRate.baseCurrency}/{reportingRate.quoteCurrency}{" "}
              {decimalToFixed(reportingRate.rate, 4)}
              {" · "}
              {formatShanghaiShortDateTime(reportingRate.observedAt)}
            </p>
          )}
        </article>

        <article>
          <p className="card-label">
            {intervalFallback ? "INTERVAL / ASSET CHANGE" : "TODAY / ASSET CHANGE"}
          </p>
          <h2>
            {intervalFallback ? "自上次完整记录以来资产变化" : "今日资产变化"}
          </h2>
          <MetricValue
            currency={currency}
            hidden={!showSensitiveInfo}
            profitColorScheme={profitColorScheme}
            signed
            value={todayChange}
          />
          {priorObservation === null ? null : (
            <p>
              {intervalFallback
                ? `较 ${formatShanghaiDayLabel(priorObservation.day)}（${daysSincePriorObservation} 日）`
                : `较 ${formatShanghaiDayLabel(priorObservation.day)}`}
            </p>
          )}
          {usesRecordedTodayObservation ? (
            <p>
              当前刷新有失败 · 资产变化截至 {formatShanghaiShortDateTime(changeEndpoint.observedAt)}
            </p>
          ) : null}
          {todayChange === null &&
          priorObservation !== null &&
          todayChangeIssueSources.length > 0 ? (
            <div
              className="daily-overview__change-issues"
              data-testid="overview-today-change-issues"
            >
              <p>未计入今日变化</p>
              {!showSensitiveInfo ? (
                <span>
                  已隐藏 {todayChangeIssueSources.length} 个来源。
                </span>
              ) : (
                <>
                  <ul>
                    {todayChangeIssueSources.map((source) => (
                      <li data-tone={source.tone} key={source.label}>
                        <span>
                          <strong>{source.label}</strong>
                          <small>{source.status}</small>
                        </span>
                        <b>
                          {source.amount === null
                            ? "无法折算"
                            : `${amount(source.amount)} ${currency}`}
                        </b>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ) : null}
        </article>
        <article className="daily-overview__confidence" data-testid="overview-confidence">
          <p className="card-label">CONFIDENCE / DATA</p>
          <h2>{current?.complete ? "总额完整" : "数据不完整"}</h2>
          <p>
            {currentReason ??
              `已覆盖 ${recordedSources.length} 个来源`}
          </p>
          {!current?.complete ? (
            <p>
              未估值 {usdValuation.unvaluedCount} 项 · 过期来源 {usdValuation.expiredCount} 个
            </p>
          ) : null}
        </article>
      </section>

      <section className="daily-overview__summary" aria-label="本金与收益摘要">
        <article data-testid="overview-net-investment">
          <p>累计净投入</p>
          <MetricValue
            currency={currency}
            hidden={!showSensitiveInfo}
            value={analysis.cumulativeNetInvestment}
          />
          {currency !== "USD" ? <span>按当前汇率折算</span> : null}
        </article>
        <article data-testid="overview-investment-profit">
          <p>组合投资盈亏</p>
          <MetricValue
            currency={currency}
            hidden={!showSensitiveInfo}
            signed
            value={analysis.investmentProfit}
          />
          {currency !== "USD" ? <span>按当前汇率折算</span> : null}
        </article>
        {demoMode ? null : (
          <div className="daily-overview__summary-actions">
            <VibeLink href="/performance" variant="primary">
              记录资金
            </VibeLink>
            <VibeLink href="/performance" variant="text">
              查看收益分析
            </VibeLink>
          </div>
        )}
      </section>

      <div className="daily-overview__analysis">
        <section
          className="daily-overview__trend"
          data-testid="overview-trend"
        >
          <header>
            <div>
              <p className="card-label">总资产趋势</p>
              <h2>近 7 日资产走势</h2>
            </div>
            <div className="daily-overview__trend-actions">
              <span>
                {trend.firstDay
                  ? `${formatShanghaiDayLabel(trend.firstDay)} 至 ${formatShanghaiDayLabel(currentDay)}`
                  : "暂无可用观察"}
              </span>
              {demoMode ? null : (
                <VibeLink
                  className="daily-overview__trend-link"
                  href="/performance"
                  variant="text"
                >
                  查看长期趋势
                </VibeLink>
              )}
            </div>
          </header>
          <AssetTrendChart
            ariaLabel="近 7 日总资产趋势"
            chartHeight={176}
            currency={currency}
            formatAmount={amount}
            formatDay={formatShanghaiDayLabel}
            incompleteCount={trend.incompleteCount}
            isSensitiveHidden={!showSensitiveInfo}
            points={trend.points}
            unavailableCount={trend.unavailableCount}
          />
        </section>
      </div>

      <LongbridgeRealtimeNotice state={realtimeState} retry={retry} />
      <section className="daily-overview__sources" data-testid="overview-source-summary">
        <header>
          <div>
            <p className="card-label">SOURCES / SUMMARY</p>
            <h2>来源摘要</h2>
          </div>
          {demoMode ? null : (
            <VibeLink aria-label="查看全部资产与持仓" href="/assets" variant="outline">
              查看全部资产与持仓
            </VibeLink>
          )}
        </header>
        {!showSensitiveInfo ? (
          <p className="daily-overview__hidden-sources">已隐藏 {recordedSources.length} 个来源。</p>
        ) : sourceSummaries.length === 0 ? (
          <div className="empty-state">
            <p className="empty-title">尚未接入资产来源</p>
            <VibeLink href="/asset-sources/new" variant="primary">
              新增资产来源
            </VibeLink>
          </div>
        ) : (
          <ul className="daily-overview__source-list">
            {sourceSummaries.map(({
              amount: sourceAmount,
              comparison,
              health,
              source,
            }) => (
              <li key={source.id}>
                <article>
                  <div className="daily-overview__source-identity">
                    <p>{assetSourceDisplayName(source)}</p>
                    <VibeStatusTag tone={health.tone}>{health.label}</VibeStatusTag>
                  </div>
                  <div className="daily-overview__source-value">
                    <strong className="daily-overview__source-total">
                      {sourceAmount === null
                        ? "无法折算"
                        : <><VibeLiveCounter value={amount(sourceAmount)} resetKey={currency} /> {currency}</>}
                    </strong>
                    <div
                      className="daily-overview__source-change"
                      data-comparison-state={comparison.state}
                    >
                      {comparison.state === "changed" ? (
                        <>
                          <div className="daily-overview__source-change-today">
                            <span>今日变化</span>
                            <VibeMetric
                              className="profit-color-value"
                              data-profit-color-scheme={profitColorScheme}
                              data-profit-direction={profitDirection(comparison.change)}
                              unit={currency}
                              value={signedAmount(comparison.change)}
                            />
                          </div>
                          <small>
                            昨日{" "}
                            <span className="daily-overview__source-yesterday-amount">
                              {amount(comparison.previousAmount)}
                            </span>{" "}
                            <span className="daily-overview__source-yesterday-unit">
                              {currency}
                            </span>
                          </small>
                        </>
                      ) : comparison.state === "scope-change" ? (
                        <>
                          <span>新增纳入</span>
                          <small>昨日未纳入</small>
                        </>
                      ) : (
                        <span>暂无法比较</span>
                      )}
                    </div>
                    {demoMode ? null : (
                      <VibeLink
                        aria-label={`查看 ${assetSourceDisplayName(source)} 的资产明细`}
                        className="daily-overview__source-detail-link"
                        href={`/asset-sources/${encodeURIComponent(source.id)}`}
                        variant="text"
                      >
                        明细
                        <SourceDetailArrowIcon />
                      </VibeLink>
                    )}
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>


    </div>
  );
}
