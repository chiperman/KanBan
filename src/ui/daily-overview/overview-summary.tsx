import { AssetFinancialValue } from "@/ui/asset-financial-value";
import { LongbridgeRealtimeNotice } from "@/ui/longbridge-realtime-notice";

import { decimalToFixed } from "@/domain/decimal";
import { type PortfolioObservation } from "@/domain/investment-performance";
import { hasManualAssetRecord } from "@/domain/manual-asset-records";
import { buildTotalValuation, type ReportingCurrency } from "@/domain/valuation";
import { AssetRefreshIssues } from "@/ui/asset-source-recovery";
import { type ProfitColorScheme } from "@/ui/profit-color-scheme";
import { formatShanghaiDayLabel, formatShanghaiShortDateTime } from "@/ui/shanghai-date-time";
import { VibeLink } from "@/ui/vibe/vibe-button";

import type { LongbridgeRealtimeState } from "@/ui/use-longbridge-realtime";
import type { compareOverviewObservations } from "./model";
import { amount, MetricValue } from "./presentation";
import type { buildOverviewSourceIssues, OverviewSource } from "./sources-model";

function sourceSyncTimeLabel(sources: OverviewSource[]): string {
  const times = sources
    .filter(hasManualAssetRecord)
    .map((source) => Date.parse(source.snapshot.syncedAt));
  if (times.length === 0 || times.some((time) => !Number.isFinite(time))) {
    return "时间未知";
  }
  const earliest = formatShanghaiShortDateTime(new Date(Math.min(...times)));
  const latest = formatShanghaiShortDateTime(new Date(Math.max(...times)));
  return earliest === latest ? earliest : `${earliest} 至 ${latest}`;
}

export function OverviewSummary({
  currency,
  showSensitiveInfo,
  profitColorScheme,
  sources,
  current,
  currentValuationComplete,
  usdValuation,
  recordedSources,
  todayChangeIssueSources,
  remainingChangeIssueSources,
  hasSyncFailures,
  demoMode,
  realtimeState,
  retry,
  comparison,
}: {
  currency: ReportingCurrency;
  showSensitiveInfo: boolean;
  profitColorScheme: ProfitColorScheme;
  sources: OverviewSource[];
  current: PortfolioObservation | null;
  currentValuationComplete: boolean;
  usdValuation: ReturnType<typeof buildTotalValuation>;
  recordedSources: OverviewSource[];
  todayChangeIssueSources: ReturnType<typeof buildOverviewSourceIssues>;
  remainingChangeIssueSources: ReturnType<typeof buildOverviewSourceIssues>;
  hasSyncFailures: boolean;
  demoMode: boolean;
  realtimeState: LongbridgeRealtimeState;
  retry(): void;
  comparison: ReturnType<typeof compareOverviewObservations>;
}) {
  const {
    changeEndpoint,
    usesRecordedTodayObservation,
    priorObservation,
    daysSincePriorObservation,
    intervalFallback,
    todayChange,
  } = comparison;
  const currentReason =
    current === null
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
  const reportingRate =
    currency === "USD"
      ? null
      : (usdValuation.exchangeRateObservations.find((rate) => rate.quoteCurrency === currency) ??
        null);

  return (
    <div className="daily-overview__snapshot" aria-labelledby="overview-total-title">
      <div className="daily-overview__snapshot-metrics">
        <article className="daily-overview__balance" data-testid="overview-current-total">
          <header className="daily-overview__total-heading">
            <h2 id="overview-total-title" aria-label="总资产">
              总资产
            </h2>
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
          <h2>{intervalFallback ? "较上次完整记录变化" : "今日资产变化"}</h2>
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
      {!currentValuationComplete || !current?.complete || hasSyncFailures ? (
        <details
          className="daily-overview__confidence"
          data-tone={hasSyncFailures ? "error" : undefined}
          data-testid="overview-confidence"
        >
          <summary>
            <span>{hasSyncFailures ? "部分来源未更新" : dataStatusLabel}</span>
            {usesRecordedTodayObservation && changeEndpoint !== null ? (
              <span className="daily-overview__confidence-context">
                {"，"}资产变化截至 {formatShanghaiShortDateTime(changeEndpoint.observedAt)}
              </span>
            ) : currentValuationComplete ? (
              <span className="daily-overview__confidence-context">{"，"}总额含最近成功值</span>
            ) : null}
          </summary>
          <div className="daily-overview__confidence-details">
            {hasSyncFailures ? <AssetRefreshIssues hideSourceNames={!showSensitiveInfo} /> : null}
            {demoMode ? null : (
              <VibeLink href="/settings?view=data#source-checks-title" variant="text">
                检查资产来源
              </VibeLink>
            )}
            {!hasSyncFailures || !currentValuationComplete ? (
              <p>{currentReason ?? `已覆盖 ${recordedSources.length} 个来源`}</p>
            ) : null}
            {usesRecordedTodayObservation ? (
              <p>当前刷新有失败，资产变化使用上述时间的已记录观测。</p>
            ) : null}
            {!hasSyncFailures && usdValuation.expiredCount > 0 ? (
              <p>过期来源 {usdValuation.expiredCount} 个；可在顶部刷新资产。</p>
            ) : null}
            {remainingChangeIssueSources.length > 0 ? (
              <div className="daily-overview__change-issues" data-testid="overview-data-issues">
                {!showSensitiveInfo ? (
                  <span>已隐藏 {remainingChangeIssueSources.length} 个来源。</span>
                ) : (
                  <ul>
                    {remainingChangeIssueSources.map((source) => (
                      <li data-tone={source.tone} key={source.label}>
                        <span>
                          <strong>{source.label}</strong>
                          <small>{source.status}</small>
                        </span>
                        <b>
                          {source.amount === null ? (
                            "无法折算"
                          ) : (
                            <AssetFinancialValue unit={currency}>
                              {amount(source.amount)}
                            </AssetFinancialValue>
                          )}
                        </b>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
      <LongbridgeRealtimeNotice
        state={realtimeState}
        retry={retry}
        sourceId={
          sources.find(
            (source) => source.kind === "longbridge" && source.lifecycle !== "disconnected",
          )?.id
        }
      />
    </div>
  );
}
