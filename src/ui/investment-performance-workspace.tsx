"use client";

import {
  useMemo,
  useState,
  type FormEvent,
} from "react";

import {
  analyzeInvestmentPerformance,
  type PortfolioObservation,
} from "@/domain/investment-performance";
import {
  decimalCompare,
  decimalMultiply,
  decimalToFixed,
} from "@/domain/decimal";
import type { ReportingCurrency } from "@/domain/valuation";
import type {
  DailyAssetTrendObservation,
  InvestmentCashflow,
  InvestmentCashflowCurrency,
  InvestmentCashflowInput,
  InvestmentCashflowKind,
} from "@/server/ports";
import { AssetTrendChart } from "@/ui/asset-trend-chart";
import { formatShanghaiDateTime, formatShanghaiDayLabel } from "@/ui/shanghai-date-time";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeMetric, VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";
import { VibeDialog } from "@/ui/vibe/vibe-dialog";
import {
  VibeField,
  VibeSelect,
  VibeTextAreaField,
  type VibeSelectOption,
} from "@/ui/vibe/vibe-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import {
  useWorkbenchDisplayPreferences,
} from "@/ui/workbench-display-preferences";
import { WorkbenchPageHeader } from "@/ui/workbench-page-header";

type IntervalPreset =
  | "month-to-date"
  | "1m"
  | "6m"
  | "year-to-date"
  | "1y"
  | "all";

type CurrentTotals = Record<ReportingCurrency, PortfolioObservation | null>;

type CashflowDraft = {
  amount: string;
  currency: InvestmentCashflowCurrency;
  kind: InvestmentCashflowKind;
  note: string;
  occurredAt: string;
};

const CURRENCY_OPTIONS: readonly VibeSelectOption<ReportingCurrency>[] = [
  { value: "USD", label: "USD" },
  { value: "CNY", label: "CNY" },
  { value: "HKD", label: "HKD" },
];

const INTERVAL_OPTIONS: readonly VibeSelectOption<IntervalPreset>[] = [
  { value: "month-to-date", label: "本月" },
  { value: "1m", label: "近 1 月" },
  { value: "6m", label: "近 6 月" },
  { value: "year-to-date", label: "本年" },
  { value: "1y", label: "近 1 年" },
  { value: "all", label: "全部" },
];

const CASHFLOW_KIND_OPTIONS: readonly VibeSelectOption<InvestmentCashflowKind>[] = [
  { value: "initial-investment", label: "初始投入" },
  { value: "external-deposit", label: "外部入金" },
  { value: "external-withdrawal", label: "外部出金" },
];

const CASHFLOW_CURRENCY_OPTIONS: readonly VibeSelectOption<InvestmentCashflowCurrency>[] =
  CURRENCY_OPTIONS;

function dayAtOffset(day: string, offset: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, date + offset));
  return value.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): string[] {
  if (start > end) return [];
  const days: string[] = [];
  for (let day = start; day <= end; day = dayAtOffset(day, 1)) {
    days.push(day);
  }
  return days;
}

