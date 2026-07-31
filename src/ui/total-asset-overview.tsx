"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  decimalCompare,
  decimalSubtract,
  decimalToFixed,
} from "@/domain/decimal";
import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import {
  buildTotalValuation,
  type DistributionDimension,
  type ReportingCurrency,
  type ValuationSource,
} from "@/domain/valuation";
import type { DailyAssetSnapshot } from "@/server/ports";
import {
  VibeMetric,
  VibeSegmentedBar,
  VibeStatusTag,
} from "@/ui/vibe/vibe-data-instrument";
import {
  VibeSelect,
  type VibeSelectOption,
} from "@/ui/vibe/vibe-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import {
  formatShanghaiDateTime,
  formatShanghaiDayLabel,
} from "@/ui/shanghai-date-time";

const CURRENCY_OPTIONS: readonly VibeSelectOption<ReportingCurrency>[] = [
  { value: "USD", label: "USD" },
  { value: "CNY", label: "CNY" },
  { value: "HKD", label: "HKD" },
];

const DIMENSION_OPTIONS: readonly VibeSelectOption<DistributionDimension>[] = [
  { value: "class", label: "资产类别" },
  { value: "source", label: "资产来源" },
  { value: "currency", label: "原始币种" },
];

function sourceGroupTitle(source: ValuationSource): string {
  return assetSourceDisplayName(source);
}

