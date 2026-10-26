"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  lockOnUnauthorizedResponse,
  OWNER_SESSION_EXPIRED_MESSAGE,
  readJsonResult,
} from "@/ui/owner-request-lock";
import { VibeButton } from "@/ui/vibe/vibe-button";

/** 与服务端 MAX_BACKUP_CONTENTS_BYTES 一致。 */
const MAX_BYTES = 32 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 120_000;

export interface UploadedBackup {
  fileName: string;
  warning: string;
}

interface BusinessDataBackupDropzoneProps {
  disabled?: boolean;
  /** 与调用方共用操作锁，防止上传与预演、恢复交错。 */
  onUploadStart(): boolean;
  onUploadEnd(): void;
  /** 上传并落盘成功后回调，调用方选中该文件。 */
  onUploaded(backup: UploadedBackup): void;
  onError(message: string, outcomeUnknown?: boolean): void;
}

const fmt = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

type Phase =
  | { kind: "idle" }
  | { kind: "sending"; fileName: string; size: number; progress: number }
  | { kind: "done"; fileName: string; size: number };

function UploadIcon() {
  return (
    <svg
      aria-hidden="true"
      className="business-data-dropzone__glyph"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
    >
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

/**
 * 备份上传区：拖拽或选择本机 `.json` 备份，用 XHR 的 upload 事件拿到真实上传进度。
 * fetch 读不到上传进度，所以这里不走 fetch；上传完成后服务端才解码校验并落盘。
 */
export function BusinessDataBackupDropzone({
  disabled = false,
  onError,
  onUploadStart,
  onUploadEnd,
  onUploaded,
}: BusinessDataBackupDropzoneProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<XMLHttpRequest | null>(null);
  const dragDepth = useRef(0);

  useEffect(() => () => {
    const request = requestRef.current;
    requestRef.current = null;
    request?.abort();
  }, []);

  const upload = useCallback(
    (file: File) => {
      if (disabled || requestRef.current) return;
      if (!/\.json$/i.test(file.name)) {
        onError("请选择业务数据备份的 .json 文件");
        return;
      }
      if (file.size > MAX_BYTES) {
        onError(`备份文件超过 ${MAX_BYTES / (1024 * 1024)} MB`);
        return;
      }

      const body = new FormData();
      body.append("file", file);
      const request = new XMLHttpRequest();
      if (!onUploadStart()) return;
      requestRef.current = request;
      setPhase({ kind: "sending", fileName: file.name, size: file.size, progress: 0 });

      function finish() {
        if (requestRef.current !== request) return;
        requestRef.current = null;
        onUploadEnd();
      }

      function fail(message: string, outcomeUnknown = false) {
        if (requestRef.current !== request) return;
        setPhase({ kind: "idle" });
        onError(message, outcomeUnknown);
        finish();
      }

      request.upload.addEventListener("progress", (event) => {
        if (!event.lengthComputable) return;
        setPhase((current) =>
          current.kind === "sending"
            ? { ...current, progress: event.loaded / event.total }
            : current,
        );
      });
      request.addEventListener("load", async () => {
        if (requestRef.current !== request) return;
        let outcomeUnknown = request.status >= 500 || (request.status >= 200 && request.status < 300);
        try {
          const response = new Response(request.response, {
            status: request.status,
            headers: { "Content-Type": "application/json" },
          });
          if (lockOnUnauthorizedResponse(response)) {
            throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
          }
          const result = await readJsonResult<
            UploadedBackup & { error?: string }
          >(response);
          if (requestRef.current !== request) return;
          if (!response.ok || result === null || typeof result.fileName !== "string" || typeof result.warning !== "string" || "error" in result) {
            throw new Error(outcomeUnknown ? "尚未确认备份是否保存，请重新读取备份列表后核对。" : result?.error ?? "备份上传未通过，请检查文件后重试。");
          }
          outcomeUnknown = false;
          setPhase({ kind: "done", fileName: result.fileName, size: file.size });
          onUploaded(result);
        } catch (error) {
          setPhase({ kind: "idle" });
          onError(error instanceof Error ? error.message : "上传备份未完成，请检查连接后重试。", outcomeUnknown);
        } finally {
          finish();
        }
      });
      request.addEventListener("error", () => fail("连接中断，尚未确认备份是否保存，请先重新读取备份列表核对。", true));
      request.addEventListener("abort", () => fail("上传已中断，尚未确认备份是否保存，请先重新读取备份列表核对。", true));
      request.addEventListener("timeout", () => fail("等待上传结果超时，备份可能仍在保存；请先重新读取备份列表核对。", true));

      try {
        request.open("POST", "/api/business-data-backups");
        request.responseType = "text";
        request.timeout = UPLOAD_TIMEOUT_MS;
        request.send(body);
      } catch {
        fail("无法开始上传，请检查连接后重试。");
      }
    },
    [disabled, onError, onUploadStart, onUploadEnd, onUploaded],
  );

  const busy = phase.kind === "sending";

  return (
    <div
      className="business-data-dropzone"
      data-dragging={dragging || undefined}
      data-busy={busy || undefined}
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        if (!disabled && !busy) setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        if (disabled || busy) return;
        const file = event.dataTransfer.files.item(0);
        if (file) upload(file);
      }}
    >
      <input
        accept=".json,application/json"
        aria-label="选择业务数据备份文件"
        disabled={disabled || busy}
        hidden
        id={inputId}
        onChange={(event) => {
          const file = event.currentTarget.files?.item(0);
          event.currentTarget.value = "";
          if (file) upload(file);
        }}
        ref={inputRef}
        type="file"
      />

      <div className="business-data-dropzone__prompt">
        {phase.kind === "idle" ? (
          <>
            <UploadIcon />
            <p className="business-data-dropzone__title">
              把备份文件拖到这里，或
            </p>
          </>
        ) : (
          <div className="business-data-dropzone__progress">
            <p className="business-data-dropzone__name">{phase.fileName}</p>
            <p className="business-data-dropzone__meta">
              {phase.kind === "done"
                ? `已保存，${fmt(phase.size)}`
                : phase.progress >= 1
                  ? "正在校验并保存…"
                  : `正在上传，${Math.round(phase.progress * 100)}%`}
            </p>
            <span className="business-data-dropzone__track">
              <span
                className="business-data-dropzone__bar"
                style={{
                  transform: `scaleX(${phase.kind === "done" ? 1 : phase.progress})`,
                }}
              />
            </span>
          </div>
        )}
        <VibeButton
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
          type="button"
          variant="outline"
        >
          {phase.kind === "done" ? "选择其他备份文件" : "选择备份文件"}
        </VibeButton>
        <p className="business-data-dropzone__hint" role="status">
          {phase.kind === "idle"
            ? `仅接受业务数据备份 .json，最大 ${MAX_BYTES / (1024 * 1024)} MB`
            : phase.kind === "done"
              ? `备份 ${phase.fileName} 已保存，可以预演恢复或选择其他文件`
              : `正在上传备份 ${phase.fileName}，请稍候`}
        </p>
      </div>
    </div>
  );
}