function dayAtMonthOffset(day: string, offset: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const targetMonth = new Date(Date.UTC(year, month - 1 + offset, 1));
  const targetYear = targetMonth.getUTCFullYear();
  const targetMonthIndex = targetMonth.getUTCMonth();
  const lastDate = new Date(
    Date.UTC(targetYear, targetMonthIndex + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(targetYear, targetMonthIndex, Math.min(date, lastDate)),
  ).toISOString().slice(0, 10);
}

function rangeDays(
  preset: IntervalPreset,
  currentDay: string,
  firstTrendDay: string | undefined,
): string[] {
  if (preset === "all") {
    return firstTrendDay === undefined ? [] : daysBetween(firstTrendDay, currentDay);
  }
  const start = preset === "month-to-date"
    ? `${currentDay.slice(0, 7)}-01`
    : preset === "year-to-date"
      ? `${currentDay.slice(0, 4)}-01-01`
      : dayAtMonthOffset(
          currentDay,
          preset === "1m" ? -1 : preset === "6m" ? -6 : -12,
        );
  return daysBetween(start, currentDay);
}

function amount(value: string): string {
  const [integer, fraction] = decimalToFixed(value, 2).split(".");
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

function signedAmount(value: string): string {
  return `${decimalCompare(value, "0") > 0 ? "+" : ""}${amount(value)}`;
}

function cashflowKindLabel(kind: InvestmentCashflowKind): string {
  return kind === "initial-investment"
    ? "初始投入"
    : kind === "external-deposit"
      ? "外部入金"
      : "外部出金";
}

function cashflowSign(kind: InvestmentCashflowKind): "+" | "-" {
  return kind === "external-withdrawal" ? "-" : "+";
}

function toInputDateTime(value: string): string {
  return value.slice(0, 16);
}

function toIso(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : date.toISOString();
}

function newDraft(occurredAt: string): CashflowDraft {
  return {
    amount: "",
    currency: "USD",
    kind: "external-deposit",
    note: "",
    occurredAt: toInputDateTime(occurredAt),
  };
}

function cashflowDraft(cashflow: InvestmentCashflow): CashflowDraft {
  return {
    amount: cashflow.amount,
    currency: cashflow.currency,
    kind: cashflow.kind,
    note: cashflow.note ?? "",
    occurredAt: toInputDateTime(cashflow.occurredAt),
  };
}

function sortCashflows(cashflows: InvestmentCashflow[]): InvestmentCashflow[] {
  return [...cashflows].toSorted(
    (left, right) =>
      right.occurredAt.localeCompare(left.occurredAt) ||
      right.createdAt.localeCompare(left.createdAt) ||
      right.id.localeCompare(left.id),
  );
}

function observationStatus(observation: DailyAssetTrendObservation): "complete" | "incomplete" | "expired" {
  return observation.status ?? (observation.complete ? "complete" : "incomplete");
}

function completeObservation(
  observation: DailyAssetTrendObservation,
  currency: ReportingCurrency,
): PortfolioObservation | null {
  const amount = observation.total[currency] ?? null;
  return observationStatus(observation) === "complete" && amount !== null
    ? {
        amount,
        complete: true,
        observedAt: observation.capturedAt,
      }
    : null;
}

function reasonForCurrent(
  current: PortfolioObservation | null,
  cumulativeNetInvestment: string | null,
): string | null {
  if (current === null) return "当前来源总额不完整、过期或无法折算，不能计算组合投资盈亏。";
  if (cumulativeNetInvestment === null) {
    return "至少一笔资金缺少该计价货币的长桥参考汇率证据，不能计算组合投资盈亏。";
  }
  return null;
}

function reasonForInterval(input: {
  end: PortfolioObservation | null;
  start: PortfolioObservation | null;
  netExternalCashflow: string | null;
  days: string[];
}): string | null {
  if (input.days.length === 0) return "请选择有效的起止日期。";
  if (input.start === null || input.end === null) {
    return "所选区间缺少两个完整资产观测，不能把资产变化或收益补造出来。";
  }
  if (input.netExternalCashflow === null) {
    return "区间内至少一笔资金缺少该计价货币的长桥参考汇率证据。";
  }
  return null;
}

async function cashflowRequest<T>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null) as {
    error?: string;
  } | null;
  if (!response.ok) throw new Error(result?.error ?? "资金记录保存失败，请重试");
  return result as T;
}

function MetricValue({
  amount: value,
  currency,
  hidden,
  signed = false,
}: {
  amount: string | null;
  currency: ReportingCurrency;
  hidden: boolean;
  signed?: boolean;
}) {
  if (hidden) return <span className="investment-performance__private">••••••</span>;
  if (value === null) return <span className="investment-performance__unavailable">数据不足</span>;
  return <VibeMetric unit={currency} value={signed ? signedAmount(value) : amount(value)} />;
}

