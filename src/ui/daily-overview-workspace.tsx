"use client";

import { formatAssetAmount } from "@/ui/asset-price-display";
import { AssetFinancialValue } from "@/ui/asset-financial-value";
import { useMemo } from "react";
import { useLongbridgeRealtime } from "@/ui/use-longbridge-realtime";
import { LongbridgeRealtimeNotice } from "@/ui/longbridge-realtime-notice";
import { VibeEntityLink } from "@/ui/vibe/vibe-entity-link";
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
import { projectTotalAssetTrendObservations, totalAssetTrendStatus } from "@/domain/total-asset-trend";
import { portfolioSourceTotal } from "@/domain/evm-token-preferences";
import { hasManualAssetRecord } from "@/domain/manual-asset-records";
import type {
  AssetSourceSummary,
  DailyAssetSourceSnapshot,
  DailyAssetTrendObservation,
  ImportedAssetSourceHistoryObservation,
  InvestmentCashflow,
} from "@/server/ports";
import { AssetGlobalRefreshControl } from "@/ui/asset-refresh-controls";
import { useAssetRefresh } from "@/ui/asset-refresh-provider";
import { AssetRefreshIssues } from "@/ui/asset-source-recovery";
import { sourceSyncStatus } from "@/ui/asset-source-status";
import { AssetTrendPanel, useAssetTrendRange } from "@/ui/asset-trend-panel";
import { rangeDays } from "@/domain/investment-performance-trend";
import { profitDirection, type ProfitColorScheme } from "@/ui/profit-color-scheme";
import {
  VibeMetric,
  VibeStatusTag,
} from "@/ui/vibe/vibe-data-instrument";
import { VibeLink } from "@/ui/vibe/vibe-button";
import {
  VibeSelect,
} from "@/ui/vibe/vibe-field";
import {
  formatShanghaiDayLabel,
  formatShanghaiShortDateTime,
} from "@/ui/shanghai-date-time";
import { signedAmount } from "@/ui/signed-amount";
import { CURRENCY_OPTIONS } from "@/ui/reporting-currency-options";
import {
  useWorkbenchDisplayPreferences,
} from "@/ui/workbench-display-preferences";
import { WorkbenchPageHeader } from "@/ui/workbench-page-header";
import { analyzeInvestmentBook, INVESTMENT_BOOKS, type InvestmentBookState } from "@/domain/investment-books";
import type { ManualAssetRecord } from "@/server/ports";

type OverviewSource = Omit<
  AssetSourceSummary,
  "credentialReference" | "permissions"
>;

type SourceComparison =
  | { state: "changed"; change: string; previousAmount: string }
  | { state: "scope-change" }
  | { state: "unavailable" };

function amount(value: string): string {
  return formatAssetAmount(value);
}

function sourceSyncTimeLabel(sources: OverviewSource[]): string {
  const times = sources.filter(hasManualAssetRecord)
    .map((source) => Date.parse(source.snapshot.syncedAt));
  if (times.length === 0 || times.some((time) => !Number.isFinite(time))) {
    return "时间未知";
  }
  const earliest = formatShanghaiShortDateTime(new Date(Math.min(...times)));
  const latest = formatShanghaiShortDateTime(new Date(Math.max(...times)));
  return earliest === latest ? earliest : `${earliest} 至 ${latest}`;
}

function sourceHealth(source: OverviewSource): {
  label: string;
  tone: "error" | "success" | "warning" | "muted";
} {
  if (source.lifecycle === "disconnected") {
    return { label: "已断开，保留最后快照", tone: "muted" };
  }
  const sync = sourceSyncStatus(source);
  if (sync !== null) return sync;
  if (source.snapshot.coverage?.status === "unknown") {
    return { label: "来源总额可读，覆盖待确认", tone: "warning" };
  }
  if (source.snapshot.coverage?.status === "partial") {
    return { label: "来源总额可读，明细覆盖不完整", tone: "warning" };
  }
  if (
    source.snapshot.coverage?.products.some(
      (product) =>
        product.capability === "aggregate-only" &&
        product.freshness === "current",
    )
  ) {
    return { label: "来源账户/平台总额，部分仅汇总", tone: "success" };
  }
  return { label: "来源账户/平台总额，当前", tone: "success" };
}

