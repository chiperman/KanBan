"use client";

import type { AssetHolding } from "@/server/ports";
import { supportsLongbridgeCandlesticks } from "@/domain/longbridge-symbols";
import {
  assetHoldingKey,
  assetHoldingDisplayName,
  AssetHoldingPositionStatus,
  AssetProductCoverage,
} from "@/ui/asset-product-coverage";
import type { ProfitColorScheme } from "@/ui/profit-color-scheme";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeSegmentedBar, VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { useTablePagination, VibeTablePagination } from "@/ui/vibe/vibe-table-pagination";
import { formatShanghaiDateTime } from "@/ui/shanghai-date-time";
import { sourceSyncStatus } from "@/ui/asset-source-status";
import { AssetFinancialValue } from "@/ui/asset-financial-value";
import { HoldingDetailRow } from "./holding-detail-row";
import type { assetSourceHoldingsModel } from "./holdings-model";
import { SourceCashBalances } from "./source-cash-balances";
import { UnreadableEvmAssets } from "./unreadable-evm-assets";
import type { AssetSourceView } from "./types";

export function AssetSourceHoldings({
  source,
  model,
  hideSmallCryptoHoldings,
  holdingsDetailExpanded,
  onSmallHoldingFilterChange,
  onToggleHoldingsDetail,
  onShowCandlesticks,
  assetScopeHref,
  profitColorScheme,
  showSensitiveInfo,
  formatAmount,
  formatDisplayMoney,
  formatDisplayPrice,
}: {
  source: AssetSourceView;
  model: ReturnType<typeof assetSourceHoldingsModel>;
  hideSmallCryptoHoldings: boolean;
  holdingsDetailExpanded: boolean;
  onSmallHoldingFilterChange: (value: boolean) => void;
  onToggleHoldingsDetail: () => void;
  onShowCandlesticks?: (holding: AssetHolding) => void;
  assetScopeHref?: string;
  profitColorScheme: ProfitColorScheme;
  showSensitiveInfo: boolean;
  formatAmount: (value: string) => string;
  formatDisplayMoney: (value: string, currency: string) => string | null;
  formatDisplayPrice: (
    value: string,
    currency: string,
    assetClass: AssetHolding["assetClass"],
  ) => string | null;
}) {
  const {
    cashBalances,
    compactProfitColumns,
    hasHoldingsSearchQuery,
    hiddenSmallHoldingCount,
    includedAssetKeys,
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
  } = model;
  const pagination = useTablePagination(searchedHoldings, JSON.stringify([source.id, hideSmallCryptoHoldings, model.holdingsSearchQuery]));
  return (
    <>
      {supportsProductCoverage ? (
        <AssetProductCoverage
          coverage={source.snapshot.coverage}
          sourceKind={source.kind}
        />
      ) : null}
      <SourceCashBalances
        balances={cashBalances}
        showSensitiveInfo={showSensitiveInfo}
        formatAmount={formatAmount}
      />
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
        <span>{visibleHoldings.length} 项持仓</span>
        <span className={unvaluedCount > 0 ? "is-incomplete" : undefined}>
          {valuationCaption}
        </span>
      </p>
      {supportsSmallHoldingFilter ? (
        <label className="crypto-small-holding-filter">
          <input
            type="checkbox"
            checked={hideSmallCryptoHoldings}
            onChange={(event) => onSmallHoldingFilterChange(event.target.checked)}
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
                  ? (() => {
                    const value = formatDisplayMoney(holding.marketValue, holding.currency);
                    return value === null
                      ? "无法折算"
                      : <AssetFinancialValue>{value}</AssetFinancialValue>;
                  })()
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
          onClick={onToggleHoldingsDetail}
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
              {hasHoldingsSearchQuery
                ? "无匹配持仓"
                : hiddenSmallHoldingCount > 0
                  ? "持仓已按金额筛选"
                  : "暂无持仓"}
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
                  {pagination.visibleItems.map((holding) => (
                    <HoldingDetailRow
                      key={assetHoldingKey(holding)}
                      holding={holding}
                      onShowCandlesticks={
                        source.kind === "longbridge" &&
                        holding.assetClass === "securities" &&
                        supportsLongbridgeCandlesticks(holding.symbol)
                          ? onShowCandlesticks
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
          {pagination.controls.pageCount > 1 ? (
            <div className="asset-holdings-pagination">
              <VibeTablePagination label={`${source.label}持仓明细分页`} pagination={pagination.controls} />
            </div>
          ) : null}
        </div>
      </section>
      <UnreadableEvmAssets
        sourceId={source.id}
        tokens={unreadableEvmTokens}
        includedAssetKeys={includedAssetKeys}
        assetScopeHref={assetScopeHref}
      />
      <div className="asset-source-footer">
        <div className="asset-source-footer__meta">
          {pagination.controls.pageCount === 1 ? (
            <p className="asset-source-footer__count" role="status">
              共 {pagination.controls.total} 项持仓
            </p>
          ) : null}
          <p className="asset-updated">
            <span>{source.kind === "longbridge" ? "资产同步时间" : "最后更新"}</span>
            <time dateTime={source.snapshot.syncedAt}>
              {formatShanghaiDateTime(source.snapshot.syncedAt)}
            </time>
          </p>
        </div>
        {unvaluedCount > 0 || quoteUnavailableCount > 0 || source.lifecycle === "disconnected" || source.sync.status === "expired" ? (
          <div className="asset-source-footer__statuses">
            {unvaluedCount > 0 ? (
              <VibeStatusTag className="asset-sync-status" tone="error">
                含 {unvaluedCount} 项未估值资产
              </VibeStatusTag>
            ) : null}
            {quoteUnavailableCount > 0 ? (
              <VibeStatusTag className="asset-sync-status" tone="muted">
                {quoteUnavailableCount} 项期权行情未接入，账户总额已包含
              </VibeStatusTag>
            ) : null}
            {source.lifecycle === "disconnected" ? (
              <VibeStatusTag className="asset-sync-status" tone="muted">
                已断开 · 历史数据保留
              </VibeStatusTag>
            ) : source.sync.status === "expired" ? (
              <VibeStatusTag className="asset-sync-status" tone="warning">
                过期数据
              </VibeStatusTag>
            ) : null}
          </div>
        ) : null}
        {source.sync.error ? (
          <VibeNotice className="asset-sync-error" role="alert" tone="error">
            {sourceSyncStatus(source)?.label}
          </VibeNotice>
        ) : null}
      </div>
    </>
  );
}
