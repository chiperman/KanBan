"use client";

import { formatAssetAmount } from "@/ui/asset-price-display";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  analyzeCurrentInvestmentPerformance,
  analyzeInvestmentPerformance,
  type PortfolioObservation,
} from "@/domain/investment-performance";
import {
  projectAssetSourceHistoryTrend,
  projectInvestmentPerformanceTrend,
} from "@/domain/investment-performance-trend";
import {
  DEFAULT_MARKET_BENCHMARK_SYMBOLS,
  type MarketBenchmarkSymbol,
} from "@/domain/market-benchmark";
import {
  decimalCompare,
  decimalMultiply,
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
import { AssetTrendPanel, useAssetTrendRange } from "@/ui/asset-trend-panel";
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
import { CURRENCY_OPTIONS } from "@/ui/reporting-currency-options";
import { profitDirection, type ProfitColorScheme } from "@/ui/profit-color-scheme";
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

const CASHFLOW_KIND_OPTIONS: readonly VibeSelectOption<InvestmentCashflowKind>[] = [
  { value: "initial-investment", label: "初始投入" },
  { value: "external-deposit", label: "外部入金" },
  { value: "external-withdrawal", label: "外部出金" },
];

const CASHFLOW_CURRENCY_OPTIONS: readonly VibeSelectOption<InvestmentCashflowCurrency>[] =
  CURRENCY_OPTIONS;

function amount(value: string): string {
  return formatAssetAmount(value);
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
  const occurredAtIso = toIso(current.occurredAt);

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
      className="investment-performance__editor"
      description="记录外部本金进出，保存后计入累计净投入，并用于计算组合投资盈亏。"
      eyebrow="INVESTMENT / CASHFLOW"
      onClose={onClose}
      onSubmit={submit}
      title={editing === null ? "新增资金记录" : "编辑资金记录"}
      titleId="cashflow-editor-title"
    >
      <div className="investment-performance__editor-fields">
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
        <VibeSelect
          fieldId="cashflow-kind"
          label="资金类型"
          onValueChange={(kind) => setCurrent((value) => ({ ...value, kind }))}
          options={kindOptions}
          value={current.kind}
        />
        <div className="investment-performance__editor-field">
          <VibeField
            aria-describedby="cashflow-time-hint"
            fieldId="cashflow-occurred-at"
            label="发生时间"
            max={toInputDateTime(new Date().toISOString())}
            onChange={(event) =>
              setCurrent((value) => ({ ...value, occurredAt: event.target.value }))}
            required
            type="datetime-local"
            value={current.occurredAt}
          />
          <p className="investment-performance__editor-hint" id="cashflow-time-hint">
            {occurredAtIso === "" ? "按设备本地时间填写，列表以上海时间显示。" : (
              <>上海时间 <time dateTime={occurredAtIso}>{formatShanghaiDateTime(occurredAtIso)}</time></>
            )}
          </p>
        </div>
      </div>
      <div className="investment-performance__editor-note">
        <VibeTextAreaField
          aria-describedby="cashflow-note-hint"
          fieldId="cashflow-note"
          label="备注"
          maxLength={500}
          onChange={(event) =>
            setCurrent((value) => ({ ...value, note: event.target.value }))}
          placeholder="例如资金来源、账户或补充说明"
          rows={3}
          value={current.note}
        />
        <div className="investment-performance__editor-note-meta">
          <p className="investment-performance__editor-hint" id="cashflow-note-hint">
            可选，最多 500 字
          </p>
          <span aria-hidden="true">{current.note.length} / 500</span>
        </div>
      </div>
      <p className="investment-performance__editor-required-hint">
        除备注外均为必填。
      </p>
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
  profitColorScheme,
  sources,
  currentExchangeRates,
  importedSourceHistoryObservations,
  trendObservations,
}: {
  cashflows: InvestmentCashflow[];
  currentDay: string;
  currentObservedAt: string;
  profitColorScheme: ProfitColorScheme;
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
  const trendRange = useAssetTrendRange();
  const { preset, customRange } = trendRange;
  const [enabledBenchmarkSymbols, setEnabledBenchmarkSymbols] = useState<
    MarketBenchmarkSymbol[]
  >(() => [...DEFAULT_MARKET_BENCHMARK_SYMBOLS]);
  const [editing, setEditing] = useState<InvestmentCashflow | null | undefined>(
    undefined,
  );
  const [deleting, setDeleting] = useState<InvestmentCashflow | null>(null);
  const [cashflowStatus, setCashflowStatus] = useState("");
  const [focusLedgerAfterDelete, setFocusLedgerAfterDelete] = useState(false);
  const ledgerHeadingRef = useRef<HTMLHeadingElement>(null);

  /* 删除后那一行连同触发按钮一起消失，弹窗的焦点归还会落空。
     把焦点交到账本标题，读屏上下文才不断。 */
  useEffect(() => {
    if (!focusLedgerAfterDelete) return;
    ledgerHeadingRef.current?.focus();
    setFocusLedgerAfterDelete(false);
  }, [focusLedgerAfterDelete]);

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
    setCashflowStatus(
      cashflows.some((item) => item.id === cashflow.id)
        ? "资金记录已更新"
        : "资金记录已保存",
    );
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
        title="投资账本"
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
            /* 日期区间是事实描述而非告警：覆盖不足由下方脚注与「完整 N / M 天」承担，
               避免读数前先被一枚橙色标签定性。 */
            <VibeStatusTag tone="muted">
              {formatShanghaiDayLabel(chartStartDay)} 至 {formatShanghaiDayLabel(chartEndDay)}
            </VibeStatusTag>
          ) : (
            <VibeStatusTag tone="warning">无记录</VibeStatusTag>
          )}
        </header>
        <AssetTrendPanel
          range={{ ...trendRange, currentDay, firstDay: firstAvailableTrendDay ?? undefined }}
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
          isSensitiveHidden={!showSensitiveInfo}
          points={chartPoints}
        >
        {/* 读法说明属于脚注而不是告警：整块提示条会压过图表本身，
            降为安静脚注，与总览「含资金进出与估值修正」保持同一层级。 */}
        <p className="investment-performance__note">
          {hasEarlyHistory ? (
            <>虚线为{importedSource?.label}早期记录；结论仅基于完整总资产。</>
          ) : (
            "结论仅基于完整总资产。"
          )}
        </p>
        {hasEarlyHistory && sourceHistoryTrend && sourceHistoryTrend.missingCount > 0 ? (
          <p className="investment-performance__note">
            早期记录缺 {sourceHistoryTrend.missingCount} 天。
          </p>
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
        </AssetTrendPanel>
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
        {/* 自释：四个数字之间的换算关系必须写出来，否则「资产变化 0」会被读成「没有盈亏」 */}
        <p className="investment-performance__note">
          区间投资盈亏 = 区间资产变化 − 区间净外部投入
        </p>
        {intervalReason ? <VibeNotice tone="info">{intervalReason}</VibeNotice> : null}
      </section>

      <section className="investment-performance__ledger" aria-label="投资资金进出账本">
        <header>
          <div>
            <p className="card-label">LEDGER / INVESTMENT BOUNDARY</p>
            {/* tabIndex=-1 只为承接「删除后的焦点」，不进入 Tab 序列 */}
            <h2 ref={ledgerHeadingRef} tabIndex={-1}>投资资金进出</h2>
          </div>
          {cashflows.length > 0 ? (
            <div className="investment-performance__ledger-heading-meta">
              <p className="investment-performance__ledger-count">
                {cashflows.length}
                <span className="investment-performance__ledger-count-unit">笔</span>
              </p>
              {/* 时间倒序是账本的自然秩序，不是可切换的偏好，所以写说明字而不是控件 */}
              <p className="investment-performance__ledger-sort">按发生时间倒序</p>
            </div>
          ) : null}
        </header>
        <p
          aria-live="polite"
          className="investment-performance__ledger-status"
          role="status"
        >
          {cashflowStatus}
        </p>
        {cashflows.length === 0 ? (
          <div className="empty-state">
            <p className="empty-title">无资金记录</p>
            {/* 空状态给出下一步：没有本金事实时，净投入与投资盈亏无法成立 */}
            <p className="empty-hint">
              记录第一笔本金，累计净投入与组合投资盈亏才有基准。
            </p>
            <VibeButton onClick={() => setEditing(null)} type="button" variant="primary">
              记录第一笔资金
            </VibeButton>
          </div>
        ) : (
          <div className="investment-performance__ledger-table">
            <div aria-hidden="true" className="investment-performance__cashflow-head">
              <span>金额 / 时间</span>
              <span>换算 / 备注</span>
              <span>操作</span>
            </div>
            <ol className="investment-performance__cashflow-list" role="list">
              {cashflows.map((cashflow) => {
                const convertedAmount = cashflow.amounts[currency];
                const needsConversion = cashflow.currency !== currency;
                const conversionEvidence = cashflow.exchangeRates.find(
                  (rate) =>
                    (rate.baseCurrency === "USD" && rate.quoteCurrency === currency) ||
                    (rate.baseCurrency === currency && rate.quoteCurrency === "USD"),
                );
                const sign = cashflowSign(cashflow.kind);
                /* 隐藏判定统一写 `=== false`（与上方卡片 MetricValue、表尾小计一致），
                   真值判断会让 true/false/undefined 三态在行与合计之间分叉。
                   隐藏模式下可访问名必须回落到时间，否则读屏会把备注念出来。 */
                const hidden = showSensitiveInfo === false;
                const occurredAtLabel = formatShanghaiDateTime(cashflow.occurredAt);
                const rowLabel = hidden ? occurredAtLabel : cashflow.note ?? occurredAtLabel;
                return (
                  <li key={cashflow.id}>
                    <article>
                      <div className="investment-performance__cashflow-main">
                        <strong
                          className="profit-color-value"
                          data-profit-color-scheme={profitColorScheme}
                          data-profit-direction={hidden
                            ? "neutral"
                            : profitDirection(`${sign}${cashflow.amount}`)}
                        >
                          {hidden ? (
                            "••••••"
                          ) : (
                            <>
                              {sign}{amount(cashflow.amount)}{" "}
                              <span className="investment-performance__cashflow-unit">
                                {cashflow.currency}
                              </span>
                            </>
                          )}
                        </strong>
                        <div className="investment-performance__cashflow-meta">
                          <VibeStatusTag tone="muted">
                            {cashflowKindLabel(cashflow.kind)}
                          </VibeStatusTag>
                          <time dateTime={cashflow.occurredAt}>{occurredAtLabel}</time>
                        </div>
                      </div>
                      <div className="investment-performance__cashflow-evidence">
                        {needsConversion ? (
                          hidden ? (
                            /* 需要换算但处于隐藏模式：两行合并成一行，避免「已隐藏」刷屏 */
                            <span>金额与汇率已隐藏</span>
                          ) : (
                            convertedAmount === null ? (
                              /* 缺汇率是事实缺口，不是 0；用 warning 标出，绝不回落成数值 */
                              <span data-evidence="missing">缺 {currency} 汇率证据</span>
                            ) : (
                              <>
                                <span>
                                  {currency} 计价 {sign}{amount(convertedAmount)}
                                </span>
                                {conversionEvidence === undefined ? null : (
                                  <span>
                                    {`${conversionEvidence.source} · ${conversionEvidence.observedAt}`}
                                  </span>
                                )}
                              </>
                            )
                          )
                        ) : null}
                        {hidden || cashflow.note === null ? null : <p>{cashflow.note}</p>}
                      </div>
                      <div className="investment-performance__cashflow-actions">
                        <VibeButton
                          aria-label={`编辑资金记录：${rowLabel}`}
                          onClick={() => setEditing(cashflow)}
                          type="button"
                          variant="text"
                        >
                          编辑
                        </VibeButton>
                        <VibeButton
                          aria-label={`删除资金记录：${rowLabel}`}
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
            {/* 表尾小计：与上方「累计净投入」同源同值，是「账目对得上」的核验点 */}
            <p className="investment-performance__ledger-total">
              <span className="investment-performance__ledger-total-label">累计净投入</span>
              {showSensitiveInfo === false ? (
                <span className="investment-performance__private">••••••</span>
              ) : currentAnalysis.cumulativeNetInvestment === null ? (
                <span className="investment-performance__unavailable">数据不足</span>
              ) : (
                <strong
                  className="profit-color-value"
                  data-profit-color-scheme={profitColorScheme}
                  data-profit-direction={profitDirection(
                    currentAnalysis.cumulativeNetInvestment,
                  )}
                >
                  {signedAmount(currentAnalysis.cumulativeNetInvestment, amount)}{" "}
                  <span className="investment-performance__cashflow-unit">{currency}</span>
                </strong>
              )}
            </p>
          </div>
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
          onDeleted={(id) => {
            setCashflows((existing) => existing.filter((cashflow) => cashflow.id !== id));
            setCashflowStatus("资金记录已删除");
            setFocusLedgerAfterDelete(true);
          }}
        />
      ) : null}
    </section>
  );
}
