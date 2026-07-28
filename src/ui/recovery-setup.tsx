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
  const [showSecret, setShowSecret] = useState(false);
  const [secretStatus, setSecretStatus] = useState("");
  const recoveryConfigured = configured || saved;

  function openDialog() {
    setError("");
    setSaved(false);
    setOptions(null);
    setShowSecret(false);
    setSecretStatus("");
    setOpen(true);
  }

  async function begin() {
    setPending(true);
    setError("");
    const response = await fetch("/api/auth/recovery/setup");
    if (!response.ok) {
      setError("无法开始备用登录配置");
      setPending(false);
      return;
    }
    setOptions((await response.json()) as SetupOptions);
    setPending(false);
  }

  function closeDialog() {
    setOpen(false);
    setOptions(null);
    setShowSecret(false);
    setSecretStatus("");
    setError("");
  }

  async function copySecret() {
    if (!options) return;
    await navigator.clipboard.writeText(options.secret);
    setSecretStatus("密钥已复制");
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
      <button type="button" className="logout-button" onClick={openDialog}>
        {recoveryConfigured ? "更新备用登录" : "配置备用登录"}
      </button>
      {saved ? <span role="status" className="recovery-status">备用登录已配置</span> : null}
      {!open && error ? <span role="alert" className="login-error">{error}</span> : null}
      {open ? (
        <div
          className="editor-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="recovery-setup-title"
        >
          {options ? (
            <form className="editor-dialog" onSubmit={save}>
              <p className="card-label">备用登录配置</p>
              <h2 id="recovery-setup-title">配置备用登录</h2>
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
                <input
                  readOnly
                  type={showSecret ? "text" : "password"}
                  value={options.secret}
                />
              </label>
              <div className="recovery-secret-actions">
                <button
                  type="button"
                  className="login-cancel"
                  onClick={() => setShowSecret((visible) => !visible)}
                >
                  {showSecret ? "隐藏密钥" : "显示密钥"}
                </button>
                <button
                  type="button"
                  className="login-cancel"
                  onClick={() => void copySecret()}
                >
                  复制密钥
                </button>
                {secretStatus ? <span role="status">{secretStatus}</span> : null}
              </div>
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
                  onClick={closeDialog}
                >
                  取消
                </button>
              </div>
            </form>
          ) : (
            <section className="editor-dialog">
              <p className="card-label">备用登录配置</p>
              <h2 id="recovery-setup-title">配置备用登录</h2>
              <p className="login-copy">
                备用登录会生成一份新的 TOTP 密钥。请确认当前环境没有录屏、投屏或旁观者，
                并准备好验证器后再继续。
              </p>
              {error ? <p className="login-error" role="alert">{error}</p> : null}
              <div className="editor-actions">
                <button
                  type="button"
                  className="login-primary"
                  disabled={pending}
                  onClick={() => void begin()}
                >
                  {pending ? "正在生成…" : "开始配置"}
                </button>
                <button
                  type="button"
                  className="login-cancel"
                  disabled={pending}
                  onClick={closeDialog}
                >
                  取消
                </button>
              </div>
            </section>
          )}
        </div>
      ) : null}
    </>
  );
}
