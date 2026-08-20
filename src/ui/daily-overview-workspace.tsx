"use client";

import { useMemo } from "react";

import {
  analyzeInvestmentPerformance,
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
  DailyAssetTrendObservation,
  InvestmentCashflow,
} from "@/server/ports";
import { AssetRefreshControls } from "@/ui/asset-refresh-controls";
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

  const recordedSources = useMemo(
    () => sources.filter(hasManualAssetRecord),
    [sources],
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
  const analysis = useMemo(
    () =>
      analyzeInvestmentPerformance({
        currency,
        asOf: currentObservedAt,
        currentTotal: current,
        cashflows,
        interval: null,
      }),
    [cashflows, currency, current, currentObservedAt],
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
  const todayChange = current?.complete &&
    comparisonTotal != null
    ? decimalSubtract(current.amount, comparisonTotal)
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
    () =>
      recordedSources
        .map((source) => ({
          source,
          amount: sourceTotalInCurrency(source, currency, longbridgeRates),
          health: sourceHealth(source),
        }))
        .toSorted((left, right) => {
          if (left.amount === null) return right.amount === null ? 0 : 1;
          if (right.amount === null) return -1;
          return decimalCompare(right.amount, left.amount);
        }),
    [currency, longbridgeRates, recordedSources],
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
      ? "当前来源总额不完整、包含过期数据或尚未接入来源，不能形成可信组合结论。"
      : `没有可用的长桥参考汇率，无法将 USD 总额折算为 ${currency}。`
    : !current.complete
      ? "当前总额保留最后成功数据，但包含过期、不完整或已断开的来源；金额可阅读，不将其标为完整。"
      : null;
  const refreshEnabled = recordedSources.some(
    (source) =>
      source.lifecycle !== "disconnected" && source.kind !== "manual",
  );
  const hasEvmSources = recordedSources.some(
    (source) =>
      source.lifecycle !== "disconnected" && source.kind.startsWith("evm-watch-"),
  );
  const hasNonEvmSources = recordedSources.some(
    (source) =>
      source.lifecycle !== "disconnected" &&
      source.kind !== "manual" &&
      !source.kind.startsWith("evm-watch-"),
  );
  const needsDailyEvmPriceRefresh = recordedSources.some(
    (source) =>
      source.lifecycle !== "disconnected" &&
      source.kind.startsWith("evm-watch-") &&
      source.sync.lastAttemptAt.slice(0, 10) !== currentDay,
  );

  return (
    <div
      className="daily-overview"
      data-testid="portfolio-overview-workspace"
    >
      <WorkbenchPageHeader
        actionsLabel="总览快捷操作"
        description="先判断组合总额是否可信，再查看本金、实际盈亏与今日变化。"
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
            <AssetRefreshControls
              automaticRefresh={false}
              disabled={demoMode}
              enabled={refreshEnabled}
              hasEvmSources={hasEvmSources}
              hasNonEvmSources={hasNonEvmSources}
              needsDailyEvmPriceRefresh={needsDailyEvmPriceRefresh}
            />
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
          <p>
            默认以 USD 计价；CNY、HKD 按长桥参考汇率折算。
            {usdValuation.exchangeRateObservations.map((rate) => (
              <span key={`${rate.baseCurrency}/${rate.quoteCurrency}`}>
                <br />
                {rate.baseCurrency}/{rate.quoteCurrency} {decimalToFixed(rate.rate, 4)}
                {" · "}
                {formatShanghaiShortDateTime(rate.observedAt)}
              </span>
            ))}
          </p>
        </article>
        <article data-testid="overview-confidence">
          <p className="card-label">CONFIDENCE / DATA</p>
          <h2>{current?.complete ? "总额完整" : "需要留意数据状态"}</h2>
          <VibeStatusTag tone={current?.complete ? "success" : "warning"}>
            {current?.complete ? "来源账户总额 · 当前" : "总额保留最后成功数据"}
          </VibeStatusTag>
          <p>
            {currentReason ??
              `已覆盖 ${recordedSources.length} 个资产来源。`}
          </p>
          {!current?.complete ? (
            <p>
              未估值 {usdValuation.unvaluedCount} 项，过期来源 {usdValuation.expiredCount} 个。
            </p>
          ) : null}
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
          <p>
            {priorObservation === null
              ? "等待一条此前完整资产记录后开始计算；可能包含入金、出金或账户划转，不是投资盈亏。"
              : intervalFallback
                ? `相对上次完整记录（${formatShanghaiDayLabel(priorObservation.day)}，间隔 ${daysSincePriorObservation} 天）以来；可能包含入金、出金或账户划转，不是投资盈亏。`
                : `相对昨日最后完整记录（${formatShanghaiDayLabel(priorObservation.day)}）；可能包含入金、出金或账户划转，不是投资盈亏。`}
          </p>
          {todayChange === null &&
          priorObservation !== null &&
          todayChangeIssueSources.length > 0 ? (
            <div
              className="daily-overview__change-issues"
              data-testid="overview-today-change-issues"
            >
              <p>影响本次计算的来源</p>
              {!showSensitiveInfo ? (
                <span>
                  已隐藏 {todayChangeIssueSources.length} 个问题来源；不参与今日资产变化。
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
                  <span>以上数据不参与今日资产变化。</span>
                </>
              )}
            </div>
          ) : null}
        </article>
      </section>

      <section className="daily-overview__summary" aria-label="本金与收益摘要">
        <article data-testid="overview-net-investment">
          <p>累计净投入</p>
          <MetricValue
            currency={currency}
            hidden={!showSensitiveInfo}
            value={analysis.current.cumulativeNetInvestment}
          />
          <span>初始投入与外部资金进出</span>
        </article>
        <article data-testid="overview-investment-profit">
          <p>组合投资盈亏</p>
          <MetricValue
            currency={currency}
            hidden={!showSensitiveInfo}
            signed
            value={analysis.current.investmentProfit}
          />
          <span>当前完整总额减累计净投入</span>
        </article>
        {demoMode ? (
          <p className="daily-overview__demo-static">
            演示数据不可记录资金或查看真实收益分析。
          </p>
        ) : (
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

      <section className="daily-overview__trend" data-testid="overview-trend">
        <header>
          <h2>近 7 日资产走势</h2>
          <div className="daily-overview__trend-actions">
            <span>
              {trend.firstDay
                ? `${formatShanghaiDayLabel(trend.firstDay)} 至 ${formatShanghaiDayLabel(currentDay)}`
                : "暂无可用观察"}
            </span>
            {demoMode ? (
              <span className="daily-overview__demo-static">
                演示仅展示近 7 日样例走势
              </span>
            ) : (
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
        <p className="daily-overview__hint">
          缺失日期不补造数据；曲线会跨过空缺连接已有估值观测。深度历史、区间收益和资金记录在收益分析中维护。
        </p>
      </section>

      <section className="daily-overview__sources" data-testid="overview-source-summary">
        <header>
          <div>
            <p className="card-label">SOURCES / SUMMARY</p>
            <h2>来源摘要</h2>
          </div>
          {demoMode ? (
            <span className="daily-overview__demo-static">
              演示不提供真实资产与持仓详情
            </span>
          ) : (
            <VibeLink aria-label="查看全部资产与持仓" href="/assets" variant="outline">
              查看全部资产与持仓
            </VibeLink>
          )}
        </header>
        {!showSensitiveInfo ? (
          <p className="daily-overview__hidden-sources">
            已隐藏 {recordedSources.length} 个来源的身份、金额与同步状态。
          </p>
        ) : sourceSummaries.length === 0 ? (
          <div className="empty-state">
            <p className="empty-title">尚未接入资产来源</p>
            <p className="empty-hint">先连接只读账户、观察钱包或手工资产，再形成组合总额。</p>
            <VibeLink href="/asset-sources/new" variant="primary">
              新增资产来源
            </VibeLink>
          </div>
        ) : (
          <ul className="daily-overview__source-list">
            {sourceSummaries.map(({ amount: sourceAmount, health, source }) => (
              <li key={source.id}>
                <article>
                  <div>
                    <p>{assetSourceDisplayName(source)}</p>
                    <VibeStatusTag tone={health.tone}>{health.label}</VibeStatusTag>
                  </div>
                  <strong>
                    {sourceAmount === null
                      ? "无法折算"
                      : `${amount(sourceAmount)} ${currency}`}
                  </strong>
                  {demoMode ? (
                    <span className="daily-overview__demo-static">
                      演示来源
                    </span>
                  ) : (
                    <VibeLink
                      aria-label={`查看 ${assetSourceDisplayName(source)} 来源详情`}
                      href={`/asset-sources/${encodeURIComponent(source.id)}`}
                      variant="text"
                    >
                      详情
                    </VibeLink>
                  )}
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>

      {demoMode ? (
        <div className="daily-overview__refresh">
          <span>演示数据为固定样例；刷新、来源维护与真实账户访问均不可用。</span>
        </div>
      ) : refreshEnabled ? (
        <div className="daily-overview__refresh">
          <VibeLink href="/asset-sources" variant="text">
            在资产来源中查看单来源状态与恢复操作
          </VibeLink>
          <span>
            全局刷新只更新已连接来源；单来源恢复、重新授权与生命周期操作留在资产来源。
          </span>
        </div>
      ) : null}
    </div>
  );
}
