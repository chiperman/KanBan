"use client";

import { useEffect, useMemo, useState } from "react";

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
  type ReportingCurrency,
} from "@/domain/valuation";
import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import { daysForTrendRange, totalTrendObservationStatus } from "@/domain/daily-trend-observations";
import { portfolioSourceTotal } from "@/domain/evm-token-preferences";
import { hasManualAssetRecord } from "@/domain/manual-asset-records";
import type {
  AssetSourceSummary,
  DailyAssetBaseline,
  DailyAssetTrendObservation,
  InvestmentCashflow,
} from "@/server/ports";
import { AssetRefreshControls } from "@/ui/asset-refresh-controls";
import { AssetTrendChart } from "@/ui/asset-trend-chart";
import {
  VibeMetric,
  VibeStatusTag,
} from "@/ui/vibe/vibe-data-instrument";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import {
  VibeSelect,
  type VibeSelectOption,
} from "@/ui/vibe/vibe-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import {
  formatShanghaiDateTime,
  formatShanghaiDayLabel,
} from "@/ui/shanghai-date-time";

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

function sourceHealth(source: OverviewSource): {
  label: string;
  tone: "error" | "success" | "warning";
} {
  if (source.lifecycle === "disconnected") {
    return { label: "已断开 · 保留最后快照", tone: "warning" };
  }
  if (source.sync.status === "expired" || source.sync.error !== null) {
    return {
      label: `数据过期 · 成功于 ${formatShanghaiDateTime(source.sync.lastSuccessfulAt)}`,
      tone: "warning",
    };
  }
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
  signed = false,
  value,
}: {
  currency: ReportingCurrency;
  hidden: boolean;
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
      unit={currency}
      value={signed ? signedAmount(value) : amount(value)}
    />
  );
}

function sourceTotalInCurrency(
  source: OverviewSource,
  currency: ReportingCurrency,
  rates: OverviewSource["snapshot"]["exchangeRates"],
): string | null {
  const total = portfolioSourceTotal(source);
  return convertCurrencyAmount(total.amount, total.currency, currency, rates);
}

