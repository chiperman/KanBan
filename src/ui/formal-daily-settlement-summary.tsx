"use client";

import { decimalToFixed } from "@/domain/decimal";
import type { FormalDailySettlement } from "@/server/ports";
import type { ReportingCurrency } from "@/domain/valuation";
import { formatShanghaiDateTime } from "@/ui/shanghai-date-time";
import { VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";

function formatAmount(value: string): string {
  const [integer, fraction] = decimalToFixed(value, 2).split(".");
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

function statusLabel(status: FormalDailySettlement["status"]): string {
  return status === "complete"
    ? "已确认"
    : status === "missed"
      ? "已错过"
      : "不完整";
}

function anchorLabel(anchor: FormalDailySettlement["anchor"]): string {
  return anchor.kind === "securities-close"
    ? `${anchor.market} 常规盘 · 交易日 ${anchor.tradingDay}`
    : `上海日切 · ${anchor.tradingDay}`;
}

export function FormalDailySettlementSummary({
  settlements,
  currency,
  showSensitiveInfo,
}: {
  settlements: FormalDailySettlement[];
  currency: ReportingCurrency;
  showSensitiveInfo: boolean;
}) {
  const latest = settlements[0];
  if (!latest) {
    return (
      <section
        className="formal-daily-settlement"
        data-testid="formal-daily-settlement"
        data-vibe-module="formal-daily-settlement"
      >
        <div className="formal-daily-settlement-head">
          <p className="card-label">正式日结</p>
          <VibeStatusTag tone="muted">等待首次日结</VibeStatusTag>
        </div>
        <p className="trend-empty">
          等待日结。
        </p>
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
          : showSensitiveInfo
            ? formatAmount(value)
            : "••••••"}{" "}
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
      {latest.diagnostic ? (
        <p className="formal-daily-settlement-diagnostic">{latest.diagnostic}</p>
      ) : null}
    </section>
  );
}
