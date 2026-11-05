"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { RecordSaveOutcomeUnknown } from "@/ui/financial-record-requests";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import { VibeDialog, type VibeDialogConfirmation } from "@/ui/vibe/vibe-dialog";
import { VibeNotice } from "@/ui/vibe/vibe-notice";

type SaveState =
  | { status: "idle" | "pending" }
  | { status: "rejected" | "unconfirmed"; message: string };

export interface FinancialRecordDialogProps {
  title: string;
  titleId: string;
  ariaLabel?: string;
  description?: ReactNode;
  children: ReactNode;
  confirmation?: VibeDialogConfirmation;
  submit(signal: AbortSignal): Promise<void>;
  onClose(): void;
  checkHref: string;
  disabled?: boolean;
  dirty?: boolean;
  button?: string;
}

export function FinancialRecordDialog({
  title,
  titleId,
  ariaLabel,
  description,
  children,
  confirmation,
  submit,
  onClose,
  checkHref,
  disabled = false,
  dirty = false,
  button = "保存",
}: FinancialRecordDialogProps) {
  const router = useRouter();
  const requestRef = useRef<AbortController | null>(null);
  const stateRef = useRef<SaveState>({ status: "idle" });
  const [state, setState] = useState<SaveState>(stateRef.current);
  const pending = state.status === "pending";
  const needsCheck = state.status === "unconfirmed";

  useEffect(() => () => {
    requestRef.current?.abort();
    requestRef.current = null;
  }, []);

  function updateState(next: SaveState) {
    stateRef.current = next;
    setState(next);
  }

  function finishRequest(controller: AbortController) {
    if (requestRef.current !== controller) return false;
    requestRef.current = null;
    controller.abort();
    return true;
  }

  async function save() {
    if (disabled || stateRef.current.status === "pending" || stateRef.current.status === "unconfirmed") return;
    const controller = new AbortController();
    requestRef.current = controller;
    updateState({ status: "pending" });
    try {
      await submit(controller.signal);
    } catch (error) {
      if (!finishRequest(controller)) return;
      updateState({
        status: error instanceof RecordSaveOutcomeUnknown ? "unconfirmed" : "rejected",
        message: error instanceof Error ? error.message : "保存失败",
      });
      return;
    }
    // 离页后即使底层请求仍返回成功，也不能刷新页面或关闭另一份表单。
    if (!finishRequest(controller)) return;
    updateState({ status: "idle" });
    router.refresh();
    onClose();
  }

  return (
    <VibeDialog
      aria-label={ariaLabel}
      title={title}
      titleId={titleId}
      description={description}
      confirmation={confirmation}
      dirty={dirty || needsCheck}
      pending={pending}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      actions={(requestClose) => (
        <>
          <VibeButton type="button" variant="text" disabled={pending} onClick={requestClose}>
            取消
          </VibeButton>
          {needsCheck ? (
            <>
              <VibeLink href={checkHref} target="_blank" rel="noreferrer" variant="outline" wrap>
                核对最新记录（新标签页）
              </VibeLink>
              <VibeButton
                type="button"
                variant="text"
                wrap
                onClick={() => {
                  if (stateRef.current.status === "unconfirmed") updateState({ status: "idle" });
                }}
              >
                已确认未保存，继续编辑
              </VibeButton>
            </>
          ) : (
            <VibeButton type="submit" variant="primary" disabled={pending || disabled}>
              {pending ? "保存中…" : button}
            </VibeButton>
          )}
        </>
      )}
    >
      <fieldset className="financial-record-dialog__fields" disabled={pending || needsCheck}>
        {children}
      </fieldset>
      {"message" in state ? (
        <VibeNotice tone={needsCheck ? "warning" : "error"} role="alert">
          {state.message}
        </VibeNotice>
      ) : null}
    </VibeDialog>
  );
}
