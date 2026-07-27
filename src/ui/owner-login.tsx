"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import { useState, type FormEvent } from "react";

type LoginState = "idle" | "pending" | "failed" | "unavailable";
type LoginMode = "choice" | "recovery-password" | "recovery-totp";

interface OwnerLoginProps {
  recoveryConfigured: boolean;
}

export function OwnerLogin({ recoveryConfigured }: OwnerLoginProps) {
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
      window.location.reload();
    } catch {
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
      setRecoveryError(result?.error ?? "备用登录邮箱或密码错误");
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
    <section className="login-gate" data-testid="login-gate" aria-labelledby="login-title">
      <p className="card-label">PRIVATE ACCESS / 00</p>
      <div className="login-intro">
        <p className="login-eyebrow">OWNER VERIFICATION REQUIRED</p>
        <h1 id="login-title">LOCKED</h1>
        <p className="login-copy">验证后加载本机资产数据。</p>
      </div>
      <div className="login-flow">
        {state === "failed" ? (
          <p className="login-error" role="alert">
            [ERROR] 验证失败或已取消，资产看板仍处于锁定状态。
          </p>
        ) : null}
        {state === "unavailable" ? (
          <p className="login-error" role="alert">
            [ERROR] 所有者尚未预置登录凭证。
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
              {state === "pending" ? "[ VERIFYING ]" : "使用 Passkey 登录"}
            </button>
            {recoveryConfigured ? (
              <button
                type="button"
                className="login-cancel"
                disabled={state === "pending"}
                onClick={() => setMode("recovery-password")}
              >
                使用备用方式登录
              </button>
            ) : (
              <p className="login-hint">
                备用登录未配置 / 登录后可在本机设置
              </p>
            )}
          </div>
        ) : null}
        {mode === "recovery-password" ? (
          <form className="login-form" onSubmit={verifyRecoveryPassword}>
            <p className="login-copy">
              邮箱仅作为本机登录标识，不会发送验证邮件。
            </p>
            <label className="field-label">
              备用登录邮箱
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <label className="field-label">
              备用登录密码
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            {recoveryError ? (
              <p className="login-error" role="alert">
                [ERROR] {recoveryError}
              </p>
            ) : null}
            <div className="login-actions">
              <button type="submit" className="login-primary">
                继续验证 TOTP
              </button>
              <button
                type="button"
                className="login-cancel"
                onClick={() => setMode("choice")}
              >
                返回
              </button>
            </div>
          </form>
        ) : null}
        {mode === "recovery-totp" ? (
          <form className="login-form" onSubmit={verifyRecoveryTotp}>
            <p className="login-copy">输入验证器当前显示的 6 位动态验证码。</p>
            <label className="field-label">
              TOTP 验证码
              <input name="code" inputMode="numeric" pattern="[0-9]{6}" required />
            </label>
            {recoveryError ? (
              <p className="login-error" role="alert">
                [ERROR] {recoveryError}
              </p>
            ) : null}
            <div className="login-actions">
              <button type="submit" className="login-primary">
                完成备用登录
              </button>
              <button
                type="button"
                className="login-cancel"
                onClick={() => setMode("recovery-password")}
              >
                返回
              </button>
            </div>
          </form>
        ) : null}
        <div className="login-trust-line" aria-label="安全属性">
          <span>PRIVATE</span>
          <span>LOCAL ONLY</span>
          <span>READ ONLY</span>
        </div>
      </div>
    </section>
  );
}
