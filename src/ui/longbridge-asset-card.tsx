"use client";

import { useMemo, useState } from "react";

import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import {
  decimalCompare,
  decimalDivide,
  decimalMultiply,
  decimalSubtract,
  decimalToFixed,
} from "@/domain/decimal";
import { compareNullableDecimalDescending } from "@/domain/valuation";
import type {
  AssetHolding,
  AssetSnapshot,
  AssetSourceSyncState,
  DailyAssetSnapshot,
} from "@/server/ports";
import {
  assetHoldingKey,
  assetHoldingDisplayName,
  AssetProductCoverage,
} from "@/ui/asset-product-coverage";
import type { ProfitColorScheme } from "@/ui/profit-color-scheme";
import {
  VibeMetric,
  VibeSegmentedBar,
  VibeStatusTag,
} from "@/ui/vibe/vibe-data-instrument";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import {
  formatShanghaiDateTime,
  formatShanghaiDayLabel,
} from "@/ui/shanghai-date-time";

export interface AssetSourceView {
  id: string;
  kind: string;
  label: string;
  displayName?: string;
  accountId: string;
  snapshot: AssetSnapshot;
  sync: AssetSourceSyncState;
  lifecycle?: "connected" | "disconnected";
}

function providerCardLabel(source: AssetSourceView): string {
  if (source.kind === "longbridge") return "长桥资产";
  if (source.kind === "binance") return "Binance 资产";
  if (source.kind === "okx") return "OKX 资产";
  if (source.kind === "bitget") return "Bitget 资产";
  if (source.kind === "evm-watch-ethereum") return "Ethereum 观察钱包";
  if (source.kind === "evm-watch-bsc") return "BNB Smart Chain 观察钱包";
  return "资产来源";
}