export function DailyOverviewWorkspace({
  cashflows,
  currentDay,
  currentObservedAt,
  dailyBaselines,
  sources,
  trendObservations,
}: {
  cashflows: InvestmentCashflow[];
  currentDay: string;
  currentObservedAt: string;
  dailyBaselines: DailyAssetBaseline[];
  sources: OverviewSource[];
  trendObservations: DailyAssetTrendObservation[];
}) {
  const [currency, setCurrency] = useState<ReportingCurrency>("USD");
  const [showSensitiveInfo, setShowSensitiveInfo] = useState(true);

  useEffect(() => {
    const stored = window.localStorage.getItem("reporting-currency");
    if (stored === "USD" || stored === "CNY" || stored === "HKD") {
      setCurrency(stored);
    }
  }, []);

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
  const baseline = dailyBaselines.find((item) => item.day === currentDay);
  const todayChange = currency === "USD" &&
    currentTotals.USD?.complete &&
    baseline?.status !== "expired" &&
    baseline?.complete &&
    baseline.total.USD !== null
    ? decimalSubtract(currentTotals.USD.amount, baseline.total.USD)
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
        amount: currency === "USD" ? observation?.total.USD ?? null : null,
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
  const currentReason = current === null
    ? currency === "USD"
      ? "当前来源总额不完整、包含过期数据或尚未接入来源，不能形成可信组合结论。"
      : `没有可用的长桥参考汇率，无法将 USD 总额折算为 ${currency}。`
    : !current.complete
      ? "当前总额保留最后成功数据，但包含过期、不完整或已断开的来源；金额可阅读，不将其标为完整。"
      : null;
  const rateEvidence = currency === "USD"
    ? "USD 为默认计价，不需要折算。CNY 与 HKD 仅使用长桥参考汇率。"
    : longbridgeRates.length === 0
      ? `没有可用的长桥参考汇率，${currency} 总额与相关收益暂不显示。`
      : `${currency} 折算只使用长桥参考汇率；最近观察 ${formatShanghaiDateTime(
        longbridgeRates
          .map((rate) => rate.observedAt)
          .toSorted()
          .at(-1)!,
      )}。`;
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
      <header className="daily-overview__header">
        <div>
          <p className="card-label">PORTFOLIO / TODAY</p>
          <h1>总览</h1>
          <p>先判断组合总额是否可信，再查看本金、实际盈亏与今日变化。</p>
        </div>
        <div className="daily-overview__actions" aria-label="总览快捷操作">
          <VibeSelect
            fieldId="overview-reporting-currency"
            label="计价货币"
            onValueChange={(nextCurrency) => {
              setCurrency(nextCurrency);
              window.localStorage.setItem("reporting-currency", nextCurrency);
            }}
            options={CURRENCY_OPTIONS}
            value={currency}
            variant="compact"
          />
          <VibeButton
            aria-pressed={showSensitiveInfo}
            onClick={() => setShowSensitiveInfo((currentValue) => !currentValue)}
            type="button"
            variant="outline"
          >
            {showSensitiveInfo ? "隐藏关键信息" : "显示关键信息"}
          </VibeButton>
          <AssetRefreshControls
            automaticRefresh={false}
            enabled={refreshEnabled}
            hasEvmSources={hasEvmSources}
            hasNonEvmSources={hasNonEvmSources}
            needsDailyEvmPriceRefresh={needsDailyEvmPriceRefresh}
          />
        </div>
      </header>

      <section className="daily-overview__current" aria-labelledby="overview-total-title">
        <article data-testid="overview-current-total">
          <p className="card-label">CURRENT / CONSOLIDATED</p>
          <h2 id="overview-total-title">当前全部投资资产</h2>
          <MetricValue
            currency={currency}
            hidden={!showSensitiveInfo}
            value={current?.amount ?? null}
          />
          <p>来源账户/平台总额是组合汇总真相；持仓明细只用于观察，不强制对账。</p>
        </article>
        <article data-testid="overview-confidence">
          <p className="card-label">CONFIDENCE / DATA</p>
          <h2>{current?.complete ? "总额完整" : "需要留意数据状态"}</h2>
          <VibeStatusTag tone={current?.complete ? "success" : "warning"}>
            {current?.complete ? "来源账户总额 · 当前" : "总额保留最后成功数据"}
          </VibeStatusTag>
          <p>
            {currentReason ??
              `已汇总 ${recordedSources.length} 个可计入来源；未估值 ${usdValuation.unvaluedCount} 项，过期来源 ${usdValuation.expiredCount} 个。`}
          </p>
          {!current?.complete ? (
            <p>
              未估值 {usdValuation.unvaluedCount} 项，过期来源 {usdValuation.expiredCount} 个。
            </p>
          ) : null}
          <p>{rateEvidence}</p>
        </article>
        <article>
          <p className="card-label">TODAY / ASSET CHANGE</p>
          <h2>今日资产变化</h2>
          <MetricValue
            currency={currency}
            hidden={!showSensitiveInfo}
            signed
            value={todayChange}
          />
          <p>
            相对当天首个完整资产基准；可能包含入金、出金或账户划转，不是投资盈亏。
          </p>
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
        <div className="daily-overview__summary-actions">
          <VibeLink href="/performance" variant="primary">
            记录资金
          </VibeLink>
          <VibeLink href="/performance" variant="text">
            查看收益分析
          </VibeLink>
        </div>
      </section>

      <section className="daily-overview__trend" data-testid="overview-trend">
        <header>
          <div>
            <p className="card-label">TREND / LAST 7 DAYS</p>
            <h2>短趋势</h2>
          </div>
          <span>
            {trend.firstDay
              ? `${formatShanghaiDayLabel(trend.firstDay)} 至 ${formatShanghaiDayLabel(currentDay)}`
              : "暂无可用观察"}
          </span>
        </header>
        {currency !== "USD" ? (
          <VibeNotice tone="info">
            为避免使用无法追溯到长桥的历史换算，短趋势暂以 USD 观察提供；其他币种的数据不足时不会补造曲线。
          </VibeNotice>
        ) : null}
        <AssetTrendChart
          ariaLabel="近七日总资产趋势"
          currency={currency}
          formatAmount={amount}
          formatDay={formatShanghaiDayLabel}
          incompleteCount={trend.incompleteCount}
          isSensitiveHidden={!showSensitiveInfo}
          points={trend.points}
          unavailableCount={trend.unavailableCount}
        />
        <p className="daily-overview__hint">
          缺失、不完整和过期观测保持断点；深度历史、区间收益和资金记录在收益分析中维护。
        </p>
      </section>

      <section className="daily-overview__sources" data-testid="overview-source-summary">
        <header>
          <div>
            <p className="card-label">SOURCES / SUMMARY</p>
            <h2>来源摘要</h2>
          </div>
          <VibeLink aria-label="查看全部资产与持仓" href="/assets" variant="outline">
            查看全部资产与持仓
          </VibeLink>
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
                  <VibeLink
                    aria-label={`查看 ${assetSourceDisplayName(source)} 来源详情`}
                    href={`/asset-sources/${encodeURIComponent(source.id)}`}
                    variant="text"
                  >
                    详情
                  </VibeLink>
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>

      {refreshEnabled ? (
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
