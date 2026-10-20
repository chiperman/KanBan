"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { useState } from "react";

import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeDialog } from "@/ui/vibe/vibe-dialog";
import { VibeNotice } from "@/ui/vibe/vibe-notice";

type Pending = "idle" | "registering" | "removing";

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
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const busy = pending !== "idle";

  async function register() {
    setError("");
    setNotice("");
    if (typeof window.PublicKeyCredential === "undefined") {
      setError(
        "当前浏览器或设备不支持 Passkey，请改用支持 WebAuthn 的浏览器或设备。",
      );
      return;
    }
    setPending("registering");
    try {
      const optionsResponse = await fetch("/api/auth/register/options", {
        method: "POST",
      });
      if (!optionsResponse.ok) {
        setError("无法开始 Passkey 绑定");
        setPending("idle");
        return;
      }
      const attestation = await startRegistration({
        optionsJSON: await optionsResponse.json(),
      });
      const verifyResponse = await fetch("/api/auth/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(attestation),
      });
      if (!verifyResponse.ok) {
        setError("Passkey 绑定失败或已取消，请重试。");
        setPending("idle");
        return;
      }
      setConfiguredNow(true);
      setBoundAtNow(new Date().toISOString());
      setNotice(configured ? "Passkey 已重新绑定。" : "Passkey 已绑定。");
    } catch {
      setError("Passkey 绑定失败或已取消，请重试。");
    }
    setPending("idle");
  }

  async function remove() {
    setError("");
    setNotice("");
    setPending("removing");
    try {
      const response = await fetch("/api/auth/passkey", { method: "DELETE" });
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(result?.error ?? "移除 Passkey 失败");
        setConfirmRemove(false);
        setPending("idle");
        return;
      }
      setConfiguredNow(false);
      setBoundAtNow(null);
      setNotice("Passkey 已移除，请使用 TOTP 登录。");
      setConfirmRemove(false);
    } catch {
      setError("移除 Passkey 失败，请检查连接后重试");
      setConfirmRemove(false);
    }
    setPending("idle");
  }

  return (
    <>
      <dl className="security-settings__statuses">
        <div>
          <dt>Passkey</dt>
          <dd data-vibe-tone={configuredNow ? "success" : "warning"}>
            {configuredNow ? "已启用" : "尚未配置"}
            {configuredNow && boundAtNow ? (
              <span className="security-settings__bound-at">
                {` · 绑定于 ${boundAtNow.slice(0, 10)}`}
              </span>
            ) : null}
          </dd>
        </div>
      </dl>
      <div className="security-settings__actions">
        <VibeButton
          type="button"
          disabled={busy}
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
            disabled={busy || !recoveryConfigured}
            onClick={() => setConfirmRemove(true)}
            tone="danger"
            variant="outline"
          >
            移除 Passkey
          </VibeButton>
        ) : null}
      </div>
      {configuredNow && !recoveryConfigured ? (
        <p className="security-settings__hint">
          移除 Passkey 前需先配置 TOTP 登录，避免无法登录。
        </p>
      ) : null}
      {notice ? (
        <VibeNotice className="vibe-notice--compact" role="status" tone="success">
          {notice}
        </VibeNotice>
      ) : null}
      {error ? (
        <VibeNotice className="login-error" role="alert" tone="error">
          {error}
        </VibeNotice>
      ) : null}
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
                onClick={() => void remove()}
                tone="danger"
                variant="primary"
              >
                {pending === "removing" ? "正在移除…" : "确认移除"}
              </VibeButton>
            </>
          }
          description={<>移除后只能用 TOTP 登录；可在登录后于设置页重新绑定。</>}
          eyebrow="SETTINGS / PASSKEY"
          onClose={() => setConfirmRemove(false)}
          title="移除 Passkey"
          titleId="passkey-remove-title"
        />
      ) : null}
    </>
  );
}
