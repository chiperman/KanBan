"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { RecordSaveOutcomeUnknown, RecordValuationConflict } from "@/ui/financial-record-requests";
import type { BookValuationChoice, BookValuationConflict } from "@/domain/investment-books";
import { AssetFinancialValue } from "@/ui/asset-financial-value";
import { useWorkbenchDisplayPreferences } from "@/ui/workbench-display-preferences";
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
  submit(signal: AbortSignal, valuationChoices?: BookValuationChoice[]): Promise<void>;
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
  const [conflicts, setConflicts] = useState<BookValuationConflict[]>([]);
  const [choices, setChoices] = useState<Record<string, BookValuationChoice["choice"]>>({});
  const { showSensitiveInfo } = useWorkbenchDisplayPreferences();
  const pending = state.status === "pending";
  const needsCheck = state.status === "unconfirmed";
  const resolvingConflict = conflicts.length > 0;
  const choicesMissing = conflicts.some(conflict => !choices[conflict.key]);

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
    if (conflicts.some(conflict => !choices[conflict.key])) return;
    const valuationChoices = conflicts.map(conflict => ({ key: conflict.key, choice: choices[conflict.key] }));
    const controller = new AbortController();
    requestRef.current = controller;
    updateState({ status: "pending" });
    try {
      await submit(controller.signal, valuationChoices);
    } catch (error) {
      if (!finishRequest(controller)) return;
      if (error instanceof RecordValuationConflict) {
        setChoices({});
        setConflicts(error.conflicts);
        updateState({ status: "idle" });
        return;
      }
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
      aria-label={resolvingConflict ? undefined : ariaLabel}
      title={resolvingConflict ? "选择资产金额" : title}
      titleId={titleId}
      description={resolvingConflict
        ? conflicts.length === 1
          ? "这一天已有不同的资产总额，请选择采用哪一个。"
          : "以下日期已有不同的资产总额，请逐项选择。"
        : description}
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
          {!resolvingConflict ? (
            <VibeButton key="cancel" type="button" variant="text" disabled={pending} onClick={requestClose}>
              取消
            </VibeButton>
          ) : null}
          {needsCheck ? (
            <>
              <VibeLink key="check-saved-result" href={checkHref} target="_blank" rel="noreferrer" variant="outline" wrap>
                核对最新记录（新标签页）
              </VibeLink>
              <VibeButton
                key="resume-editing"
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
            <>
              {resolvingConflict ? (
                <VibeButton key="edit-conflicts" type="button" variant="text" disabled={pending} onClick={() => {
                  setChoices({});
                  setConflicts([]);
                  updateState({ status: "idle" });
                }}>
                  返回修改
                </VibeButton>
              ) : null}
              {conflicts.length > 1 ? (
                <span className="financial-record-dialog__progress" role="status">
                  已选 {conflicts.filter(conflict => choices[conflict.key]).length} / {conflicts.length}
                </span>
              ) : null}
              <VibeButton
                key={resolvingConflict ? "save-conflict-choices" : "save-record"}
                type="submit"
                variant="primary"
                disabled={pending || disabled || choicesMissing}
              >
                {pending ? "保存中…" : resolvingConflict ? "采用所选金额" : button}
              </VibeButton>
            </>
          )}
        </>
      )}
    >
      <div hidden={resolvingConflict} inert={resolvingConflict}>
        <fieldset className="financial-record-dialog__fields" disabled={pending || needsCheck || resolvingConflict}>
          {children}
        </fieldset>
      </div>
      {resolvingConflict ? (
        <div className="financial-record-dialog__conflicts">
          {conflicts.map((conflict, index) => (
            <fieldset key={conflict.key} className="financial-record-dialog__conflict" disabled={pending || needsCheck}>
              <legend>{conflict.day}</legend>
              <div className="financial-record-dialog__options">
                {(["existing", "incoming"] as const).map(choice => (
                  <label key={choice} className="vibe-choice financial-record-dialog__option">
                    <input
                      type="radio"
                      name={`${titleId}-conflict-${index}`}
                      value={choice}
                      required
                      checked={choices[conflict.key] === choice}
                      onChange={() => setChoices(previous => ({ ...previous, [conflict.key]: choice }))}
                    />
                    <span className="financial-record-dialog__option-copy">
                      <span>{choice === "existing" ? conflict.existingLabel : conflict.incomingLabel}</span>
                      <span className="financial-record-dialog__amount">
                        <AssetFinancialValue unit={conflict.currency}>
                          {showSensitiveInfo ? (choice === "existing" ? conflict.existingAmount : conflict.incomingAmount) : "••••••"}
                        </AssetFinancialValue>
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      ) : null}
      {"message" in state ? (
        <VibeNotice tone={needsCheck ? "warning" : "error"} role="alert">
          {state.message}
        </VibeNotice>
      ) : null}
    </VibeDialog>
  );
}
