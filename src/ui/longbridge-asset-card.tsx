"use client";

import { useEffect, useMemo, useState } from "react";

import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import type {
  MarketBenchmarkComparison,
  MarketBenchmarkSymbol,
} from "@/domain/market-benchmark";
import {
  decimalCompare,
  decimalDivide,
  decimalMultiply,
  decimalSubtract,
  decimalToFixed,
} from "@/domain/decimal";
import {
  ignoredAssetKeySet,
  includedAssetKeySet,
  isUnrecognizedEvmTokenHolding,
  portfolioSourceTotal,
  unrecognizedEvmTokenCandidates,
} from "@/domain/evm-token-preferences";
import {
  compareNullableDecimalDescending,
  convertCurrencyAmount,
  sourceReportingConversionRates,
  type ReportingCurrency,
} from "@/domain/valuation";
import {
  daysForTrendRange,
  sourceTrendObservationStatus,
  type TrendRange,
} from "@/domain/daily-trend-observations";
import type {
  AssetExchangeRate,
  AssetHolding,
  AssetSnapshot,
  AssetSourceSyncState,
  DailyAssetTrendObservation,
  ManualAssetClass,
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

export interface AssetSourceView {
  id: string;
  kind: string;
  label: string;
  displayName?: string;
  accountId: string;
  snapshot: AssetSnapshot;
  sync: AssetSourceSyncState;
  ignoredAssetKeys?: string[];
  includedAssetKeys?: string[];
  hasManualRecord?: boolean;
  manualAssetClass?: ManualAssetClass;
  manualRecords?: ManualAssetRecord[];
  lifecycle?: "connected" | "disconnected";
}

function providerCardLabel(source: AssetSourceView): string {
  if (source.kind === "longbridge") return "长桥资产";
  if (source.kind === "binance") return "Binance 资产";
  if (source.kind === "okx") return "OKX 资产";
  if (source.kind === "bitget") return "Bitget 资产";
  if (source.kind === "bit") return "BIT / Matrixport 资产";
  if (source.kind === "evm-watch-ethereum") return "Ethereum 观察钱包";
  if (source.kind === "evm-watch-bsc") return "BNB Smart Chain 观察钱包";
  if (source.kind === "manual") return "手工资产记录";
  return "资产来源";
}

function providerCode(source: AssetSourceView): string {
  if (source.kind === "longbridge") return "LB";
  if (source.kind === "binance") return "BN";
  if (source.kind === "okx") return "OKX";
  if (source.kind === "bitget") return "BG";
  if (source.kind === "bit") return "BIT";
  if (source.kind === "evm-watch-ethereum") return "ETH";
  if (source.kind === "evm-watch-bsc") return "BSC";
  if (source.kind === "manual") return "MANUAL";
  return "SRC";
}

function sourceHeading(source: AssetSourceView): {
  title: string;
  metadata: string | null;
} {
  return { title: assetSourceDisplayName(source), metadata: null };
}

function amount(value: string): string {
  const [integer, fraction] = value.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
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

function holdingProfit(holding: AssetHolding): {
  amount: string;
  percent: string;
} | null {
  if (
    holding.currentPrice === null ||
    holding.costPrice === null ||
    holding.currentPrice.currency !== holding.currency
  ) {
    return null;
  }
  const costBasis = decimalMultiply(holding.costPrice, holding.quantity);
  if (decimalCompare(costBasis, "0") === 0) return null;
  const absoluteCostBasis = decimalCompare(costBasis, "0") < 0
    ? costBasis.slice(1)
    : costBasis;
  const profit = decimalMultiply(
    decimalSubtract(holding.currentPrice.amount, holding.costPrice),
    holding.quantity,
  );
  return {
    amount: profit,
    percent: decimalToFixed(
      decimalDivide(decimalMultiply(profit, "100"), absoluteCostBasis, 8),
      2,
    ),
  };
}

function holdingTodayProfit(holding: AssetHolding): {
  amount: string;
  percent: string;
} | null {
  if (
    holding.currentPrice === null ||
    holding.previousClose === null ||
    holding.previousClose === undefined ||
    holding.currentPrice.currency !== holding.previousClose.currency ||
    holding.currentPrice.currency !== holding.currency
  ) {
    return null;
  }
  if (decimalCompare(holding.previousClose.amount, "0") === 0) return null;
  const amount = decimalMultiply(
    decimalSubtract(holding.currentPrice.amount, holding.previousClose.amount),
    holding.quantity,
  );
  return {
    amount,
    percent: decimalToFixed(
      decimalDivide(
        decimalMultiply(
          decimalSubtract(holding.currentPrice.amount, holding.previousClose.amount),
          "100",
        ),
        holding.previousClose.amount,
        8,
      ),
      2,
    ),
  };
}

function signedAmount(value: string, format: (value: string) => string): string {
  const formatted = format(value);
  return decimalCompare(value, "0") > 0 ? `+${formatted}` : formatted;
}

function signedDisplayAmount(value: string, formatted: string): string {
  return decimalCompare(value, "0") > 0 ? `+${formatted}` : formatted;
}

function holdingMatchesSearch(
  source: AssetSourceView,
  holding: AssetHolding,
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length === 0) return true;
  return [
    source.label,
    source.displayName,
    assetHoldingDisplayName(holding),
    holding.symbol,
    holding.sourceAsset,
    holding.sourceAccount,
    holding.sourceProduct,
  ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
}

function profitDirection(
  value: string,
  showSensitiveInfo: boolean,
): "positive" | "negative" | "neutral" {
  if (!showSensitiveInfo) return "neutral";
  const comparison = decimalCompare(value, "0");
  return comparison > 0 ? "positive" : comparison < 0 ? "negative" : "neutral";
}

function HoldingProfitSummaryCell({
  currency,
  profit,
  kind,
  profitColorScheme,
  showSensitiveInfo,
  formatDisplayMoney,
}: {
  currency: string;
  profit: { amount: string; percent: string } | null;
  kind: "today" | "position";
  profitColorScheme: ProfitColorScheme;
  showSensitiveInfo: boolean;
  formatDisplayMoney: (value: string, currency: string) => string | null;
}) {
  const masked = "••••••";
  const displayedAmount = profit === null
    ? null
    : formatDisplayMoney(profit.amount, currency);
  return (
    <td
      className={`holding-profit-summary holding-profit-summary--${kind} profit-color-value`}
      data-profit-color-scheme={profitColorScheme}
      data-profit-direction={
        profit === null
          ? "neutral"
          : profitDirection(profit.amount, showSensitiveInfo)
      }
    >
      <strong>
        {profit === null
          ? "—"
          : !showSensitiveInfo
            ? masked
            : displayedAmount === null
              ? "无法折算"
              : signedDisplayAmount(profit.amount, displayedAmount)}
      </strong>
      <span>
        {profit === null
          ? "—"
          : showSensitiveInfo
            ? `${signedAmount(profit.percent, amount)}%`
            : masked}
      </span>
    </td>
  );
}

function HoldingMarketValueQuantityCell({
  holding,
  quoteUnavailable,
  showSensitiveInfo,
  formatDisplayMoney,
}: {
  holding: AssetHolding;
  quoteUnavailable: boolean;
  showSensitiveInfo: boolean;
  formatDisplayMoney: (value: string, currency: string) => string | null;
}) {
  const masked = "••••••";
  const displayedMarketValue = holding.marketValue === null
    ? null
    : formatDisplayMoney(holding.marketValue, holding.currency);
  return (
    <td className="holding-market-value-summary">
      <strong>
        {holding.marketValue === null
          ? quoteUnavailable
            ? "期权行情未接入"
            : "未估值"
          : !showSensitiveInfo
            ? masked
            : displayedMarketValue ?? "无法折算"}
      </strong>
      <span>{showSensitiveInfo ? amount(holding.quantity) : masked}</span>
    </td>
  );
}

function HoldingCostPrice({
  holding,
  showSensitiveInfo,
  formatDisplayPrice,
}: {
  holding: AssetHolding;
  showSensitiveInfo: boolean;
  formatDisplayPrice: (
    value: string,
    currency: string,
    assetClass: AssetHolding["assetClass"],
  ) => string | null;
}) {
  if (holding.costPrice === null) return "—";
  if (!showSensitiveInfo) return "••••••";
  const price = formatDisplayPrice(
    holding.costPrice,
    holding.currency,
    holding.assetClass,
  );
  if (price === null) return "无法折算";
  return (
    <>
      {price}
      {holding.costPriceSource ? (
        <span className="holding-price-source"> · {holding.costPriceSource}</span>
      ) : null}
    </>
  );
}

function hasLegacyLongbridgeQuote(holding: AssetHolding): boolean {
  return holding.valuation.status === "valued" &&
    (
      holding.valuation.priceSource === "Longbridge 行情" ||
      holding.valuation.priceSource === "Longbridge 实时行情"
    );
}

function holdingQuoteSessionText(
  holding: AssetHolding,
  showSensitiveInfo: boolean,
): string | null {
  if (!showSensitiveInfo || holding.currentPrice === null) return null;
  const evidence = holding.quoteEvidence;
  const legacyLongbridgeQuote = hasLegacyLongbridgeQuote(holding);
  if (holding.assetClass !== "crypto" && evidence === undefined && !legacyLongbridgeQuote) {
    return null;
  }
  const session = holding.assetClass === "crypto"
    ? "crypto-24h"
    : evidence?.session ?? "unknown";
  const sessionLabel = {
    regular: "常规盘",
    "pre-market": "盘前",
    "post-market": "盘后",
    overnight: "夜盘",
    unknown: "时段未知",
    "crypto-24h": "24h",
  }[session];
  // 旧证券快照没有独立的供应商时间证据，不能把 valuation.pricedAt
  // （它可能是当时的同步时间）冒充为行情时间。加密资产维持来源报价时间。
  const quotedAt = evidence?.quotedAt ??
    (holding.assetClass === "crypto" && holding.valuation.status === "valued"
      ? holding.valuation.pricedAt
      : null);
  return [
    evidence?.freshness === "retained" ? "保留行情" : null,
    evidence?.delivery === "delayed" ? "延迟行情" : null,
    sessionLabel,
    quotedAt === null
      ? "时间不可用"
      : `行情 ${formatShanghaiDateTime(quotedAt)}`,
  ].filter(Boolean).join(" · ");
}

function holdingValuationDetail(holding: AssetHolding): string {
  if (holding.valuation.status !== "valued") return holding.valuation.reason;
  const quotedAt = holding.quoteEvidence === undefined
    ? hasLegacyLongbridgeQuote(holding)
      ? null
      : holding.valuation.pricedAt
    : holding.quoteEvidence.quotedAt;
  return `${holding.valuation.priceSource} · ${
    quotedAt === null ? "时间不可用" : formatShanghaiDateTime(quotedAt)
  }`;
}

function HoldingCurrentPrice({
  holding,
  quoteUnavailable,
  showSensitiveInfo,
  formatDisplayPrice,
}: {
  holding: AssetHolding;
  quoteUnavailable: boolean;
  showSensitiveInfo: boolean;
  formatDisplayPrice: (
    value: string,
    currency: string,
    assetClass: AssetHolding["assetClass"],
  ) => string | null;
}) {
  const masked = "••••••";
  const currentPrice = holding.currentPrice
    ? !showSensitiveInfo
      ? masked
      : formatDisplayPrice(
        holding.currentPrice.amount,
        holding.currentPrice.currency,
        holding.assetClass,
      ) ?? "无法折算"
    : quoteUnavailable
      ? "现价不可用"
      : holding.valuation.status === "unvalued"
        ? "未估值"
        : "—";
  const session = holdingQuoteSessionText(holding, showSensitiveInfo);
  return (
    <>
      <strong className="holding-current-price">{currentPrice}</strong>
      {session ? <span className="holding-quote-session">{session}</span> : null}
    </>
  );
}

function HoldingCurrentCostPriceCell({
  holding,
  quoteUnavailable,
  showSensitiveInfo,
  formatDisplayPrice,
}: {
  holding: AssetHolding;
  quoteUnavailable: boolean;
  showSensitiveInfo: boolean;
  formatDisplayPrice: (
    value: string,
    currency: string,
    assetClass: AssetHolding["assetClass"],
  ) => string | null;
}) {
  return (
    <td className="holding-current-cost-price">
      <HoldingCurrentPrice
        formatDisplayPrice={formatDisplayPrice}
        holding={holding}
        quoteUnavailable={quoteUnavailable}
        showSensitiveInfo={showSensitiveInfo}
      />
      <span>
        <HoldingCostPrice
          formatDisplayPrice={formatDisplayPrice}
          holding={holding}
          showSensitiveInfo={showSensitiveInfo}
        />
      </span>
    </td>
  );
}

function HoldingDetailRow({
  holding,
  onShowCandlesticks,
  profitColorScheme,
  showPlatformProfit,
  compactProfitColumns,
  showSensitiveInfo,
  formatDisplayMoney,
  formatDisplayPrice,
}: {
  holding: AssetHolding;
  onShowCandlesticks?: (holding: AssetHolding) => void;
  profitColorScheme: ProfitColorScheme;
  showPlatformProfit: boolean;
  compactProfitColumns: boolean;
  showSensitiveInfo: boolean;
  formatDisplayMoney: (value: string, currency: string) => string | null;
  formatDisplayPrice: (
    value: string,
    currency: string,
    assetClass: AssetHolding["assetClass"],
  ) => string | null;
}) {
  const masked = "••••••";
  const quoteUnavailable = holding.valuation.status === "quote-unavailable";
  const valuationDetail = holdingValuationDetail(holding);
  const profit = holdingProfit(holding);
  const todayProfit = holdingTodayProfit(holding);
  return (
    <tr
      className={holding.valuation.status === "unvalued" ? "is-unvalued" : undefined}
      data-holding-key={assetHoldingKey(holding)}
    >
      <td>
        <strong className="holding-name">
          {assetHoldingDisplayName(holding)}
          {onShowCandlesticks ? (
            <VibeButton
              className="holding-candlestick-trigger"
              onClick={() => onShowCandlesticks(holding)}
              type="button"
              variant="text"
            >
              K线
            </VibeButton>
          ) : null}
        </strong>
        <AssetHoldingPositionStatus holding={holding} />
        <span className="holding-symbol">{holding.symbol}</span>
        <span className="holding-price-source">{valuationDetail}</span>
      </td>
      {compactProfitColumns ? (
        <>
          <HoldingMarketValueQuantityCell
            formatDisplayMoney={formatDisplayMoney}
            holding={holding}
            quoteUnavailable={quoteUnavailable}
            showSensitiveInfo={showSensitiveInfo}
          />
          <HoldingCurrentCostPriceCell
            formatDisplayPrice={formatDisplayPrice}
            holding={holding}
            quoteUnavailable={quoteUnavailable}
            showSensitiveInfo={showSensitiveInfo}
          />
          <HoldingProfitSummaryCell
            currency={holding.currency}
            formatDisplayMoney={formatDisplayMoney}
            kind="today"
            profit={todayProfit}
            profitColorScheme={profitColorScheme}
            showSensitiveInfo={showSensitiveInfo}
          />
          <HoldingProfitSummaryCell
            currency={holding.currency}
            formatDisplayMoney={formatDisplayMoney}
            kind="position"
            profit={profit}
            profitColorScheme={profitColorScheme}
            showSensitiveInfo={showSensitiveInfo}
          />
        </>
      ) : (
        <>
          <td>{showSensitiveInfo ? amount(holding.quantity) : masked}</td>
          <td className="holding-current-price-cell">
            <HoldingCurrentPrice
              formatDisplayPrice={formatDisplayPrice}
              holding={holding}
              quoteUnavailable={quoteUnavailable}
              showSensitiveInfo={showSensitiveInfo}
            />
          </td>
          <td>
            {holding.marketValue === null
              ? quoteUnavailable
                ? "期权行情未接入"
                : "未估值"
              : !showSensitiveInfo
                ? masked
                : formatDisplayMoney(holding.marketValue, holding.currency) ?? "无法折算"}
          </td>
          <td>
            <HoldingCostPrice
              formatDisplayPrice={formatDisplayPrice}
              holding={holding}
              showSensitiveInfo={showSensitiveInfo}
            />
          </td>
          {showPlatformProfit ? (
            <td>
              {holding.platformProfit === null
                ? "—"
                : !showSensitiveInfo
                  ? masked
                  : formatDisplayMoney(holding.platformProfit, holding.currency) ?? "无法折算"}
            </td>
          ) : null}
          <td
            className="holding-profit profit-color-value"
            data-profit-color-scheme={profitColorScheme}
            data-profit-direction={
              profit === null
                ? "neutral"
                : profitDirection(profit.amount, showSensitiveInfo)
            }
          >
            {profit === null
              ? "—"
              : !showSensitiveInfo
                ? masked
                : (() => {
                  const displayed = formatDisplayMoney(profit.amount, holding.currency);
                  return displayed === null
                    ? "无法折算"
                    : signedDisplayAmount(profit.amount, displayed);
                })()}
          </td>
          <td
            className="holding-profit profit-color-value"
            data-profit-color-scheme={profitColorScheme}
            data-profit-direction={
              profit === null
                ? "neutral"
                : profitDirection(profit.percent, showSensitiveInfo)
            }
          >
            {profit === null
              ? "—"
              : showSensitiveInfo
                ? `${signedAmount(profit.percent, amount)}%`
                : masked}
          </td>
        </>
      )}
    </tr>
  );
}

export function AssetSourceCard({
  totalAnimationKey,
  refreshDisabled = false,
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
  totalAnimationKey?: string;
  refreshDisabled?: boolean;
  source: AssetSourceView;
  history: DailyAssetTrendObservation[];
  reportingExchangeRates: AssetExchangeRate[];
  reportingCurrency: ReportingCurrency;
  trendBenchmark?: {
    comparison: MarketBenchmarkComparison;
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
  const isManual = source.kind === "manual";
  const hasManualRecord = !isManual || source.hasManualRecord !== false;
  const manualRecords = source.manualRecords ?? [];
  const currentManualRecord = manualRecords.find(({ day }) => day === currentDay);
  const supportsSmallHoldingFilter =
    !isManual && source.kind !== "longbridge";
  const supportsEvmTokenPreferences = source.kind.startsWith("evm-watch-");
  const supportsProductCoverage =
    ["binance", "okx", "bitget", "bit"].includes(source.kind) ||
    source.kind.startsWith("evm-watch-");
  const orderedHoldings = useMemo(
    () => source.snapshot.holdings.toSorted((left, right) =>
      compareNullableDecimalDescending(
        left.sourceMarketValue?.amount ?? null,
        right.sourceMarketValue?.amount ?? null,
      ),
    ),
    [source.snapshot.holdings],
  );
  const cashHoldings = orderedHoldings.filter(
    ({ assetClass }) => assetClass === "cash",
  );
  const positionHoldings = orderedHoldings.filter(
    ({ assetClass }) => assetClass !== "cash",
  );
  const ignoredAssetKeys = ignoredAssetKeySet(source);
  const includedAssetKeys = includedAssetKeySet(source);
  const activePositionHoldings = positionHoldings.filter(
    (holding) =>
      holding.sourceAsset === undefined ||
      !ignoredAssetKeys.has(holding.sourceAsset),
  );
  const unrecognizedHoldings = supportsEvmTokenPreferences
    ? activePositionHoldings.filter((holding) =>
        isUnrecognizedEvmTokenHolding(source, holding)
      )
    : [];
  const unrecognizedAssetKeys = new Set(
    unrecognizedHoldings.flatMap((holding) =>
      holding.sourceAsset ? [holding.sourceAsset] : [],
    ),
  );
  const reviewedPositionHoldings = activePositionHoldings.filter(
    (holding) =>
      holding.sourceAsset === undefined ||
      !unrecognizedAssetKeys.has(holding.sourceAsset),
  );
  const unreadableEvmTokens = supportsEvmTokenPreferences
    ? unrecognizedEvmTokenCandidates(source).filter(
      (token) =>
        token.quantity === null && !ignoredAssetKeys.has(token.sourceAsset),
    )
    : [];
  const cashBalances = cashHoldings.flatMap((holding) =>
    holding.cashBalances ?? [{
      amount: holding.marketValue ?? holding.quantity,
      availableCash: holding.quantity,
      currency: holding.currency,
      frozenCash: "0",
      settlingCash: "0",
      withdrawCash: holding.quantity,
    }]
  );
  const hiddenSmallHoldingCount = supportsSmallHoldingFilter
    ? reviewedPositionHoldings.filter(
        (holding) =>
          holding.marketValue !== null &&
          decimalCompare(holding.marketValue, "1") < 0,
      ).length
    : 0;
  const visibleHoldings = supportsSmallHoldingFilter && hideSmallCryptoHoldings
    ? reviewedPositionHoldings.filter(
      (holding) =>
        holding.marketValue === null ||
        decimalCompare(holding.marketValue, "1") >= 0,
      )
    : reviewedPositionHoldings;
  const searchedHoldings = visibleHoldings.filter((holding) =>
    holdingMatchesSearch(source, holding, holdingsSearchQuery)
  );
  const hasHoldingsSearchQuery =
    !isManual && holdingsSearchQuery.trim().length > 0;
  const showPlatformProfit = visibleHoldings.some(
    (holding) => holding.platformProfit !== null,
  );
  const compactProfitColumns = source.kind === "longbridge";
  const sourceHistory = history.flatMap((snapshot) => {
    const item = snapshot.sources.find(({ sourceId }) => sourceId === source.id);
    return item ? [{ day: snapshot.day, ...item }] : [];
  });
  const firstSourceTrendDay = isManual
    ? manualRecords.reduce<string | undefined>(
      (earliest, record) =>
        earliest === undefined || record.day < earliest ? record.day : earliest,
      undefined,
    )
    : sourceHistory.reduce<string | undefined>(
      (earliest, observation) =>
        earliest === undefined || observation.day < earliest
          ? observation.day
          : earliest,
      undefined,
    );
  const sourceTrendDays = trendDays ?? daysForTrendRange(
    trendRange,
    currentDay,
    firstSourceTrendDay,
  );
  const sourceTrendByDay = new Map(
    sourceHistory.map((observation) => [observation.day, observation]),
  );
  const trendSnapshotByDay = new Map(
    history.map((snapshot) => [snapshot.day, snapshot]),
  );
  const sourceDailyDetails = [...sourceHistory].sort((left, right) =>
    right.day.localeCompare(left.day)
  );
  const missingSourceTrendDayCount = isManual
    ? 0
    : sourceTrendDays.filter((day) => !sourceTrendByDay.has(day)).length;
  const sourceTrendPoints = sourceTrendDays.map((day, index) => {
    if (isManual) {
      const record = manualRecords
        .filter((item) => item.day <= day)
        .toSorted((left, right) => right.day.localeCompare(left.day))[0];
      if (record === undefined) {
        return {
          day,
          index,
          amount: null,
          observed: false,
          status: "incomplete" as const,
        };
      }
      const recordedObservation = sourceTrendByDay.get(record.day);
      const recordedSnapshot = trendSnapshotByDay.get(record.day);
      return {
        day,
        index,
        amount: recordedObservation?.total[reportingCurrency] ??
          convertCurrencyAmount(
            record.amount,
            record.currency,
            reportingCurrency,
            recordedSnapshot?.exchangeRates ?? [],
          ),
        manualRecordDay: record.day,
        observed: record.day === day && recordedObservation !== undefined,
        status: "complete" as const,
      };
    }
    const observation = sourceTrendByDay.get(day);
    return {
      day,
      index,
      amount: observation?.total[reportingCurrency] ?? null,
      observed: observation !== undefined,
      status: observation === undefined
        ? "incomplete"
        : sourceTrendObservationStatus(observation),
    };
  });
  const unavailableSourceTrendPoints = sourceTrendPoints.filter(
    (point) => point.amount === null && sourceTrendByDay.has(point.day),
  );
  const abnormalSourceTrendPoints = sourceTrendPoints.filter(
    (point) => point.amount !== null && point.status !== "complete",
  );
  const sourceTrendNotice = [
    isManual
      ? "手工记录"
      : missingSourceTrendDayCount > 0
      ? `缺少 ${missingSourceTrendDayCount} 天观测`
      : null,
    abnormalSourceTrendPoints.length > 0 || unavailableSourceTrendPoints.length > 0
      ? `数据受限：${
        [
          abnormalSourceTrendPoints.length > 0
            ? `${abnormalSourceTrendPoints.length} 天不完整或过期`
            : null,
          unavailableSourceTrendPoints.length > 0
            ? `${unavailableSourceTrendPoints.length} 天未估值`
            : null,
        ].filter(Boolean).join(" · ")
      }`
      : null,
  ].filter(Boolean).join(" · ");
  const unvaluedCount = visibleHoldings.filter(
    ({ valuation }) => valuation.status === "unvalued",
  ).length;
  const quoteUnavailableCount = visibleHoldings.filter(
    ({ valuation }) => valuation.status === "quote-unavailable",
  ).length;
  const valuedCount =
    visibleHoldings.length - unvaluedCount - quoteUnavailableCount;
  const valuationSegments = visibleHoldings.map((holding) => ({
    key: assetHoldingKey(holding),
    tone:
      holding.valuation.status === "unvalued"
        ? "error" as const
        : holding.valuation.status === "quote-unavailable"
          ? "muted" as const
        : "primary" as const,
    value: 1,
  }));
  const valuationAriaLabel = quoteUnavailableCount > 0
    ? `${valuedCount} 项已估值，${unvaluedCount} 项未估值，${quoteUnavailableCount} 项行情未接入`
    : `${valuedCount} 项已估值，${unvaluedCount} 项未估值`;
  const valuationCaption = unvaluedCount > 0
    ? `${unvaluedCount} UNVALUED${
        quoteUnavailableCount > 0 ? ` · ${quoteUnavailableCount} QUOTE N/A` : ""
      }`
    : quoteUnavailableCount > 0
      ? `${quoteUnavailableCount} QUOTE N/A`
      : "VALUATION / COMPLETE";
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
            {isManual && onManualAssetRecord ? (
              <VibeButton
                className="manual-asset-record-button"
                data-demo-disabled={onReadOnlyAction ? "true" : undefined}
                onClick={() => {
                  if (onReadOnlyAction) {
                    onReadOnlyAction();
                    return;
                  }
                  onManualAssetRecord(source);
                }}
                type="button"
                variant="outline"
              >
                {currentManualRecord ? "更新今日数据" : "添加数据"}
              </VibeButton>
            ) : !isManual && source.lifecycle !== "disconnected" ? (
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
        <section
          className="asset-trend source-trend"
          data-testid={`asset-source-trend-${source.id}`}
        >
          <p className="card-label">来源趋势</p>
          {!showSensitiveInfo ? (
            <AssetTrendChart
              ariaLabel={`${heading.title}来源总额趋势已隐藏`}
              currency={reportingCurrency}
              formatAmount={moneyAmount}
              formatDay={formatShanghaiDayLabel}
              incompleteCount={0}
              isSensitiveHidden
              points={[]}
              showCurrency={false}
              unavailableCount={0}
              variant="source"
            />
          ) : sourceHistory.length === 0 ? (
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
                incompleteCount={abnormalSourceTrendPoints.length}
                lineType={isManual ? "stepAfter" : "linear"}
                points={sourceTrendPoints}
                showCurrency={false}
                unavailableCount={unavailableSourceTrendPoints.length}
                variant="source"
              />
              {!isManual ? (
                <details
                  className="daily-trend-details source-daily-trend-details"
                  data-testid={`asset-source-daily-details-${source.id}`}
                >
                  <summary>每日总额（{sourceDailyDetails.length}）</summary>
                  <div className="daily-trend-details-content">
                    <ol className="daily-trend-detail-list">
                      {sourceDailyDetails.map((observation) => {
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
          {showSensitiveInfo && sourceTrendNotice ? (
            <p className="trend-note">{sourceTrendNotice}</p>
          ) : null}
        </section>
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
                未找到匹配持仓
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
                          <th>平均成本价</th>
                          {showPlatformProfit ? <th>平台盈亏（来源提供）</th> : null}
                          <th>浮动盈亏</th>
                          <th>持仓盈亏率</th>
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
