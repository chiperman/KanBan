"use client";

import type {
  AssetHolding,
  AssetSnapshot,
  AssetSourceSyncState,
  DailyAssetSnapshot,
} from "@/server/ports";
import { assetHoldingKey, BinanceCoverage } from "@/ui/binance-coverage";

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

function amount(value: string): string {
  const [integer, fraction] = value.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

function dayLabel(day: string): string {
  return `${day.slice(5, 7)}月${day.slice(8, 10)}日`;
}

function HoldingDetailRow({
  holding,
  showPlatformProfit,
  showSensitiveInfo,
}: {
  holding: AssetHolding;
  showPlatformProfit: boolean;
  showSensitiveInfo: boolean;
}) {
  const masked = "••••••";
  const valuationDetail = holding.valuation.status === "valued"
    ? `${holding.valuation.priceSource} · ${holding.valuation.pricedAt.slice(0, 16).replace("T", " ")} UTC`
    : holding.valuation.reason;
  return (
    <tr>
      <td>
        <strong>{holding.name}</strong>
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
          : `${showSensitiveInfo ? amount(holding.marketValue) : masked} ${holding.currency}`}
      </td>
      <td>{holding.costPrice === null ? "—" : showSensitiveInfo ? amount(holding.costPrice) : masked}</td>
      {showPlatformProfit ? (
        <td>{holding.platformProfit === null ? "—" : showSensitiveInfo ? amount(holding.platformProfit) : masked}</td>
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
  const showPlatformProfit = source.snapshot.holdings.some(
    (holding) => holding.platformProfit !== null,
  );
  const sourceHistory = history.flatMap((snapshot) => {
    const item = snapshot.sources.find(({ sourceId }) => sourceId === source.id);
    return item ? [{ day: snapshot.day, ...item }] : [];
  });
  const unvaluedCount = source.snapshot.holdings.filter(
    ({ valuation }) => valuation.status === "unvalued",
  ).length;
  const valuedCount = source.snapshot.holdings.length - unvaluedCount;
  const meterSegments = 12;
  const filledSegments =
    source.snapshot.holdings.length === 0
      ? 0
      : Math.max(
          1,
          Math.round((valuedCount / source.snapshot.holdings.length) * meterSegments),
        );
  return (
    <>
      <div
        className="asset-source-card"
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
          <p className={`source-live-state ${source.sync.status}`}>
            <span />
            {providerCode(source)} / {source.sync.status === "expired" ? "STALE" : "LIVE"}
          </p>
        </header>
        <h2 className="asset-source-title">{source.label}</h2>
        <p className="asset-total" data-testid="asset-source-total">{showSensitiveInfo ? amount(source.snapshot.total.amount) : "••••••"} <span>{source.snapshot.total.currency}</span></p>
        {source.kind === "binance" ? (
          <BinanceCoverage coverage={source.snapshot.coverage} />
        ) : null}
        <div className="source-meter" aria-hidden="true">
          {Array.from({ length: meterSegments }, (_, index) => (
            <span key={index} className={index < filledSegments ? "is-filled" : ""} />
          ))}
        </div>
        <p className="source-meter-caption">
          <span>{String(source.snapshot.holdings.length).padStart(2, "0")} POSITIONS</span>
          <span className={unvaluedCount > 0 ? "is-incomplete" : undefined}>
            {unvaluedCount === 0 ? "VALUATION / COMPLETE" : `${unvaluedCount} UNVALUED`}
          </span>
        </p>
        <ol className="holding-top-list" data-testid="holding-top-list">
          {source.snapshot.holdings.map((holding) => (
            <li key={assetHoldingKey(holding)}>
              <span>{holding.name}</span>
              <strong>
                {holding.marketValue === null
                  ? `未估值（${holding.currency}）`
                  : `${showSensitiveInfo ? amount(holding.marketValue) : "••••••"} ${holding.currency}`}
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
            <table className="asset-table">
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
                {source.snapshot.holdings.map((holding) => (
                  <HoldingDetailRow
                    key={assetHoldingKey(holding)}
                    holding={holding}
                    showPlatformProfit={showPlatformProfit}
                    showSensitiveInfo={showSensitiveInfo}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
        {unvaluedCount > 0 ? (
          <p className="asset-sync-status">含 {unvaluedCount} 项未估值资产</p>
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
                      : `${showSensitiveInfo ? amount(snapshot.total.USD) : "••••••"} USD`}
                  </strong>
                  <span>{snapshot.complete ? "完整" : "不完整"}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
        <p className="asset-updated">最后更新：{source.snapshot.syncedAt.slice(0, 16).replace("T", " ")} UTC</p>
        {source.lifecycle === "disconnected" ? (
          <p className="asset-sync-status expired">已断开 · 历史数据保留</p>
        ) : (
          <p className={`asset-sync-status ${source.sync.status}`}>
            {source.sync.status === "expired" ? "过期数据" : "数据当前"}
            {" · 最后成功："}
            {source.sync.lastSuccessfulAt.slice(0, 16).replace("T", " ")} UTC
          </p>
        )}
        {source.sync.error ? (
          <p className="asset-sync-error" role="alert">
            {source.label} 同步失败：{source.sync.error}
          </p>
        ) : null}
      </div>
    </>
  );
}
