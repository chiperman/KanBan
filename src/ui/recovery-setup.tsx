"use client";

import { useState, type FormEvent } from "react";

interface SetupOptions {
  secret: string;
  provisioningUri: string;
}

interface RecoverySetupProps {
  configured: boolean;
}

export function RecoverySetup({ configured }: RecoverySetupProps) {
  const [options, setOptions] = useState<SetupOptions | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const recoveryConfigured = configured || saved;

  async function begin() {
    setError("");
    setSaved(false);
    const response = await fetch("/api/auth/recovery/setup");
    if (!response.ok) {
      setError("无法开始备用登录配置");
      return;
    }
    setOptions((await response.json()) as SetupOptions);
    setOpen(true);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!options) return;
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/recovery/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: data.get("email"),
        password: data.get("password"),
        code: data.get("code"),
        secret: options.secret,
      }),
    });
    const result = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    if (!response.ok) {
      setError(result?.error ?? "备用登录配置失败");
      setPending(false);
      return;
    }
    setOpen(false);
    setOptions(null);
    setSaved(true);
    setPending(false);
  }

  return (
    <>
      <button type="button" className="logout-button" onClick={() => void begin()}>
        {recoveryConfigured ? "更新备用登录" : "配置备用登录"}
      </button>
      {saved ? <span role="status" className="recovery-status">备用登录已配置</span> : null}
      {!open && error ? <span role="alert" className="login-error">{error}</span> : null}
      {open && options ? (
        <div className="editor-overlay" role="dialog" aria-modal="true">
          <form className="editor-dialog" onSubmit={save}>
            <p className="card-label">备用登录配置</p>
            <p className="login-copy">
              邮箱仅作为本机登录标识，不发送验证邮件。请把下方 TOTP
              密钥添加到验证器，再输入当前验证码确认；密钥只在本次配置中显示。
            </p>
            <label className="field-label">
              备用登录邮箱
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <label className="field-label">
              备用登录密码
              <input name="password" type="password" autoComplete="new-password" required />
            </label>
            <label className="field-label">
              TOTP 密钥
              <input readOnly value={options.secret} />
            </label>
            <label className="field-label">
              当前 TOTP 验证码
              <input name="code" inputMode="numeric" pattern="[0-9]{6}" required />
            </label>
            {error ? <p className="login-error" role="alert">{error}</p> : null}
            <div className="editor-actions">
              <button type="submit" className="login-primary" disabled={pending}>
                保存备用登录
              </button>
              <button
                type="button"
                className="login-cancel"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                取消
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
