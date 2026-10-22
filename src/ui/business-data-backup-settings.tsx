"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import type { BackupRestorePreview, BackupSummary } from "@/server/business-data-backup";
import { BusinessDataBackupDropzone } from "@/ui/business-data-backup-dropzone";
import { formatShanghaiDateTime } from "@/ui/shanghai-date-time";
import { VibeSelectField } from "@/ui/vibe/vibe-field";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeDialog } from "@/ui/vibe/vibe-dialog";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { lockOnUnauthorizedResponse, OWNER_SESSION_EXPIRED_MESSAGE, readJsonResult } from "@/ui/owner-request-lock";

interface BackupPreview extends BackupRestorePreview {
  fileName: string;
}

type BackupOperation = "export" | "preview" | "restore" | "upload";

interface BackupExport {
  checksum: string;
  fileName: string;
  warning: string;
}

async function requestBackup<T>(
  action: "export" | "list" | "preview" | "restore",
  fileName?: string,
  discardConfirmation?: string,
): Promise<T> {
  const response = await fetch("/api/business-data-backups", {
    method: action === "list" ? "GET" : "POST",
    ...(action === "list"
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            fileName === undefined
              ? { action }
              : { action, fileName, discardConfirmation },
          ),
        }),
  });
  const result = await readJsonResult<T & { error?: string }>(response);
  if (lockOnUnauthorizedResponse(response)) throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
  if (!response.ok || result === null || "error" in result) {
    throw new Error(
      result && "error" in result
        ? result.error ?? "备份操作失败"
        : "备份操作失败",
    );
  }
  return result;
}

function previewSummary(preview: BackupPreview) {
  const range = preview.snapshotRange.from && preview.snapshotRange.to
    ? `${preview.snapshotRange.from} 至 ${preview.snapshotRange.to}`
    : "无历史观测";
  return `将恢复 ${preview.sourceCount} 个来源、${preview.cardCount} 张卡片和 ${range} 的历史观测；当前 ${preview.replaces.sourceCount} 个来源、${preview.replaces.cardCount} 张卡片和 ${preview.replaces.snapshotCount} 条日初基准会被替换。`;
}

const NO_BACKUP = "";

function backupOptions(backups: BackupSummary[], selected: string, loading: boolean, failed: boolean) {
  return [
    { label: loading ? "正在读取备份…" : failed ? "备份列表读取失败" : backups.length === 0 ? "暂无可用备份" : "选择备份", value: NO_BACKUP },
    ...(selected && !backups.some((backup) => backup.fileName === selected)
      ? [{ label: selected, value: selected }]
      : []),
    ...backups.map((backup) => ({
      label: `${backup.fileName} · ${
        backup.modifiedAt ? formatShanghaiDateTime(backup.modifiedAt) : "时间未知"
      }`,
      value: backup.fileName,
    })),
  ];
}

function omittedHistorySummary(history: NonNullable<BackupRestorePreview["omittedHistory"]>) {
  const counts = [
    [history.manualAssetRecords, "条手工记录"],
    [history.formalDailySettlements, "条正式日结"],
    [history.sourceInvestmentHistories ?? 0, "份来源投资历史"],
    [history.sourceInvestmentRecords ?? 0, "条来源手工投资记录"],
    [history.investmentBookRecords ?? 0, "条三本账记录或来源范围"],
  ] as const;
  const discarded = counts.filter(([count]) => count > 0).map(([count, label]) => `${count} ${label}`);
  return discarded.length > 0
    ? `本备份缺少的历史域将替换为空：${discarded.join("、")}。确认恢复即确认丢弃这些记录。`
    : "本备份缺少的历史域将替换为空。";
}

