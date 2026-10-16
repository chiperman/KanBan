"use client";

import { useMemo, useState, type FormEvent } from "react";

import {
  analyzeCurrentInvestmentPerformance,
  analyzeInvestmentPerformance,
  type PortfolioObservation,
} from "@/domain/investment-performance";
import {
  projectAssetSourceHistoryTrend,
  projectInvestmentPerformanceTrend,
  type InvestmentPerformanceCustomRange,
  type InvestmentPerformanceIntervalPreset,
} from "@/domain/investment-performance-trend";
import {
  DEFAULT_MARKET_BENCHMARK_SYMBOLS,
  type MarketBenchmarkSymbol,
} from "@/domain/market-benchmark";
import {
  decimalCompare,
  decimalMultiply,
  decimalToFixed,
} from "@/domain/decimal";
import { buildTotalValuation, convertCurrencyAmount, type ReportingCurrency } from "@/domain/valuation";
import { hasManualAssetRecord } from "@/domain/manual-asset-records";
import { useLongbridgeRealtime } from "@/ui/use-longbridge-realtime";
import { LongbridgeRealtimeNotice, LongbridgeRealtimeStatus } from "@/ui/longbridge-realtime-notice";
import type {
  AssetExchangeRate,
  AssetSourceSummary,
  DailyAssetTrendObservation,
  ImportedAssetSourceHistoryObservation,
  InvestmentCashflow,
  InvestmentCashflowCurrency,
  InvestmentCashflowInput,
  InvestmentCashflowKind,
} from "@/server/ports";
import { AssetTrendChart } from "@/ui/asset-trend-chart";
import { MarketBenchmarkControls } from "@/ui/market-benchmark-controls";
import { useMarketBenchmarkComparison } from "@/ui/market-benchmark";
import { formatShanghaiDateTime, formatShanghaiDayLabel } from "@/ui/shanghai-date-time";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeMetric, VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";
import { VibeDateField } from "@/ui/vibe/vibe-date-field";
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
import { AssetGlobalRefreshControl } from "@/ui/asset-refresh-controls";
import { lockOnUnauthorizedResponse, OWNER_SESSION_EXPIRED_MESSAGE, readJsonResult } from "@/ui/owner-request-lock";
import { signedAmount } from "@/ui/signed-amount";

type CurrentTotals = Record<ReportingCurrency, PortfolioObservation | null>;

type SourceHistoryOption = {
  firstDay: string;
  label: string;
  value: string;
};

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

const INTERVAL_OPTIONS: readonly VibeSelectOption<InvestmentPerformanceIntervalPreset>[] = [
  { value: "month-to-date", label: "本月" },
  { value: "1m", label: "近 1 月" },
  { value: "6m", label: "近 6 月" },
  { value: "year-to-date", label: "本年" },
  { value: "1y", label: "近 1 年" },
  { value: "all", label: "全部" },
  { value: "custom", label: "自定义" },
];

const CASHFLOW_KIND_OPTIONS: readonly VibeSelectOption<InvestmentCashflowKind>[] = [
  { value: "initial-investment", label: "初始投入" },
  { value: "external-deposit", label: "外部入金" },
  { value: "external-withdrawal", label: "外部出金" },
];

const CASHFLOW_CURRENCY_OPTIONS: readonly VibeSelectOption<InvestmentCashflowCurrency>[] =
  CURRENCY_OPTIONS;

