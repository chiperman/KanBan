"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import type {
  AssetPermission,
  DailyAssetTrendObservation,
  ManualAssetRecord,
} from "@/server/ports";
import {
  AssetSourceCard,
  type AssetSourceView,
} from "@/ui/longbridge-asset-card";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeDateField } from "@/ui/vibe/vibe-date-field";
import { VibeDialog } from "@/ui/vibe/vibe-dialog";
import { VibeField, VibeSelectField } from "@/ui/vibe/vibe-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";

type DetailSource = AssetSourceView & {
  permissions: AssetPermission[];
};

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
      description="手工来源只保存每个上海自然日的一条资产总额，不创建持仓或同步记录。"
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
      description="删除后会回退到该来源最新保留的日期记录。"
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
            ? "该来源卡片已从总览隐藏；来源身份、数据和快照仍保留。"
            : "隐藏只影响总览卡片显示，不影响来源身份、同步或历史快照。"}
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
          <p>手工资产记录没有连接或断开能力；永久删除会移除该来源与全部历史记录。</p>
        ) : source.lifecycle === "disconnected" ? (
          <p>该来源已断开，历史数据保留。恢复只会使用仍有效的既有只读授权。</p>
        ) : (
          <p>断开会停止后续同步，但保留来源身份、总览卡片和已经生成的历史快照。</p>
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
          description="停止后续同步，但不会删除来源身份、总览卡片或已经生成的资产快照。"
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
          description="这会永久删除该来源的持仓记录、同步记录和全部资产快照，无法恢复。"
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
          description={`即将永久删除 ${name} 的来源数据及全部历史快照。`}
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
  source,
}: {
  cardHidden: boolean;
  currentDay: string;
  history: DailyAssetTrendObservation[];
  source: DetailSource;
}) {
  const [editingRecord, setEditingRecord] = useState<ManualAssetRecord | null | undefined>(
    null,
  );
  const [deletingRecord, setDeletingRecord] = useState<ManualAssetRecord | null>(
    null,
  );
  const name = assetSourceDisplayName(source);
  const manual = source.kind === "manual";

  return (
    <>
      <section className="asset-source-detail__header">
        <p className="card-label">SOURCE / DETAIL</p>
        <h1>来源详情</h1>
        <p>{manual ? "手工资产记录只维护日期总额，不含凭证、持仓或同步操作。" : "查看单一来源的持仓、趋势、同步与只读授权摘要。"}</p>
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
        </section>
      ) : null}

      <AssetSourceCard
        currentDay={currentDay}
        history={history}
        holdingsSearchQuery=""
        onManualAssetRecord={(current, record) => {
          if (current.id === source.id) setEditingRecord(record ?? undefined);
        }}
        onManualAssetRecordDelete={(current, record) => {
          if (current.id === source.id) setDeletingRecord(record);
        }}
        profitColorScheme="red-up"
        reportingCurrency="USD"
        reportingExchangeRates={source.snapshot.exchangeRates}
        showSensitiveInfo
        source={source}
        trendRange="30d"
      />
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
    </>
  );
}