function providerCode(source: AssetSourceView): string {
  if (source.kind === "longbridge") return "LB";
  if (source.kind === "binance") return "BN";
  if (source.kind === "okx") return "OK";
  if (source.kind === "bitget") return "BG";
  if (source.kind === "evm-watch-ethereum") return "ETH";
  if (source.kind === "evm-watch-bsc") return "BSC";
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

function signedAmount(value: string, format: (value: string) => string): string {
  const formatted = format(value);
  return decimalCompare(value, "0") > 0 ? `+${formatted}` : formatted;
}

function profitDirection(
  value: string,
  showSensitiveInfo: boolean,
): "positive" | "negative" | "neutral" {
  if (!showSensitiveInfo) return "neutral";
  const comparison = decimalCompare(value, "0");
  return comparison > 0 ? "positive" : comparison < 0 ? "negative" : "neutral";
}

function HoldingDetailRow({
  holding,
  profitColorScheme,
  showPlatformProfit,
  showSensitiveInfo,
  formatMoney,
}: {
  holding: AssetHolding;
  profitColorScheme: ProfitColorScheme;
  showPlatformProfit: boolean;
  showSensitiveInfo: boolean;
  formatMoney: (value: string) => string;
}) {
  const masked = "••••••";
  const valuationDetail = holding.valuation.status === "valued"
    ? `${holding.valuation.priceSource} · ${formatShanghaiDateTime(holding.valuation.pricedAt)}`
    : holding.valuation.reason;
  const profit = holdingProfit(holding);
  return (
    <tr
      className={holding.valuation.status === "unvalued" ? "is-unvalued" : undefined}
      data-holding-key={assetHoldingKey(holding)}
    >
      <td>
        <strong>{assetHoldingDisplayName(holding)}</strong>
        <span className="holding-symbol">{holding.symbol}</span>
        <span className="holding-price-source">{valuationDetail}</span>
      </td>
      <td>{showSensitiveInfo ? amount(holding.quantity) : masked}</td>
      <td>
        {holding.currentPrice
          ? `${showSensitiveInfo ? amount(holding.currentPrice.amount) : masked} ${holding.currentPrice.currency}`
          : holding.valuation.status === "unvalued"
            ? `未估值（${holding.currency}）`
            : "—"}
      </td>
      <td>
        {holding.marketValue === null
          ? `未估值（${holding.currency}）`
          : `${showSensitiveInfo ? formatMoney(holding.marketValue) : masked} ${holding.currency}`}
      </td>
      <td>
        {holding.costPrice === null
          ? "—"
          : `${showSensitiveInfo ? amount(holding.costPrice) : masked} ${holding.currency}`}
      </td>
      {showPlatformProfit ? (
        <td>{holding.platformProfit === null ? "—" : showSensitiveInfo ? formatMoney(holding.platformProfit) : masked}</td>
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
          : `${showSensitiveInfo ? signedAmount(profit.amount, formatMoney) : masked} ${holding.currency}`}
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
    </tr>
  );
}

export function AssetSourceCard({
  source,
  history,
  profitColorScheme,
  showSensitiveInfo,
}: {
  source: AssetSourceView;
  history: DailyAssetSnapshot[];
  profitColorScheme: ProfitColorScheme;
  showSensitiveInfo: boolean;
}) {
  const [hideSmallCryptoHoldings, setHideSmallCryptoHoldings] = useState(true);
  const supportsSmallHoldingFilter = source.kind !== "longbridge";
  const supportsProductCoverage = ["binance", "okx", "bitget"].includes(
    source.kind,
  );
  const orderedHoldings = useMemo(
    () => source.snapshot.holdings.toSorted((left, right) =>
      compareNullableDecimalDescending(
        left.sourceMarketValue?.amount ?? null,
        right.sourceMarketValue?.amount ?? null,
      ),
    ),
    [source.snapshot.holdings],
  );
  const hiddenSmallHoldingCount = supportsSmallHoldingFilter
    ? orderedHoldings.filter(
        (holding) =>
          holding.marketValue !== null &&
          decimalCompare(holding.marketValue, "1") < 0,
      ).length
    : 0;
  const visibleHoldings = supportsSmallHoldingFilter && hideSmallCryptoHoldings
    ? orderedHoldings.filter(
        (holding) =>
          holding.marketValue === null ||
          decimalCompare(holding.marketValue, "1") >= 0,
      )
    : orderedHoldings;
  const showPlatformProfit = visibleHoldings.some(
    (holding) => holding.platformProfit !== null,
  );
  const sourceHistory = history.flatMap((snapshot) => {
    const item = snapshot.sources.find(({ sourceId }) => sourceId === source.id);
    return item ? [{ day: snapshot.day, ...item }] : [];
  });
  const unvaluedCount = visibleHoldings.filter(
    ({ valuation }) => valuation.status === "unvalued",
  ).length;
  const valuedCount = visibleHoldings.length - unvaluedCount;
  const valuationSegments = visibleHoldings.map((holding) => ({
    key: assetHoldingKey(holding),
    tone:
      holding.valuation.status === "unvalued"
        ? "error" as const
        : "primary" as const,
    value: 1,
  }));
  const heading = sourceHeading(source);
  const formatMoney = source.kind === "longbridge" ? amount : moneyAmount;
  const sourceState = source.lifecycle === "disconnected"
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
                  : source.kind === "evm-watch-ethereum"
                    ? "ethereum-watch-card"
                    : source.kind === "evm-watch-bsc"
                      ? "bsc-watch-card"
              : `asset-source-card-${source.id}`
        }
      >
        <header className="asset-source-head">
          <p className="card-label">{providerCardLabel(source)}</p>
          <VibeStatusTag
            className={`source-live-state ${source.sync.status}`}
            tone={sourceState.tone}
          >
            {providerCode(source)} / {sourceState.label}
          </VibeStatusTag>
        </header>
        <h2 className="asset-source-title">{heading.title}</h2>
        {heading.metadata ? (
          <p className="asset-source-meta">{heading.metadata}</p>
        ) : null}
        <VibeMetric
          className="asset-total"
          data-testid="asset-source-total"
          unit={source.snapshot.total.currency}
          value={showSensitiveInfo ? formatMoney(source.snapshot.total.amount) : "••••••"}
        />
        {supportsProductCoverage ? (
          <AssetProductCoverage
            coverage={source.snapshot.coverage}
            sourceKind={source.kind}
          />
        ) : null}
        <div className="source-meter">
          <VibeSegmentedBar
            ariaLabel={`${valuedCount} 项已估值，${unvaluedCount} 项未估值`}
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
            {unvaluedCount === 0 ? "VALUATION / COMPLETE" : `${unvaluedCount} UNVALUED`}
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
              隐藏低于 1 {source.snapshot.total.currency} 的持仓
              {hideSmallCryptoHoldings && hiddenSmallHoldingCount > 0
                ? `（已隐藏 ${hiddenSmallHoldingCount} 项）`
                : ""}
            </span>
          </label>
        ) : null}
        <ol className="holding-top-list" data-testid="holding-top-list">
          {visibleHoldings.map((holding) => (
            <li
              className={`vibe-data-row${holding.valuation.status === "unvalued" ? " is-unvalued" : ""}`}
              data-holding-key={assetHoldingKey(holding)}
              key={assetHoldingKey(holding)}
            >
              <span>{assetHoldingDisplayName(holding)}</span>
              <strong>
                {holding.marketValue === null
                  ? `未估值（${holding.currency}）`
                  : `${showSensitiveInfo ? formatMoney(holding.marketValue) : "••••••"} ${holding.currency}`}
              </strong>
            </li>
          ))}
        </ol>
        <section
          className="asset-holdings-detail"
          data-testid="asset-holdings-detail"
          aria-label={`${source.label} ${
            source.kind === "longbridge" ? "证券持仓明细" : "持仓明细"
          }`}
        >
          <p className="card-label">
            {source.kind === "longbridge" ? "证券持仓明细" : "持仓明细"}
          </p>
          <div className="asset-table-wrap">
            <table className="asset-table vibe-data-table" data-vibe-component="data-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>数量</th>
                  <th>现价</th>
                  <th>持仓市值</th>
                  <th>平均成本价</th>
                  {showPlatformProfit ? <th>平台盈亏（来源提供）</th> : null}
                  <th>浮动盈亏</th>
                  <th>持仓盈亏率</th>
                </tr>
              </thead>
              <tbody>
                {visibleHoldings.map((holding) => (
                  <HoldingDetailRow
                    key={assetHoldingKey(holding)}
                    holding={holding}
                    profitColorScheme={profitColorScheme}
                    showPlatformProfit={showPlatformProfit}
                    showSensitiveInfo={showSensitiveInfo}
                    formatMoney={formatMoney}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
        {unvaluedCount > 0 ? (
          <VibeStatusTag className="asset-sync-status" tone="warning">
            含 {unvaluedCount} 项未估值资产
          </VibeStatusTag>
        ) : null}
        <section
          className="asset-trend source-trend"
          data-testid={`asset-source-trend-${source.id}`}
        >
          <p className="card-label">来源趋势（USD）</p>
          {sourceHistory.length === 0 ? (
            <p className="trend-empty">首次成功同步后开始记录</p>
          ) : (
            <ol className="trend-list">
              {sourceHistory.map((snapshot) => (
                <li key={snapshot.day}>
                  <time dateTime={snapshot.day}>{formatShanghaiDayLabel(snapshot.day)}</time>
                  <strong>
                    {snapshot.total.USD === null
                      ? "未估值"
                      : `${showSensitiveInfo ? formatMoney(snapshot.total.USD) : "••••••"} USD`}
                  </strong>
                  <span>{snapshot.complete ? "完整" : "不完整"}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
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
            {" · 最后成功："}
            {formatShanghaiDateTime(source.sync.lastSuccessfulAt)}
          </VibeStatusTag>
        )}
        {source.sync.error ? (
          <VibeNotice className="asset-sync-error" role="alert" tone="error">
            {source.label} 同步失败：{source.sync.error}
          </VibeNotice>
        ) : null}
      </div>
    </>
  );
}