function MetricValue({
  currency,
  hidden,
  profitColorScheme,
  signed = false,
  unavailableLabel = "数据不足",
  value,
}: {
  currency: ReportingCurrency;
  hidden: boolean;
  profitColorScheme?: ProfitColorScheme;
  signed?: boolean;
  unavailableLabel?: string;
  value: string | null;
}) {
  if (hidden) {
    return <VibeMetric className="daily-overview__private" unit={currency} value="••••••" />;
  }
  if (value === null) {
    return <span className="daily-overview__unavailable">{unavailableLabel}</span>;
  }
  return (
    <VibeMetric
      className={profitColorScheme ? "profit-color-value" : undefined}
      data-profit-color-scheme={profitColorScheme}
      data-profit-direction={
        profitColorScheme ? profitDirection(value) : undefined
      }
      unit={currency}
      value={signed ? signedAmount(value, amount, { signZero: true }) : amount(value)}
    />
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
  currency: ReportingCurrency,
): DailyAssetTrendObservation | null {
  return observations
    .filter(
      (observation) =>
        observation.day < currentDay &&
        totalAssetTrendStatus(observation, currency) === "complete",
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
  investmentBooks,
  manualRecords = [],
  importedHistory = [],
  cashflows,
  currentDay,
  currentObservedAt,
  demoMode = false,
  profitColorScheme,
  sources,
  trendObservations,
}: {
  investmentBooks?: InvestmentBookState | null;
  manualRecords?: ManualAssetRecord[];
  importedHistory?: ImportedAssetSourceHistoryObservation[];
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
  const { failedSources } = useAssetRefresh();
  const hasSyncFailures = !demoMode && (failedSources.length > 0 ||
    sources.some(source => source.lifecycle !== "disconnected" && source.kind !== "manual" && source.sync.error !== null));
  const totalTrendObservations = useMemo(
    () => projectTotalAssetTrendObservations({
      observations: trendObservations, sources, manualRecords, importedHistory,
      members: investmentBooks?.members,
    }),
    [trendObservations, sources, manualRecords, importedHistory, investmentBooks],
  );
  const recordedSources = useMemo(
    () => liveSources.filter(hasManualAssetRecord),
    [liveSources],
  );
  const usdValuation = useMemo(
    () => buildTotalValuation(recordedSources, "USD", "source"),
    [recordedSources],
  );
  const longbridgeRates = useMemo(
    () => longbridgeReferenceRates(recordedSources),
    [recordedSources],
  );
  const usdValuationComplete =
    usdValuation.amount !== null &&
    !usdValuation.incomplete &&
    recordedSources.length > 0;
  const currentTotals = useMemo(() => {
    // 比较与收益仍要求新鲜数据，不与总额估值完整性共用展示判断。
    const complete =
      usdValuationComplete &&
      usdValuation.expiredCount === 0 &&
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
  }, [currentObservedAt, longbridgeRates, recordedSources, usdValuation, usdValuationComplete]);
  const current = currentTotals[currency];
  const currentValuationComplete = current !== null && usdValuationComplete;
  const recordedTodayObservation = useMemo(
    () =>
      totalTrendObservations
        .filter(
          (observation) =>
            observation.day === currentDay &&
            totalAssetTrendStatus(observation, currency) === "complete",
        )
        .toSorted((left, right) => right.capturedAt.localeCompare(left.capturedAt))
        .at(0) ?? null,
    [currency, currentDay, totalTrendObservations],
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
    totalTrendObservations,
    currentDay,
    currency,
  );
  const daysSincePriorObservation = priorObservation === null
    ? null
    : daysBetweenShanghaiDays(priorObservation.day, currentDay);
  const intervalFallback = daysSincePriorObservation !== null &&
    daysSincePriorObservation > 1;
  const sourceComparisonLabel = priorObservation === null
    ? "前值"
    : intervalFallback
      ? formatShanghaiDayLabel(priorObservation.day)
      : "昨日";
  const comparisonTotal = priorObservation?.total[currency];
  const changeSourceIds = new Set(current?.complete
    ? recordedSources.map(source => source.id)
    : recordedTodayObservation?.sources.map(source => source.sourceId));
  const hasSameSourceScope = priorObservation !== null &&
    changeSourceIds.size === priorObservation.sources.length &&
    priorObservation.sources.every(source => changeSourceIds.has(source.sourceId));
  const todayChange = changeEndpoint !== null &&
    hasSameSourceScope &&
    comparisonTotal != null
    ? decimalSubtract(changeEndpoint.amount, comparisonTotal)
    : null;
  const trendRange = useAssetTrendRange();
  const trend = useMemo(() => {
    const firstTrendDay = totalTrendObservations
      .filter((observation) => observation.total[currency] != null)
      .map((observation) => observation.day)
      .toSorted()
      .at(0);
    const days = rangeDays(trendRange.preset, currentDay, firstTrendDay, trendRange.customRange);
    const observationsByDay = new Map(
      totalTrendObservations.map((observation) => [observation.day, observation]),
    );
    const points = days.map((day) => {
      const observation = observationsByDay.get(day);
      const status = observation
        ? totalAssetTrendStatus(observation, currency)
        : "incomplete";
      return {
        day,
        amount: observation?.total[currency] ?? null,
        observed: observation !== undefined,
        status,
      };
    });
    return {
      firstDay: firstTrendDay,
      points,
    };
  }, [currency, currentDay, totalTrendObservations, trendRange.preset, trendRange.customRange]);
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
          id: source.id,
          syncOnly: source.sync.error !== null && sourceAmount !== null && !valuation.incomplete,
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
  const remainingChangeIssueSources = todayChangeIssueSources.filter(source =>
    !source.syncOnly || !failedSources.some(failed => failed.id === source.id),
  );
  const currentReason = current === null
    ? currency === "USD"
      ? "总额数据不完整。"
      : `无法折算为 ${currency}。`
    : !current.complete
      ? "总额为最近成功值。"
      : null;
  const dataStatusLabel = !currentValuationComplete
    ? `数据不完整${usdValuation.unvaluedCount > 0 ? `，未估值 ${usdValuation.unvaluedCount} 项` : ""}`
    : todayChangeIssueSources.length > 0
      ? `${todayChangeIssueSources.length} 个来源待更新`
      : "部分来源待更新";
  const reportingRate = currency === "USD"
    ? null
    : usdValuation.exchangeRateObservations.find(
      (rate) => rate.quoteCurrency === currency,
    ) ?? null;
  // 本金与收益都不可用时，整块降级为一行，避免首屏中段重复显示「数据不足」。
  const summaryCompact =
    analysis.cumulativeNetInvestment === null &&
    analysis.investmentProfit === null;
  const overviewEmpty = !demoMode && recordedSources.length === 0;
  return (
    <div
      className="daily-overview"
      data-testid="portfolio-overview-workspace"
    >
      <WorkbenchPageHeader
        actionsLabel="总览快捷操作"
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
            {demoMode ? null : <AssetGlobalRefreshControl showRecoveryDetails={false} />}
          </>
        }
      />

      {/* 未接入来源时只显示接入入口，避免重复的缺数据分区。 */}
      {overviewEmpty ? (
        <section
          aria-labelledby="overview-getting-started-title"
          className="daily-overview__getting-started"
        >
          <h2 id="overview-getting-started-title">添加资产来源</h2>
          <div className="daily-overview__getting-started-actions">
            <VibeLink href="/asset-sources/new" variant="primary">
              新增资产来源
            </VibeLink>
            <VibeLink href="/?mode=demo" variant="text">
              先看演示模式
            </VibeLink>
          </div>
        </section>
      ) : null}

      {overviewEmpty ? null : (
        <>
          <div className="daily-overview__hero" data-has-investment-books={investmentBooks ? "true" : undefined}>
            <section className="daily-overview__main" aria-label="资产概况">
              <div className="daily-overview__snapshot" aria-labelledby="overview-total-title">
                <div className="daily-overview__snapshot-metrics">
                  <article className="daily-overview__balance" data-testid="overview-current-total">
                    <header className="daily-overview__total-heading">
                      <h2 id="overview-total-title" aria-label="总资产">总资产</h2>
                      <span>资产同步 {sourceSyncTimeLabel(sources)}</span>
                    </header>
                    <MetricValue
                      currency={currency}
                      hidden={!showSensitiveInfo}
                      value={current?.amount ?? null}
                    />
                    {reportingRate === null ? null : (
                      <p data-testid="overview-reporting-rate">
                        {reportingRate.baseCurrency}/{reportingRate.quoteCurrency}{" "}
                        {decimalToFixed(reportingRate.rate, 4)}
                        {"，"}
                        {formatShanghaiShortDateTime(reportingRate.observedAt)}
                      </p>
                    )}
                  </article>
                  <article className="daily-overview__change">
                    <h2>
                      {intervalFallback ? "较上次完整记录变化" : "今日资产变化"}
                    </h2>
                    <MetricValue
                      currency={currency}
                      hidden={!showSensitiveInfo}
                      profitColorScheme={profitColorScheme}
                      signed
                      unavailableLabel="暂不可比"
                      value={todayChange}
                    />
                    {priorObservation === null ? null : (
                      <p>
                        {intervalFallback
                          ? `较 ${formatShanghaiDayLabel(priorObservation.day)}（${daysSincePriorObservation} 日）`
                          : `较 ${formatShanghaiDayLabel(priorObservation.day)}`}
                      </p>
                    )}
                  </article>
                </div>
                {!currentValuationComplete || !current?.complete || hasSyncFailures ? <details
                  className="daily-overview__confidence"
                  data-tone={hasSyncFailures ? "error" : undefined}
                  data-testid="overview-confidence"
                >
                  <summary>
                    <span>{hasSyncFailures ? "部分来源未更新" : dataStatusLabel}</span>
                    {usesRecordedTodayObservation ? <span className="daily-overview__confidence-context">
                      {"，"}资产变化截至 {formatShanghaiShortDateTime(changeEndpoint.observedAt)}
                    </span> : currentValuationComplete ? <span className="daily-overview__confidence-context">
                      {"，"}总额含最近成功值
                    </span> : null}
                  </summary>
                  <div className="daily-overview__confidence-details">
                    {hasSyncFailures ? <AssetRefreshIssues hideSourceNames={!showSensitiveInfo} /> : null}
                    {demoMode ? null : <VibeLink href="/settings?view=data#source-checks-title" variant="text">检查资产来源</VibeLink>}
                    {!hasSyncFailures || !currentValuationComplete ? <p>{currentReason ?? `已覆盖 ${recordedSources.length} 个来源`}</p> : null}
                    {usesRecordedTodayObservation ? <p>
                      当前刷新有失败，资产变化使用上述时间的已记录观测。
                    </p> : null}
                    {!hasSyncFailures && usdValuation.expiredCount > 0 ? <p>
                      过期来源 {usdValuation.expiredCount} 个；可在顶部刷新资产。
                    </p> : null}
                    {remainingChangeIssueSources.length > 0 ? <div
                      className="daily-overview__change-issues"
                      data-testid="overview-data-issues"
                    >
                      {!showSensitiveInfo ? <span>已隐藏 {remainingChangeIssueSources.length} 个来源。</span> : <ul>
                        {remainingChangeIssueSources.map((source) => (
                          <li data-tone={source.tone} key={source.label}>
                            <span>
                              <strong>{source.label}</strong>
                              <small>{source.status}</small>
                            </span>
                            <b>
                              {source.amount === null
                                ? "无法折算"
                                : <AssetFinancialValue unit={currency}>
                                    {amount(source.amount)}
                                  </AssetFinancialValue>}
                            </b>
                          </li>
                        ))}
                      </ul>}
                    </div> : null}
                  </div>
                </details> : null}
                <LongbridgeRealtimeNotice state={realtimeState} retry={retry} sourceId={sources.find(source => source.kind === "longbridge" && source.lifecycle !== "disconnected")?.id} />
              </div>
              <section
                className="daily-overview__trend"
                data-testid="overview-trend"
              >
                <AssetTrendPanel
                  title="资产走势"
                  range={{ ...trendRange, currentDay, firstDay: trend.firstDay }}
                  ariaLabel="总资产趋势"
                  chartHeight={320}
                  currency={currency}
                  dateAxisPresentation="compact"
                  formatAmount={amount}
                  formatDay={formatShanghaiDayLabel}
                  isSensitiveHidden={!showSensitiveInfo}
                  points={trend.points}
                />
              </section>
            </section>

            {investmentBooks ? <section className="daily-overview__books" aria-label="投资账本">
              <div className="daily-overview__books-grid">
                {INVESTMENT_BOOKS.map(book => {
                  const result = analyzeInvestmentBook({
                    state: investmentBooks,
                    bookId: book.id,
                    sources: liveSources,
                    observations: trendObservations,
                    manualRecords,
                    currentDay,
                  });
                  const summary = result.summary;
                  const hasBookValues = summary !== null && [
                    summary.total,
                    summary.netInvestment,
                    summary.profit,
                  ].some(value => value !== null);
                  return <article key={book.id} className="daily-overview__book">
                    <h3>
                      <VibeEntityLink href={`/performance?book=${book.id}`} aria-label={`查看${book.name}投资账本`}>
                        {book.name}
                      </VibeEntityLink>
                    </h3>
                    {hasBookValues && summary ? <>
                      <div className="daily-overview__book-total" aria-label={`${book.name}资产金额`}>
                        <MetricValue currency={book.currency} hidden={!showSensitiveInfo} value={summary.total} />
                      </div>
                      {summary.netInvestment !== null || summary.profit !== null ? <dl className="daily-overview__book-metrics">
                        <div>
                          <dt>累计净投入</dt>
                          <dd><MetricValue currency={book.currency} hidden={!showSensitiveInfo} value={summary.netInvestment} /></dd>
                        </div>
                        <div>
                          <dt>累计收益</dt>
                          <dd><MetricValue currency={book.currency} hidden={!showSensitiveInfo} profitColorScheme={profitColorScheme} signed value={summary.profit} /></dd>
                        </div>
                      </dl> : null}
                      <p className="daily-overview__book-date">{summary.total !== null ? `截至 ${summary.day}` : "暂无完整资产记录"}</p>
                    </> : result.summaryMissingReason && showSensitiveInfo ? null : <p className="daily-overview__book-date">{summary ? "数据不足" : "暂无资产记录"}</p>}
                    {showSensitiveInfo && result.summaryMissingReason ? <p className="daily-overview__book-warning">{result.summaryMissingReason}</p> : null}
                  </article>;
                })}
              </div>
            </section> : <section
              className="daily-overview__summary"
              data-compact={summaryCompact ? "true" : undefined}
              aria-label="本金与收益摘要"
            >
              {summaryCompact ? (
                <>
                  <p className="daily-overview__summary-label">本金与收益</p>
                  <MetricValue currency={currency} hidden={!showSensitiveInfo} value={null} />
                </>
              ) : null}
              {summaryCompact ? null : (
                <article data-testid="overview-net-investment">
                  <p>累计净投入</p>
                  <MetricValue
                    currency={currency}
                    hidden={!showSensitiveInfo}
                    value={analysis.cumulativeNetInvestment}
                  />
                  {currency !== "USD" ? <span>按当前汇率折算</span> : null}
                </article>
              )}
              {summaryCompact ? null : (
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
              )}
              {demoMode ? null : (
                <div className="daily-overview__summary-actions">
                  <VibeLink href="/performance" variant="text">
                    查看投资账本
                  </VibeLink>
                </div>
              )}
            </section>}
          </div>
          <section className="daily-overview__sources" data-testid="overview-source-summary" aria-labelledby="overview-sources-title">
            <header className="daily-overview__section-heading">
              <h2 id="overview-sources-title">来源分布</h2>
              {demoMode ? null : <VibeLink href="/assets" variant="text" size="compact">查看持仓</VibeLink>}
            </header>
            {sourceSummaries.length === 0 ? (
              <div className="empty-state">
                <p className="empty-title">尚未接入资产来源</p>
                <VibeLink href="/asset-sources/new" variant="primary">新增资产来源</VibeLink>
              </div>
            ) : (
              <>
                <div className="daily-overview__source-head" aria-hidden="true">
                  <span>来源</span><span>当前金额</span><span>较{sourceComparisonLabel}变化</span><span>{sourceComparisonLabel}金额</span>
                </div>
                <ul className="daily-overview__source-list">
                  {sourceSummaries.map(({ amount: sourceAmount, comparison, health, source }) => (
                    <li key={source.id}>
                      <article>
                        <div className="daily-overview__source-heading">
                          <h3>
                            {demoMode ? assetSourceDisplayName(source) : (
                              <VibeEntityLink href={`/asset-sources/${encodeURIComponent(source.id)}`}>
                                {assetSourceDisplayName(source)}
                              </VibeEntityLink>
                            )}
                          </h3>
                          <strong className="daily-overview__source-total">
                            {!showSensitiveInfo ? <AssetFinancialValue unit={currency}>••••••</AssetFinancialValue> : sourceAmount === null ? "无法折算" : (
                              <AssetFinancialValue unit={currency}>
                                <VibeLiveCounter value={amount(sourceAmount)} resetKey={currency} />
                              </AssetFinancialValue>
                            )}
                          </strong>
                        </div>
                        <div className="daily-overview__source-comparison">
                          <div className="daily-overview__source-change" data-comparison-state={comparison.state}>
                            {comparison.state === "changed" ? <>
                              <span className="daily-overview__source-column-label">较{sourceComparisonLabel}变化</span>
                              <MetricValue
                                currency={currency}
                                hidden={!showSensitiveInfo}
                                profitColorScheme={profitColorScheme}
                                signed
                                value={comparison.change}
                              />
                            </> : <span>{comparison.state === "scope-change" ? "新增纳入" : "暂不可比"}</span>}
                          </div>
                          <span className="daily-overview__source-previous">
                            {priorObservation === null ? "暂无可比记录" : <><span className="daily-overview__source-column-label">{sourceComparisonLabel}金额</span>{" "}{comparison.state === "changed" ? (
                              <AssetFinancialValue unit={currency}>{showSensitiveInfo ? amount(comparison.previousAmount) : "••••••"}</AssetFinancialValue>
                            ) : comparison.state === "scope-change" ? "未纳入" : "—"}</>}
                          </span>
                        </div>
                        {health.tone !== "success" ? <VibeStatusTag tone={health.tone}>{health.label}</VibeStatusTag> : null}
                      </article>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
