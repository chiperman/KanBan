"use client";

import { VibeLink } from "@/ui/vibe/vibe-button";
import { settlementOutcomeLabel } from "@/ui/formal-settlement-status";
import { decimalToFixed } from "@/domain/decimal";
import type { FormalDailySettlement, FormalSettlementExecution } from "@/server/ports";
import type { ReportingCurrency } from "@/domain/valuation";
import { formatShanghaiDateTime } from "@/ui/shanghai-date-time";
import { VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";

function formatAmount(value: string): string {
  const [integer, fraction] = decimalToFixed(value, 2).split(".");
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

function statusLabel(status: FormalDailySettlement["status"]): string {
  return status === "complete"
    ? "完整"
    : status === "missed"
      ? "错过窗口"
      : "不完整";
}

function anchorLabel(anchor: FormalDailySettlement["anchor"]): string {
  return anchor.kind === "securities-close"
    ? `${anchor.market} 常规盘 · 交易日 ${anchor.tradingDay}`
    : `上海日切 · ${anchor.tradingDay}`;
}

export function FormalDailySettlementSummary({
  settlements,
  execution = null,
  currency,
  showSensitiveInfo,
}: {
  settlements: FormalDailySettlement[];
  execution?: FormalSettlementExecution | null;
  currency: ReportingCurrency;
  showSensitiveInfo: boolean;
}) {
  const latest = settlements[0];
  const executionHint = (
    <div className="formal-daily-settlement-runtime">
      {execution?.outcome === "error" || execution?.outcome === "waiting" ? (
        <span className="formal-daily-settlement-note">最近一次执行：{settlementOutcomeLabel[execution.outcome]}</span>
      ) : null}
      <VibeLink href="/settings#automatic-daily-settlement" variant="text">查看自动日结状态</VibeLink>
    </div>
  );
  if (!latest) {
    return (
      <section
        className="formal-daily-settlement"
        data-testid="formal-daily-settlement"
        data-vibe-module="formal-daily-settlement"
      >
        <div className="formal-daily-settlement-head">
          <p className="card-label">正式日结</p>
          <VibeStatusTag tone="muted">暂无记录</VibeStatusTag>
        </div>
        <p className="trend-empty">
          尚无正式日结记录，实时资产和近7日趋势仍可查看
        </p>
        <p className="formal-daily-settlement-note">正式日结独立记录收盘窗口资产，证券采用官方常规盘收盘价。</p>
        {executionHint}
      </section>
    );
  }

  const value = latest.total[currency];
  const hasCrypto = latest.holdings.some(
    (holding) => holding.assetClass === "crypto",
  );
  return (
    <section
      className="formal-daily-settlement"
      data-testid="formal-daily-settlement"
      data-vibe-module="formal-daily-settlement"
    >
      <div className="formal-daily-settlement-head">
        <p className="card-label">正式日结</p>
        <VibeStatusTag
          tone={latest.status === "complete"
            ? "success"
            : latest.status === "missed"
              ? "error"
              : "warning"}
        >
          {statusLabel(latest.status)}
        </VibeStatusTag>
      </div>
      <p className="formal-daily-settlement-amount">
        {value === null
          ? "未完整折算"
          : <span className="formal-daily-settlement-value">{showSensitiveInfo
            ? formatAmount(value)
            : "••••••"}</span>}{" "}
        {value === null ? "" : currency}
      </p>
      <p className="formal-daily-settlement-provenance">
        {anchorLabel(latest.anchor)}
        {latest.capturedAt === null
          ? " · 未采集"
          : ` · 采集于 ${formatShanghaiDateTime(latest.capturedAt)}`}
      </p>
      <p className="formal-daily-settlement-note">
        证券按官方日 K 常规盘收盘记录
        {hasCrypto ? "；加密资产按同一采集窗口市价记录。" : "。"}
      </p>
      {latest.status !== "complete" ? (
        <p className="formal-daily-settlement-diagnostic">
          {latest.status === "missed" ? "采集窗口内未形成日结，未使用之后的实时数据补写。" : "估值或来源证据不完整，已知金额不代表完整资产总额。"}
        </p>
      ) : null}
      {executionHint}
    </section>
  );
}
