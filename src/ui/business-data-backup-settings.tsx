"use client";

import { useRef, useState, type FormEvent } from "react";

import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeDialog } from "@/ui/vibe/vibe-dialog";
import { VibeField } from "@/ui/vibe/vibe-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";

interface BackupPreview {
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
): Promise<T> {
  const response = await fetch("/api/business-data-backups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      fileName === undefined ? { action } : { action, fileName },
    ),
  });
  const result = (await response.json().catch(() => null)) as
    | (T & { error?: never })
    | { error?: string }
    | null;
  if (!response.ok || result === null || "error" in result) {
    throw new Error(
      result && "error" in result
        ? result.error ?? "备份操作失败"
        : "备份操作失败",
    );
  }
  return result as T;
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
      const result = await requestBackup<BackupPreview>("restore", candidate);
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
        备份包含来源与历史观察、资金账本及对应的长桥参考汇率观察；恢复会替换这些业务数据。外部来源凭证、令牌和密钥不会导出、回显或恢复。
      </p>
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
      <div className="business-data-restore">
        <VibeField
          fieldId="business-data-backup-file-name"
          label="要恢复的本机备份文件名"
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
          已恢复业务数据与资金账本。自动来源保持断开，需重新提供只读授权材料。
        </VibeNotice>
      ) : null}
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
              此操作会替换当前业务数据。{preview.warning}
              资金账本及其长桥参考汇率观察会一并恢复；自动来源保持断开，必须重新提供只读授权材料。
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
