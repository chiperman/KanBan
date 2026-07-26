"use client";

import { useMemo, useRef, useState } from "react";

import type {
  AssetHolding,
  AssetSnapshot,
  AssetSourceSyncState,
  DailyAssetSnapshot,
} from "@/server/ports";

export interface AssetSourceView {
  id: string;
  kind: string;
  label: string;
  accountId: string;
  snapshot: AssetSnapshot;
  sync: AssetSourceSyncState;
}

function amount(value: string): string {
  const [integer, fraction] = value.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

function compareDecimal(left: string | null, right: string | null): number {
  if (left === null) return right === null ? 0 : -1;
  if (right === null) return 1;
  const parts = (value: string) => {
    const negative = value.startsWith("-");
    const unsigned = value.replace(/^[+-]/, "");
    const [integer = "0", fraction = ""] = unsigned.split(".");
    return { negative, integer: integer.replace(/^0+(?=\d)/, ""), fraction };
  };
  const a = parts(left);
  const b = parts(right);
  if (a.negative !== b.negative) return a.negative ? -1 : 1;
  const direction = a.negative ? -1 : 1;
  if (a.integer.length !== b.integer.length) {
    return direction * (a.integer.length - b.integer.length);
  }
  const integerOrder = a.integer.localeCompare(b.integer);
  if (integerOrder !== 0) return direction * integerOrder;
  const width = Math.max(a.fraction.length, b.fraction.length);
  return (
    direction *
    a.fraction.padEnd(width, "0").localeCompare(b.fraction.padEnd(width, "0"))
  );
}

function dayLabel(day: string): string {
  return `${day.slice(5, 7)}月${day.slice(8, 10)}日`;
}

function HoldingRow({
  holding,
  showPlatformProfit,
}: {
  holding: AssetHolding;
  showPlatformProfit: boolean;
}) {
  const valuationDetail = holding.valuation.status === "valued"
    ? `${holding.valuation.priceSource} · ${holding.valuation.pricedAt.slice(0, 16).replace("T", " ")} UTC`
    : holding.valuation.reason;
  return (
    <tr>
      <td>
        <strong>{holding.name}</strong>
        <span className="holding-symbol">{holding.symbol}</span>
        <span className="holding-price-source">
          {valuationDetail}
        </span>
      </td>
      <td>{amount(holding.quantity)}</td>
      <td>
        {holding.currentPrice
          ? `${amount(holding.currentPrice.amount)} ${holding.currentPrice.currency}`
          : holding.valuation.status === "unvalued"
            ? "未估值"
            : "—"}
      </td>
      <td>{holding.marketValue === null ? "未估值" : `${amount(holding.marketValue)} ${holding.currency}`}</td>
      <td>{holding.costPrice === null ? "—" : amount(holding.costPrice)}</td>
      {showPlatformProfit ? (
        <td>{holding.platformProfit === null ? "—" : amount(holding.platformProfit)}</td>
      ) : null}
      <td>{holding.changePercent === null ? "—" : `${holding.changePercent}%`}</td>
    </tr>
  );
}

export function AssetSourceCard({
  source,
  history,
}: {
  source: AssetSourceView;
  history: DailyAssetSnapshot[];
}) {
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState("market-value");
  const scrollPosition = useRef(0);
  const showPlatformProfit = source.snapshot.holdings.some(
    (holding) => holding.platformProfit !== null,
  );
  const sourceHistory = history.flatMap((snapshot) => {
    const item = snapshot.sources.find(({ sourceId }) => sourceId === source.id);
    return item ? [{ day: snapshot.day, ...item }] : [];
  });
  const holdings = useMemo(() => {
    return [...source.snapshot.holdings].sort((left, right) => {
      if (sort === "name") return left.name.localeCompare(right.name, "en");
      if (sort === "change") return compareDecimal(right.changePercent, left.changePercent);
      return compareDecimal(
        right.sourceMarketValue?.amount ?? null,
        left.sourceMarketValue?.amount ?? null,
      );
    });
  }, [sort, source.snapshot.holdings]);

  function showDetails() {
    scrollPosition.current = window.scrollY;
    setOpen(true);
  }

  function closeDetails() {
    setOpen(false);
    requestAnimationFrame(() => window.scrollTo(0, scrollPosition.current));
  }

  return (
    <>
      <div
        data-testid={source.kind === "longbridge" ? "longbridge-card" : `asset-source-card-${source.id}`}
      >
        <p className="card-label">{source.kind === "longbridge" ? "长桥资产" : "资产来源"}</p>
        {source.kind === "longbridge" ? null : <h2 className="asset-source-title">{source.label}</h2>}
        <p className="asset-total" data-testid="asset-source-total">{amount(source.snapshot.total.amount)} <span>{source.snapshot.total.currency}</span></p>
        <ol className="holding-top-list">
          {source.snapshot.holdings.slice(0, 5).map((holding) => (
            <li key={holding.symbol}>
              <span>{holding.name}</span>
              <strong>
                {holding.marketValue === null
                  ? "未估值"
                  : `${amount(holding.marketValue)} ${holding.currency}`}
              </strong>
            </li>
          ))}
        </ol>
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
                      : `${amount(snapshot.total.USD)} USD`}
                  </strong>
                  <span>{snapshot.complete ? "完整" : "不完整"}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
        <p className="asset-updated">最后更新：{source.snapshot.syncedAt.slice(0, 16).replace("T", " ")} UTC</p>
        <p className={`asset-sync-status ${source.sync.status}`}>
          {source.sync.status === "expired" ? "过期数据" : "数据当前"}
          {" · 最后成功："}
          {source.sync.lastSuccessfulAt.slice(0, 16).replace("T", " ")} UTC
        </p>
        {source.sync.error ? (
          <p className="asset-sync-error" role="alert">
            {source.label} 同步失败：{source.sync.error}
          </p>
        ) : null}
        <button type="button" className="secondary-button" onClick={showDetails}>查看全部持仓</button>
      </div>
      {open ? (
        <div
          className="asset-detail-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={source.kind === "longbridge" ? "长桥全部持仓" : `${source.label} 全部持仓`}
        >
          <div className="asset-detail-dialog">
            <div className="asset-detail-header">
              <div><p className="card-label">全部持仓</p><h2>{source.label}</h2></div>
              <button type="button" className="login-cancel" onClick={closeDetails}>关闭详情</button>
            </div>
            <label className="asset-sort">持仓排序
              <select aria-label="持仓排序" value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="market-value">市值</option>
                <option value="change">涨跌</option>
                <option value="name">名称</option>
              </select>
            </label>
            <div className="asset-table-wrap">
              <table className="asset-table">
                <thead><tr><th>名称</th><th>数量</th><th>当前价格</th><th>原始市值</th><th>成本</th>{showPlatformProfit ? <th>平台盈亏（来源提供）</th> : null}<th>涨跌</th></tr></thead>
                <tbody>{holdings.map((holding) => <HoldingRow key={holding.symbol} holding={holding} showPlatformProfit={showPlatformProfit} />)}</tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