function amount(value: string): string {
  const [integer, fraction] = decimalToFixed(value, 2).split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}.${fraction}`;
}

function signedAmount(value: string): string {
  return `${decimalCompare(value, "0") >= 0 ? "+" : ""}${amount(value)}`;
}

export function TotalAssetOverview({
  sources,
  currency,
  onCurrencyChange,
  history,
  currentDay,
  showSensitiveInfo,
}: {
  sources: ValuationSource[];
  currency: ReportingCurrency;
  onCurrencyChange(value: ReportingCurrency): void;
  history: DailyAssetSnapshot[];
  currentDay: string;
  showSensitiveInfo: boolean;
}) {
  const [dimension, setDimension] = useState<DistributionDimension>("class");

  useEffect(() => {
    const savedDimension = window.localStorage.getItem("distribution-dimension");
    if (
      savedDimension === "class" ||
      savedDimension === "source" ||
      savedDimension === "currency"
    ) {
      setDimension(savedDimension);
    }
  }, []);

  const valuation = useMemo(
    () => buildTotalValuation(sources, currency, dimension),
    [currency, dimension, sources],
  );
  const todayBaseline = history.find((snapshot) => snapshot.day === currentDay);
  const baselineAmount = todayBaseline?.total[currency] ?? null;
  const todayChange =
    valuation.amount === null || baselineAmount === null
      ? null
      : decimalSubtract(valuation.amount, baselineAmount);
  const changeIncomplete =
    valuation.incomplete ||
    valuation.expiredCount > 0 ||
    todayBaseline?.complete === false;
  const todayChangeStatus =
    todayBaseline?.complete === false
      ? "今日变动：基准不完整"
      : valuation.incomplete
        ? "今日变动：当前估值不完整"
        : valuation.expiredCount > 0
          ? "今日变动：包含过期来源"
          : null;
  const allocationGroups = valuation.groups.filter(
    (group) => group.amount !== null && decimalCompare(group.amount, "0") > 0,
  );
  const sourceTitleById = new Map(
    sources.map((source) => [source.id, sourceGroupTitle(source)]),
  );
  const valuationStatusText = valuation.incomplete
    ? valuation.unvaluedCount > 0
      ? `当前估值：不完整 · ${valuation.unvaluedCount} 项未估值`
      : "当前估值：不完整"
    : "当前估值：完整";
  const valuationStatus = [
    valuationStatusText,
    valuation.coverageIssues.length > 0
      ? `来源覆盖：不完整 · ${valuation.coverageIssues.length} 个来源`
      : null,
    valuation.aggregateOnlySourceCount > 0
      ? `产品明细：部分仅汇总 · ${valuation.aggregateOnlySourceCount} 个来源`
      : null,
    valuation.expiredCount > 0
      ? `包含 ${valuation.expiredCount} 个过期来源`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const valuationStatusTone =
    valuation.incomplete || valuation.expiredCount > 0
      ? "error"
      : valuation.coverageIssues.length > 0
        ? "warning"
        : valuation.aggregateOnlySourceCount > 0
          ? "warning"
        : "success";

  function changeCurrency(value: ReportingCurrency) {
    onCurrencyChange(value);
  }

  function changeDimension(value: DistributionDimension) {
    setDimension(value);
    window.localStorage.setItem("distribution-dimension", value);
  }

  return (
    <section
      className="total-overview vibe-data-module"
      data-testid="total-asset-overview"
      data-vibe-module="asset-overview"
    >
      <div className="total-overview-head">
        <div>
          <p className="card-label">总资产概览</p>
          <VibeMetric
            className="total-overview-amount"
            data-testid="total-asset-amount"
            unit={valuation.currency}
            value={valuation.amount === null
              ? "无法折算"
              : showSensitiveInfo
                ? amount(valuation.amount)
                : "••••••"}
          />
          <VibeStatusTag
            className={`total-status${valuation.incomplete ? " incomplete" : ""}${valuation.expiredCount > 0 ? " expired" : ""}`}
            tone={valuationStatusTone}
          >
            {valuationStatus}
          </VibeStatusTag>
          <div className="allocation-instrument" aria-label="分配比例仪表">
            <div className="allocation-instrument-head">
              <span>ALLOCATION / {dimension.toUpperCase()}</span>
              <span>{String(allocationGroups.length).padStart(2, "0")} GROUPS</span>
            </div>
            <VibeSegmentedBar
              ariaLabel={`${dimension} 维度资产分配，共 ${allocationGroups.length} 组`}
              segments={allocationGroups.map((group) => ({
                key: group.key,
                value: Number(group.amount),
              }))}
            />
          </div>
        </div>
        <div className="valuation-controls">
          <VibeSelect
            fieldId="reporting-currency"
            label="计价货币"
            value={currency}
            options={CURRENCY_OPTIONS}
            variant="compact"
            onValueChange={changeCurrency}
          />
          <VibeSelect
            fieldId="distribution-dimension"
            label="分布维度"
            value={dimension}
            options={DIMENSION_OPTIONS}
            variant="wide"
            onValueChange={changeDimension}
          />
        </div>
      </div>
      {valuation.conversion ? (
        <p className="conversion-observation">
          汇率观察：{valuation.conversion.baseCurrency}/{valuation.conversion.quoteCurrency}{" "}
          {decimalToFixed(valuation.conversion.rate, 4)} · {valuation.conversion.source} · {formatShanghaiDateTime(valuation.conversion.observedAt)}
        </p>
      ) : null}
      {valuation.coverageIssues.length > 0 ? (
        <VibeNotice
          className="valuation-reconciliation-notice valuation-coverage-notice"
          data-testid="valuation-coverage-notice"
          role="status"
          tone="info"
        >
          <p>
            {valuation.coverageIssues.map((issue) => issue.sourceLabel).join("、")}
            ：产品覆盖不完整，当前总资产按已接入及平台汇总范围计算。
          </p>
        </VibeNotice>
      ) : null}
      {valuation.reconciliationIssues.length > 0 ? (
        <VibeNotice
          className="valuation-reconciliation-notice"
          data-testid="valuation-reconciliation-notice"
          role="status"
          tone="info"
        >
          {valuation.reconciliationIssues.map((issue) => {
            if (issue.kind === "quote-unavailable") {
              return (
                <p key={issue.sourceId}>
                  {`${issue.sourceLabel}：${issue.quoteUnavailableCount} 项期权行情未接入，当前持仓明细无法与账户总额精确对账。总资产以账户总额为准。`}
                </p>
              );
            }
            const prefix = issue.unvaluedCount > 0
              ? `${issue.unvaluedCount} 项持仓未估值，`
              : "";
            return (
              <p key={issue.sourceId}>
                {issue.sourceLabel}：{showSensitiveInfo && issue.amount !== null
                  ? `${prefix}持仓明细比账户总额高 ${amount(decimalSubtract("0", issue.amount))} ${valuation.currency}。`
                  : `${prefix}持仓明细与账户总额暂未对齐。`}
                总资产以账户总额为准。
              </p>
            );
          })}
        </VibeNotice>
      ) : null}
      <section className="today-asset-change" data-testid="today-asset-change">
        <p className="card-label">今日资产变动</p>
        {todayChange === null ? (
          <p className="trend-empty">
            {todayBaseline
              ? "当前值或今日基准无法可靠折算"
              : "首次成功同步后建立今日基准"}
          </p>
        ) : (
          <p className="today-change-amount">
            {showSensitiveInfo ? signedAmount(todayChange) : "••••••"}
            {changeIncomplete && todayChangeStatus ? (
              <span className="today-change-note"> · {todayChangeStatus}</span>
            ) : null}
          </p>
        )}
      </section>
      <div className="distribution-list" aria-label="资产分布">
        {valuation.groups.map((group, index) => (
          <div key={group.key} className="distribution-item vibe-data-row">
            <span className="distribution-name">
              <span className="distribution-index">
                {String(index + 1).padStart(2, "0")}
              </span>
              {dimension === "source"
                ? (sourceTitleById.get(group.key) ?? group.label)
                : group.label}
            </span>
            <strong>
              {group.amount === null
                ? "未折算"
                : showSensitiveInfo
                  ? amount(group.amount)
                  : "••••••"}
            </strong>
          </div>
        ))}
      </div>
      <section className="asset-trend" data-testid="total-asset-trend">
        <p className="card-label">总资产趋势</p>
        {history.length === 0 ? (
          <p className="trend-empty">首次成功同步后开始记录</p>
        ) : (
          <ol className="trend-list">
            {history.map((snapshot) => (
              <li key={snapshot.day}>
                <time dateTime={snapshot.day}>{formatShanghaiDayLabel(snapshot.day)}</time>
                <strong>
                  {snapshot.total[currency] == null
                    ? "未估值"
                    : showSensitiveInfo
                      ? amount(snapshot.total[currency])
                      : "••••••"}
                </strong>
                <span>
                  {snapshot.complete && snapshot.total[currency] != null
                    ? "历史快照：完整"
                    : "历史快照：不完整"}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}
