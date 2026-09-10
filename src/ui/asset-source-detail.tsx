"use client";

import { WorkbenchHeaderUtilitiesSlot } from "@/ui/workbench-shell";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import {
  DEFAULT_MARKET_BENCHMARK_SYMBOLS,
  type MarketBenchmarkSymbol,
} from "@/domain/market-benchmark";
import {
  projectAssetSourceTrend,
  type InvestmentPerformanceCustomRange,
  type InvestmentPerformanceIntervalPreset,
} from "@/domain/investment-performance-trend";
import type {
  AssetExchangeRate,
  AssetPermission,
  DailyAssetTrendObservation,
  ManualAssetRecord,
} from "@/server/ports";
import {
  AssetSourceCard,
  type AssetSourceView,
} from "@/ui/longbridge-asset-card";
import { MarketBenchmarkControls } from "@/ui/market-benchmark-controls";
import { useMarketBenchmarkComparison } from "@/ui/market-benchmark";
import type { ProfitColorScheme } from "@/ui/profit-color-scheme";
import { formatShanghaiDayLabel } from "@/ui/shanghai-date-time";
import { useWorkbenchDisplayPreferences } from "@/ui/workbench-display-preferences";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import { VibeDateField } from "@/ui/vibe/vibe-date-field";
import { VibeDialog } from "@/ui/vibe/vibe-dialog";
import {
  VibeField,
  VibeSelect,
  VibeSelectField,
  type VibeSelectOption,
} from "@/ui/vibe/vibe-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";

type DetailSource = AssetSourceView & {
  permissions: AssetPermission[];
};

const REPORTING_CURRENCY_OPTIONS: readonly VibeSelectOption<"USD" | "CNY" | "HKD">[] = [
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

async function sourceRequest(
  url: string,
  method: "PATCH" | "DELETE",
  body: unknown,
) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;
  if (!response.ok) throw new Error(result?.error ?? "来源操作失败");
}

function permissionSummary(permissions: AssetPermission[]): string {
  const labels: Record<AssetPermission, string> = {
    account: "账户读取",
    positions: "持仓读取",
    "market-data": "行情读取",
    "public-address": "公开地址读取",
    trade: "交易权限",
    transfer: "划转权限",
    withdraw: "提现权限",
  };
  return permissions.map((permission) => labels[permission]).join(" · ");
}

