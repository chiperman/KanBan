"use client";

import { useEffect, useMemo, useState } from "react";

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
import type { TrendRange } from "@/domain/daily-trend-observations";
import type { AssetTrendRange } from "@/ui/asset-trend-panel";
import type {
  AssetExchangeRate,
  AssetHolding,
  DailyAssetTrendObservation,
  ManualAssetRecord,
} from "@/server/ports";
import { assetHoldingDisplayName } from "@/ui/asset-product-coverage";
import { HoldingCandlestickChart } from "@/ui/holding-candlestick-chart";
import { formatAssetUnitPrice } from "@/ui/asset-price-display";
import type { ProfitColorScheme } from "@/ui/profit-color-scheme";
import { assetSourceHoldingsModel } from "@/ui/asset-source-card/holdings-model";
import { amount } from "@/ui/asset-source-card/holding-detail-model";
import { AssetSourceHeader } from "@/ui/asset-source-card/source-header";
import { AssetSourceTotal } from "@/ui/asset-source-card/source-total";
import { AssetSourceTrend } from "@/ui/asset-source-card/source-trend";
import { ManualAssetHistory } from "@/ui/asset-source-card/manual-asset-history";
import { AssetSourceHoldings } from "@/ui/asset-source-card/source-holdings";
import type { AssetSourceView } from "@/ui/asset-source-card/types";

export type { AssetSourceView } from "@/ui/asset-source-card/types";

function moneyAmount(value: string): string {
  return amount(decimalToFixed(value, 2));
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
  trendRangeSelection,
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
  trendRange?: TrendRange;
  trendRangeSelection?: AssetTrendRange;
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
  const { hasHoldingsSearchQuery, isManual } = holdings;
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
        <AssetSourceHeader
          source={source}
          refreshDisabled={refreshDisabled}
          showRefreshControl={showRefreshControl}
          onReadOnlyAction={onReadOnlyAction}
        />
        <AssetSourceTotal
          source={source}
          sourceTotal={sourceTotal}
          reportingCurrency={reportingCurrency}
          totalAnimationKey={totalAnimationKey}
          showSensitiveInfo={showSensitiveInfo}
        />
        {trendContent}
        {showAssetTrend ? (
          <AssetSourceTrend
            source={source}
            history={history}
            reportingCurrency={reportingCurrency}
            currentDay={currentDay}
            range={trendRangeSelection}
            trendBenchmark={trendBenchmark}
            hasTrendContent={Boolean(trendContent)}
            showSensitiveInfo={showSensitiveInfo}
            formatAmount={moneyAmount}
          />
        ) : null}
        {isManual ? (
          <ManualAssetHistory
            source={source}
            showSensitiveInfo={showSensitiveInfo}
            formatAmount={moneyAmount}
            onManualAssetRecord={onManualAssetRecord}
            onManualAssetRecordDelete={onManualAssetRecordDelete}
            onReadOnlyAction={onReadOnlyAction}
          />
        ) : (
          <AssetSourceHoldings
            source={source}
            model={holdings}
            hideSmallCryptoHoldings={hideSmallCryptoHoldings}
            holdingsDetailExpanded={holdingsDetailExpanded}
            onSmallHoldingFilterChange={setHideSmallCryptoHoldings}
            onToggleHoldingsDetail={() => setHoldingsDetailExpanded((current) => !current)}
            onShowCandlesticks={setCandlestickHolding}
            assetScopeHref={assetScopeHref}
            profitColorScheme={profitColorScheme}
            showSensitiveInfo={showSensitiveInfo}
            formatAmount={moneyAmount}
            formatDisplayMoney={formatDisplayMoney}
            formatDisplayPrice={formatDisplayPrice}
          />
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
