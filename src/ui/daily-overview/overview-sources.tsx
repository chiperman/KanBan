import { AssetFinancialValue } from "@/ui/asset-financial-value";
import { VibeEntityLink } from "@/ui/vibe/vibe-entity-link";
import { VibeLiveCounter } from "@/ui/vibe/vibe-live-counter";

import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import { type ReportingCurrency } from "@/domain/valuation";
import type { DailyAssetTrendObservation } from "@/server/ports";
import { type ProfitColorScheme } from "@/ui/profit-color-scheme";
import { VibeLink } from "@/ui/vibe/vibe-button";
import { VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";

import { amount, MetricValue } from "./presentation";
import type { buildOverviewSources } from "./sources-model";

export function OverviewSources({
  currency,
  demoMode,
  sourceSummaries,
  sourceComparisonLabel,
  showSensitiveInfo,
  profitColorScheme,
  priorObservation,
}: {
  currency: ReportingCurrency;
  demoMode: boolean;
  sourceSummaries: ReturnType<typeof buildOverviewSources>;
  sourceComparisonLabel: string;
  showSensitiveInfo: boolean;
  profitColorScheme: ProfitColorScheme;
  priorObservation: DailyAssetTrendObservation | null;
}) {
  return (
    <section
      className="daily-overview__sources"
      data-testid="overview-source-summary"
      aria-labelledby="overview-sources-title"
    >
      <header className="daily-overview__section-heading">
        <h2 id="overview-sources-title">来源分布</h2>
        {demoMode ? null : (
          <VibeLink href="/assets" variant="text" size="compact">
            查看持仓
          </VibeLink>
        )}
      </header>
      {sourceSummaries.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">尚未接入资产来源</p>
          <VibeLink href="/asset-sources/new" variant="primary">
            新增资产来源
          </VibeLink>
        </div>
      ) : (
        <>
          <div className="daily-overview__source-head" aria-hidden="true">
            <span>来源</span>
            <span>当前金额</span>
            <span>较{sourceComparisonLabel}变化</span>
            <span>{sourceComparisonLabel}金额</span>
          </div>
          <ul className="daily-overview__source-list">
            {sourceSummaries.map(({ amount: sourceAmount, comparison, health, source }) => (
              <li key={source.id}>
                <article>
                  <div className="daily-overview__source-heading">
                    <h3>
                      {demoMode ? (
                        assetSourceDisplayName(source)
                      ) : (
                        <VibeEntityLink href={`/asset-sources/${encodeURIComponent(source.id)}`}>
                          {assetSourceDisplayName(source)}
                        </VibeEntityLink>
                      )}
                    </h3>
                    <strong className="daily-overview__source-total">
                      {!showSensitiveInfo ? (
                        <AssetFinancialValue unit={currency}>••••••</AssetFinancialValue>
                      ) : sourceAmount === null ? (
                        "无法折算"
                      ) : (
                        <AssetFinancialValue unit={currency}>
                          <VibeLiveCounter value={amount(sourceAmount)} resetKey={currency} />
                        </AssetFinancialValue>
                      )}
                    </strong>
                  </div>
                  <div className="daily-overview__source-comparison">
                    <div
                      className="daily-overview__source-change"
                      data-comparison-state={comparison.state}
                    >
                      {comparison.state === "changed" ? (
                        <>
                          <span className="daily-overview__source-column-label">
                            较{sourceComparisonLabel}变化
                          </span>
                          <MetricValue
                            currency={currency}
                            hidden={!showSensitiveInfo}
                            profitColorScheme={profitColorScheme}
                            signed
                            value={comparison.change}
                          />
                        </>
                      ) : (
                        <span>{comparison.state === "scope-change" ? "新增纳入" : "暂不可比"}</span>
                      )}
                    </div>
                    <span className="daily-overview__source-previous">
                      {priorObservation === null ? (
                        "暂无可比记录"
                      ) : (
                        <>
                          <span className="daily-overview__source-column-label">
                            {sourceComparisonLabel}金额
                          </span>{" "}
                          {comparison.state === "changed" ? (
                            <AssetFinancialValue unit={currency}>
                              {showSensitiveInfo ? amount(comparison.previousAmount) : "••••••"}
                            </AssetFinancialValue>
                          ) : comparison.state === "scope-change" ? (
                            "未纳入"
                          ) : (
                            "—"
                          )}
                        </>
                      )}
                    </span>
                  </div>
                  {health.tone !== "success" ? (
                    <VibeStatusTag tone={health.tone}>{health.label}</VibeStatusTag>
                  ) : null}
                </article>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
