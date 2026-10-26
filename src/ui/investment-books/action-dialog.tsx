import { type InvestmentBookId } from "@/domain/investment-books";
import {
  lockOnUnauthorizedResponse,
  OWNER_SESSION_EXPIRED_MESSAGE,
  readJsonResult,
} from "@/ui/owner-request-lock";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import { VibeDialog } from "@/ui/vibe/vibe-dialog";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";

class BookSaveOutcomeUnknown extends Error {
  constructor() {
    super("尚未确认保存结果。请在新标签页核对最新记录，确认未保存后再重试；当前输入已保留。");
  }
}
export async function bookRequest(body: object) {
  let response: Response;
  try {
    response = await fetch("/api/investment-books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new BookSaveOutcomeUnknown();
  }
  if (lockOnUnauthorizedResponse(response)) throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
  const result = await readJsonResult<{ ok?: boolean; error?: string }>(response);
  if (response.status >= 500 || (response.ok && result?.ok !== true))
    throw new BookSaveOutcomeUnknown();
  if (!response.ok) throw new Error(result?.error ?? "账本保存失败");
}
export function ActionDialog({
  title,
  description,
  children,
  submit,
  onClose,
  checkBookId,
  checkHref,
  disabled = false,
  dirty = false,
  button = "保存",
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  submit(): Promise<void>;
  onClose(): void;
  checkBookId: InvestmentBookId;
  checkHref?: string;
  disabled?: boolean;
  dirty?: boolean;
  button?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState("");
  const [needsCheck, setNeedsCheck] = useState(false);
  const needsCheckRef = useRef(false);
  async function save() {
    if (pendingRef.current || needsCheckRef.current || disabled) return;
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      await submit();
      router.refresh();
      onClose();
    } catch (e) {
      if (e instanceof BookSaveOutcomeUnknown) {
        needsCheckRef.current = true;
        setNeedsCheck(true);
      }
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }
  return (
    <VibeDialog
      title={title}
      titleId="book-action-title"
      description={description}
      dirty={dirty || needsCheck}
      pending={pending}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      actions={(requestClose) => (
        <>
          <VibeButton type="button" variant="text" disabled={pending} onClick={requestClose}>
            取消
          </VibeButton>
          {needsCheck ? (
            <>
              <VibeLink
                href={checkHref ?? `/performance?book=${checkBookId}&view=records&recordFilter=all`}
                target="_blank"
                rel="noreferrer"
                variant="outline"
              >
                查看最新记录（新标签页）
              </VibeLink>
              <VibeButton
                type="button"
                variant="text"
                onClick={() => {
                  needsCheckRef.current = false;
                  setNeedsCheck(false);
                  setError("");
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
      <fieldset className="investment-books__fields" disabled={pending || needsCheck}>
        {children}
      </fieldset>
      {error ? (
        <VibeNotice tone={needsCheck ? "warning" : "error"} role="alert">
          {error}
        </VibeNotice>
      ) : null}
    </VibeDialog>
  );
}
