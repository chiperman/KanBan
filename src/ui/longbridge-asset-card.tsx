"use client";

import { useMemo, useState } from "react";

import { decimalCompare, decimalToFixed } from "@/domain/decimal";
import { compareNullableDecimalDescending } from "@/domain/valuation";
import type {
  AssetHolding,
  AssetSnapshot,
  AssetSourceSyncState,
  DailyAssetSnapshot,
} from "@/server/ports";
import {
  assetHoldingKey,
  binanceHoldingDisplayName,
  BinanceCoverage,
} from "@/ui/binance-coverage";
import {
  VibeMetric,
  VibeSegmentedBar,
  VibeStatusTag,
} from "@/ui/vibe/vibe-data-instrument";
import { VibeNotice } from "@/ui/vibe/vibe-notice";

export interface AssetSourceView {
  id: string;
  kind: string;
  label: string;
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
  if (source.kind === "longbridge") {
    return { title: "长桥账户", metadata: null };
  }
  return { title: source.label, metadata: null };
}

function amount(value: string): string {
  const [integer, fraction] = value.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

function moneyAmount(value: string): string {
  return amount(decimalToFixed(value, 2));
}

function dayLabel(day: string): string {
  return `${day.slice(5, 7)}月${day.slice(8, 10)}日`;
}

function HoldingDetailRow({
  holding,
  showPlatformProfit,
  showSensitiveInfo,
  formatMoney,
}: {
  holding: AssetHolding;
  showPlatformProfit: boolean;
  showSensitiveInfo: boolean;
  formatMoney: (value: string) => string;
}) {
  const masked = "••••••";
  const valuationDetail = holding.valuation.status === "valued"
    ? `${holding.valuation.priceSource} · ${holding.valuation.pricedAt.slice(0, 16).replace("T", " ")} UTC`
    : holding.valuation.reason;
  return (
    <tr>
      <td>
        <strong>{binanceHoldingDisplayName(holding)}</strong>
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
      <td>{holding.costPrice === null ? "—" : showSensitiveInfo ? amount(holding.costPrice) : masked}</td>
      {showPlatformProfit ? (
        <td>{holding.platformProfit === null ? "—" : showSensitiveInfo ? formatMoney(holding.platformProfit) : masked}</td>
      ) : null}
      <td>{holding.changePercent === null ? "—" : showSensitiveInfo ? `${holding.changePercent}%` : masked}</td>
    </tr>
  );
}

export function AssetSourceCard({
  source,
  history,
  showSensitiveInfo,
}: {
  source: AssetSourceView;
  history: DailyAssetSnapshot[];
  showSensitiveInfo: boolean;
}) {
  const [hideSmallCryptoHoldings, setHideSmallCryptoHoldings] = useState(true);
  const supportsSmallHoldingFilter = source.kind !== "longbridge";
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
  const meterSegments = 12;
  const heading = sourceHeading(source);
  const formatMoney = source.kind === "longbridge" ? amount : moneyAmount;
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
            tone={source.sync.status === "expired" ? "warning" : "muted"}
          >
            {providerCode(source)} / {source.sync.status === "expired" ? "STALE" : "LIVE"}
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
        {source.kind === "binance" ? (
          <BinanceCoverage coverage={source.snapshot.coverage} />
        ) : null}
        <div className="source-meter">
          <VibeSegmentedBar
            ariaLabel={`${valuedCount} 项已估值，${unvaluedCount} 项未估值`}
            cells={meterSegments}
            segments={[
              { key: "valued", tone: "primary", value: valuedCount },
              {
                key: "unvalued",
                tone: "muted",
                value: unvaluedCount,
              },
            ]}
            total={visibleHoldings.length}
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
            <li className="vibe-data-row" key={assetHoldingKey(holding)}>
              <span>{binanceHoldingDisplayName(holding)}</span>
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
          aria-label={`${source.label} 持仓明细`}
        >
          <p className="card-label">持仓明细</p>
          <div className="asset-table-wrap">
            <table className="asset-table vibe-data-table" data-vibe-component="data-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>数量</th>
                  <th>当前价格</th>
                  <th>原始市值</th>
                  <th>成本</th>
                  {showPlatformProfit ? <th>平台盈亏（来源提供）</th> : null}
                  <th>涨跌</th>
                </tr>
              </thead>
              <tbody>
                {visibleHoldings.map((holding) => (
                  <HoldingDetailRow
                    key={assetHoldingKey(holding)}
                    holding={holding}
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
                  <time dateTime={snapshot.day}>{dayLabel(snapshot.day)}</time>
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
        <p className="asset-updated">最后更新：{source.snapshot.syncedAt.slice(0, 16).replace("T", " ")} UTC</p>
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
            {source.sync.lastSuccessfulAt.slice(0, 16).replace("T", " ")} UTC
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
