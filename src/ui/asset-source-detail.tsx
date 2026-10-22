"use client";

import { LongbridgeConnectionSummary } from "@/ui/longbridge-connection-settings";

import { WorkspaceViewNavigation } from "@/ui/workspace-view-navigation";
import { lazy, Suspense, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { WorkbenchPageHeader } from "@/ui/workbench-page-header";
import { AssetSourceRefreshButton } from "@/ui/asset-refresh-controls";
import { sourceSyncStatus } from "@/ui/asset-source-status";
import { type AssetTrendRange } from "@/ui/asset-trend-panel";
import { SourceInvestmentPerformance } from "@/ui/source-investment-performance";
import type { SourceInvestmentHistory } from "@/domain/source-investment-history";
import type { SourceInvestmentRecord } from "@/domain/source-investment-records";
import { SourceInvestmentRecordDialog, SourceInvestmentRecordDeleteDialog } from "@/ui/source-investment-record-dialog";

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
import { lockOnUnauthorizedResponse, OWNER_SESSION_EXPIRED_MESSAGE, readJsonResult } from "@/ui/owner-request-lock";
import { CURRENCY_OPTIONS } from "@/ui/reporting-currency-options";

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
    <form className="asset-source-detail__form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="asset-source-detail__form-row">
        <VibeField
          aria-describedby="source-display-name-hint"
          autoComplete="off"
          disabled={pending}
          fieldId="source-display-name"
          label="自定义名称"
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder={assetSourceDefaultDisplayName(source)}
          value={displayName}
        />
        <VibeButton
          disabled={pending || displayName.trim() === (source.displayName ?? "")}
          type="submit"
          variant="outline"
        >
          {pending ? "正在保存…" : "保存名称"}
        </VibeButton>
      </div>
      <p className="trend-note" id="source-display-name-hint">仅修改本看板中的显示名称。清空后恢复默认名称。</p>
      {error ? <VibeNotice role="alert" tone="error">{error}</VibeNotice> : null}
    </form>
  );
}

type SourceLifecycleAction = "visibility" | "disconnect" | "restore" | "delete";

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
  const [failure, setFailure] = useState<{ action: SourceLifecycleAction; message: string } | null>(null);
  const name = assetSourceDisplayName(source);
  const manual = source.kind === "manual";

  async function run(
    action: SourceLifecycleAction,
    body: Record<string, unknown> = {},
  ) {
    setPending(true);
    setFailure(null);
    try {
      if (action === "delete") {
        await sourceRequest(`/api/asset-sources/${encodeURIComponent(source.id)}`, "DELETE", {
          confirmation: "DELETE_SOURCE_DATA",
        });
        router.push("/assets?view=sources#asset-sources");
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
      setFailure({ action, message: caught instanceof Error ? caught.message : "来源操作失败" });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <section aria-labelledby="source-display-heading" className="asset-source-detail__setting-section">
        <h2 id="source-display-heading">显示</h2>
        <div className="asset-source-detail__setting-content">
          <div className="asset-source-detail__management-row">
            <div>
              <h3>总览卡片</h3>
              <p>{hidden ? "已隐藏，可随时恢复显示。" : "隐藏后仍保留来源与历史数据。"}</p>
            </div>
            <VibeButton
              disabled={pending}
              onClick={() => void run("visibility", { hidden: !hidden })}
              type="button"
              variant="outline"
            >
              {hidden ? "恢复显示" : "隐藏卡片"}
            </VibeButton>
          </div>
          {failure?.action === "visibility" ? (
            <VibeNotice role="alert" tone="error">{failure.message}</VibeNotice>
          ) : null}
        </div>
      </section>
      <section aria-labelledby="source-danger-heading" className="asset-source-detail__setting-section">
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
                  onClick={() => { setFailure(null); setConfirmDisconnect(true); }}
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
              disabled={pending}
              onClick={() => { setFailure(null); setDeleteStep(1); }}
              type="button"
              variant="outline"
              tone="danger"
            >
              永久删除数据
            </VibeButton>
          </div>
          {failure && failure.action !== "visibility" && !confirmDisconnect && deleteStep === null ? (
            <VibeNotice role="alert" tone="error">{failure.message}</VibeNotice>
          ) : null}
        </div>
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
        >
          {failure?.action === "disconnect" ? <VibeNotice role="alert" tone="error">{failure.message}</VibeNotice> : null}
        </VibeDialog>
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
        >
          {failure?.action === "delete" ? <VibeNotice role="alert" tone="error">{failure.message}</VibeNotice> : null}
        </VibeDialog>
      ) : null}
    </>
  );
}

