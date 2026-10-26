"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { lockOnUnauthorizedResponse, OWNER_SESSION_EXPIRED_MESSAGE, readJsonResult } from "@/ui/owner-request-lock";
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
  onConfigured?(): void;
}

function validOptions(value: SetupOptions | null): value is SetupOptions {
  if (typeof value?.secret !== "string" || !/^[A-Z2-7]{32}$/u.test(value.secret) || typeof value.provisioningUri !== "string") return false;
  try {
    const uri = new URL(value.provisioningUri);
    return uri.protocol === "otpauth:" && uri.hostname === "totp" && uri.searchParams.get("secret") === value.secret;
  } catch {
    return false;
  }
}

export function RecoverySetup({ configured, onConfigured }: RecoverySetupProps) {
  const [options, setOptions] = useState<SetupOptions | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [configuredNow, setConfiguredNow] = useState(configured);
  const [needsCheck, setNeedsCheck] = useState(false);
  const [notice, setNotice] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [secretStatus, setSecretStatus] = useState("");
  const codeRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef(false);
  const needsCheckRef = useRef(false);

  useEffect(() => { setConfiguredNow(configured); }, [configured]);

  function openDialog() {
    if (pendingRef.current) return;
    setOpen(true);
    if (needsCheckRef.current) return;
    setError("");
    setNotice("");
    setSaved(false);
    setOptions(null);
    setShowSecret(false);
    setSecretStatus("");
  }

  async function begin() {
    if (pendingRef.current || needsCheckRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      const signal = AbortSignal.timeout(15_000);
      const response = await fetch("/api/auth/recovery/setup", { cache: "no-store", signal });
      if (lockOnUnauthorizedResponse(response)) {
        setError(OWNER_SESSION_EXPIRED_MESSAGE);
        return;
      }
      const result = await readJsonResult<SetupOptions>(response);
      signal.throwIfAborted();
      if (!response.ok || !validOptions(result)) {
        setError("未能生成 TOTP 密钥，请重试；现有登录方式未改变。");
        return;
      }
      setOptions(result);
    } catch {
      setError("未能获取 TOTP 密钥，请检查连接后重试；现有登录方式未改变。");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  function closeDialog() {
    if (pendingRef.current) return;
    setOpen(false);
    setShowSecret(false);
    setSecretStatus("");
    if (needsCheckRef.current) return;
    setOptions(null);
    setError("");
  }

  async function copySecret() {
    if (!options) return;
    try {
      await navigator.clipboard.writeText(options.secret);
      setSecretStatus("密钥已复制");
    } catch {
      setSecretStatus("无法复制，请显示密钥后手动复制。");
    }
  }

  function savedSuccessfully() {
    needsCheckRef.current = false;
    setNeedsCheck(false);
    setConfiguredNow(true);
    setOpen(false);
    setOptions(null);
    setError("");
    setSaved(true);
    onConfigured?.();
  }

  async function checkSavedSecret() {
    if (pendingRef.current || !options) return;
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      const signal = AbortSignal.timeout(15_000);
      const response = await fetch("/api/auth/recovery/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check", secret: options.secret }),
        signal,
      });
      if (lockOnUnauthorizedResponse(response)) {
        setError(OWNER_SESSION_EXPIRED_MESSAGE);
        return;
      }
      const result = await readJsonResult<{ ok?: boolean; matches?: boolean }>(response);
      signal.throwIfAborted();
      if (!response.ok || result?.ok !== true || typeof result.matches !== "boolean") {
        setError("未能核对当前密钥，请检查连接后重试；密钥已保留。");
        return;
      }
      if (result.matches) savedSuccessfully();
      else {
        needsCheckRef.current = false;
        setNeedsCheck(false);
        setNotice("当前保存的密钥与本次密钥不一致。请检查验证码后重新保存。");
        window.requestAnimationFrame(() => codeRef.current?.focus());
      }
    } catch {
      setError("未能核对当前密钥，请检查连接后重试；密钥已保留。");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current || needsCheckRef.current || !options) return;
    const data = new FormData(event.currentTarget);
    pendingRef.current = true;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/auth/recovery/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: data.get("code"), secret: options.secret }),
      });
      if (lockOnUnauthorizedResponse(response)) {
        setError(OWNER_SESSION_EXPIRED_MESSAGE);
        return;
      }
      const result = await readJsonResult<{ ok?: boolean; error?: string }>(response);
      if (response.status >= 500 || (response.ok && result?.ok !== true)) throw new Error("unconfirmed");
      if (!response.ok) {
        setError(result?.error ?? "未能保存 TOTP 登录，请检查验证码后重试。");
        window.requestAnimationFrame(() => codeRef.current?.focus());
        return;
      }
      savedSuccessfully();
    } catch {
      needsCheckRef.current = true;
      setNeedsCheck(true);
      setError("尚未确认保存结果，请先核对本次密钥；密钥和输入已保留，请勿重新配置或丢弃密钥。");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <>
      <VibeButton
        type="button"
        disabled={pending}
        onClick={openDialog}
        variant="outline"
      >
        {needsCheck ? "核对 TOTP 登录" : configuredNow ? "更新 TOTP 登录" : "配置 TOTP 登录"}
      </VibeButton>
      {saved ? (
        <VibeNotice
          className="recovery-status vibe-notice--compact"
          role="status"
          tone="success"
        >
          TOTP 已配置，请使用下一组验证码登录。
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
                {needsCheck ? "稍后核对" : "取消"}
              </VibeButton>
              {needsCheck ? <VibeButton type="button" disabled={pending} onClick={() => void checkSavedSecret()} variant="primary">
                {pending ? "正在核对…" : "核对本次密钥"}
              </VibeButton> : <VibeButton type="submit" disabled={pending} variant="primary">
                {pending ? "正在保存…" : "保存 TOTP 登录"}
              </VibeButton>}
            </>
          }
          description={
            <>
              添加密钥并输入验证码确认；密钥仅本次显示。
            </>
          }
          onClose={closeDialog}
          onSubmit={save}
          pending={pending}
          title="配置 TOTP 登录"
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
              disabled={pending}
              onClick={() => setShowSecret((visible) => !visible)}
              variant="text"
            >
              {showSecret ? "隐藏密钥" : "显示密钥"}
            </VibeButton>
            <VibeButton type="button" disabled={pending} onClick={() => void copySecret()} variant="text">
              复制密钥
            </VibeButton>
            {secretStatus ? (
              <VibeNotice
                className="vibe-notice--compact"
                role="status"
                tone="info"
              >
                {secretStatus}
              </VibeNotice>
            ) : null}
          </div>
          <VibeVerificationCode
            aria-describedby={error ? "recovery-setup-code-error" : undefined}
            aria-invalid={error ? true : undefined}
            fieldId="recovery-setup-code"
            disabled={pending || needsCheck}
            label="当前 TOTP 验证码"
            name="code"
            ref={codeRef}
            required
            spellCheck={false}
          />
          <div role="status">{notice ? <VibeNotice tone="info">{notice}</VibeNotice> : null}</div>
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
              将生成新密钥，请注意防窥。
            </>
          }
          onClose={closeDialog}
          pending={pending}
          title="配置 TOTP 登录"
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
