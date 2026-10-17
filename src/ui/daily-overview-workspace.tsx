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
  formatShanghaiDateTime,
  formatShanghaiDayLabel,
  formatShanghaiShortDateTime,
} from "@/ui/shanghai-date-time";
import { signedAmount } from "@/ui/signed-amount";
import { CURRENCY_OPTIONS } from "@/ui/reporting-currency-options";
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

function amount(value: string): string {
  const [integer, fraction] = decimalToFixed(value, 2).split(".");
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
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
      value={signed ? signedAmount(value, amount, { signZero: true }) : amount(value)}
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

      {/* 尚未接入来源时给出下一步路径；金额卡片仍保留，缺数据继续显示「数据不足」 */}
      {overviewEmpty ? (
        <section
          aria-labelledby="overview-getting-started-title"
          className="daily-overview__getting-started"
        >
          <p className="card-label">GETTING STARTED</p>
          <h2 id="overview-getting-started-title">
            接入第一个资产来源，看板会自动开始工作
          </h2>
          <p className="daily-overview__getting-started-desc">
            总资产、趋势与收益分析在数据接入后自动生成，无需手动录入每日金额。
          </p>
          <ol className="daily-overview__getting-started-steps">
            <li>
              <span className="daily-overview__getting-started-index">01</span>
              <strong>新增资产来源</strong>
              <span>
                长桥 / 交易所 / 观察钱包 / 手工记录，只需只读凭证。
              </span>
            </li>
            <li>
              <span className="daily-overview__getting-started-index">02</span>
              <strong>等待首次同步</strong>
              <span>
                同步成功即形成当日基准，趋势图从第一天开始积累。
              </span>
            </li>
            <li>
              <span className="daily-overview__getting-started-index">03</span>
              <strong>记录初始投入</strong>
              <span>
                录入本金事实后，累计净投入与组合投资盈亏才会亮起。
              </span>
            </li>
          </ol>
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
          {/* 数据完整性并入总资产卡，避免与下方提示重复表达同一事实 */}
          <article
            className="daily-overview__confidence"
            data-testid="overview-confidence"
          >
            <p className="card-label">CONFIDENCE / DATA</p>
            <h2>{currentValuationComplete ? "总额完整" : "数据不完整"}</h2>
            <p>
              {currentReason ??
                `已覆盖 ${recordedSources.length} 个来源`}
            </p>
            {!current?.complete ? (
              <p>
                未估值 {usdValuation.unvaluedCount} 项 · 过期来源{" "}
                {usdValuation.expiredCount} 个
              </p>
            ) : null}
          </article>
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
          {/* 自释：今日资产变化含资金进出与估值修正，不能当作投资收益阅读 */}
          <p className="daily-overview__note">
            含资金进出与估值修正，不是组合投资盈亏
          </p>
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
      </section>

      <section
        className="daily-overview__summary"
        data-compact={summaryCompact ? "true" : undefined}
        aria-label="本金与收益摘要"
      >
        {summaryCompact ? (
          /* 两个指标都不可用时压缩为一行，避免读屏与视觉上重复播报「数据不足」 */
          <>
            <p className="daily-overview__summary-label">本金与收益</p>
            <span
              className="daily-overview__summary-item"
              data-testid="overview-net-investment"
            >
              <span>累计净投入</span>
              <MetricValue
                currency={currency}
                hidden={!showSensitiveInfo}
                value={analysis.cumulativeNetInvestment}
              />
            </span>
            <span
              className="daily-overview__summary-item"
              data-testid="overview-investment-profit"
            >
              <span>组合投资盈亏</span>
              <MetricValue
                currency={currency}
                hidden={!showSensitiveInfo}
                signed
                value={analysis.investmentProfit}
              />
            </span>
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
            <VibeLink href="/performance" variant="outline">
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
            <p className="card-label">ASSETS / DISTRIBUTION</p>
            <h2>资产分布</h2>
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
          <>
            {/* 列头保留当前总额、较昨日变化和昨日金额的跨行对比。 */}
            <div aria-hidden="true" className="daily-overview__source-head">
              <span>来源</span>
              <span>总额</span>
              <span>较昨日变化</span>
              <span>昨日金额</span>
              <span />
            </div>
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
                      {/* 健康来源不挂彩色标签，只留一行静默说明；只有异常来源才需要被看见 */}
                      {health.tone === "success" ? (
                        <span className="daily-overview__source-state">
                          {health.label}
                        </span>
                      ) : (
                        <VibeStatusTag tone={health.tone}>{health.label}</VibeStatusTag>
                      )}
                    </div>
                    <div className="daily-overview__source-value">
                      <strong className="daily-overview__source-total">
                        {sourceAmount === null
                          ? "无法折算"
                          : (
                            <>
                              <VibeLiveCounter value={amount(sourceAmount)} resetKey={currency} />{" "}
                              <span className="vibe-metric__unit">{currency}</span>
                            </>
                          )}
                      </strong>
                      <div
                        className="daily-overview__source-change"
                        data-comparison-state={comparison.state}
                      >
                        {comparison.state === "changed" ? (
                          <div className="daily-overview__source-change-today">
                            <span className="daily-overview__source-column-label">
                              较昨日变化
                            </span>
                            <VibeMetric
                              className="profit-color-value"
                              data-profit-color-scheme={profitColorScheme}
                              data-profit-direction={profitDirection(comparison.change)}
                              unit={currency}
                              value={signedAmount(comparison.change, amount, { signZero: true })}
                            />
                          </div>
                        ) : comparison.state === "scope-change" ? (
                          <span>新增纳入</span>
                        ) : (
                          <span>暂无法比较</span>
                        )}
                      </div>
                      <div className="daily-overview__source-yesterday">
                        {comparison.state === "changed" ? (
                          <small>
                            <span className="daily-overview__source-column-label">
                              昨日金额
                            </span>{" "}
                            <span className="daily-overview__source-yesterday-amount">
                              {amount(comparison.previousAmount)}
                            </span>{" "}
                            <span className="vibe-metric__unit">
                              {currency}
                            </span>
                          </small>
                        ) : comparison.state === "scope-change" ? (
                          /* 昨日确实没有这个来源，说清楚而不是留空白 */
                          <small>
                            <span className="daily-overview__source-column-label">
                              昨日金额
                            </span>{" "}
                            未纳入
                          </small>
                        ) : (
                          /* 缺失值保留行位，保证各行结构恒定、行高一致 */
                          <small>—</small>
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
          </>
        )}
      </section>


    </div>
  );
}
