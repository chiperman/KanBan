import { VibeEntityLink } from "@/ui/vibe/vibe-entity-link";

import {
  analyzeInvestmentBook,
  INVESTMENT_BOOKS,
  type InvestmentBookState,
} from "@/domain/investment-books";
import { analyzeCurrentInvestmentPerformance } from "@/domain/investment-performance";
import { type ReportingCurrency } from "@/domain/valuation";
import type { DailyAssetTrendObservation, ManualAssetRecord } from "@/server/ports";
import { type ProfitColorScheme } from "@/ui/profit-color-scheme";
import { VibeLink } from "@/ui/vibe/vibe-button";

import { MetricValue } from "./presentation";
import type { OverviewSource } from "./sources-model";

export function OverviewBooks({
  investmentBooks,
  liveSources,
  trendObservations,
  manualRecords,
  currentDay,
  showSensitiveInfo,
  profitColorScheme,
  currency,
  analysis,
  demoMode,
}: {
  investmentBooks?: InvestmentBookState | null;
  liveSources: OverviewSource[];
  trendObservations: DailyAssetTrendObservation[];
  manualRecords: ManualAssetRecord[];
  currentDay: string;
  showSensitiveInfo: boolean;
  profitColorScheme: ProfitColorScheme;
  currency: ReportingCurrency;
  analysis: ReturnType<typeof analyzeCurrentInvestmentPerformance>;
  demoMode: boolean;
}) {
  // 本金与收益都不可用时，整块降级为一行，避免首屏中段重复显示「数据不足」。
  const summaryCompact =
    analysis.cumulativeNetInvestment === null && analysis.investmentProfit === null;

  return investmentBooks ? (
    <section className="daily-overview__books" aria-label="投资账本">
      <div className="daily-overview__books-grid">
        {INVESTMENT_BOOKS.map((book) => {
          const result = analyzeInvestmentBook({
            state: investmentBooks,
            bookId: book.id,
            sources: liveSources,
            observations: trendObservations,
            manualRecords,
            currentDay,
          });
          const summary = result.summary;
          const hasBookValues =
            summary !== null &&
            [summary.total, summary.netInvestment, summary.profit].some((value) => value !== null);
          return (
            <article key={book.id} className="daily-overview__book">
              <h3>
                <VibeEntityLink
                  href={`/performance?book=${book.id}`}
                  aria-label={`查看${book.name}投资账本`}
                >
                  {book.name}
                </VibeEntityLink>
              </h3>
              {hasBookValues && summary ? (
                <>
                  <div className="daily-overview__book-total" aria-label={`${book.name}资产金额`}>
                    <MetricValue
                      currency={book.currency}
                      hidden={!showSensitiveInfo}
                      value={summary.total}
                    />
                  </div>
                  {summary.netInvestment !== null || summary.profit !== null ? (
                    <dl className="daily-overview__book-metrics">
                      <div>
                        <dt>累计净投入</dt>
                        <dd>
                          <MetricValue
                            currency={book.currency}
                            hidden={!showSensitiveInfo}
                            value={summary.netInvestment}
                          />
                        </dd>
                      </div>
                      <div>
                        <dt>累计收益</dt>
                        <dd>
                          <MetricValue
                            currency={book.currency}
                            hidden={!showSensitiveInfo}
                            profitColorScheme={profitColorScheme}
                            signed
                            value={summary.profit}
                          />
                        </dd>
                      </div>
                    </dl>
                  ) : null}
                  <p className="daily-overview__book-date">
                    {summary.total !== null ? `截至 ${summary.day}` : "暂无完整资产记录"}
                  </p>
                </>
              ) : result.summaryMissingReason && showSensitiveInfo ? null : (
                <p className="daily-overview__book-date">{summary ? "数据不足" : "暂无资产记录"}</p>
              )}
              {showSensitiveInfo && result.summaryMissingReason ? (
                <p className="daily-overview__book-warning">{result.summaryMissingReason}</p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  ) : (
    <section
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
    </section>
  );
}
