"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { useEffect, useRef, useState } from "react";

import { RecoverySetup } from "@/ui/recovery-setup";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeDialog } from "@/ui/vibe/vibe-dialog";
import { VibeNotice } from "@/ui/vibe/vibe-notice";

type Pending = "idle" | "registering" | "removing" | "checking";

interface OwnerPasskeySettingsProps {
  configured: boolean;
  boundAt: string | null;
  recoveryConfigured: boolean;
}

/** 设置页的 Passkey 状态与操作：已登录时可重新绑定或移除，不做多凭证列表。 */
export function OwnerPasskeySettings({
  configured,
  boundAt,
  recoveryConfigured,
}: OwnerPasskeySettingsProps) {
  const [pending, setPending] = useState<Pending>("idle");
  const [configuredNow, setConfiguredNow] = useState(configured);
  const [boundAtNow, setBoundAtNow] = useState(boundAt);
  const [recoveryConfiguredNow, setRecoveryConfiguredNow] = useState(recoveryConfigured);
  const pendingRef = useRef(false);
  const [needsCheck, setNeedsCheck] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<"success" | "info">("success");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const busy = pending !== "idle";

  useEffect(() => { setConfiguredNow(configured); }, [configured]);
  useEffect(() => { setBoundAtNow(boundAt); }, [boundAt]);
  useEffect(() => { setRecoveryConfiguredNow(recoveryConfigured); }, [recoveryConfigured]);

  async function register() {
    if (pendingRef.current || needsCheck) return;
    setError("");
    setNotice("");
    setNoticeTone("success");
    if (typeof window.PublicKeyCredential === "undefined") {
      setError(
        "当前浏览器或设备不支持 Passkey，请改用支持 WebAuthn 的浏览器或设备。",
      );
      return;
    }
    pendingRef.current = true;
    setPending("registering");
    let stage: "options" | "ceremony" | "verify" = "options";
    try {
      const optionsResponse = await fetch("/api/auth/register/options", {
        method: "POST",
      });
      if (!optionsResponse.ok) {
        const result = await optionsResponse.json().catch(() => null);
        setError(result?.error ?? "无法开始 Passkey 绑定，请稍后重试。");
        return;
      }
      const optionsJSON = await optionsResponse.json();
      stage = "ceremony";
      const attestation = await startRegistration({
        optionsJSON,
      });
      stage = "verify";
      const verifyResponse = await fetch("/api/auth/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(attestation),
      });
      const result = await verifyResponse.json().catch(() => null);
      if (verifyResponse.status >= 500 || (verifyResponse.ok && result?.ok !== true)) {
        setNeedsCheck(true);
        setError("尚未确认 Passkey 绑定结果，请先重新读取状态，再决定是否重新绑定。");
        return;
      }
      if (!verifyResponse.ok) {
        setError(result?.error ?? "Passkey 绑定未通过，请重试。");
        return;
      }
      setConfiguredNow(true);
      setBoundAtNow(new Date().toISOString());
      setNotice(configuredNow ? "Passkey 已重新绑定。" : "Passkey 已绑定。");
    } catch (caught) {
      if (stage === "verify") {
        setNeedsCheck(true);
        setError("连接中断，尚未确认 Passkey 绑定结果，请先重新读取状态。");
      } else if (stage === "ceremony") {
        const cause = caught instanceof Error && caught.cause instanceof Error ? caught.cause : caught;
        if (cause instanceof Error && ["AbortError", "NotAllowedError"].includes(cause.name)) {
          setNoticeTone("info");
          setNotice("Passkey 绑定未完成，可能已取消或等待超时；现有登录方式未改变。");
        } else {
          setError("设备未能创建 Passkey，请重试或改用支持 Passkey 的浏览器与设备。");
        }
      } else {
        setError("无法连接到服务，尚未开始绑定；请检查连接后重试。");
      }
    } finally {
      pendingRef.current = false;
      setPending("idle");
    }
  }

  async function remove() {
    if (pendingRef.current || needsCheck) return;
    pendingRef.current = true;
    setError("");
    setNotice("");
    setNoticeTone("success");
    setPending("removing");
    try {
      const response = await fetch("/api/auth/passkey", { method: "DELETE" });
      const result = await response.json().catch(() => null);
      if (response.ok && result?.ok !== true) {
        setNeedsCheck(true);
        setError("尚未确认移除结果，请先重新读取 Passkey 状态。");
        return;
      }
      if (!response.ok) {
        if (response.status >= 500) {
          setNeedsCheck(true);
          setError("尚未确认移除结果，请先重新读取 Passkey 状态。");
        } else setError(result?.error ?? "未能移除 Passkey，请重试。");
        return;
      }
      setConfiguredNow(false);
      setBoundAtNow(null);
      setNotice("Passkey 已移除，请使用 TOTP 登录。");
      setConfirmRemove(false);
    } catch {
      setNeedsCheck(true);
      setError("连接中断，尚未确认移除结果，请先重新读取 Passkey 状态。");
    } finally {
      pendingRef.current = false;
      setPending("idle");
    }
  }

  async function checkStatus() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending("checking");
    setError("");
    try {
      const response = await fetch("/api/auth/passkey", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const result = await response.json().catch(() => null);
      if (!response.ok || typeof result?.configured !== "boolean" || typeof result?.recoveryConfigured !== "boolean" || (result.boundAt !== null && typeof result.boundAt !== "string")) {
        setError(result?.error ?? "无法读取 Passkey 状态，请检查连接后重试。");
        return;
      }
      setConfiguredNow(result.configured);
      setBoundAtNow(result.boundAt);
      setRecoveryConfiguredNow(result.recoveryConfigured);
      setNeedsCheck(false);
      setConfirmRemove(false);
      setNoticeTone("info");
      setNotice("已读取当前 Passkey 状态，请核对后再操作。");
    } catch {
      setError("无法读取 Passkey 状态，请检查连接后重试。");
    } finally {
      pendingRef.current = false;
      setPending("idle");
    }
  }

  return (
    <>
      <dl className="security-settings__statuses">
        <div>
          <dt>Passkey</dt>
          <dd data-vibe-tone={needsCheck ? "warning" : configuredNow ? "success" : "warning"}>
            {needsCheck ? `待核对（上次${configuredNow ? "已启用" : "尚未配置"}）` : configuredNow ? "已启用" : "尚未配置"}
            {configuredNow && boundAtNow ? (
              <span className="security-settings__bound-at">
                {`，绑定于 ${boundAtNow.slice(0, 10)}`}
              </span>
            ) : null}
          </dd>
        </div>
      </dl>
      <div className="security-settings__actions">
        <VibeButton
          type="button"
          disabled={busy || needsCheck}
          onClick={() => void register()}
          variant={configuredNow ? "outline" : "primary"}
        >
          {pending === "registering"
            ? "等待 Passkey…"
            : configuredNow
              ? "重新绑定 Passkey"
              : "绑定 Passkey"}
        </VibeButton>
        {configuredNow ? (
          <VibeButton
            type="button"
            disabled={busy || needsCheck || !recoveryConfiguredNow}
            onClick={() => { setError(""); setNotice(""); setConfirmRemove(true); }}
            tone="danger"
            variant="outline"
          >
            移除 Passkey
          </VibeButton>
        ) : null}
      </div>
      {configuredNow && !recoveryConfiguredNow ? (
        <p className="security-settings__hint">
          移除 Passkey 前需先配置 TOTP 登录，避免无法登录。
        </p>
      ) : null}
      <div role="status">
        {notice ? <VibeNotice className="vibe-notice--compact" tone={noticeTone}>{notice}</VibeNotice> : null}
      </div>
      {needsCheck && !confirmRemove ? <VibeButton type="button" disabled={busy} onClick={() => void checkStatus()} variant="outline">
        {pending === "checking" ? "正在读取…" : "重新读取 Passkey 状态"}
      </VibeButton> : null}
      {error && !confirmRemove ? (
        <VibeNotice className="login-error" role="alert" tone="error">
          {error}
        </VibeNotice>
      ) : null}
      <div className="security-settings__recovery">
        <h3 id="recovery-settings-title">TOTP 登录</h3>
        <RecoverySetup configured={recoveryConfiguredNow} onConfigured={() => setRecoveryConfiguredNow(true)} />
      </div>
      {confirmRemove ? (
        <VibeDialog
          actions={
            <>
              <VibeButton
                type="button"
                disabled={busy}
                onClick={() => setConfirmRemove(false)}
                variant="text"
              >
                取消
              </VibeButton>
              <VibeButton
                type="button"
                disabled={busy}
                onClick={() => void (needsCheck ? checkStatus() : remove())}
                tone="danger"
                variant="primary"
              >
                {pending === "removing" ? "正在移除…" : pending === "checking" ? "正在读取…" : needsCheck ? "重新读取状态" : error ? "重试移除" : "确认移除"}
              </VibeButton>
            </>
          }
          description={<>移除后只能用 TOTP 登录；可在登录后于设置页重新绑定。</>}
          onClose={() => setConfirmRemove(false)}
          pending={busy}
          title="移除 Passkey"
          titleId="passkey-remove-title"
        >
          {error ? <VibeNotice role="alert" tone="error">{error}</VibeNotice> : null}
        </VibeDialog>
      ) : null}
    </>
  );
}
