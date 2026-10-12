"use client";

import { useEffect, useMemo, useState } from "react";

import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import { assetSourceKindMetadata } from "@/domain/asset-source-kinds";
import type {
  MarketBenchmarkComparison,
  MarketBenchmarkSymbol,
} from "@/domain/market-benchmark";
import { decimalToFixed } from "@/domain/decimal";
import { portfolioSourceTotal } from "@/domain/evm-token-preferences";
import {
  convertCurrencyAmount,
  sourceReportingConversionRates,
  type ReportingCurrency,
} from "@/domain/valuation";
import {
  sourceTrendObservationStatus,
  type TrendRange,
} from "@/domain/daily-trend-observations";
import type {
  AssetExchangeRate,
  AssetHolding,
  DailyAssetTrendObservation,
  ManualAssetRecord,
} from "@/server/ports";
import {
  assetHoldingKey,
  assetHoldingDisplayName,
  AssetHoldingPositionStatus,
  AssetProductCoverage,
} from "@/ui/asset-product-coverage";
import { supportsLongbridgeCandlesticks } from "@/domain/longbridge-symbols";
import { HoldingCandlestickChart } from "@/ui/holding-candlestick-chart";
import { formatAssetUnitPrice } from "@/ui/asset-price-display";
import type { ProfitColorScheme } from "@/ui/profit-color-scheme";
import {
  VibeMetric,
  VibeSegmentedBar,
  VibeStatusTag,
} from "@/ui/vibe/vibe-data-instrument";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { AssetTrendChart } from "@/ui/asset-trend-chart";
import {
  formatShanghaiDateTime,
  formatShanghaiDayLabel,
} from "@/ui/shanghai-date-time";
import { AssetSourceRefreshButton } from "@/ui/asset-refresh-controls";
import { assetSourceHoldingsModel } from "@/ui/asset-source-card/holdings-model";
import { amount } from "@/ui/asset-source-card/holding-detail-model";
import { HoldingDetailRow } from "@/ui/asset-source-card/holding-detail-row";
import { assetSourceTrendModel } from "@/ui/asset-source-card/source-trend-model";
import type { AssetSourceView } from "@/ui/asset-source-card/types";

export type { AssetSourceView } from "@/ui/asset-source-card/types";

function providerCardLabel(source: AssetSourceView): string {
  return assetSourceKindMetadata(source.kind)?.title ?? "资产来源";
}

function providerCode(source: AssetSourceView): string {
  return assetSourceKindMetadata(source.kind)?.code ?? "SRC";
}

function sourceHeading(source: AssetSourceView): {
  title: string;
  metadata: string | null;
} {
  return { title: assetSourceDisplayName(source), metadata: null };
}

function moneyAmount(value: string): string {
  return amount(decimalToFixed(value, 2));
}

function sourceTrendStatusLabel(
  status: "complete" | "incomplete" | "expired",
): string {
  return status === "expired"
    ? "过期"
    : status === "incomplete"
      ? "不完整"
      : "完整";
}