function authorizationStatus(source: DetailSource): string {
  if (source.kind === "manual") return "无凭证手工来源";
  return source.lifecycle === "disconnected" ? "已断开" : "已连接（只读）";
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function ManualRecordDialog({
  currentDay,
  onClose,
  record,
  source,
}: {
  currentDay: string;
  onClose(): void;
  record?: ManualAssetRecord;
  source: DetailSource;
}) {
  const router = useRouter();
  const [day, setDay] = useState(record?.day ?? currentDay);
  const [amount, setAmount] = useState(record?.amount ?? "");
  const [currency, setCurrency] = useState<"USD" | "CNY" | "HKD">(
    record?.currency ?? "USD",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const name = assetSourceDisplayName(source);

  async function save() {
    setPending(true);
    setError("");
    try {
      await sourceRequest(`/api/asset-sources/${encodeURIComponent(source.id)}`, "PATCH", {
        action: "manual-record",
        day,
        amount,
        currency,
      });
      router.refresh();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存数据失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <VibeDialog
      actions={
        <>
          <VibeButton disabled={pending} onClick={onClose} type="button" variant="text">
            取消
          </VibeButton>
          <VibeButton disabled={pending || amount.trim() === ""} type="submit" variant="primary">
            保存数据
          </VibeButton>
        </>
      }
      aria-label={`记录 ${name} 数据`}
      description="每日仅记录一条总额。"
      eyebrow="MANUAL / RECORD"
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      title={`记录 ${name} 数据`}
      titleId="manual-record-dialog-title"
    >
      <VibeDateField
        disabled={record !== undefined}
        fieldId="manual-record-day"
        label="记录日期"
        max={currentDay}
        onValueChange={setDay}
        value={day}
      />
      <VibeField
        fieldId="manual-record-amount"
        label="资产总额"
        inputMode="decimal"
        onChange={(event) => setAmount(event.target.value)}
        value={amount}
      />
      <VibeSelectField
        fieldId="manual-record-currency"
        label="币种"
        onValueChange={(value) => setCurrency(value as "USD" | "CNY" | "HKD")}
        options={[
          { value: "USD", label: "USD" },
          { value: "CNY", label: "CNY" },
          { value: "HKD", label: "HKD" },
        ]}
        value={currency}
      />
      {error ? (
        <VibeNotice role="alert" tone="error">{error}</VibeNotice>
      ) : null}
    </VibeDialog>
  );
}

function ManualRecordDeleteDialog({
  onClose,
  record,
  source,
}: {
  onClose(): void;
  record: ManualAssetRecord;
  source: DetailSource;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const name = assetSourceDisplayName(source);

  async function remove() {
    setPending(true);
    setError("");
    try {
      await sourceRequest(`/api/asset-sources/${encodeURIComponent(source.id)}`, "DELETE", {
        action: "manual-record",
        day: record.day,
      });
      router.refresh();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "删除数据失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <VibeDialog
      actions={
        <>
          <VibeButton disabled={pending} onClick={onClose} type="button" variant="text">
            取消
          </VibeButton>
          <VibeButton className="danger-button" disabled={pending} onClick={() => void remove()} type="button" variant="outline">
            删除数据
          </VibeButton>
        </>
      }
      aria-label={`删除 ${name} ${record.day} 数据`}
      description="将显示上一条保留记录。"
      eyebrow="MANUAL / DELETE"
      onClose={onClose}
      title={`删除 ${name} ${record.day} 数据`}
      titleId="manual-record-delete-dialog-title"
    >
      {error ? (
        <VibeNotice role="alert" tone="error">{error}</VibeNotice>
      ) : null}
    </VibeDialog>
  );
}

function SourceLifecycleActions({
  cardHidden,
  source,
}: {
  cardHidden: boolean;
  source: DetailSource;
}) {
  const router = useRouter();
  const [hidden, setHidden] = useState(cardHidden);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [deleteStep, setDeleteStep] = useState<1 | 2 | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const name = assetSourceDisplayName(source);
  const manual = source.kind === "manual";

  async function run(
    action: "visibility" | "disconnect" | "restore" | "delete",
    body: Record<string, unknown> = {},
  ) {
    setPending(true);
    setError("");
    try {
      if (action === "delete") {
        await sourceRequest(`/api/asset-sources/${encodeURIComponent(source.id)}`, "DELETE", {
          confirmation: "DELETE_SOURCE_DATA",
        });
        router.push("/asset-sources");
      } else {
        await sourceRequest(`/api/asset-sources/${encodeURIComponent(source.id)}`, "PATCH", {
          action,
          ...body,
        });
      }
      if (action === "visibility") setHidden(Boolean(body.hidden));
      setConfirmDisconnect(false);
      setDeleteStep(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "来源操作失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <section aria-label="来源显示与生命周期" className="asset-source-lifecycle">
        <p className="card-label">DISPLAY / LIFECYCLE</p>
        <h2>显示与生命周期</h2>
        <p>
          {hidden
            ? "来源卡片已隐藏。"
            : "仅隐藏总览卡片。"}
        </p>
        <VibeButton
          disabled={pending}
          onClick={() => void run("visibility", { hidden: !hidden })}
          type="button"
          variant="outline"
        >
          {hidden ? "恢复显示来源卡片" : "隐藏来源卡片"}
        </VibeButton>
      </section>

      <section aria-label="危险操作" className="asset-source-danger">
        <p className="card-label">DANGEROUS / SOURCE DATA</p>
        <h2>危险操作</h2>
        {manual ? (
          <p>永久删除会移除来源及全部历史记录。</p>
        ) : source.lifecycle === "disconnected" ? (
          <p>已断开；历史数据保留。</p>
        ) : (
          <p>断开将停止同步；历史数据保留。</p>
        )}
        {!manual ? (
          source.lifecycle === "disconnected" ? (
            <VibeButton
              disabled={pending}
              onClick={() => void run("restore")}
              type="button"
              variant="outline"
            >
              恢复连接
            </VibeButton>
          ) : (
            <VibeButton
              className="danger-button"
              disabled={pending}
              onClick={() => setConfirmDisconnect(true)}
              type="button"
              variant="outline"
            >
              断开来源
            </VibeButton>
          )
        ) : null}
        <VibeButton
          className="danger-button"
          disabled={pending}
          onClick={() => setDeleteStep(1)}
          type="button"
          variant="text"
        >
          永久删除数据
        </VibeButton>
        {error ? (
          <VibeNotice role="alert" tone="error">{error}</VibeNotice>
        ) : null}
      </section>

      {confirmDisconnect ? (
        <VibeDialog
          actions={
            <>
              <VibeButton disabled={pending} onClick={() => setConfirmDisconnect(false)} type="button" variant="text">
                取消
              </VibeButton>
              <VibeButton className="danger-button" disabled={pending} onClick={() => void run("disconnect")} type="button" variant="outline">
                确认断开
              </VibeButton>
            </>
          }
          description="停止同步；历史数据保留。"
          eyebrow="DANGEROUS / DISCONNECT"
          onClose={() => setConfirmDisconnect(false)}
          title={`确认断开 ${name}`}
          titleId="source-disconnect-dialog-title"
        />
      ) : null}

      {deleteStep === 1 ? (
        <VibeDialog
          actions={
            <>
              <VibeButton disabled={pending} onClick={() => setDeleteStep(null)} type="button" variant="text">
                取消
              </VibeButton>
              <VibeButton className="danger-button" disabled={pending} onClick={() => setDeleteStep(2)} type="button" variant="outline">
                继续删除
              </VibeButton>
            </>
          }
          description="将永久删除来源及全部历史数据，无法恢复。"
          eyebrow="DANGEROUS / DELETE"
          onClose={() => setDeleteStep(null)}
          title="永久删除来源数据"
          titleId="source-delete-dialog-title"
        />
      ) : null}

      {deleteStep === 2 ? (
        <VibeDialog
          actions={
            <>
              <VibeButton disabled={pending} onClick={() => setDeleteStep(null)} type="button" variant="text">
                取消
              </VibeButton>
              <VibeButton className="danger-button" disabled={pending} onClick={() => void run("delete")} type="button" variant="outline">
                确认永久删除
              </VibeButton>
            </>
          }
          description={`将永久删除 ${name} 及全部历史数据。`}
          eyebrow="DANGEROUS / FINAL CONFIRMATION"
          onClose={() => setDeleteStep(null)}
          title="第二次确认永久删除"
          titleId="source-delete-confirmation-dialog-title"
        />
      ) : null}
    </>
  );
}

export function AssetSourceDetail({
  cardHidden,
  currentDay,
  history,
  profitColorScheme,
  reportingExchangeRates,
  source,
}: {
  cardHidden: boolean;
  currentDay: string;
  history: DailyAssetTrendObservation[];
  profitColorScheme: ProfitColorScheme;
  reportingExchangeRates: AssetExchangeRate[];
  source: DetailSource;
}) {
  const {
    currency,
    setCurrency,
    showSensitiveInfo,
  } = useWorkbenchDisplayPreferences();
  const [editingRecord, setEditingRecord] = useState<ManualAssetRecord | null | undefined>(
    null,
  );
  const [deletingRecord, setDeletingRecord] = useState<ManualAssetRecord | null>(
    null,
  );
  const [preset, setPreset] = useState<InvestmentPerformanceIntervalPreset>(
    "month-to-date",
  );
  const [customRange, setCustomRange] =
    useState<InvestmentPerformanceCustomRange | null>(null);
  const [customRangeDialogOpen, setCustomRangeDialogOpen] = useState(false);
  const [customStartDay, setCustomStartDay] = useState(currentDay);
  const [customEndDay, setCustomEndDay] = useState(currentDay);
  const [enabledBenchmarkSymbols, setEnabledBenchmarkSymbols] = useState<
    MarketBenchmarkSymbol[]
  >(() => [...DEFAULT_MARKET_BENCHMARK_SYMBOLS]);
  const name = assetSourceDisplayName(source);
  const manual = source.kind === "manual";
  const firstSourceTrendDay = useMemo(
    () => history.flatMap((observation) =>
      observation.sources.some((item) => item.sourceId === source.id)
        ? [observation.day]
        : []
    ).toSorted().at(0),
    [history, source.id],
  );
  const sourceTrend = useMemo(
    () => projectAssetSourceTrend({
      currency,
      customRange,
      currentDay,
      preset,
      sourceId: source.id,
      trendObservations: history,
    }),
    [currency, customRange, currentDay, history, preset, source.id],
  );

  const benchmarkDataState = useMarketBenchmarkComparison({
    enabledSymbols: enabledBenchmarkSymbols,
    points: sourceTrend.points,
    visible: showSensitiveInfo,
  });

  function openCustomRangeDialog() {
    if (firstSourceTrendDay === undefined) return;
    setCustomStartDay(customRange?.startDay ?? sourceTrend.days[0] ?? firstSourceTrendDay);
    setCustomEndDay(customRange?.endDay ?? sourceTrend.days.at(-1) ?? currentDay);
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
    setCustomRange({ startDay: customStartDay, endDay: customEndDay });
    setPreset("custom");
    setCustomRangeDialogOpen(false);
  }

  return (
    <>
      <section className="asset-source-detail__header">
        <div className="asset-source-detail__heading">
          <div>
            <p className="card-label">SOURCE / DETAIL</p>
            <h1>来源详情</h1>
          </div>
          <div className="asset-source-detail__actions">
            <VibeSelect
              fieldId="asset-source-detail-reporting-currency"
              label="计价货币"
              onValueChange={setCurrency}
              options={REPORTING_CURRENCY_OPTIONS}
              value={currency}
              variant="compact"
            />
            <VibeLink href="/asset-sources" variant="outline">
              返回资产来源
            </VibeLink>
          </div>
        </div>
        <WorkbenchHeaderUtilitiesSlot />
      </section>

      <section aria-label="来源身份" className="asset-source-detail__metadata">
        <h2>来源身份</h2>
        <dl>
          <div>
            <dt>来源名称</dt>
            <dd>{name}</dd>
          </div>
          <div>
            <dt>来源标识</dt>
            <dd>{source.label}</dd>
          </div>
          <div>
            <dt>来源类型</dt>
            <dd>{manual ? "手工资产记录" : source.kind.startsWith("evm-watch-") ? "观察钱包" : "自动账户"}</dd>
          </div>
        </dl>
      </section>

      {!manual ? (
        <section aria-label="只读授权摘要" className="asset-source-detail__metadata">
          <h2>只读授权摘要</h2>
          <dl>
            <div>
              <dt>授权状态</dt>
              <dd>{authorizationStatus(source)}</dd>
            </div>
            <div>
              <dt>最近校验</dt>
              <dd>{formatTime(source.sync.lastAttemptAt)}</dd>
            </div>
            <div>
              <dt>权限摘要</dt>
              <dd>{permissionSummary(source.permissions)}</dd>
            </div>
          </dl>
          <div className="asset-source-detail__metadata-actions">
            <VibeLink
              href={`/asset-sources/${encodeURIComponent(source.id)}/reauthorize`}
              variant="outline"
            >
              更换授权 / 重新授权
            </VibeLink>
            {source.kind.startsWith("evm-watch-") ? (
              <VibeLink
                href={`/asset-sources/${encodeURIComponent(source.id)}/settings`}
                variant="outline"
              >
                管理资产范围
              </VibeLink>
            ) : null}
          </div>
        </section>
      ) : null}

      <section aria-label="来源分析" className="asset-source-detail__analysis">
        <div
          aria-label="分析区间"
          className="investment-performance__range"
          role="group"
        >
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
                  disabled={option.value === "custom" && firstSourceTrendDay === undefined}
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
        {showSensitiveInfo ? (
          <MarketBenchmarkControls
            assetScopeLabel="来源"
            dataState={benchmarkDataState}
            enabledSymbols={enabledBenchmarkSymbols}
            formatDay={formatShanghaiDayLabel}
            onEnabledSymbolsChange={setEnabledBenchmarkSymbols}
          />
        ) : null}

        <AssetSourceCard
          assetScopeHref={source.kind.startsWith("evm-watch-")
            ? `/asset-sources/${encodeURIComponent(source.id)}/settings`
            : undefined}
          currentDay={currentDay}
          history={history}
          holdingsSearchQuery=""
          onManualAssetRecord={(current, record) => {
            if (current.id === source.id) setEditingRecord(record ?? undefined);
          }}
          onManualAssetRecordDelete={(current, record) => {
            if (current.id === source.id) setDeletingRecord(record);
          }}
          profitColorScheme={profitColorScheme}
          reportingCurrency={currency}
          reportingExchangeRates={reportingExchangeRates}
          showSensitiveInfo={showSensitiveInfo}
          source={source}
          trendBenchmark={benchmarkDataState.kind === "ready" ? {
            comparison: benchmarkDataState.comparison,
            enabledSymbols: enabledBenchmarkSymbols,
          } : null}
          trendDays={sourceTrend.days}
          trendRange="30d"
        />
      </section>
      <SourceLifecycleActions cardHidden={cardHidden} source={source} />

      {editingRecord !== null ? (
        <ManualRecordDialog
          currentDay={currentDay}
          onClose={() => setEditingRecord(null)}
          record={editingRecord ?? undefined}
          source={source}
        />
      ) : null}
      {deletingRecord ? (
        <ManualRecordDeleteDialog
          onClose={() => setDeletingRecord(null)}
          record={deletingRecord}
          source={source}
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
          aria-label="选择来源分析区间"
          description="仅使用完整每日观测。"
          eyebrow="SOURCE / CUSTOM RANGE"
          onClose={() => setCustomRangeDialogOpen(false)}
          title="选择分析区间"
          titleId="asset-source-analysis-range-title"
        >
          <VibeDateField
            fieldId="asset-source-analysis-start-day"
            label="开始日期"
            max={customEndDay}
            min={firstSourceTrendDay}
            onValueChange={setCustomStartDay}
            value={customStartDay}
          />
          <VibeDateField
            fieldId="asset-source-analysis-end-day"
            label="结束日期"
            max={currentDay}
            min={customStartDay}
            onValueChange={setCustomEndDay}
            value={customEndDay}
          />
        </VibeDialog>
      ) : null}
    </>
  );
}
