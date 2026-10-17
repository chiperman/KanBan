"use client";

import { lazy, Suspense, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { WorkbenchPageHeader } from "@/ui/workbench-page-header";
import { AssetSourceRefreshButton } from "@/ui/asset-refresh-controls";
import { SourceInvestmentPerformance } from "@/ui/source-investment-performance";
import type { SourceInvestmentHistory } from "@/domain/source-investment-history";
import type { SourceInvestmentRecord } from "@/domain/source-investment-records";
import { SourceInvestmentRecordDialog, SourceInvestmentRecordDeleteDialog } from "@/ui/source-investment-record-dialog";

import { assetSourceDefaultDisplayName, assetSourceDisplayName } from "@/domain/asset-source-display-name";
import { defaultManualAssetRecordCurrency } from "@/domain/manual-asset-records";
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
import { LongbridgeRealtimeNotice, LongbridgeRealtimeStatus } from "@/ui/longbridge-realtime-notice";
import { useLongbridgeRealtime } from "@/ui/use-longbridge-realtime";
import type { ProfitColorScheme } from "@/ui/profit-color-scheme";
import { formatShanghaiDayLabel } from "@/ui/shanghai-date-time";
import { useWorkbenchDisplayPreferences } from "@/ui/workbench-display-preferences";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import { VibeDateField } from "@/ui/vibe/vibe-date-field";
import { VibeDialog } from "@/ui/vibe/vibe-dialog";
import { VibeIcon } from "@/ui/vibe/vibe-icon";
import {
  VibeField,
  VibeSelect,
  VibeSelectField,
} from "@/ui/vibe/vibe-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { lockOnUnauthorizedResponse, OWNER_SESSION_EXPIRED_MESSAGE, readJsonResult } from "@/ui/owner-request-lock";
import { CURRENCY_OPTIONS, INTERVAL_OPTIONS } from "@/ui/reporting-currency-options";

type DetailSource = AssetSourceView & {
  permissions: AssetPermission[];
};

// 资产类别表单只服务手工来源，动态导入避免自动来源页面下载其代码。
const SourceManualAssetClassForm = lazy(() =>
  import("./source-manual-asset-class-form").then((module) => ({
    default: module.SourceManualAssetClassForm,
  })),
);

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
  const result = await readJsonResult<{ error?: string }>(response);
  if (lockOnUnauthorizedResponse(response)) throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
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
    record?.currency ?? defaultManualAssetRecordCurrency(source.manualRecords),
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
        options={CURRENCY_OPTIONS}
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
          <VibeButton tone="danger" disabled={pending} onClick={() => void remove()} type="button" variant="outline">
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

function SourceDisplayNameForm({ source }: { source: DetailSource }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(source.displayName ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setPending(true);
    setError("");
    try {
      await sourceRequest(`/api/asset-sources/${encodeURIComponent(source.id)}`, "PATCH", {
        action: "rename", displayName,
      });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存名称失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <VibeField
        autoComplete="off"
        disabled={pending}
        fieldId="source-display-name"
        label="自定义名称"
        onChange={(event) => setDisplayName(event.target.value)}
        placeholder={assetSourceDefaultDisplayName(source)}
        value={displayName}
      />
      <p>仅修改本看板中的显示名称。清空后恢复默认名称。</p>
      {error ? <VibeNotice role="alert" tone="error">{error}</VibeNotice> : null}
      <VibeButton
        disabled={pending || displayName.trim() === (source.displayName ?? "")}
        type="submit"
        variant="outline"
      >
        {pending ? "正在保存…" : "保存名称"}
      </VibeButton>
    </form>
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
              <VibeButton tone="danger" disabled={pending} onClick={() => void run("disconnect")} type="button" variant="outline">
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
              <VibeButton tone="danger" disabled={pending} onClick={() => setDeleteStep(2)} type="button" variant="outline">
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
              <VibeButton tone="danger" disabled={pending} onClick={() => void run("delete")} type="button" variant="outline">
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
  investmentHistory = null,
  investmentRecords = [],
  initialPreset = "month-to-date",
  initialCustomRange = null,
  firstDay,
  cardHidden,
  currentDay,
  history,
  profitColorScheme,
  reportingExchangeRates,
  source,
}: {
  investmentHistory?: SourceInvestmentHistory | null;
  investmentRecords?: SourceInvestmentRecord[];
  initialPreset?: InvestmentPerformanceIntervalPreset;
  initialCustomRange?: InvestmentPerformanceCustomRange | null;
  firstDay?: string;
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
  const realtimeSources = useMemo(() => [source], [source]);
  const { active: realtimeActive, liveSources, state: realtimeState, retry } = useLongbridgeRealtime(realtimeSources);
  const [editingRecord, setEditingRecord] = useState<ManualAssetRecord | null | undefined>(
    null,
  );
  const [deletingRecord, setDeletingRecord] = useState<ManualAssetRecord | null>(
    null,
  );
  const [investmentRecord, setInvestmentRecord] = useState<SourceInvestmentRecord | null | undefined>(null);
  const [deletingInvestmentRecord, setDeletingInvestmentRecord] = useState<SourceInvestmentRecord | null>(null);
  const preset = initialPreset;
  const customRange = initialCustomRange;
  const router = useRouter();
  const [rangePending, startRangeTransition] = useTransition();
  function navigateRange(value: InvestmentPerformanceIntervalPreset, range?: InvestmentPerformanceCustomRange) {
    const params = new URLSearchParams({interval:value});
    if (range) { params.set("from", range.startDay); params.set("to", range.endDay); }
    startRangeTransition(() => router.push("/asset-sources/" + encodeURIComponent(source.id) + "?" + params, {scroll:false}));
  }

  const [customRangeDialogOpen, setCustomRangeDialogOpen] = useState(false);
  const [customStartDay, setCustomStartDay] = useState(currentDay);
  const [customEndDay, setCustomEndDay] = useState(currentDay);
  const name = assetSourceDisplayName(source);
  const manual = source.kind === "manual";
  const firstSourceTrendDay = useMemo(
    () => firstDay ?? history.flatMap((observation) =>
      observation.sources.some((item) => item.sourceId === source.id)
        ? [observation.day]
        : []
    ).toSorted().at(0),
    [firstDay, history, source.id],
  );
  const hasCurrentManualRecord = source.manualRecords?.some(({ day }) => day === currentDay);
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

  const openingRecord = investmentRecords.find(record => record.kind === "opening");
  const investmentCurrency = investmentHistory?.currency ?? investmentRecords[0]?.currency ?? null;

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
    navigateRange(value);
  }

  function applyCustomRange() {
    if (customStartDay > customEndDay) return;
    navigateRange("custom", { startDay: customStartDay, endDay: customEndDay });
    setCustomRangeDialogOpen(false);
  }

  return (
    <>
      <section className="asset-source-detail__header">
        <WorkbenchPageHeader
          description={realtimeActive ? <LongbridgeRealtimeStatus state={realtimeState} /> : undefined}
          eyebrow="SOURCE / DETAIL"
          title="来源详情"
          backLink={{ href: "/asset-sources", label: "返回来源管理" }}
          actionsLabel="来源详情快捷操作"
          actions={<>
            <VibeSelect
              fieldId="asset-source-detail-reporting-currency"
              label="计价货币"
              onValueChange={setCurrency}
              options={CURRENCY_OPTIONS}
            value={currency}
              variant="compact"
            />
            <VibeButton onClick={() => setInvestmentRecord(undefined)} type="button" variant="outline">
              <VibeIcon name="plus" /><span>手动记录</span>
            </VibeButton>
            {manual ? (
              <VibeButton
                className="manual-asset-record-button"
                onClick={() => setEditingRecord(undefined)}
                type="button"
                variant="outline"
              >
                <VibeIcon name={hasCurrentManualRecord ? "edit" : "plus"} />
                <span>{hasCurrentManualRecord ? "更新今日数据" : "添加数据"}</span>
              </VibeButton>
            ) : source.lifecycle !== "disconnected" ? (
              <AssetSourceRefreshButton sourceId={source.id} sourceName={name} />
            ) : null}
          </>}
        />
      </section>

      <section aria-label="来源分析" className="asset-source-detail__analysis">
        <LongbridgeRealtimeNotice state={realtimeState} retry={retry} />
        <AssetSourceCard
          showAssetTrend={investmentHistory === null && !openingRecord}
          trendContent={<SourceInvestmentPerformance
            rangeControls={
              <div className="asset-source-detail__analysis-controls">
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
                          disabled={rangePending || (option.value === "custom" && firstSourceTrendDay === undefined)}
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
              </div>
            }
            history={investmentHistory}
            sourceId={source.id}
            sourceName={name}
            records={investmentRecords}
            observations={manual ? [] : history}
            source={manual ? undefined : liveSources[0]}
            manualRecords={source.manualRecords ?? []}
            currentDay={currentDay}
            preset={preset}
            customRange={customRange}
            showSensitiveInfo={showSensitiveInfo}
            onEdit={setInvestmentRecord}
            onDelete={setDeletingInvestmentRecord}
          />}
          showRefreshControl={false}
          totalAnimationKey={source.kind === "longbridge" ? source.snapshot.syncedAt : undefined}
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
          source={liveSources[0]}
          trendBenchmark={null}
          trendDays={sourceTrend.days}
          trendRange="30d"
        />
      </section>
      <div className="asset-source-detail__account-info">
        <section aria-label="来源身份" className="asset-source-detail__metadata">
          <h2>来源身份</h2>
          <SourceDisplayNameForm key={`${source.id}:${source.displayName ?? ""}`} source={source} />
          {manual ? (
            <Suspense fallback={null}>
              <SourceManualAssetClassForm
                key={`${source.id}:${source.manualAssetClass ?? ""}`}
                manualAssetClass={source.manualAssetClass ?? null}
                sourceId={source.id}
              />
            </Suspense>
          ) : null}
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

      </div>
      <SourceLifecycleActions cardHidden={cardHidden} source={source} />

      {investmentRecord !== null ? <SourceInvestmentRecordDialog sourceId={source.id} sourceName={name}
        currentDay={currentDay} currency={investmentCurrency} hasOpening={investmentHistory !== null || !!openingRecord}
        record={investmentRecord} onClose={() => setInvestmentRecord(null)} /> : null}
      {deletingInvestmentRecord ? <SourceInvestmentRecordDeleteDialog sourceName={name} record={deletingInvestmentRecord}
        onClose={() => setDeletingInvestmentRecord(null)} /> : null}

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
