"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { useRef, useState } from "react";

import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import { VibeNotice } from "@/ui/vibe/vibe-notice";

type SetupState = "idle" | "pending" | "done" | "failed" | "cancelled" | "unconfirmed" | "unsupported";

export function SetupPasskey() {
  const [state, setState] = useState<SetupState>("idle");
  const [message, setMessage] = useState("");
  const pendingRef = useRef(false);
  const needsCheckRef = useRef(false);

  function unconfirmed() {
    needsCheckRef.current = true;
    setState("unconfirmed");
    setMessage("尚未确认 Passkey 预置结果。请返回所有者登录，尝试使用刚创建的 Passkey；如仍未配置，再从登录页进入预置。");
  }

  async function provision() {
    if (pendingRef.current || needsCheckRef.current) return;
    if (typeof window.PublicKeyCredential === "undefined") {
      setState("unsupported");
      return;
    }
    pendingRef.current = true;
    setState("pending");
    setMessage("");
    let stage: "options" | "ceremony" | "verify" = "options";
    try {
      const optionsResponse = await fetch("/api/auth/register/options", {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
      });
      if (!optionsResponse.ok) {
        const result = await optionsResponse.json().catch(() => null);
        setMessage(result?.error ?? "无法开始 Passkey 预置，请稍后重试。");
        setState("failed");
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
        unconfirmed();
      } else if (!verifyResponse.ok) {
        setState("failed");
        setMessage(result?.error ?? "Passkey 预置验证未通过，请重试。");
      } else {
        needsCheckRef.current = true;
        setState("done");
      }
    } catch (caught) {
      if (stage === "verify") unconfirmed();
      else if (stage === "ceremony") {
        const cause = caught instanceof Error && caught.cause instanceof Error ? caught.cause : caught;
        if (cause instanceof Error && ["AbortError", "NotAllowedError"].includes(cause.name)) {
          setState("cancelled");
          setMessage("Passkey 预置未完成，可能已取消或等待超时；可重新发起。");
        } else {
          setState("failed");
          setMessage("设备未能创建 Passkey，请重试或改用支持 Passkey 的浏览器与设备。");
        }
      } else {
        setState("failed");
        setMessage("无法连接到服务，尚未开始预置；请检查连接后重试。");
      }
    } finally {
      pendingRef.current = false;
    }
  }

  if (state === "done") {
    return (
      <div className="setup-done">
        <VibeNotice role="status" tone="success">
          预置完成，请登录。
        </VibeNotice>
        <VibeLink
          className="provision-primary setup-home-link"
          href="/"
          variant="primary"
        >
          <span>返回所有者登录</span>
          <span className="provision-primary-arrow" aria-hidden="true">
            →
          </span>
        </VibeLink>
      </div>
    );
  }

  return (
    <div className="setup-actions">
      {state === "failed" || state === "unconfirmed" ? (
        <VibeNotice
          className="login-error setup-feedback-message"
          role="alert"
          tone="error"
        >
          {message}
        </VibeNotice>
      ) : null}
      <div role="status">{state === "cancelled" ? <VibeNotice className="setup-feedback-message" tone="info">{message}</VibeNotice> : null}</div>
      {state === "unsupported" ? (
        <>
          <VibeNotice
            className="login-error setup-feedback-message"
            role="alert"
            tone="error"
          >
            当前浏览器或设备不支持 Passkey，请改用支持 WebAuthn 的浏览器或设备。
          </VibeNotice>
          <div className="setup-feedback-actions">
            <VibeLink className="setup-secondary-action" href="/" variant="text">
              返回首页
            </VibeLink>
          </div>
        </>
      ) : state === "unconfirmed" ? (
        <VibeLink className="provision-primary" href="/" variant="primary">返回所有者登录核对</VibeLink>
      ) : (
        <div className={state === "failed" ? "setup-feedback-actions" : undefined}>
          <VibeButton
            type="button"
            className="provision-primary"
            disabled={state === "pending"}
            onClick={provision}
            variant="primary"
          >
            <span>
              {state === "pending"
                ? "等待 Passkey…"
                : state === "failed"
                  ? "重试预置"
                  : "创建所有者 Passkey"}
            </span>
            <span className="provision-primary-arrow" aria-hidden="true">
              →
            </span>
          </VibeButton>
          {state === "failed" ? (
            <VibeLink className="setup-secondary-action" href="/" variant="text">
              返回首页
            </VibeLink>
          ) : null}
        </div>
      )}
    </div>
  );
}
