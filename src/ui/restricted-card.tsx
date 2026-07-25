"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import { useState, type FormEvent } from "react";

type LoginState = "idle" | "pending" | "failed" | "unavailable";
type LoginMode = "choice" | "recovery-password" | "recovery-totp";

/**
 * 受限卡片占位：只接收卡片 id 与宽度，不接触任何真实内容。
 * 点击进入 Passkey 登录流程；失败或取消后保持访客状态。
 */
export function RestrictedCard({ span }: { span: 1 | 2 | 3 }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoginState>("idle");
  const [mode, setMode] = useState<LoginMode>("choice");
  const [recoveryError, setRecoveryError] = useState("");

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
      // 重新加载以获得服务端按所有者身份渲染的页面，避免客户端残留访客视图。
      window.location.reload();
    } catch {
      // 用户取消或认证器失败：保持访客状态。
      setState("failed");
    }
  }

  async function verifyRecoveryPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRecoveryError("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/recovery/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: data.get("email"),
        password: data.get("password"),
      }),
    });
    if (!response.ok) {
      const result = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setRecoveryError(result?.error ?? "恢复邮箱或密码错误");
      return;
    }
    setMode("recovery-totp");
  }

  async function verifyRecoveryTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRecoveryError("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/recovery/totp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: data.get("code") }),
    });
    if (!response.ok) {
      setRecoveryError("TOTP 验证失败");
      return;
    }
    window.location.reload();
  }

  return (
    <article
      className={`card card-restricted span-${span}`}
      data-testid="restricted-card"
    >
      <div className="restricted-mask" aria-hidden="true" />
      <p className="card-label">受限内容</p>
      <p className="restricted-hint">此卡片包含敏感信息，验证身份后可见。</p>
      <button
        type="button"
        className="restricted-unlock"
        onClick={() => {
          setOpen(true);
          setState("idle");
          setMode("choice");
          setRecoveryError("");
        }}
      >
        验证身份后查看
      </button>
      {open ? (
        <div className="login-overlay" role="dialog" aria-modal="true">
          <div className="login-dialog">
            <p className="card-label">所有者验证</p>
            {mode === "choice" ? (
              <p className="login-copy">
                优先使用 Passkey；Passkey 不可用时可使用已配置的恢复认证。
              </p>
            ) : null}
            {state === "failed" ? (
              <p className="login-error" role="alert">
                验证失败或已取消，仍处于访客状态。
              </p>
            ) : null}
            {state === "unavailable" ? (
              <p className="login-error" role="alert">
                所有者尚未预置登录凭证。
              </p>
            ) : null}
            {mode === "choice" ? (
              <div className="login-actions">
                <button
                  type="button"
                  className="login-primary"
                  disabled={state === "pending"}
                  onClick={login}
                >
                  {state === "pending" ? "等待 Passkey…" : "使用 Passkey 解锁"}
                </button>
                <button
                  type="button"
                  className="login-cancel"
                  disabled={state === "pending"}
                  onClick={() => setMode("recovery-password")}
                >
                  使用恢复认证
                </button>
                <button
                  type="button"
                  className="login-cancel"
                  disabled={state === "pending"}
                  onClick={() => setOpen(false)}
                >
                  取消
                </button>
              </div>
            ) : null}
            {mode === "recovery-password" ? (
              <form onSubmit={verifyRecoveryPassword}>
                <label className="field-label">
                  恢复邮箱
                  <input name="email" type="email" autoComplete="email" required />
                </label>
                <label className="field-label">
                  强密码
                  <input name="password" type="password" autoComplete="current-password" required />
                </label>
                {recoveryError ? <p className="login-error" role="alert">{recoveryError}</p> : null}
                <div className="login-actions">
                  <button type="submit" className="login-primary">继续验证 TOTP</button>
                  <button type="button" className="login-cancel" onClick={() => setMode("choice")}>返回</button>
                </div>
              </form>
            ) : null}
            {mode === "recovery-totp" ? (
              <form onSubmit={verifyRecoveryTotp}>
                <label className="field-label">
                  TOTP 验证码
                  <input name="code" inputMode="numeric" pattern="[0-9]{6}" required />
                </label>
                {recoveryError ? <p className="login-error" role="alert">{recoveryError}</p> : null}
                <div className="login-actions">
                  <button type="submit" className="login-primary">完成恢复解锁</button>
                  <button type="button" className="login-cancel" onClick={() => setMode("recovery-password")}>返回</button>
                </div>
              </form>
            ) : null}
            {mode !== "choice" ? (
              <button
                type="button"
                className="login-cancel recovery-cancel"
                onClick={() => setOpen(false)}
              >
                取消
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}
