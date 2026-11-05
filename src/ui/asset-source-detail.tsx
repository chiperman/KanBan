"use client";

import { LongbridgeConnectionSummary } from "@/ui/longbridge-connection-settings";

import { WorkspaceViewNavigation } from "@/ui/workspace-view-navigation";
import { lazy, Suspense, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { WorkbenchPageHeader } from "@/ui/workbench-page-header";
import { AssetSourceRefreshButton } from "@/ui/asset-refresh-controls";
import { AssetSourceRecoveryAction } from "@/ui/asset-source-recovery";
import { sourceSyncStatus } from "@/ui/asset-source-status";
import { type AssetTrendRange } from "@/ui/asset-trend-panel";
import { ManualAssetRecordCheck, ManualAssetRecordDialog } from "@/ui/manual-asset-record-dialog";

import { assetSourceDefaultDisplayName, assetSourceDisplayName } from "@/domain/asset-source-display-name";
import { defaultManualAssetRecordCurrency } from "@/domain/manual-asset-records";
import {
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
import { useWorkbenchDisplayPreferences } from "@/ui/workbench-display-preferences";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import { VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";
import { VibeDialog } from "@/ui/vibe/vibe-dialog";
import { VibeIcon } from "@/ui/vibe/vibe-icon";
import {
  VibeField,
  VibeSelect,
} from "@/ui/vibe/vibe-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { CURRENCY_OPTIONS } from "@/ui/reporting-currency-options";
import { useSourceSettingDraft } from "@/ui/use-source-setting-draft";
import { AssetSourceCommandFeedback, useAssetSourceCommand } from "@/ui/asset-source-command";

type DetailSource = AssetSourceView & {
  permissions: AssetPermission[];
};

type SourceCommandController = ReturnType<typeof useAssetSourceCommand>;

// 资产类别表单只服务手工来源，动态导入避免自动来源页面下载其代码。
const SourceManualAssetClassForm = lazy(() =>
  import("./source-manual-asset-class-form").then((module) => ({
    default: module.SourceManualAssetClassForm,
  })),
);

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
  return permissions.map((permission) => labels[permission]).join("，");
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

function ManualRecordDeleteDialog({
  operation,
  onClose,
  record,
  source,
}: {
  operation: SourceCommandController;
  onClose(): void;
  record: ManualAssetRecord;
  source: DetailSource;
}) {
  const name = assetSourceDisplayName(source);

  async function remove() {
    await operation.run(source.id, { action: "delete-manual-record", day: record.day }, onClose);
  }

  return (
    <VibeDialog
      actions={
        <>
          <VibeButton disabled={operation.busy} onClick={onClose} type="button" variant="text">
            取消
          </VibeButton>
          {!operation.needsCheck ? (
            <VibeButton tone="danger" disabled={operation.blocked} onClick={() => void remove()} type="button" variant="outline">
              {operation.pending ? "正在删除…" : "删除数据"}
            </VibeButton>
          ) : null}
        </>
      }
      aria-label={`删除 ${name} ${record.day} 数据`}
      description="将显示上一条保留记录。"
      pending={operation.busy}
      onClose={onClose}
      title={`删除 ${name} ${record.day} 数据`}
      titleId="manual-record-delete-dialog-title"
    >
      <AssetSourceCommandFeedback failure={operation.failure} onContinue={() => {
        operation.continueAfterCheck();
        onClose();
      }} />
    </VibeDialog>
  );
}

function SourceDisplayNameForm({ source }: { source: DetailSource }) {
  const {
    value: displayName,
    dirty,
    saved,
    setValue: setDisplayName,
    markSaved,
  } = useSourceSettingDraft(source.displayName ?? "", (value) => value.trim());
  const saving = useAssetSourceCommand();

  async function save() {
    if (!dirty) return;
    await saving.run(source.id, { action: "rename", displayName }, () => markSaved(displayName));
  }

  return (
    <form className="asset-source-detail__form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="asset-source-detail__form-row">
        <VibeField
          aria-describedby="source-display-name-hint"
          autoComplete="off"
          disabled={saving.blocked}
          fieldId="source-display-name"
          label="自定义名称"
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder={assetSourceDefaultDisplayName(source)}
          value={displayName}
        />
        <VibeButton
          disabled={saving.blocked || !dirty}
          type="submit"
          variant="outline"
        >
          {saving.pending ? "正在保存…" : saving.refreshing ? "正在更新…" : "保存名称"}
        </VibeButton>
      </div>
      <p className="trend-note" id="source-display-name-hint">仅修改本看板中的显示名称。清空后恢复默认名称。</p>
      <div role="status">{saved ? <VibeNotice tone="success">{saving.refreshing ? "名称已保存，正在更新页面…" : "名称已保存。"}</VibeNotice> : null}</div>
      <AssetSourceCommandFeedback failure={saving.failure} onContinue={saving.continueAfterCheck} />
    </form>
  );
}

type SourceLifecycleAction = "disconnect" | "restore" | "delete";

function SourceLifecycleActions({
  operation,
  source,
}: {
  operation: SourceCommandController;
  source: DetailSource;
}) {
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [deleteStep, setDeleteStep] = useState<1 | 2 | null>(null);
  const name = assetSourceDisplayName(source);
  const manual = source.kind === "manual";
  const { busy, blocked, needsCheck, failure } = operation;
  const pendingAction = operation.pendingRequest?.command.action;

  async function run(action: SourceLifecycleAction) {
    if (action === "delete" && deleteStep !== 2) return;
    if (action === "disconnect" && !confirmDisconnect) return;
    await operation.run(source.id, action === "delete"
      ? { action: "delete-source-data", confirmation: "DELETE_SOURCE_DATA" }
      : { action }, () => {
      setConfirmDisconnect(false);
      setDeleteStep(null);
    });
  }

  function continueAfterCheck() {
    operation.continueAfterCheck();
    setConfirmDisconnect(false);
    setDeleteStep(null);
  }

  const feedback = <AssetSourceCommandFeedback failure={failure} onContinue={continueAfterCheck} />;

  return (
    <>
      <section aria-busy={busy} aria-labelledby="source-danger-heading" className="asset-source-detail__setting-section">
        <h2 id="source-danger-heading">危险操作</h2>
        <div className="asset-source-detail__setting-content">
          {!manual ? (
            <div className="asset-source-detail__management-row">
              <div>
                <h3>{source.lifecycle === "disconnected" ? "恢复来源连接" : "断开来源"}</h3>
                <p>{source.lifecycle === "disconnected" ? "已断开；历史数据保留。" : "断开将停止同步；历史数据保留。"}</p>
              </div>
              {source.lifecycle === "disconnected" ? (
                <VibeButton
                  disabled={blocked}
                  onClick={() => void run("restore")}
                  type="button"
                  variant="outline"
                >
                  {pendingAction === "restore" ? "正在恢复…" : operation.refreshing ? "正在更新…" : "恢复连接"}
                </VibeButton>
              ) : (
                <VibeButton
                  disabled={blocked}
                  onClick={() => { if (operation.clearFailure()) setConfirmDisconnect(true); }}
                  type="button"
                  variant="outline"
                  tone="danger"
                >
                  断开来源
                </VibeButton>
              )}
            </div>
          ) : null}
          <div className="asset-source-detail__management-row">
            <div>
              <h3>删除来源数据</h3>
              <p>永久删除来源及全部历史记录，无法恢复。</p>
            </div>
            <VibeButton
              disabled={blocked}
              onClick={() => { if (operation.clearFailure()) setDeleteStep(1); }}
              type="button"
              variant="outline"
              tone="danger"
            >
              永久删除数据
            </VibeButton>
          </div>
          {!confirmDisconnect && deleteStep === null ? (
            <AssetSourceCommandFeedback failure={failure} focusRecoveryOnMount onContinue={continueAfterCheck} />
          ) : null}
        </div>
      </section>

      {confirmDisconnect ? (
        <VibeDialog
          actions={
            <>
              <VibeButton disabled={busy} onClick={() => setConfirmDisconnect(false)} type="button" variant="text">
                取消
              </VibeButton>
              {!needsCheck ? (
                <VibeButton tone="danger" disabled={blocked} onClick={() => void run("disconnect")} type="button" variant="outline">
                  {operation.pending ? "正在断开…" : "确认断开"}
                </VibeButton>
              ) : null}
            </>
          }
          description="停止同步；历史数据保留。"
          pending={busy}
          onClose={() => setConfirmDisconnect(false)}
          title={`确认断开 ${name}`}
          titleId="source-disconnect-dialog-title"
        >
          {feedback}
        </VibeDialog>
      ) : null}

      {deleteStep !== null ? (
        <VibeDialog
          actions={
            <>
              <VibeButton disabled={busy} onClick={() => setDeleteStep(null)} type="button" variant="text">
                取消
              </VibeButton>
              {!needsCheck ? (
                <VibeButton
                  key={deleteStep}
                  tone="danger"
                  disabled={blocked}
                  onClick={(event) => {
                    if (event.detail > 1) return;
                    if (deleteStep === 1) setDeleteStep(2);
                    else void run("delete");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && event.repeat) event.preventDefault();
                  }}
                  type="button"
                  variant="outline"
                >
                  {operation.pending ? "正在删除…" : deleteStep === 1 ? "继续删除" : "确认永久删除"}
                </VibeButton>
              ) : null}
            </>
          }
          description={deleteStep === 1
            ? "将永久删除来源及全部历史数据，无法恢复。"
            : `将永久删除 ${name} 及全部历史数据。`}
          pending={busy}
          onClose={() => setDeleteStep(null)}
          title={deleteStep === 1 ? "永久删除来源数据" : "第二次确认永久删除"}
          titleId={deleteStep === 1 ? "source-delete-dialog-title" : "source-delete-confirmation-dialog-title"}
        >
          {deleteStep === 2 ? feedback : null}
        </VibeDialog>
      ) : null}
    </>
  );
}

export function AssetSourceDetail({
  view = "overview",
  initialUpdate = false,
  checkRecordDay,
  bookId,
  showAssetTrend,
  initialPreset = "all",
  initialCustomRange = null,
  firstDay,
  currentDay,
  history,
  profitColorScheme,
  reportingExchangeRates,
  source,
}: {
  view?: "overview" | "manage";
  initialUpdate?: boolean;
  checkRecordDay?: string;
  bookId?: import("@/domain/investment-books").InvestmentBookId;
  showAssetTrend: boolean;
  initialPreset?: InvestmentPerformanceIntervalPreset;
  initialCustomRange?: InvestmentPerformanceCustomRange | null;
  firstDay?: string;
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
  const { active: realtimeActive, liveSources, quotes: realtimeQuotes, state: realtimeState, retry } = useLongbridgeRealtime(realtimeSources);
  const [editingRecord, setEditingRecord] = useState<ManualAssetRecord | null | undefined>(
    initialUpdate && source.kind === "manual" ? undefined : null,
  );
  const [deletingRecord, setDeletingRecord] = useState<ManualAssetRecord | null>(
    null,
  );
  const preset = initialPreset;
  const customRange = initialCustomRange;
  const router = useRouter();
  const destructiveOperation = useAssetSourceCommand();
  const [rangePending, startRangeTransition] = useTransition();
  function navigateRange(value: InvestmentPerformanceIntervalPreset, range: InvestmentPerformanceCustomRange | null) {
    const params = new URLSearchParams({interval:value});
    if (range) { params.set("from", range.startDay); params.set("to", range.endDay); }
    startRangeTransition(() => router.push("/asset-sources/" + encodeURIComponent(source.id) + "?" + params, {scroll:false}));
  }

  const name = assetSourceDisplayName(source);
  const manual = source.kind === "manual";
  const syncNotice = source.lifecycle !== "disconnected" ? sourceSyncStatus(source) : null;
  const firstSourceTrendDay = useMemo(
    () => firstDay ?? history.flatMap((observation) =>
      observation.sources.some((item) => item.sourceId === source.id)
        ? [observation.day]
        : []
    ).toSorted().at(0),
    [firstDay, history, source.id],
  );
  const trendRange: AssetTrendRange = {
    preset, customRange, currentDay, firstDay: firstSourceTrendDay,
    pending: rangePending, onChange: navigateRange,
  };

  return (
    <>
      <section className="asset-source-detail__header">
        <WorkbenchPageHeader
          description={realtimeActive ? <LongbridgeRealtimeStatus state={realtimeState} /> : undefined}
          title={name}
          backLink={{ href: "/settings?view=data#asset-sources", label: "返回资产来源" }}
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
            {manual ? (
              <VibeButton
                className="manual-asset-record-button"
                onClick={() => setEditingRecord(undefined)}
                type="button"
                variant="outline"
              >
                <VibeIcon name="plus" />
                <span>更新资产</span>
              </VibeButton>
            ) : source.lifecycle !== "disconnected" ? (
              <AssetSourceRefreshButton sourceId={source.id} sourceName={name} />
            ) : null}
          </>}
        />
      </section>

      <WorkspaceViewNavigation label="来源详情视角" current={`/asset-sources/${encodeURIComponent(source.id)}?${view === "manage" ? "view=manage&" : ""}interval=${preset}${customRange ? `&from=${customRange.startDay}&to=${customRange.endDay}` : ""}`} items={[
        { href: `/asset-sources/${encodeURIComponent(source.id)}?interval=${preset}${customRange ? `&from=${customRange.startDay}&to=${customRange.endDay}` : ""}`, label: "资产概况" },
        { href: `/asset-sources/${encodeURIComponent(source.id)}?view=manage&interval=${preset}${customRange ? `&from=${customRange.startDay}&to=${customRange.endDay}` : ""}`, label: "连接与管理" },
      ]} />
      {view === "overview" ? <section aria-label="来源分析" className="asset-source-detail__analysis">
        {manual && checkRecordDay ? <ManualAssetRecordCheck sourceId={source.id} sourceName={name} day={checkRecordDay} records={source.manualRecords ?? []} /> : null}
        {bookId ? <p className="trend-note">本来源提供资产余额。<VibeLink href={`/performance?book=${bookId}`} variant="text">查看所属账本的本金与收益</VibeLink></p> : null}
        <LongbridgeRealtimeNotice state={realtimeState} retry={retry} sourceId={source.id} />
        <AssetSourceCard
          realtimeQuotes={realtimeQuotes}
          realtimeState={realtimeState}
          onRetryRealtime={retry}
          showAssetTrend={showAssetTrend}
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
            if (current.id === source.id && destructiveOperation.clearFailure()) setDeletingRecord(record);
          }}
          profitColorScheme={profitColorScheme}
          reportingCurrency={currency}
          reportingExchangeRates={reportingExchangeRates}
          showSensitiveInfo={showSensitiveInfo}
          source={liveSources[0]}
          trendBenchmark={null}
          trendRangeSelection={trendRange}
        />
      </section> : <div className="asset-source-detail__settings">
        <section aria-labelledby="source-identity-heading" className="asset-source-detail__setting-section">
          <h2 id="source-identity-heading">基本信息</h2>
          <div className="asset-source-detail__setting-content">
            <dl>
              <div>
                <dt>来源类型</dt>
                <dd>{manual ? "手工资产记录" : source.kind.startsWith("evm-watch-") ? "观察钱包" : "自动账户"}</dd>
              </div>
            </dl>
            <SourceDisplayNameForm key={source.id} source={source} />
            {manual ? (
              <Suspense fallback={null}>
                <SourceManualAssetClassForm
                  key={source.id}
                  manualAssetClass={source.manualAssetClass ?? null}
                  sourceId={source.id}
                />
              </Suspense>
            ) : null}
            <details className="asset-source-detail__disclosure">
              <summary>来源标识</summary>
<p>{source.label.replace(/\s+[·・]\s+/g, "，")}</p>
            </details>
          </div>
        </section>

        {!manual ? (
          <section aria-labelledby="source-connection-heading" className="asset-source-detail__setting-section">
            <h2 id="source-connection-heading">连接与授权</h2>
            <div className="asset-source-detail__setting-content">
              <VibeStatusTag tone={source.lifecycle === "disconnected" ? "muted" : "success"}>
                {authorizationStatus(source)}
              </VibeStatusTag>
              {syncNotice ? <VibeNotice tone={syncNotice.tone}>
                <p>{syncNotice.label}</p>
                {source.sync.error !== null ? <AssetSourceRecoveryAction hideManageLink source={{ ...source, displayName: name }} /> : null}
              </VibeNotice> : null}
              {source.kind === "longbridge" ? (
                <LongbridgeConnectionSummary
                  sourceId={source.id}
                  permissions={permissionSummary(source.permissions)}
                  lastAttemptLabel={formatTime(source.sync.lastAttemptAt)}
                />
              ) : <>
                <dl>
                  <div><dt>只读权限</dt><dd>{permissionSummary(source.permissions)}</dd></div>
                  <div><dt>最近同步尝试</dt><dd>{formatTime(source.sync.lastAttemptAt)}</dd></div>
                </dl>
                <div className="asset-source-detail__metadata-actions">
                  <VibeLink
                    href={`/asset-sources/${encodeURIComponent(source.id)}/reauthorize`}
                    variant="outline"
                  >
                    {source.kind.startsWith("evm-watch-") ? "管理公开地址" : "重新授权"}
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
              </>}
            </div>
          </section>
        ) : null}

        <SourceLifecycleActions key={source.id} source={source} operation={destructiveOperation} />
      </div>}

      {view === "overview" && !deletingRecord ? (
        <AssetSourceCommandFeedback failure={destructiveOperation.failure} focusRecoveryOnMount onContinue={destructiveOperation.continueAfterCheck} />
      ) : null}

      {manual && editingRecord !== null ? <ManualAssetRecordDialog sourceId={source.id} sourceName={name}
        checkBookId={bookId}
        currentDay={currentDay}
        defaultCurrency={defaultManualAssetRecordCurrency(source.manualRecords)}
        record={editingRecord}
        onClose={() => setEditingRecord(null)} /> : null}

      {manual && deletingRecord ? (
        <ManualRecordDeleteDialog
          operation={destructiveOperation}
          onClose={() => setDeletingRecord(null)}
          record={deletingRecord}
          source={source}
        />
      ) : null}
    </>
  );
}