function amount(value: string): string {
  const [integer, fraction] = decimalToFixed(value, 2).split(".");
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
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
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  // datetime-local must use the same local time zone as toIso when saving.
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

function reasonForCurrent(
  current: PortfolioObservation | null,
  cumulativeNetInvestment: string | null,
): string | null {
  if (current === null) return "总资产不可用，无法计算投资盈亏。";
  if (cumulativeNetInvestment === null) {
    return "资金缺少汇率证据，无法计算投资盈亏。";
  }
  return null;
}

function earliestImportedSource(
  importedSourceHistoryObservations: ImportedAssetSourceHistoryObservation[],
): SourceHistoryOption | null {
  const byId = new Map<string, SourceHistoryOption>();
  for (const observation of importedSourceHistoryObservations) {
    const existing = byId.get(observation.sourceId);
    if (existing === undefined) {
      byId.set(observation.sourceId, {
        firstDay: observation.day,
        label: observation.label || observation.sourceId,
        value: observation.sourceId,
      });
    } else if (observation.day < existing.firstDay) {
      byId.set(observation.sourceId, {
        ...existing,
        firstDay: observation.day,
      });
    }
  }
  return [...byId.values()].toSorted(
    (left, right) =>
      left.firstDay.localeCompare(right.firstDay) ||
      left.label.localeCompare(right.label) ||
      left.value.localeCompare(right.value),
  )[0] ?? null;
}

function reasonForInterval(input: {
  end: PortfolioObservation | null;
  start: PortfolioObservation | null;
  netExternalCashflow: string | null;
  days: string[];
}): string | null {
  if (input.days.length === 0) return "请选择有效日期。";
  if (input.start === null || input.end === null) {
    return "区间缺少完整资产观测。";
  }
  if (input.netExternalCashflow === null) {
    return "区间资金缺少汇率证据。";
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
  const result = await readJsonResult<{ error?: string }>(response);
  if (lockOnUnauthorizedResponse(response)) throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
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
  return <VibeMetric unit={currency} value={signed ? signedAmount(value, amount) : amount(value)} />;
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
      description="仅记录外部资金进出。"
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
          placeholder="备注（可选）"
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
      description={`将永久删除 ${cashflowKindLabel(cashflow.kind)}记录。`}
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
  sources,
  currentExchangeRates,
  importedSourceHistoryObservations,
  trendObservations,
}: {
  cashflows: InvestmentCashflow[];
  currentDay: string;
  currentObservedAt: string;
  sources: Omit<AssetSourceSummary, "credentialReference" | "permissions">[];
  currentExchangeRates: AssetExchangeRate[];
  importedSourceHistoryObservations: ImportedAssetSourceHistoryObservation[];
  trendObservations: DailyAssetTrendObservation[];
}) {
  const { active: realtimeActive, liveSources, state: realtimeState, retry } = useLongbridgeRealtime(sources);
  const currentTotals = useMemo(() => {
    const recorded = liveSources.filter(hasManualAssetRecord);
    const valuation = buildTotalValuation(recorded, "USD", "source");
    return (["USD", "CNY", "HKD"] as const).reduce((totals, currency) => {
      const amount = valuation.amount === null ? null : currency === "USD" ? valuation.amount
        : convertCurrencyAmount(valuation.amount, "USD", currency, currentExchangeRates);
      totals[currency] = amount === null ? null : {
        amount,
        complete: !valuation.incomplete && valuation.expiredCount === 0 && recorded.length > 0 &&
          recorded.every(source => source.lifecycle !== "disconnected" && source.sync.status === "current"),
        observedAt: currentObservedAt,
      };
      return totals;
    }, {} as CurrentTotals);
  }, [liveSources, currentExchangeRates, currentObservedAt]);
  const [cashflows, setCashflows] = useState(() => sortCashflows(initialCashflows));
  const {
    currency,
    setCurrency,
    showSensitiveInfo,
  } = useWorkbenchDisplayPreferences();
  const [preset, setPreset] = useState<InvestmentPerformanceIntervalPreset>("month-to-date");
  const [customRange, setCustomRange] =
    useState<InvestmentPerformanceCustomRange | null>(null);
  const [customRangeDialogOpen, setCustomRangeDialogOpen] = useState(false);
  const [customStartDay, setCustomStartDay] = useState(currentDay);
  const [customEndDay, setCustomEndDay] = useState(currentDay);
  const [enabledBenchmarkSymbols, setEnabledBenchmarkSymbols] = useState<
    MarketBenchmarkSymbol[]
  >(() => [...DEFAULT_MARKET_BENCHMARK_SYMBOLS]);
  const [editing, setEditing] = useState<InvestmentCashflow | null | undefined>(
    undefined,
  );
  const [deleting, setDeleting] = useState<InvestmentCashflow | null>(null);
  const importedSource = useMemo(
    () => earliestImportedSource(importedSourceHistoryObservations),
    [importedSourceHistoryObservations],
  );
  const portfolioTrend = useMemo(
    () => projectInvestmentPerformanceTrend({
      assetScope: "portfolio",
      currency,
      customRange,
      currentDay,
      preset,
      trendObservations,
    }),
    [currency, customRange, currentDay, preset, trendObservations],
  );
  const fullPortfolioTrend = useMemo(
    () => projectInvestmentPerformanceTrend({
      assetScope: "portfolio",
      currency,
      currentDay,
      preset: "all",
      trendObservations,
    }),
    [currency, currentDay, trendObservations],
  );
  const sourceHistoryTrend = useMemo(
    () => importedSource === null
      ? null
      : projectAssetSourceHistoryTrend({
          currency,
          customRange,
          currentDay,
          importedSourceHistoryObservations,
          preset,
          sourceId: importedSource.value,
          trendObservations,
        }),
    [
      currency,
      customRange,
      currentDay,
      importedSource,
      importedSourceHistoryObservations,
      preset,
      trendObservations,
    ],
  );
  const fullSourceHistoryTrend = useMemo(
    () => importedSource === null
      ? null
      : projectAssetSourceHistoryTrend({
          currency,
          currentDay,
          importedSourceHistoryObservations,
          preset: "all",
          sourceId: importedSource.value,
          trendObservations,
        }),
    [
      currency,
      currentDay,
      importedSource,
      importedSourceHistoryObservations,
      trendObservations,
    ],
  );
  const firstAvailableTrendDay = importedSource?.firstDay
    ?? fullSourceHistoryTrend?.startDay
    ?? fullPortfolioTrend.startDay;
  const historicalSeries = useMemo(() => {
    if (sourceHistoryTrend === null || importedSource === null) return null;
    const completePortfolioStartDay = fullPortfolioTrend.startDay;
    return {
      label: `${importedSource.label}早期记录`,
      points: sourceHistoryTrend.points.map((point) =>
        completePortfolioStartDay === null || point.day < completePortfolioStartDay
          ? point
          : { ...point, amount: null },
      ),
    };
  }, [fullPortfolioTrend.startDay, importedSource, sourceHistoryTrend]);
  const hasEarlyHistory = historicalSeries?.points.some(
    (point) => point.amount !== null,
  ) ?? false;
  const chartPoints = useMemo(() => {
    const portfolioByDay = new Map(
      portfolioTrend.points.map((point) => [point.day, point]),
    );
    const days = sourceHistoryTrend?.days.length
      ? sourceHistoryTrend.days
      : portfolioTrend.days;
    return days.map((day) => portfolioByDay.get(day) ?? {
      amount: null,
      day,
      observed: false,
      observedAt: null,
      status: "incomplete" as const,
    });
  }, [portfolioTrend.days, portfolioTrend.points, sourceHistoryTrend]);
  const chartStartDay = chartPoints.at(0)?.day ?? null;
  const chartEndDay = chartPoints.at(-1)?.day ?? null;

  const current = currentTotals[currency];
  const currentAnalysis = useMemo(
    () => analyzeCurrentInvestmentPerformance({
      asOf: currentObservedAt,
      cashflows,
      currency,
      currentUsdTotal: currentTotals.USD,
      exchangeRates: currentExchangeRates,
    }),
    [cashflows, currency, currentTotals.USD, currentObservedAt, currentExchangeRates],
  );
  const analysis = useMemo(
    () =>
      analyzeInvestmentPerformance({
        asOf: currentObservedAt,
        cashflows,
        currency,
        currentTotal: current,
        interval: portfolioTrend.start && portfolioTrend.end
          ? { start: portfolioTrend.start, end: portfolioTrend.end }
          : null,
      }),
    [
      cashflows,
      currency,
      current,
      currentObservedAt,
      portfolioTrend.end,
      portfolioTrend.start,
    ],
  );
  const currentReason = reasonForCurrent(
    current,
    currentAnalysis.cumulativeNetInvestment,
  );
  const intervalReason = reasonForInterval({
    days: portfolioTrend.days,
    end: portfolioTrend.end,
    netExternalCashflow: analysis.interval.netExternalCashflow,
    start: portfolioTrend.start,
  });
  const benchmarkVisible = showSensitiveInfo && !hasEarlyHistory;
  const benchmarkDataState = useMarketBenchmarkComparison({
    enabledSymbols: enabledBenchmarkSymbols,
    points: portfolioTrend.points,
    visible: benchmarkVisible,
  });

  function upsertCashflow(cashflow: InvestmentCashflow) {
    setCashflows((existing) =>
      sortCashflows([
        ...existing.filter((item) => item.id !== cashflow.id),
        cashflow,
      ]));
  }

  function openCustomRangeDialog() {
    if (firstAvailableTrendDay === null) return;
    const suggestedStartDay = portfolioTrend.startDay ?? firstAvailableTrendDay;
    const suggestedEndDay = portfolioTrend.days.at(-1) ?? currentDay;
    setCustomStartDay(customRange?.startDay ?? suggestedStartDay);
    setCustomEndDay(customRange?.endDay ?? suggestedEndDay);
    setCustomRangeDialogOpen(true);
  }

  function choosePreset(value: InvestmentPerformanceIntervalPreset) {
    if (value === "custom") {
      openCustomRangeDialog();
      return;
    }
    setPreset(value);
  }

  function applyCustomRange() {
    if (customStartDay > customEndDay) return;
    setCustomRange({
      startDay: customStartDay,
      endDay: customEndDay,
    });
    setPreset("custom");
    setCustomRangeDialogOpen(false);
  }

  return (
    <section
      className="investment-performance"
      data-testid="investment-performance-workspace"
    >
      <WorkbenchPageHeader
        description={realtimeActive ? <LongbridgeRealtimeStatus state={realtimeState} /> : undefined}
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
          <AssetGlobalRefreshControl />
          <VibeButton onClick={() => setEditing(null)} type="button" variant="primary">
            新增资金记录
          </VibeButton>
          </>
        }
        eyebrow="PORTFOLIO / PERFORMANCE"
        title="收益分析"
      />

      <LongbridgeRealtimeNotice state={realtimeState} retry={retry} />
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
            amount={currentAnalysis.cumulativeNetInvestment}
            currency={currency}
            hidden={showSensitiveInfo === false}
            signed
          />
          {currency !== "USD" ? <p>按当前汇率折算</p> : null}
        </article>
        <article data-testid="performance-current-profit">
          <p className="card-label">PERFORMANCE / CURRENT</p>
          <h2>组合投资盈亏</h2>
          <MetricValue
            amount={currentAnalysis.investmentProfit}
            currency={currency}
            hidden={showSensitiveInfo === false}
            signed
          />
          {currency !== "USD" ? <p>按当前汇率折算</p> : null}
        </article>
      </section>
      {currentReason ? <VibeNotice tone="info">{currentReason}</VibeNotice> : null}

      <section className="investment-performance__trend" data-testid="performance-trend">
        <header>
          <div>
            <p className="card-label">HISTORY / ACTUAL OBSERVATIONS</p>
            <h2>我的资产走势</h2>
          </div>
          {chartStartDay && chartEndDay ? (
            <VibeStatusTag tone={hasEarlyHistory || portfolioTrend.missingCount > 0 ? "warning" : "success"}>
              {formatShanghaiDayLabel(chartStartDay)} 至 {formatShanghaiDayLabel(chartEndDay)}
            </VibeStatusTag>
          ) : (
            <VibeStatusTag tone="warning">无记录</VibeStatusTag>
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
                  disabled={option.value === "custom" && firstAvailableTrendDay === null}
                  onClick={() => choosePreset(option.value)}
                  type="button"
                  variant={selected ? "primary" : "outline"}
                >
                {option.label}
                </VibeButton>
              );
            })}
          </div>
          {preset === "custom" && customRange !== null ? (
            <span className="investment-performance__custom-range-label">
              已选 {formatShanghaiDayLabel(customRange.startDay)} 至{" "}
              {formatShanghaiDayLabel(customRange.endDay)}
            </span>
          ) : null}
        </div>
        {hasEarlyHistory ? (
          <VibeNotice tone="info">
            虚线为{importedSource?.label}早期记录；结论仅基于完整总资产。
          </VibeNotice>
        ) : (
          <VibeNotice tone="info">
            结论仅基于完整总资产。
          </VibeNotice>
        )}
        {hasEarlyHistory && sourceHistoryTrend && sourceHistoryTrend.missingCount > 0 ? (
          <VibeNotice tone="info">
            早期记录缺 {sourceHistoryTrend.missingCount} 天。
          </VibeNotice>
        ) : null}
        {benchmarkVisible ? (
          <MarketBenchmarkControls
            assetScopeLabel="组合"
            dataState={benchmarkDataState}
            enabledSymbols={enabledBenchmarkSymbols}
            formatDay={formatShanghaiDayLabel}
            onEnabledSymbolsChange={setEnabledBenchmarkSymbols}
          />
        ) : null}
        <AssetTrendChart
          ariaLabel={hasEarlyHistory
            ? `我的资产走势：完整总资产与${importedSource?.label}早期实际记录`
            : "完整总资产走势"}
          benchmark={{
            assetScopeLabel: "组合",
            comparison: benchmarkDataState.kind === "ready" ? benchmarkDataState.comparison : null,
            enabledSymbols: enabledBenchmarkSymbols,
          }}
          currency={currency}
          formatAmount={amount}
          formatDay={formatShanghaiDayLabel}
          historicalSeries={historicalSeries}
          incompleteCount={portfolioTrend.incompleteCount}
          isSensitiveHidden={!showSensitiveInfo}
          points={chartPoints}
          unavailableCount={portfolioTrend.unavailableCount}
        />
      </section>

      <section className="investment-performance__interval" data-testid="performance-interval">
        <header>
          <div>
            <p className="card-label">INTERVAL / EXPLAINED CHANGE</p>
            <h2>区间结论</h2>
          </div>
          {portfolioTrend.startDay && portfolioTrend.endDay ? (
            <VibeStatusTag tone={portfolioTrend.missingCount > 0 ? "warning" : "success"}>
              {formatShanghaiDayLabel(portfolioTrend.startDay)} 至 {formatShanghaiDayLabel(portfolioTrend.endDay)}
            </VibeStatusTag>
          ) : (
            <VibeStatusTag tone="warning">缺完整端点</VibeStatusTag>
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
            <p>资金加权收益率</p>
            {showSensitiveInfo === false ? (
              <span className="investment-performance__private">••••••</span>
            ) : analysis.interval.investmentProfitRatio === null ? (
              <span className="investment-performance__unavailable">数据不足</span>
            ) : (
              <VibeMetric
                unit="%"
                value={signedAmount(
                  decimalMultiply(analysis.interval.investmentProfitRatio, "100"),
                  amount,
                )}
              />
            )}
          </article>
        </div>
        {intervalReason ? <VibeNotice tone="info">{intervalReason}</VibeNotice> : null}
      </section>

      <section className="investment-performance__ledger" aria-label="投资资金进出账本">
        <header>
          <div>
            <p className="card-label">LEDGER / INVESTMENT BOUNDARY</p>
            <h2>投资资金进出</h2>
          </div>
          <span>{cashflows.length} 笔</span>
        </header>
        {cashflows.length === 0 ? (
          <div className="empty-state">
            <p className="empty-title">无资金记录</p>
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
                            ? `缺 ${currency} 汇率`
                            : `${currency} 计价 ${cashflowSign(cashflow.kind)}${amount(convertedAmount)}`
                          : "换算与汇率已隐藏"}
                      </span>
                      <span>
                        {showSensitiveInfo
                          ? conversionEvidence === undefined
                            ? "缺参考汇率证据"
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
      {customRangeDialogOpen ? (
        <VibeDialog
          actions={
            <>
              <VibeButton
                onClick={() => setCustomRangeDialogOpen(false)}
                type="button"
                variant="text"
              >
                取消
              </VibeButton>
              <VibeButton
                disabled={customStartDay > customEndDay}
                onClick={applyCustomRange}
                type="button"
                variant="primary"
              >
                应用区间
              </VibeButton>
            </>
          }
          aria-label="自定义分析区间"
          description="仅使用完整总资产观测。"
          eyebrow="PERFORMANCE / RANGE"
          onClose={() => setCustomRangeDialogOpen(false)}
          title="自定义分析区间"
          titleId="custom-performance-range-title"
        >
          <div className="investment-performance__custom-range-fields">
            <VibeDateField
              fieldId="custom-performance-range-start"
              label="开始日期"
              max={customEndDay}
              min={firstAvailableTrendDay ?? currentDay}
              onValueChange={setCustomStartDay}
              value={customStartDay}
            />
            <VibeDateField
              fieldId="custom-performance-range-end"
              label="结束日期"
              max={currentDay}
              min={customStartDay}
              onValueChange={setCustomEndDay}
              value={customEndDay}
            />
          </div>
        </VibeDialog>
      ) : null}
    </section>
  );
}
