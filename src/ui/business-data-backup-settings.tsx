"use client";

import { useRef, useState, type FormEvent } from "react";

import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeDialog } from "@/ui/vibe/vibe-dialog";
import { VibeField } from "@/ui/vibe/vibe-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { lockOnUnauthorizedResponse, OWNER_SESSION_EXPIRED_MESSAGE, readJsonResult } from "@/ui/owner-request-lock";

interface BackupPreview {
  discardConfirmation?: string;
  omittedHistory?: { manualAssetRecords: number; formalDailySettlements: number };
  cardCount: number;
  replaces: {
    cardCount: number;
    snapshotCount: number;
    sourceCount: number;
  };
  snapshotRange: {
    from: string | null;
    to: string | null;
  };
  sourceCount: number;
  warning: string;
}

interface BackupExport {
  checksum: string;
  fileName: string;
  warning: string;
}

async function requestBackup<T>(
  action: "export" | "preview" | "restore",
  fileName?: string,
  discardConfirmation?: string,
): Promise<T> {
  const response = await fetch("/api/business-data-backups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      fileName === undefined ? { action } : { action, fileName, discardConfirmation },
    ),
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

export function BusinessDataBackupSettings() {
  const [fileName, setFileName] = useState("");
  const [exported, setExported] = useState<BackupExport | null>(null);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [restored, setRestored] = useState<BackupPreview | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState<"export" | "preview" | "restore" | null>(
    null,
  );
  const [error, setError] = useState("");
  const restoreFieldRef = useRef<HTMLInputElement>(null);

  async function exportBackup() {
    setPending("export");
    setError("");
    try {
      const result = await requestBackup<BackupExport>("export");
      setExported(result);
      setFileName(result.fileName);
      setPreview(null);
      setRestored(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导出业务数据备份失败");
    } finally {
      setPending(null);
    }
  }

  async function previewRestore() {
    const candidate = fileName.trim();
    if (!candidate) {
      setError("请先输入要恢复的本机备份文件名");
      restoreFieldRef.current?.focus();
      return;
    }
    setPending("preview");
    setError("");
    try {
      setPreview(await requestBackup<BackupPreview>("preview", candidate));
      setRestored(null);
    } catch (caught) {
      setPreview(null);
      setError(caught instanceof Error ? caught.message : "无法预演恢复");
      restoreFieldRef.current?.focus();
    } finally {
      setPending(null);
    }
  }

  async function restore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = fileName.trim();
    if (!candidate) return;
    setPending("restore");
    setError("");
    try {
      const result = await requestBackup<BackupPreview>("restore", candidate, preview?.discardConfirmation);
      setPreview(result);
      setRestored(result);
      setConfirmOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "恢复业务数据失败");
    } finally {
      setPending(null);
    }
  }

  return (
    <section
      className="settings-section business-data-backup-settings"
      aria-labelledby="business-data-backup-title"
    >
      <h2 id="business-data-backup-title">备份与恢复</h2>
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
        <div className="business-data-restore">
          <VibeField
            fieldId="business-data-backup-file-name"
            label="备份文件名"
            name="fileName"
            onChange={(event) => {
              setFileName(event.currentTarget.value);
              setPreview(null);
              setRestored(null);
            }}
            placeholder="asset-dashboard-….json"
            ref={restoreFieldRef}
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
              {preview.omittedHistory ? "本备份缺少的历史域将替换为空：" + preview.omittedHistory.manualAssetRecords + " 条手工记录、" + preview.omittedHistory.formalDailySettlements + " 条正式日结。确认恢复即确认丢弃这些记录。" : null}
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
    </section>
  );
}
