"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import {
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";

import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { VibeVerificationCode } from "@/ui/vibe/vibe-verification-code";

type LoginState = "idle" | "pending" | "failed" | "unavailable";
type LoginMode = "choice" | "recovery-totp";

interface OwnerLoginProps {
  ownerProvisioned: boolean;
  recoveryConfigured: boolean;
}

const LOCKED_PIXEL_ROWS = [
  { letter: "L", rows: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"] },
  { letter: "O", rows: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"] },
  { letter: "C", rows: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"] },
  { letter: "K", rows: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"] },
  { letter: "E", rows: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"] },
  { letter: "D", rows: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"] },
] as const;

type LockedPixelLetter = (typeof LOCKED_PIXEL_ROWS)[number]["letter"];

const LOCKED_PIXEL_PATHS: Record<LockedPixelLetter, readonly number[]> = {
  L: [0, 5, 10, 15, 20, 25, 30, 31, 32, 33, 34],
  O: [1, 2, 3, 9, 14, 19, 24, 29, 33, 32, 31, 25, 20, 15, 10, 5],
  C: [4, 3, 2, 1, 5, 10, 15, 20, 25, 31, 32, 33, 34],
  K: [4, 8, 12, 16, 22, 28, 34, 0, 5, 10, 15, 20, 25, 30],
  E: [4, 3, 2, 1, 0, 5, 10, 15, 20, 25, 30, 31, 32, 33, 34, 16, 17, 18],
  D: [0, 1, 2, 3, 9, 14, 19, 24, 29, 33, 32, 31, 30, 25, 20, 15, 10, 5],
};

const LOCKED_PIXEL_GLYPHS = (() => {
  let animationIndex = 0;
  return LOCKED_PIXEL_ROWS.map(({ letter, rows }) => {
    const path = LOCKED_PIXEL_PATHS[letter];
    const pathIndexByCell = new Map(
      path.map((cellIndex, pathIndex) => [cellIndex, pathIndex]),
    );
    const glyphStartIndex = animationIndex;
    animationIndex += path.length;

    return {
      letter,
      cells: rows.flatMap((row, rowIndex) =>
        [...row].map((value, columnIndex) => ({
          filled: value === "1",
          animationIndex:
            value === "1"
              ? glyphStartIndex +
                (pathIndexByCell.get(rowIndex * 5 + columnIndex) ?? 0)
              : null,
        })),
      ),
    };
  });
})();

type LockPixelStyle = CSSProperties & { "--lock-dot-index": number };

function LockedPixelDisplay() {
  return (
    <div
      className="login-display-state login-display-pixels"
      data-testid="locked-pixel-display"
      aria-hidden="true"
    >
      {LOCKED_PIXEL_GLYPHS.map((glyph) => (
        <span className="login-pixel-letter" key={glyph.letter}>
          {glyph.cells.map((cell, index) => (
            <span
              className={`login-pixel${cell.filled ? " is-filled" : ""}`}
              key={`${glyph.letter}-${index}`}
              style={
                cell.animationIndex === null
                  ? undefined
                  : ({ "--lock-dot-index": cell.animationIndex } as LockPixelStyle)
              }
            />
          ))}
        </span>
      ))}
    </div>
  );
}

export function OwnerLogin({
  ownerProvisioned,
  recoveryConfigured,
}: OwnerLoginProps) {
  const [state, setState] = useState<LoginState>("idle");
  const [mode, setMode] = useState<LoginMode>("choice");
  const [recoveryError, setRecoveryError] = useState("");
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [recoveryRateLimited, setRecoveryRateLimited] = useState(false);
  const recoveryCodeRef = useRef<HTMLInputElement>(null);

  function showRecoveryTotp() {
    setRecoveryError("");
    setRecoveryRateLimited(false);
    setMode("recovery-totp");
  }

  function returnToLoginChoice() {
    setRecoveryError("");
    setRecoveryPending(false);
    setRecoveryRateLimited(false);
    setMode("choice");
  }

  async function login() {
    setState("pending");
    try {
      const optionsResponse = await fetch("/api/auth/login/options", {
        method: "POST",
      });
      if (!optionsResponse.ok) {
        setState("unavailable");
        return;
      }
      const assertion = await startAuthentication({
        optionsJSON: await optionsResponse.json(),
      });
      const verifyResponse = await fetch("/api/auth/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assertion),
      });
      if (!verifyResponse.ok) {
        setState("failed");
        return;
      }
      window.location.reload();
    } catch {
      setState("failed");
    }
  }

  async function verifyRecoveryTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRecoveryPending(true);
    setRecoveryError("");
    try {
      const data = new FormData(event.currentTarget);
      const response = await fetch("/api/auth/recovery/totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: data.get("code") }),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        const rateLimited = response.status === 429;
        setRecoveryRateLimited(rateLimited);
        setRecoveryError(result?.error ?? "TOTP 验证失败");
        setRecoveryPending(false);
        if (!rateLimited) {
          window.requestAnimationFrame(() => recoveryCodeRef.current?.focus());
        }
        return;
      }
      window.location.reload();
    } catch {
      setRecoveryRateLimited(false);
      setRecoveryError("TOTP 验证失败，请检查连接后重试");
      setRecoveryPending(false);
      window.requestAnimationFrame(() => recoveryCodeRef.current?.focus());
    }
  }

  return (
    <section
      aria-labelledby="login-title"
      className={`login-gate vibe-auth-surface${
        ownerProvisioned
          ? ` login-gate--owner login-gate--owner-${mode}`
          : ""
      }`}
      data-testid="login-gate"
      data-vibe-surface="auth-panel"
    >
      <div className="login-intro">
        <p className="login-eyebrow">
          {ownerProvisioned
            ? "OWNER VERIFICATION REQUIRED"
            : "FIRST RUN · OWNER PROVISION REQUIRED"}
          {ownerProvisioned ? (
            <span
              aria-hidden="true"
              className="login-lock-progress"
              data-testid="locked-progress"
            >
              <span />
            </span>
          ) : null}
        </p>
        {ownerProvisioned ? (
          <LockedPixelDisplay />
        ) : (
          <p className="login-display-state" aria-hidden="true">
            SETUP
          </p>
        )}
        <h1
          id="login-title"
          className={ownerProvisioned ? "login-state-heading" : undefined}
        >
          {ownerProvisioned ? "个人资产看板已锁定" : "预置唯一所有者"}
        </h1>
        {ownerProvisioned ? null : (
          <p className="login-copy">
            此终端尚未预置所有者 Passkey，请先完成一次性预置。
          </p>
        )}
      </div>
      <div className="login-flow" key={ownerProvisioned ? mode : "setup"}>
        {state === "failed" ? (
          <VibeNotice className="login-error" code="ERROR" role="alert" tone="error">
            验证失败或已取消，资产看板仍处于锁定状态。
          </VibeNotice>
        ) : null}
        {state === "unavailable" ? (
          <VibeNotice className="login-error" code="ERROR" role="alert" tone="error">
            所有者尚未预置登录凭证，请先完成首次预置。
          </VibeNotice>
        ) : null}
        {!ownerProvisioned ? (
          <div className="login-actions first-run-actions">
            <VibeLink className="provision-primary" href="/setup" variant="primary">
              <span>开始首次预置</span>
              <span className="provision-primary-arrow" aria-hidden="true">
                →
              </span>
            </VibeLink>
            <p className="login-hint">
              仅可预置一位所有者 / 完成后仍需使用 Passkey 登录
            </p>
          </div>
        ) : null}
        {ownerProvisioned && mode === "choice" ? (
          <div className="login-actions login-actions--choice">
            <VibeButton
              type="button"
              disabled={state === "pending"}
              onClick={login}
              variant="primary"
            >
              {state === "pending" ? "[ VERIFYING ]" : "使用 Passkey 登录"}
            </VibeButton>
            {recoveryConfigured ? (
              <VibeButton
                type="button"
                disabled={state === "pending"}
                onClick={showRecoveryTotp}
                variant="outline"
              >
                使用备用方式登录
              </VibeButton>
            ) : (
              <p className="login-hint">
                备用登录未配置 / 登录后可在本机设置
              </p>
            )}
          </div>
        ) : null}
        {mode === "recovery-totp" ? (
          <form
            className="login-form"
            data-vibe-surface="auth-flow"
            onSubmit={verifyRecoveryTotp}
          >
            <p className="login-copy">输入验证器当前显示的 6 位动态验证码。</p>
            <VibeVerificationCode
              aria-describedby={recoveryError ? "recovery-totp-error" : undefined}
              aria-invalid={recoveryError ? true : undefined}
              disabled={recoveryPending || recoveryRateLimited}
              fieldId="recovery-totp-code"
              label="TOTP 验证码"
              name="code"
              ref={recoveryCodeRef}
              required
              spellCheck={false}
            />
            {recoveryError ? (
              <VibeNotice
                className="login-error"
                code="ERROR"
                id="recovery-totp-error"
                role="alert"
                tone="error"
              >
                {recoveryError}
              </VibeNotice>
            ) : null}
            <div className="login-actions">
              <VibeButton
                type="submit"
                disabled={recoveryPending || recoveryRateLimited}
                variant="primary"
              >
                完成备用登录
              </VibeButton>
              <VibeButton
                type="button"
                disabled={recoveryPending}
                onClick={returnToLoginChoice}
                variant="text"
              >
                返回
              </VibeButton>
            </div>
          </form>
        ) : null}
        <div className="login-trust-line" aria-label="安全属性">
          <span>PASSKEY</span>
          <span>LOCAL</span>
          <span>READ ONLY</span>
        </div>
      </div>
    </section>
  );
}