export function AssetSourceCard({
  trendContent,
  showAssetTrend = trendContent === undefined,
  totalAnimationKey,
  refreshDisabled = false,
  showRefreshControl = true,
  source,
  history,
  reportingExchangeRates,
  reportingCurrency,
  trendBenchmark,
  trendDays,
  trendRange,
  currentDay,
  holdingsSearchQuery,
  onManualAssetRecord,
  onManualAssetRecordDelete,
  onReadOnlyAction,
  assetScopeHref,
  profitColorScheme,
  showSensitiveInfo,
}: {
  trendContent?: import("react").ReactNode;
  showAssetTrend?: boolean;
  totalAnimationKey?: string;
  refreshDisabled?: boolean;
  showRefreshControl?: boolean;
  source: AssetSourceView;
  history: DailyAssetTrendObservation[];
  reportingExchangeRates: AssetExchangeRate[];
  reportingCurrency: ReportingCurrency;
  trendBenchmark?: {
    comparison: MarketBenchmarkComparison | null;
    enabledSymbols: MarketBenchmarkSymbol[];
  } | null;
  trendDays?: readonly string[];
  trendRange: TrendRange;
  currentDay: string;
  holdingsSearchQuery: string;
  onManualAssetRecord?: (source: AssetSourceView, record?: ManualAssetRecord) => void;
  onManualAssetRecordDelete?: (source: AssetSourceView, record: ManualAssetRecord) => void;
  onReadOnlyAction?: () => void;
  assetScopeHref?: string;
  profitColorScheme: ProfitColorScheme;
  showSensitiveInfo: boolean;
}) {
  const [hideSmallCryptoHoldings, setHideSmallCryptoHoldings] = useState(true);
  const [holdingsDetailExpanded, setHoldingsDetailExpanded] = useState(true);
  const [candlestickHolding, setCandlestickHolding] = useState<AssetHolding | null>(null);
  useEffect(() => {
    if (!showSensitiveInfo) setCandlestickHolding(null);
  }, [showSensitiveInfo]);
  const holdings = useMemo(
    () => assetSourceHoldingsModel({
      hideSmallCryptoHoldings,
      holdingsSearchQuery,
      source,
    }),
    [hideSmallCryptoHoldings, holdingsSearchQuery, source],
  );
  const {
    cashBalances,
    compactProfitColumns,
    hasHoldingsSearchQuery,
    hiddenSmallHoldingCount,
    includedAssetKeys,
    isManual,
    quoteUnavailableCount,
    searchedHoldings,
    showPlatformProfit,
    supportsProductCoverage,
    supportsSmallHoldingFilter,
    unvaluedCount,
    unreadableEvmTokens,
    valuationAriaLabel,
    valuationCaption,
    valuationSegments,
    visibleHoldings,
  } = holdings;
  const hasManualRecord = !isManual || source.hasManualRecord !== false;
  const manualRecords = source.manualRecords ?? [];
  const sourceTrend = assetSourceTrendModel({
    currentDay,
    history,
    isManual,
    manualRecords,
    reportingCurrency,
    sourceId: source.id,
    trendDays,
    trendRange,
  });
  const heading = sourceHeading(source);
  const displayExchangeRates = sourceReportingConversionRates(
    source,
    reportingExchangeRates,
  );
  const formatDisplayMoney = (value: string, currency: string) => {
    const converted = convertCurrencyAmount(
      value,
      currency,
      reportingCurrency,
      displayExchangeRates,
    );
    return converted === null ? null : moneyAmount(converted);
  };
  const formatDisplayPrice = (
    value: string,
    currency: string,
    assetClass: AssetHolding["assetClass"],
  ) => {
    const converted = convertCurrencyAmount(
      value,
      currency,
      reportingCurrency,
      displayExchangeRates,
    );
    return converted === null
      ? null
      : formatAssetUnitPrice(converted, assetClass);
  };
  const effectiveSourceTotal = portfolioSourceTotal(source);
  const sourceTotal = formatDisplayMoney(
    effectiveSourceTotal.amount,
    effectiveSourceTotal.currency,
  );
  const sourceState = isManual
    ? { label: "MANUAL", tone: "muted" as const }
    : source.lifecycle === "disconnected"
    ? { label: "OFFLINE", tone: "muted" as const }
    : source.sync.error
      ? { label: "ERROR", tone: "error" as const }
      : source.sync.status === "expired"
        ? { label: "STALE", tone: "warning" as const }
        : { label: "CURRENT", tone: "success" as const };
  return (
    <>
      <div
        className="asset-source-card vibe-data-module"
        data-holdings-search-active={hasHoldingsSearchQuery ? "true" : undefined}
        data-vibe-module="asset-source"
        data-testid={
          source.kind === "longbridge"
            ? "longbridge-card"
            : source.kind === "binance"
              ? "binance-card"
              : source.kind === "okx"
                ? "okx-card"
                : source.kind === "bitget"
                  ? "bitget-card"
                  : source.kind === "bit"
                    ? "bit-card"
                  : source.kind === "evm-watch-ethereum"
                    ? "ethereum-watch-card"
                    : source.kind === "evm-watch-bsc"
                      ? "bsc-watch-card"
                      : source.kind === "manual"
                        ? "manual-asset-card"
              : `asset-source-card-${source.id}`
        }
      >
        <header className="asset-source-head">
          <p className="card-label">{providerCardLabel(source)}</p>
          <div className="asset-source-head-actions">
            <VibeStatusTag
              className={`source-live-state ${source.sync.status}`}
              tone={sourceState.tone}
            >
              {providerCode(source)} / {sourceState.label}
            </VibeStatusTag>
            {showRefreshControl && !isManual && source.lifecycle !== "disconnected" ? (
              <AssetSourceRefreshButton
                disabled={refreshDisabled}
                onDisabledClick={onReadOnlyAction}
                sourceId={source.id}
                sourceName={heading.title}
              />
            ) : null}
          </div>
        </header>
        <h2 className="asset-source-title">{heading.title}</h2>
        {heading.metadata ? (
          <p className="asset-source-meta">{heading.metadata}</p>
        ) : null}
        {hasManualRecord ? (
          <VibeMetric
            animationKey={totalAnimationKey}
            className="asset-total"
            data-testid="asset-source-total"
            unit={reportingCurrency}
            value={showSensitiveInfo ? sourceTotal ?? "无法折算" : "••••••"}
          />
        ) : (
          <p
            className="asset-total manual-asset-unrecorded"
            data-testid="manual-asset-unrecorded"
          >
            0 <span className="vibe-metric__unit">{reportingCurrency}</span>
          </p>
        )}
        {trendContent}
        {showAssetTrend ? <section
          className="asset-trend source-trend"
          data-testid={`asset-source-trend-${source.id}`}
        >
          <p className="card-label">资产金额趋势</p>
          {trendContent ? <p className="trend-note">资产金额变化包含资金进出，不能作为收益率。</p> : null}
          {!showSensitiveInfo ? (
            <AssetTrendChart
              ariaLabel={`${heading.title}来源总额趋势已隐藏`}
              currency={reportingCurrency}
              formatAmount={moneyAmount}
              formatDay={formatShanghaiDayLabel}
              incompleteCount={0}
              isSensitiveHidden
              points={[]}
              unavailableCount={0}
              variant="source"
            />
          ) : sourceTrend.sourceHistory.length === 0 ? (
            <p className="trend-empty">
              {isManual ? "等待首条记录" : "等待首次同步"}
            </p>
          ) : (
            <>
              <AssetTrendChart
                ariaLabel={`${heading.title}来源总额趋势`}
                benchmark={trendBenchmark === null || trendBenchmark === undefined ? null : {
                  assetScopeLabel: "来源",
                  comparison: trendBenchmark.comparison,
                  enabledSymbols: trendBenchmark.enabledSymbols,
                }}
                currency={reportingCurrency}
                formatAmount={moneyAmount}
                formatDay={formatShanghaiDayLabel}
                incompleteCount={sourceTrend.abnormalPoints.length}
                lineType={isManual ? "stepAfter" : "linear"}
                points={sourceTrend.points}
                unavailableCount={sourceTrend.unavailablePoints.length}
                variant="source"
              />
              {!isManual ? (
                <details
                  className="daily-trend-details source-daily-trend-details"
                  data-testid={`asset-source-daily-details-${source.id}`}
                >
                  <summary>每日总额（{sourceTrend.sourceDailyDetails.length}）</summary>
                  <div className="daily-trend-details-content">
                    <ol className="daily-trend-detail-list">
                      {sourceTrend.sourceDailyDetails.map((observation) => {
                        const observationStatus =
                          sourceTrendObservationStatus(observation);
                        const observationAmount =
                          observation.total[reportingCurrency] ?? null;
                        const abnormal =
                          observationStatus !== "complete" ||
                          observationAmount === null;
                        return (
                          <li
                            key={observation.day}
                            data-testid={`asset-source-daily-detail-${source.id}`}
                          >
                            <time dateTime={observation.day}>
                              {formatShanghaiDayLabel(observation.day)}
                            </time>
                            <strong>
                              {observationAmount === null
                                ? "未估值"
                                : `${moneyAmount(observationAmount)} ${reportingCurrency}`}
                            </strong>
                            {abnormal ? (
                              <span>
                                {observationAmount === null
                                  ? `未估值 · ${sourceTrendStatusLabel(observationStatus)}`
                                  : sourceTrendStatusLabel(observationStatus)}
                              </span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                </details>
              ) : null}
            </>
          )}
          {showSensitiveInfo && sourceTrend.notice ? (
            <p className="trend-note">{sourceTrend.notice}</p>
          ) : null}
        </section> : null}
        {isManual ? (
          <>
            <VibeStatusTag className="asset-sync-status" tone="muted">
              {hasManualRecord
                ? "每日一条总额"
                : "等待首条数据"}
            </VibeStatusTag>
            {hasManualRecord ? (
              <p className="asset-updated">
                最近记录日期：{manualRecords[0]?.day ?? formatShanghaiDateTime(source.snapshot.syncedAt)}
              </p>
            ) : null}
            <section className="manual-asset-history" aria-label={`${heading.title}历史记录`}>
              <p className="card-label">历史记录</p>
              {manualRecords.length === 0 ? (
                <p className="trend-empty">尚无历史记录</p>
              ) : (
                <ol className="manual-asset-history-list">
                  {manualRecords.map((record) => (
                    <li key={record.day}>
                      <span>{record.day}</span>
                      <strong>{showSensitiveInfo ? `${moneyAmount(record.amount)} ${record.currency}` : "••••••"}</strong>
                      <span className="manual-asset-history-actions">
                        <VibeButton
                          data-demo-disabled={onReadOnlyAction ? "true" : undefined}
                          onClick={() => {
                            if (onReadOnlyAction) {
                              onReadOnlyAction();
                              return;
                            }
                            onManualAssetRecord?.(source, record);
                          }}
                          type="button"
                          variant="text"
                        >
                          编辑
                        </VibeButton>
                        <VibeButton
                          data-demo-disabled={onReadOnlyAction ? "true" : undefined}
                          onClick={() => {
                            if (onReadOnlyAction) {
                              onReadOnlyAction();
                              return;
                            }
                            onManualAssetRecordDelete?.(source, record);
                          }}
                          type="button"
                          variant="text"
                        >
                          删除
                        </VibeButton>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        ) : (
          <>
        {supportsProductCoverage ? (
          <AssetProductCoverage
            coverage={source.snapshot.coverage}
            sourceKind={source.kind}
          />
        ) : null}
        {cashBalances.length > 0 ? (
          <section
            className="asset-cash-balances"
            data-testid="asset-cash-balances"
          >
            <p className="card-label">CASH BALANCE</p>
            <ol className="holding-top-list">
              {cashBalances.map((balance, index) => (
                <li
                  className="vibe-data-row"
                  key={`${balance.currency}:${balance.amount}`}
                >
                  <span>{balance.currency} CASH</span>
                  <strong>
                    {showSensitiveInfo
                      ? `${moneyAmount(balance.amount)} ${balance.currency}`
                      : "••••••"}
                  </strong>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        <div className="source-meter">
          <VibeSegmentedBar
            ariaLabel={valuationAriaLabel}
            cells={visibleHoldings.length}
            compact
            segments={valuationSegments}
            total={visibleHoldings.length}
            varySegmentOpacity={false}
          />
        </div>
        <p className="source-meter-caption">
          <span>{String(visibleHoldings.length).padStart(2, "0")} POSITIONS</span>
          <span className={unvaluedCount > 0 ? "is-incomplete" : undefined}>
            {valuationCaption}
          </span>
        </p>
        {supportsSmallHoldingFilter ? (
          <label className="crypto-small-holding-filter">
            <input
              type="checkbox"
              checked={hideSmallCryptoHoldings}
              onChange={(event) => setHideSmallCryptoHoldings(event.target.checked)}
            />
            <span>
              隐藏低于 1 的持仓
              {hideSmallCryptoHoldings && hiddenSmallHoldingCount > 0
                ? `（已隐藏 ${hiddenSmallHoldingCount} 项）`
                : ""}
            </span>
          </label>
        ) : null}
        <ol className="holding-top-list" data-testid="holding-top-list">
          {searchedHoldings.map((holding) => (
            <li
              className={`vibe-data-row${holding.valuation.status === "unvalued" ? " is-unvalued" : ""}`}
              data-holding-key={assetHoldingKey(holding)}
              key={assetHoldingKey(holding)}
            >
              <div className="holding-top-list__identity">
                <span>{assetHoldingDisplayName(holding)}</span>
                <AssetHoldingPositionStatus holding={holding} />
              </div>
              <strong>
                {holding.marketValue === null
                  ? holding.valuation.status === "quote-unavailable"
                    ? "持仓行情未接入"
                    : "未估值"
                  : showSensitiveInfo
                    ? formatDisplayMoney(holding.marketValue, holding.currency) ?? "无法折算"
                    : "••••••"}
              </strong>
            </li>
          ))}
        </ol>
        {hasHoldingsSearchQuery && searchedHoldings.length === 0 ? (
          <p className="asset-holdings-search-empty" role="status">
            无匹配持仓
          </p>
        ) : null}
        <section
          aria-label={`${source.label} ${
            source.kind === "longbridge" ? "证券持仓明细" : "持仓明细"
          }`}
          className="asset-holdings-disclosure"
        >
          <VibeButton
            aria-controls={`asset-holdings-detail-${source.id}`}
            aria-expanded={holdingsDetailExpanded}
            aria-label={`${holdingsDetailExpanded ? "收起" : "展开"}${
              source.kind === "longbridge" ? "证券持仓明细" : "持仓明细"
            }`}
            className="asset-holdings-detail-toggle"
            data-testid="asset-holdings-detail-toggle"
            onClick={() => setHoldingsDetailExpanded((current) => !current)}
            type="button"
            variant="text"
          >
            <span className="asset-holdings-detail-toggle__title">
              {source.kind === "longbridge" ? "证券持仓明细" : "持仓明细"}
            </span>
            <span
              aria-hidden="true"
              className="asset-holdings-detail-toggle__action"
            />
          </VibeButton>
          <div
            className="asset-holdings-detail"
            data-expanded={holdingsDetailExpanded}
            data-testid="asset-holdings-detail"
            id={`asset-holdings-detail-${source.id}`}
          >
            {searchedHoldings.length === 0 ? (
              <p
                className="trend-empty"
                data-testid="asset-holdings-search-empty"
                role="status"
              >
                无匹配持仓
              </p>
            ) : (
              <div className="asset-table-wrap">
                <table className="asset-table vibe-data-table" data-vibe-component="data-table">
                  <thead>
                    <tr>
                      <th>名称</th>
                      {compactProfitColumns ? (
                        <>
                          <th>市值/数量</th>
                          <th>现价/成本</th>
                          <th>当日盈亏</th>
                          <th>持仓盈亏</th>
                        </>
                      ) : (
                        <>
                          <th>数量</th>
                          <th>现价</th>
                          <th>持仓市值</th>
                          <th>成本价</th>
                          {showPlatformProfit ? <th>平台盈亏（来源提供）</th> : null}
                          <th>浮动盈亏</th>
                          <th>盈亏率</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {searchedHoldings.map((holding) => (
                      <HoldingDetailRow
                        key={assetHoldingKey(holding)}
                        holding={holding}
                        onShowCandlesticks={
                          source.kind === "longbridge" &&
                          showSensitiveInfo &&
                          holding.assetClass === "securities" &&
                          supportsLongbridgeCandlesticks(holding.symbol)
                            ? setCandlestickHolding
                            : undefined
                        }
                        profitColorScheme={profitColorScheme}
                        showPlatformProfit={showPlatformProfit}
                        compactProfitColumns={compactProfitColumns}
                        showSensitiveInfo={showSensitiveInfo}
                        formatDisplayMoney={formatDisplayMoney}
                        formatDisplayPrice={formatDisplayPrice}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
        {unreadableEvmTokens.length > 0 ? (
          <section
            aria-labelledby={`evm-unreadable-assets-title-${source.id}`}
            className="evm-unreadable-assets"
            data-testid="evm-unreadable-assets"
          >
            <div className="evm-unreadable-assets__head">
              <div>
                <p className="card-label">EVM / READ LIMITED</p>
                <h3 id={`evm-unreadable-assets-title-${source.id}`}>
                  读取受限资产
                </h3>
              </div>
              {assetScopeHref ? (
                <VibeLink href={assetScopeHref} variant="outline">
                  管理资产范围
                </VibeLink>
              ) : null}
            </div>
            <ol>
              {unreadableEvmTokens.map((token) => {
                const isIncluded = includedAssetKeys.has(token.sourceAsset);
                const displayName = token.name ?? token.symbol ?? "未识别代币";
                return (
                  <li key={token.sourceAsset}>
                    <div className="evm-unreadable-assets__identity">
                      <strong>{displayName}</strong>
                      {token.symbol && token.name ? (
                        <span>{token.symbol}</span>
                      ) : null}
                      <small>{token.sourceAsset}</small>
                    </div>
                    <div className="evm-unreadable-assets__status">
                      <VibeStatusTag tone="warning">
                        {isIncluded ? "已关注 · 数量无法读取" : "待确认 · 数量无法读取"}
                      </VibeStatusTag>
                      <p>{token.reason}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ) : null}
        {unvaluedCount > 0 ? (
          <VibeStatusTag className="asset-sync-status" tone="warning">
            含 {unvaluedCount} 项未估值资产
          </VibeStatusTag>
        ) : null}
        {quoteUnavailableCount > 0 ? (
          <VibeStatusTag className="asset-sync-status" tone="muted">
            {quoteUnavailableCount} 项期权行情未接入 · 账户总额已包含
          </VibeStatusTag>
        ) : null}
        <p className="asset-updated">最后更新：{formatShanghaiDateTime(source.snapshot.syncedAt)}</p>
        {source.lifecycle === "disconnected" ? (
          <VibeStatusTag className="asset-sync-status expired" tone="muted">
            已断开 · 历史数据保留
          </VibeStatusTag>
        ) : (
          <VibeStatusTag
            className={`asset-sync-status ${source.sync.status}`}
            tone={source.sync.status === "expired" ? "warning" : "muted"}
          >
            {source.sync.status === "expired" ? "过期数据" : "数据当前"}
          </VibeStatusTag>
        )}
        {source.sync.error ? (
          <VibeNotice className="asset-sync-error" role="alert" tone="error">
            {source.label} 同步失败：{source.sync.error}
          </VibeNotice>
        ) : null}
          </>
        )}
      </div>
      {candlestickHolding !== null && showSensitiveInfo ? (
        <HoldingCandlestickChart
          name={assetHoldingDisplayName(candlestickHolding)}
          onClose={() => setCandlestickHolding(null)}
          sourceId={source.id}
          symbol={candlestickHolding.symbol}
        />
      ) : null}
    </>
  );
}
