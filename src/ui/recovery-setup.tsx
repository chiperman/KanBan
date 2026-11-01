"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  requestRecoveryCheck,
  requestRecoveryOptions,
  requestRecoverySave,
  type RecoverySetupOptions,
} from "@/ui/security-settings-requests";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeDialog } from "@/ui/vibe/vibe-dialog";
import { VibeField } from "@/ui/vibe/vibe-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { VibeVerificationCode } from "@/ui/vibe/vibe-verification-code";

interface RecoverySetupProps {
  configured: boolean;
  onConfigured?(): void;
}

export function RecoverySetup({ configured, onConfigured }: RecoverySetupProps) {
  const [options, setOptions] = useState<RecoverySetupOptions | null>(null);
  const [code, setCode] = useState("");
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
    setCode("");
    setShowSecret(false);
    setSecretStatus("");
  }

  async function begin() {
    if (pendingRef.current || needsCheckRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      setOptions(await requestRecoveryOptions());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能获取 TOTP 密钥，请检查连接后重试；现有登录方式未改变。");
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
    setCode("");
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
    setCode("");
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
      if (await requestRecoveryCheck(options.secret)) savedSuccessfully();
      else {
        needsCheckRef.current = false;
        setNeedsCheck(false);
        setNotice("当前保存的密钥与本次密钥不一致。请检查验证码后重新保存。");
        window.requestAnimationFrame(() => codeRef.current?.focus());
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能核对当前密钥，请检查连接后重试；密钥已保留。");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current || needsCheckRef.current || !options) return;
    pendingRef.current = true;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const result = await requestRecoverySave(options.secret, code);
      if (result.outcome !== "confirmed") {
        needsCheckRef.current = result.outcome === "unconfirmed";
        setNeedsCheck(needsCheckRef.current);
        setError(result.message);
        if (result.outcome === "rejected") {
          window.requestAnimationFrame(() => codeRef.current?.focus());
        }
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
      {open ? (
        <VibeDialog
          actions={
            <>
              <VibeButton type="button" disabled={pending} onClick={closeDialog} variant="text">
                {needsCheck ? "稍后核对" : "取消"}
              </VibeButton>
              {/* 阶段切换时替换按钮，防止核对点击变成表单提交。 */}
              {!options ? <VibeButton key="generate" type="button" disabled={pending} onClick={() => void begin()} variant="primary">
                {pending ? "正在生成…" : "开始配置"}
              </VibeButton> : needsCheck ? <VibeButton key="check" type="button" disabled={pending} onClick={() => void checkSavedSecret()} variant="primary">
                {pending ? "正在核对…" : "核对本次密钥"}
              </VibeButton> : <VibeButton key="save" type="submit" disabled={pending} variant="primary">
                {pending ? "正在保存…" : "保存 TOTP 登录"}
              </VibeButton>}
            </>
          }
          description={options
            ? "添加密钥并输入验证码确认；密钥仅本次显示。"
            : "将生成新密钥，请注意防窥。"}
          onClose={closeDialog}
          onSubmit={save}
          pending={pending}
          title="配置 TOTP 登录"
          titleId="recovery-setup-title"
        >
          {options ? <>
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
              onValueChange={setCode}
              ref={codeRef}
              required
              spellCheck={false}
              value={code}
            />
            <div role="status">{notice ? <VibeNotice tone="info">{notice}</VibeNotice> : null}</div>
          </> : null}
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
    </>
  );
}
