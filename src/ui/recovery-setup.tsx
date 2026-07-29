"use client";

import { useRef, useState, type FormEvent } from "react";

import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeDialog } from "@/ui/vibe/vibe-dialog";
import { VibeField } from "@/ui/vibe/vibe-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { VibeVerificationCode } from "@/ui/vibe/vibe-verification-code";

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
  const codeRef = useRef<HTMLInputElement>(null);
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
      window.requestAnimationFrame(() => codeRef.current?.focus());
      return;
    }
    setOpen(false);
    setOptions(null);
    setSaved(true);
    setPending(false);
  }

  return (
    <>
      <VibeButton
        className="header-action-button"
        type="button"
        onClick={openDialog}
        variant="outline"
      >
        {recoveryConfigured ? "更新备用登录" : "配置备用登录"}
      </VibeButton>
      {saved ? (
        <VibeNotice
          className="recovery-status vibe-notice--compact"
          role="status"
          tone="success"
        >
          备用登录已配置，请等待验证器显示下一组验证码后再登录
        </VibeNotice>
      ) : null}
      {!open && error ? (
        <VibeNotice className="login-error" role="alert" tone="error">
          {error}
        </VibeNotice>
      ) : null}
      {open && options ? (
        <VibeDialog
          actions={
            <>
              <VibeButton type="button" disabled={pending} onClick={closeDialog} variant="text">
                取消
              </VibeButton>
              <VibeButton type="submit" disabled={pending} variant="primary">
                保存备用登录
              </VibeButton>
            </>
          }
          description={
            <>
              请把下方 TOTP 密钥添加到验证器，再输入当前验证码确认；
              密钥只在本次配置中显示。
            </>
          }
          eyebrow="LOCAL RECOVERY / TOTP"
          onClose={closeDialog}
          onSubmit={save}
          title="配置备用登录"
          titleId="recovery-setup-title"
        >
          <VibeField
            fieldId="recovery-setup-secret"
            label="TOTP 密钥"
            readOnly
            type={showSecret ? "text" : "password"}
            value={options.secret}
          />
          <div className="recovery-secret-actions">
            <VibeButton
              type="button"
              onClick={() => setShowSecret((visible) => !visible)}
              variant="text"
            >
              {showSecret ? "隐藏密钥" : "显示密钥"}
            </VibeButton>
            <VibeButton type="button" onClick={() => void copySecret()} variant="text">
              复制密钥
            </VibeButton>
            {secretStatus ? (
              <VibeNotice
                className="vibe-notice--compact"
                role="status"
                tone="success"
              >
                {secretStatus}
              </VibeNotice>
            ) : null}
          </div>
          <VibeVerificationCode
            aria-describedby={error ? "recovery-setup-code-error" : undefined}
            aria-invalid={error ? true : undefined}
            fieldId="recovery-setup-code"
            label="当前 TOTP 验证码"
            name="code"
            ref={codeRef}
            required
            spellCheck={false}
          />
          {error ? (
            <VibeNotice
              className="login-error"
              id="recovery-setup-code-error"
              role="alert"
              tone="error"
            >
              {error}
            </VibeNotice>
          ) : null}
        </VibeDialog>
      ) : null}
      {open && !options ? (
        <VibeDialog
          actions={
            <>
              <VibeButton type="button" disabled={pending} onClick={closeDialog} variant="text">
                取消
              </VibeButton>
              <VibeButton
                type="button"
                disabled={pending}
                onClick={() => void begin()}
                variant="primary"
              >
                {pending ? "正在生成…" : "开始配置"}
              </VibeButton>
            </>
          }
          description={
            <>
              备用登录会生成一份新的 TOTP 密钥。请确认当前环境没有录屏、投屏或旁观者，
              并准备好验证器后再继续。
            </>
          }
          eyebrow="LOCAL RECOVERY / TOTP"
          onClose={closeDialog}
          title="配置备用登录"
          titleId="recovery-setup-title"
        >
          {error ? (
            <VibeNotice className="login-error" role="alert" tone="error">
              {error}
            </VibeNotice>
          ) : null}
        </VibeDialog>
      ) : null}
    </>
  );
}