function CashflowEditor({
  cashflows,
  draft,
  editing,
  onClose,
  onSaved,
}: {
  cashflows: InvestmentCashflow[];
  draft: CashflowDraft;
  editing: InvestmentCashflow | null;
  onClose(): void;
  onSaved(cashflow: InvestmentCashflow): void;
}) {
  const [current, setCurrent] = useState(draft);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const hasOtherInitial = cashflows.some(
    (cashflow) =>
      cashflow.kind === "initial-investment" && cashflow.id !== editing?.id,
  );
  const kindOptions = CASHFLOW_KIND_OPTIONS.filter(
    (option) => option.value !== "initial-investment" || !hasOtherInitial,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const occurredAt = toIso(current.occurredAt);
    if (occurredAt.length === 0) {
      setError("资金发生时间无效");
      return;
    }
    setSaving(true);
    try {
      const input: InvestmentCashflowInput = {
        kind: current.kind,
        occurredAt,
        amount: current.amount,
        currency: current.currency,
        note: current.note.trim() || null,
      };
      const result = editing === null
        ? await cashflowRequest<{ cashflow: InvestmentCashflow }>(
          "/api/investment-cashflows",
          "POST",
          input,
        )
        : await cashflowRequest<{ cashflow: InvestmentCashflow }>(
          `/api/investment-cashflows/${encodeURIComponent(editing.id)}`,
          "PATCH",
          input,
        );
      onSaved(result.cashflow);
      onClose();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "资金记录保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <VibeDialog
      actions={
        <>
          <VibeButton onClick={onClose} type="button" variant="text">
            取消
          </VibeButton>
          <VibeButton disabled={saving} type="submit" variant="primary">
            {saving ? "保存中…" : "保存资金记录"}
          </VibeButton>
        </>
      }
      description="只记录资金跨越投资范围的事实；不会创建交易流水、平台间转账或资产观测。"
      eyebrow="INVESTMENT / CASHFLOW"
      onClose={onClose}
      onSubmit={submit}
      title={editing === null ? "新增资金记录" : "编辑资金记录"}
      titleId="cashflow-editor-title"
    >
      <div className="investment-performance__editor-fields">
        <VibeSelect
          fieldId="cashflow-kind"
          label="资金类型"
          onValueChange={(kind) => setCurrent((value) => ({ ...value, kind }))}
          options={kindOptions}
          value={current.kind}
        />
        <VibeField
          fieldId="cashflow-occurred-at"
          label="发生时间"
          max={toInputDateTime(new Date().toISOString())}
          onChange={(event) =>
            setCurrent((value) => ({ ...value, occurredAt: event.target.value }))}
          required
          type="datetime-local"
          value={current.occurredAt}
        />
        <VibeField
          fieldId="cashflow-amount"
          inputMode="decimal"
          label="金额"
          onChange={(event) =>
            setCurrent((value) => ({ ...value, amount: event.target.value }))}
          placeholder="例如 10000"
          required
          value={current.amount}
        />
        <VibeSelect
          fieldId="cashflow-currency"
          label="原始币种"
          onValueChange={(currency) =>
            setCurrent((value) => ({ ...value, currency }))}
          options={CASHFLOW_CURRENCY_OPTIONS}
          value={current.currency}
        />
        <VibeTextAreaField
          fieldId="cashflow-note"
          label="备注"
          maxLength={500}
          onChange={(event) =>
            setCurrent((value) => ({ ...value, note: event.target.value }))}
          placeholder="可选，仅用于解释这一笔资金"
          value={current.note}
        />
      </div>
      {error ? <VibeNotice tone="error">{error}</VibeNotice> : null}
    </VibeDialog>
  );
}

function CashflowDeleteDialog({
  cashflow,
  onClose,
  onDeleted,
}: {
  cashflow: InvestmentCashflow;
  onClose(): void;
  onDeleted(id: string): void;
}) {
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    setError("");
    setDeleting(true);
    try {
      await cashflowRequest(
        `/api/investment-cashflows/${encodeURIComponent(cashflow.id)}`,
        "DELETE",
        { confirmation: "DELETE_CASHFLOW" },
      );
      onDeleted(cashflow.id);
      onClose();
    } catch (deletionError) {
      setError(deletionError instanceof Error ? deletionError.message : "资金记录删除失败");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <VibeDialog
      actions={
        <>
          <VibeButton onClick={onClose} type="button" variant="text">
            保留记录
          </VibeButton>
          <VibeButton disabled={deleting} onClick={remove} type="button" variant="primary">
            {deleting ? "删除中…" : "永久删除这条记录"}
          </VibeButton>
        </>
      }
      description={`将永久删除 ${cashflowKindLabel(cashflow.kind)}记录。此操作不会改写任何资产观测、来源快照或收益曲线。`}
      eyebrow="DANGER / CASHFLOW"
      onClose={onClose}
      title="永久删除资金记录"
      titleId="cashflow-delete-title"
    >
      {error ? <VibeNotice tone="error">{error}</VibeNotice> : null}
    </VibeDialog>
  );
}

export function InvestmentPerformanceWorkspace({
  cashflows: initialCashflows,
  currentDay,
  currentObservedAt,
  currentTotals,
  trendObservations,
}: {
  cashflows: InvestmentCashflow[];
  currentDay: string;
  currentObservedAt: string;
  currentTotals: CurrentTotals;
  trendObservations: DailyAssetTrendObservation[];
}) {
  const [cashflows, setCashflows] = useState(() => sortCashflows(initialCashflows));
  const {
    currency,
    setCurrency,
    showSensitiveInfo,
  } = useWorkbenchDisplayPreferences();
  const [preset, setPreset] = useState<IntervalPreset>("month-to-date");
  const [editing, setEditing] = useState<InvestmentCashflow | null | undefined>(
    undefined,
  );
  const [deleting, setDeleting] = useState<InvestmentCashflow | null>(null);

  const trend = useMemo(() => {
    const firstTrendDay = trendObservations
      .map((observation) => observation.day)
      .toSorted()[0];
    const days = rangeDays(
      preset,
      currentDay,
      firstTrendDay,
    );
    const byDay = new Map(trendObservations.map((observation) => [
      observation.day,
      observation,
    ]));
    const points = days.map((day) => {
      const observation = byDay.get(day);
      if (!observation) {
        return {
          amount: null,
          day,
          observed: false,
          status: "incomplete" as const,
        };
      }
      return {
        amount: observation.total[currency] ?? null,
        day,
        observed: true,
        status: observationStatus(observation),
      };
    });
    const complete = days.flatMap((day) => {
      const observation = byDay.get(day);
      if (!observation) return [];
      const value = completeObservation(observation, currency);
      return value === null ? [] : [{ day, value }];
    });
    return {
      days,
      end: complete.at(-1)?.value ?? null,
      endDay: complete.at(-1)?.day ?? null,
      incompleteCount: points.filter(
        (point) => point.observed && point.status !== "complete",
      ).length,
      missingCount: points.filter((point) => !point.observed).length,
      points,
      start: complete[0]?.value ?? null,
      startDay: complete[0]?.day ?? null,
      unavailableCount: points.filter(
        (point) => point.observed && point.amount === null,
      ).length,
    };
  }, [
    currency,
    currentDay,
    preset,
    trendObservations,
  ]);

  const current = currentTotals[currency];
  const analysis = useMemo(
    () =>
      analyzeInvestmentPerformance({
        asOf: currentObservedAt,
        cashflows,
        currency,
        currentTotal: current,
        interval: trend.start && trend.end
          ? { start: trend.start, end: trend.end }
          : null,
      }),
    [cashflows, currency, current, currentObservedAt, trend.end, trend.start],
  );
  const currentReason = reasonForCurrent(
    current,
    analysis.current.cumulativeNetInvestment,
  );
  const intervalReason = reasonForInterval({
    days: trend.days,
    end: trend.end,
    netExternalCashflow: analysis.interval.netExternalCashflow,
    start: trend.start,
  });

  function upsertCashflow(cashflow: InvestmentCashflow) {
    setCashflows((existing) =>
      sortCashflows([
        ...existing.filter((item) => item.id !== cashflow.id),
        cashflow,
      ]));
  }

  return (
    <section
      className="investment-performance"
      data-testid="investment-performance-workspace"
    >
      <WorkbenchPageHeader
        actions={
          <>
          <VibeSelect
            fieldId="performance-currency"
            label="计价货币"
            onValueChange={(value) => setCurrency(value)}
            options={CURRENCY_OPTIONS}
            value={currency}
            variant="wide"
          />
          <VibeButton onClick={() => setEditing(null)} type="button" variant="primary">
            新增资金记录
          </VibeButton>
          </>
        }
        description="将资金进出与资产变化分开阅读。账本只记录本金事实，不会伪造交易、换仓或历史净值。"
        eyebrow="PORTFOLIO / PERFORMANCE"
        title="收益分析"
      />

      <section className="investment-performance__current" aria-label="当前组合结论">
        <article data-testid="performance-current-total">
          <p className="card-label">CURRENT / TOTAL</p>
          <h2>当前总资产</h2>
          <MetricValue amount={current?.amount ?? null} currency={currency} hidden={showSensitiveInfo === false} />
        </article>
        <article data-testid="performance-net-investment">
          <p className="card-label">PRINCIPAL / NET</p>
          <h2>累计净投入</h2>
          <MetricValue
            amount={analysis.current.cumulativeNetInvestment}
            currency={currency}
            hidden={showSensitiveInfo === false}
            signed
          />
          <p>初始投入 + 外部入金 − 外部出金。</p>
        </article>
        <article data-testid="performance-current-profit">
          <p className="card-label">PERFORMANCE / CURRENT</p>
          <h2>组合投资盈亏</h2>
          <MetricValue
            amount={analysis.current.investmentProfit}
            currency={currency}
            hidden={showSensitiveInfo === false}
            signed
          />
          <p>当前完整总资产 − 累计净投入。</p>
        </article>
      </section>
      {currentReason ? <VibeNotice tone="info">{currentReason}</VibeNotice> : null}

      <section className="investment-performance__trend" data-testid="performance-trend">
        <header>
          <div>
            <p className="card-label">HISTORY / ACTUAL OBSERVATIONS</p>
            <h2>资产走势与区间解释</h2>
          </div>
          {trend.startDay && trend.endDay ? (
            <VibeStatusTag tone={trend.missingCount > 0 ? "warning" : "success"}>
              {formatShanghaiDayLabel(trend.startDay)} 至 {formatShanghaiDayLabel(trend.endDay)}
            </VibeStatusTag>
          ) : (
            <VibeStatusTag tone="warning">尚无完整端点</VibeStatusTag>
          )}
        </header>
        <div className="investment-performance__range" aria-label="分析区间" role="group">
          <span aria-hidden="true" className="vibe-field__label">
            分析区间
          </span>
          <div className="investment-performance__range-options">
            {INTERVAL_OPTIONS.map((option) => {
              const selected = option.value === preset;
              return (
                <VibeButton
                  key={option.value}
                  aria-pressed={selected}
                  className="investment-performance__range-option"
                  onClick={() => setPreset(option.value)}
                  type="button"
                  variant={selected ? "primary" : "outline"}
                >
                  {option.label}
                </VibeButton>
              );
            })}
          </div>
        </div>
        {trend.missingCount > 0 ? (
          <VibeNotice tone="info">
            缺少 {trend.missingCount} 天资产观测；趋势线已跨过缺口连接，区间端点仅使用实际完整观测。
          </VibeNotice>
        ) : null}
        <AssetTrendChart
          ariaLabel="收益分析资产走势"
          currency={currency}
          formatAmount={amount}
          formatDay={formatShanghaiDayLabel}
          incompleteCount={trend.incompleteCount}
          isSensitiveHidden={!showSensitiveInfo}
          points={trend.points}
          unavailableCount={trend.unavailableCount}
        />
      </section>

      <section className="investment-performance__interval" data-testid="performance-interval">
        <header>
          <div>
            <p className="card-label">INTERVAL / EXPLAINED CHANGE</p>
            <h2>区间结论</h2>
          </div>
          {trend.startDay && trend.endDay ? (
            <VibeStatusTag tone={trend.missingCount > 0 ? "warning" : "success"}>
              {formatShanghaiDayLabel(trend.startDay)} 至 {formatShanghaiDayLabel(trend.endDay)}
            </VibeStatusTag>
          ) : (
            <VibeStatusTag tone="warning">尚无完整端点</VibeStatusTag>
          )}
        </header>
        <div className="investment-performance__interval-grid">
          <article>
            <p>区间资产变化</p>
            <MetricValue
              amount={analysis.interval.assetChange}
              currency={currency}
              hidden={!showSensitiveInfo}
              signed
            />
          </article>
          <article>
            <p>区间净外部投入</p>
            <MetricValue
              amount={analysis.interval.netExternalCashflow}
              currency={currency}
              hidden={!showSensitiveInfo}
              signed
            />
          </article>
          <article>
            <p>区间投资盈亏</p>
            <MetricValue
              amount={analysis.interval.investmentProfit}
              currency={currency}
              hidden={!showSensitiveInfo}
              signed
            />
          </article>
          <article>
            <p>资金发生日加权比例</p>
            {showSensitiveInfo === false ? (
              <span className="investment-performance__private">••••••</span>
            ) : analysis.interval.investmentProfitRatio === null ? (
              <span className="investment-performance__unavailable">数据不足</span>
            ) : (
              <VibeMetric
                unit="%"
                value={signedAmount(
                  decimalMultiply(analysis.interval.investmentProfitRatio, "100"),
                )}
              />
            )}
          </article>
        </div>
        <p className="investment-performance__interval-formula">
          区间投资盈亏 = 区间资产变化 − 区间内净外部投入；不是交易级或税务收益率。
        </p>
        {intervalReason ? <VibeNotice tone="info">{intervalReason}</VibeNotice> : null}
      </section>

      <section className="investment-performance__ledger" aria-label="投资资金进出账本">
        <header>
          <div>
            <p className="card-label">LEDGER / INVESTMENT BOUNDARY</p>
            <h2>投资资金进出</h2>
            <p>按发生时间倒序。平台间转账、买卖、换汇和调仓不属于本账本。</p>
          </div>
          <span>{cashflows.length} 笔</span>
        </header>
        {cashflows.length === 0 ? (
          <div className="empty-state">
            <p className="empty-title">尚未记录投入本金</p>
            <p className="empty-hint">
              可补录初始投入或后续外部资金进出；没有资产观测的日期不会因此生成收益曲线。
            </p>
          </div>
        ) : (
          <ol className="investment-performance__cashflow-list">
            {cashflows.map((cashflow) => {
              const convertedAmount = cashflow.amounts[currency];
              const conversionEvidence = cashflow.exchangeRates.find(
                (rate) =>
                  (rate.baseCurrency === "USD" && rate.quoteCurrency === currency) ||
                  (rate.baseCurrency === currency && rate.quoteCurrency === "USD"),
              );
              return (
                <li key={cashflow.id}>
                  <article>
                    <div className="investment-performance__cashflow-main">
                      <VibeStatusTag
                        tone={cashflow.kind === "external-withdrawal" ? "warning" : "success"}
                      >
                        {cashflowKindLabel(cashflow.kind)}
                      </VibeStatusTag>
                      <strong>
                        {showSensitiveInfo
                          ? `${cashflowSign(cashflow.kind)}${amount(cashflow.amount)} ${cashflow.currency}`
                          : "••••••"}
                      </strong>
                      <span>{formatShanghaiDateTime(cashflow.occurredAt)}</span>
                    </div>
                    <div className="investment-performance__cashflow-evidence">
                      <span>
                        {showSensitiveInfo
                          ? convertedAmount === null
                            ? `${currency} 换算不可用`
                            : `${currency} 计价 ${cashflowSign(cashflow.kind)}${amount(convertedAmount)}`
                          : "换算与汇率已隐藏"}
                      </span>
                      <span>
                        {showSensitiveInfo
                          ? conversionEvidence === undefined
                            ? "无可用的长桥参考汇率证据"
                            : `${conversionEvidence.source} · ${conversionEvidence.observedAt}`
                          : "汇率证据已隐藏"}
                      </span>
                      {showSensitiveInfo && cashflow.note ? <p>{cashflow.note}</p> : null}
                    </div>
                    <div className="investment-performance__cashflow-actions">
                      <VibeButton
                        aria-label={`编辑资金记录：${cashflow.note ?? formatShanghaiDateTime(cashflow.occurredAt)}`}
                        onClick={() => setEditing(cashflow)}
                        type="button"
                        variant="text"
                      >
                        编辑
                      </VibeButton>
                      <VibeButton
                        aria-label={`删除资金记录：${cashflow.note ?? formatShanghaiDateTime(cashflow.occurredAt)}`}
                        onClick={() => setDeleting(cashflow)}
                        type="button"
                        variant="text"
                      >
                        删除
                      </VibeButton>
                    </div>
                  </article>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {editing !== undefined ? (
        <CashflowEditor
          cashflows={cashflows}
          draft={editing === null ? newDraft(currentObservedAt) : cashflowDraft(editing)}
          editing={editing}
          onClose={() => setEditing(undefined)}
          onSaved={upsertCashflow}
        />
      ) : null}
      {deleting !== null ? (
        <CashflowDeleteDialog
          cashflow={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(id) =>
            setCashflows((existing) => existing.filter((cashflow) => cashflow.id !== id))}
        />
      ) : null}
    </section>
  );
}
