"use client";

import { useLongbridgeRealtime } from "@/ui/use-longbridge-realtime";
import { useMemo } from "react";

import { type InvestmentBookState } from "@/domain/investment-books";
import {
  analyzeCurrentInvestmentPerformance,
  longbridgeReferenceRates,
} from "@/domain/investment-performance";
import { hasManualAssetRecord } from "@/domain/manual-asset-records";
import { projectTotalAssetTrendObservations } from "@/domain/total-asset-trend";
import { buildTotalValuation } from "@/domain/valuation";
import type {
  DailyAssetTrendObservation,
  ImportedAssetSourceHistoryObservation,
  InvestmentCashflow,
  ManualAssetRecord,
} from "@/server/ports";
import { AssetGlobalRefreshControl } from "@/ui/asset-refresh-controls";
import { useAssetRefresh } from "@/ui/asset-refresh-provider";
import { AssetTrendPanel, useAssetTrendRange } from "@/ui/asset-trend-panel";
import { type ProfitColorScheme } from "@/ui/profit-color-scheme";
import { CURRENCY_OPTIONS } from "@/ui/reporting-currency-options";
import { formatShanghaiDayLabel } from "@/ui/shanghai-date-time";
import { VibeLink } from "@/ui/vibe/vibe-button";
import { VibeSelect } from "@/ui/vibe/vibe-field";
import { useWorkbenchDisplayPreferences } from "@/ui/workbench-display-preferences";
import { WorkbenchPageHeader } from "@/ui/workbench-page-header";

import {
  buildOverviewTotals,
  buildOverviewTrend,
  compareOverviewObservations,
} from "./daily-overview/model";
import { OverviewBooks } from "./daily-overview/overview-books";
import { OverviewSources } from "./daily-overview/overview-sources";
import { OverviewSummary } from "./daily-overview/overview-summary";
import { amount } from "./daily-overview/presentation";
import {
  buildOverviewSourceIssues,
  buildOverviewSources,
  type OverviewSource,
} from "./daily-overview/sources-model";

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
  const { currency, setCurrency, showSensitiveInfo } = useWorkbenchDisplayPreferences();

  const { liveSources, state: realtimeState, retry } = useLongbridgeRealtime(sources, !demoMode);
  const { failedSources } = useAssetRefresh();
  const hasSyncFailures =
    !demoMode &&
    (failedSources.length > 0 ||
      sources.some(
        (source) =>
          source.lifecycle !== "disconnected" &&
          source.kind !== "manual" &&
          source.sync.error !== null,
      ));
  const totalTrendObservations = useMemo(
    () =>
      projectTotalAssetTrendObservations({
        observations: trendObservations,
        sources,
        manualRecords,
        importedHistory,
        members: investmentBooks?.members,
      }),
    [trendObservations, sources, manualRecords, importedHistory, investmentBooks],
  );
  const recordedSources = useMemo(() => liveSources.filter(hasManualAssetRecord), [liveSources]);
  const usdValuation = useMemo(
    () => buildTotalValuation(recordedSources, "USD", "source"),
    [recordedSources],
  );
  const longbridgeRates = useMemo(
    () => longbridgeReferenceRates(recordedSources),
    [recordedSources],
  );
  const usdValuationComplete =
    usdValuation.amount !== null && !usdValuation.incomplete && recordedSources.length > 0;

  const currentTotals = useMemo(
    () =>
      buildOverviewTotals({
        currentObservedAt,
        longbridgeRates,
        recordedSources,
        usdValuation,
        usdValuationComplete,
      }),
    [currentObservedAt, longbridgeRates, recordedSources, usdValuation, usdValuationComplete],
  );
  const current = currentTotals[currency];
  const currentValuationComplete = current !== null && usdValuationComplete;
  const comparison = useMemo(
    () =>
      compareOverviewObservations({
        currency,
        currentDay,
        current,
        totalTrendObservations,
        recordedSources,
      }),
    [currency, currentDay, current, totalTrendObservations, recordedSources],
  );
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
  const trendRange = useAssetTrendRange();
  const trend = useMemo(
    () => buildOverviewTrend({ currency, currentDay, totalTrendObservations, trendRange }),
    [currency, currentDay, totalTrendObservations, trendRange.preset, trendRange.customRange],
  );
  const sourceSummaries = useMemo(
    () =>
      buildOverviewSources({
        currency,
        longbridgeRates,
        priorObservation: comparison.priorObservation,
        recordedSources,
      }),
    [currency, longbridgeRates, comparison.priorObservation, recordedSources],
  );
  const todayChangeIssueSources = useMemo(
    () => buildOverviewSourceIssues({ currency, recordedSources, sourceSummaries }),
    [currency, recordedSources, sourceSummaries],
  );
  const remainingChangeIssueSources = todayChangeIssueSources.filter(
    (source) => !source.syncOnly || !failedSources.some((failed) => failed.id === source.id),
  );
  const overviewEmpty = !demoMode && recordedSources.length === 0;
  return (
    <div className="daily-overview" data-testid="portfolio-overview-workspace">
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
          <div
            className="daily-overview__hero"
            data-has-investment-books={investmentBooks ? "true" : undefined}
          >
            <section className="daily-overview__main" aria-label="资产概况">
              <OverviewSummary
                currency={currency}
                showSensitiveInfo={showSensitiveInfo}
                profitColorScheme={profitColorScheme}
                sources={sources}
                current={current}
                currentValuationComplete={currentValuationComplete}
                usdValuation={usdValuation}
                recordedSources={recordedSources}
                comparison={comparison}
                todayChangeIssueSources={todayChangeIssueSources}
                remainingChangeIssueSources={remainingChangeIssueSources}
                hasSyncFailures={hasSyncFailures}
                demoMode={demoMode}
                realtimeState={realtimeState}
                retry={retry}
              />
              <section className="daily-overview__trend" data-testid="overview-trend">
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

            <OverviewBooks
              investmentBooks={investmentBooks}
              liveSources={liveSources}
              trendObservations={trendObservations}
              manualRecords={manualRecords}
              currentDay={currentDay}
              showSensitiveInfo={showSensitiveInfo}
              profitColorScheme={profitColorScheme}
              currency={currency}
              analysis={analysis}
              demoMode={demoMode}
            />
          </div>
          <OverviewSources
            currency={currency}
            demoMode={demoMode}
            sourceSummaries={sourceSummaries}
            sourceComparisonLabel={comparison.sourceComparisonLabel}
            showSensitiveInfo={showSensitiveInfo}
            profitColorScheme={profitColorScheme}
            priorObservation={comparison.priorObservation}
          />
        </>
      )}
    </div>
  );
}