export function BusinessDataBackupSettings() {
  const [exported, setExported] = useState<BackupExport | null>(null);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [restored, setRestored] = useState<BackupPreview | null>(null);
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(true);
  const [listError, setListError] = useState("");
  const listRequestRef = useRef(0);
  const [fileName, setFileName] = useState(NO_BACKUP);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState<BackupOperation | null>(null);
  const pendingRef = useRef<BackupOperation | null>(null);
  const [error, setError] = useState("");

  function beginOperation(operation: BackupOperation) {
    if (pendingRef.current !== null) return false;
    pendingRef.current = operation;
    setPending(operation);
    setError("");
    return true;
  }

  function finishOperation() {
    pendingRef.current = null;
    setPending(null);
  }

  async function loadBackups() {
    const requestId = ++listRequestRef.current;
    setLoadingBackups(true);
    setListError("");
    try {
      const result = await requestBackup<{ backups: BackupSummary[] }>("list");
      if (requestId === listRequestRef.current) setBackups(result.backups);
    } catch (caught) {
      if (requestId === listRequestRef.current) {
        setListError(caught instanceof Error ? caught.message : "读取备份列表失败");
      }
    } finally {
      if (requestId === listRequestRef.current) setLoadingBackups(false);
    }
  }

  useEffect(() => {
    void loadBackups();
  }, []);

  function selectBackup(next: string) {
    if (pendingRef.current !== null) return;
    setFileName(next);
    setPreview(null);
    setRestored(null);
    setConfirmOpen(false);
  }

  async function exportBackup() {
    if (!beginOperation("export")) return;
    try {
      const result = await requestBackup<BackupExport>("export");
      setExported(result);
      setPreview(null);
      setRestored(null);
      await loadBackups();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导出业务数据备份失败");
    } finally {
      finishOperation();
    }
  }

  async function previewRestore() {
    if (pendingRef.current !== null) return;
    const candidate = fileName;
    if (!candidate) {
      setError(backups.length === 0 ? "暂无可恢复的备份" : "请先选择要恢复的备份");
      return;
    }
    if (!beginOperation("preview")) return;
    try {
      const result = await requestBackup<BackupRestorePreview>("preview", candidate);
      setPreview({ ...result, fileName: candidate });
      setRestored(null);
    } catch (caught) {
      setPreview(null);
      setError(caught instanceof Error ? caught.message : "无法预演恢复");
    } finally {
      finishOperation();
    }
  }

  async function restore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current !== null) return;
    if (!preview || preview.fileName !== fileName) {
      setError("备份选择已变化，请重新预演恢复");
      return;
    }
    const candidate = preview.fileName;
    if (!beginOperation("restore")) return;
    try {
      const result = await requestBackup<BackupRestorePreview>("restore", candidate, preview.discardConfirmation);
      const restoredPreview = { ...result, fileName: candidate };
      setPreview(restoredPreview);
      setRestored(restoredPreview);
      setConfirmOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "恢复业务数据失败");
    } finally {
      finishOperation();
    }
  }

  return (
    <section
      className="data-maintenance-section business-data-backup-settings"
      aria-labelledby="business-data-backup-title"
    >
      <h2 id="business-data-backup-title">备份与恢复</h2>
      <div className="data-maintenance-section__content">
        <p className="settings-description">
          备份业务数据与资金账本。恢复会替换当前数据；不含凭证、令牌和密钥。
        </p>
        {/* 导出与恢复方向相反：分成两组，避免把「备份文件名」误读成导出目标 */}
        <div className="business-data-backup-settings__group">
          <p className="business-data-backup-settings__group-label">导出</p>
          <div className="business-data-backup-settings__actions">
            <VibeButton
              disabled={pending !== null}
              onClick={() => void exportBackup()}
              type="button"
              variant="primary"
            >
              {pending === "export" ? "正在导出…" : "导出业务数据备份"}
            </VibeButton>
          </div>
          {exported && !restored ? (
            <VibeNotice role="status" tone="success">
              已导出本机备份 {exported.fileName}。{exported.warning}
            </VibeNotice>
          ) : null}
        </div>
        <div className="business-data-backup-settings__group business-data-backup-settings__group--restore">
          <p className="business-data-backup-settings__group-label">
            从本机备份恢复
            <span className="business-data-backup-settings__group-caveat">
              会替换当前业务数据
            </span>
          </p>
          <BusinessDataBackupDropzone
            disabled={pending !== null || confirmOpen}
            onUploadStart={() => {
              if (!beginOperation("upload")) return false;
              setPreview(null);
              setRestored(null);
              setConfirmOpen(false);
              return true;
            }}
            onUploadEnd={finishOperation}
            onUploaded={(backup) => {
              setFileName(backup.fileName);
              setPreview(null);
              setRestored(null);
              void loadBackups();
            }}
            onError={setError}
          />
          <div className="business-data-restore">
            <VibeSelectField
              disabled={pending !== null}
              fieldId="business-data-backup-file-name"
              label="选择备份"
              onValueChange={selectBackup}
              options={backupOptions(backups, fileName, loadingBackups, listError !== "")}
              value={fileName}
            />
            <VibeButton
              disabled={pending !== null}
              onClick={() => void previewRestore()}
              type="button"
              variant="outline"
            >
              {pending === "preview" ? "正在预演…" : "预演恢复"}
            </VibeButton>
          </div>
          {listError ? (
            <VibeNotice role="alert" tone="error">
              读取备份列表失败：{listError}
              <VibeButton
                disabled={loadingBackups || pending !== null}
                onClick={() => void loadBackups()}
                type="button"
                variant="text"
              >
                重新加载备份
              </VibeButton>
            </VibeNotice>
          ) : null}
          {preview ? (
            <div className="business-data-restore__preview">
              <p>{previewSummary(preview)}</p>
              <VibeNotice tone="info">{preview.warning}</VibeNotice>
              <VibeButton
                disabled={pending !== null}
                onClick={() => setConfirmOpen(true)}
                type="button"
                variant="outline"
              >
                恢复此业务数据备份
              </VibeButton>
            </div>
          ) : null}
          {restored ? (
            <VibeNotice role="status" tone="success">
              已恢复。自动来源需重新授权。
            </VibeNotice>
          ) : null}
        </div>
        {error ? (
          <VibeNotice role="alert" tone="error">
            {error}
          </VibeNotice>
        ) : null}
        {confirmOpen && preview ? (
          <VibeDialog
            actions={
              <>
                <VibeButton
                  disabled={pending === "restore"}
                  onClick={() => setConfirmOpen(false)}
                  type="button"
                  variant="text"
                >
                  取消
                </VibeButton>
                <VibeButton
                  disabled={pending === "restore"}
                  type="submit"
                  variant="primary"
                >
                  {pending === "restore" ? "正在恢复…" : "确认恢复"}
                </VibeButton>
              </>
            }
            description={
              <>
                将覆盖当前业务数据。自动来源需重新授权。
                {preview.omittedHistory ? omittedHistorySummary(preview.omittedHistory) : null}
              </>
            }
            eyebrow="LOCAL BACKUP / RESTORE"
            onClose={() => setConfirmOpen(false)}
            onSubmit={restore}
            title="确认恢复业务数据"
            titleId="business-data-restore-confirm-title"
          >
            <p className="business-data-restore__dialog-summary">
              {previewSummary(preview)}
            </p>
          </VibeDialog>
        ) : null}
      </div>
    </section>
  );
}