export function AssetSourceDetail({
  view = "overview",
  initialUpdate = false,
  bookId,
  bookMode = false,
  investmentHistory = null,
  investmentRecords = [],
  initialPreset = "all",
  initialCustomRange = null,
  firstDay,
  cardHidden,
  currentDay,
  history,
  profitColorScheme,
  reportingExchangeRates,
  source,
}: {
  view?: "overview" | "manage";
  initialUpdate?: boolean;
  bookId?: import("@/domain/investment-books").InvestmentBookId;
  bookMode?: boolean;
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
  const [investmentRecord, setInvestmentRecord] = useState<SourceInvestmentRecord | null | undefined>(initialUpdate && source.kind === "manual" ? undefined : null);
  const [deletingInvestmentRecord, setDeletingInvestmentRecord] = useState<SourceInvestmentRecord | null>(null);
  const preset = initialPreset;
  const customRange = initialCustomRange;
  const router = useRouter();
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

  const openingRecord = investmentRecords.find(record => record.kind === "opening");
  const investmentCurrency = investmentHistory?.currency ?? investmentRecords[0]?.currency ?? null;

  return (
    <>
      <section className="asset-source-detail__header">
        <WorkbenchPageHeader
          description={realtimeActive ? <LongbridgeRealtimeStatus state={realtimeState} /> : undefined}
          eyebrow="SOURCE / DETAIL"
          title={name}
          backLink={view === "manage"
            ? { href: "/assets?view=sources#asset-sources", label: "返回资产" }
            : { href: "/assets", label: "返回资产" }}
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
                onClick={() => setInvestmentRecord(undefined)}
                type="button"
                variant="outline"
              >
                <VibeIcon name="plus" />
                <span>{bookMode ? "更新资产" : "添加记录"}</span>
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
        {bookId ? <p className="trend-note">本来源提供资产余额。<VibeLink href={`/performance?book=${bookId}`} variant="text">查看所属账本的本金与收益</VibeLink></p> : null}
        <LongbridgeRealtimeNotice state={realtimeState} retry={retry} />
        <AssetSourceCard
          showAssetTrend={bookMode || (investmentHistory === null && !openingRecord)}
          trendContent={bookMode ? undefined : <SourceInvestmentPerformance
            range={trendRange}
            history={investmentHistory}
            sourceId={source.id}
            sourceName={name}
            records={investmentRecords}
            observations={manual ? [] : history}
            source={manual ? undefined : liveSources[0]}
            manualRecords={source.manualRecords ?? []}
            currentDay={currentDay}
            showSensitiveInfo={showSensitiveInfo}
            onEdit={manual ? setInvestmentRecord : undefined}
            onDelete={manual ? setDeletingInvestmentRecord : undefined}
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
            <details className="asset-source-detail__disclosure">
              <summary>来源标识</summary>
              <p>{source.label}</p>
            </details>
          </div>
        </section>

        {!manual ? (
          <section aria-labelledby="source-connection-heading" className="asset-source-detail__setting-section">
            <h2 id="source-connection-heading">连接与授权</h2>
            <div className="asset-source-detail__setting-content">
              <VibeStatusTag tone="muted">
                {authorizationStatus(source)}
              </VibeStatusTag>
              {syncNotice ? <VibeNotice tone={syncNotice.tone === "warning" ? "info" : syncNotice.tone}>{syncNotice.label}</VibeNotice> : null}
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

        <SourceLifecycleActions key={source.id} cardHidden={cardHidden} source={source} />
      </div>}

      {manual && (investmentRecord !== null || editingRecord !== null) ? <SourceInvestmentRecordDialog sourceId={source.id} sourceName={name}
        assetOnly={bookMode}
        currentDay={currentDay} currency={investmentCurrency} hasOpening={investmentHistory !== null || !!openingRecord}
        defaultCurrency={defaultManualAssetRecordCurrency(source.manualRecords)}
        record={investmentRecord ?? undefined} manualRecord={editingRecord ?? undefined}
        onClose={() => { setInvestmentRecord(null); setEditingRecord(null); }} /> : null}
      {manual && deletingInvestmentRecord ? <SourceInvestmentRecordDeleteDialog sourceName={name} record={deletingInvestmentRecord}
        onClose={() => setDeletingInvestmentRecord(null)} /> : null}

      {manual && deletingRecord ? (
        <ManualRecordDeleteDialog
          onClose={() => setDeletingRecord(null)}
          record={deletingRecord}
          source={source}
        />
      ) : null}
    </>
  );
}
