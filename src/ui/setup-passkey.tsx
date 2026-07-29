"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { useState } from "react";

import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import { VibeNotice } from "@/ui/vibe/vibe-notice";

type SetupState = "idle" | "pending" | "done" | "failed" | "unsupported";

export function SetupPasskey() {
  const [state, setState] = useState<SetupState>("idle");

  async function provision() {
    if (typeof window.PublicKeyCredential === "undefined") {
      setState("unsupported");
      return;
    }
    setState("pending");
    try {
      const optionsResponse = await fetch("/api/auth/register/options", {
        method: "POST",
      });
      if (!optionsResponse.ok) {
        setState("failed");
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
      setState(verifyResponse.ok ? "done" : "failed");
    } catch {
      setState("failed");
    }
  }

  if (state === "done") {
    return (
      <div className="setup-done">
        <VibeNotice role="status" tone="success">
          已完成预置。预置不会自动登录，请返回所有者登录页验证身份。
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
      {state === "failed" ? (
        <VibeNotice
          className="login-error setup-feedback-message"
          code="ERROR"
          role="alert"
          tone="error"
        >
          预置失败或已取消。请重试；如系统未弹出 Passkey
          窗口，请改用支持 Passkey 的浏览器或设备。
        </VibeNotice>
      ) : null}
      {state === "unsupported" ? (
        <>
          <VibeNotice
            className="login-error setup-feedback-message"
            code="UNSUPPORTED"
            role="alert"
            tone="error"
          >
            当前浏览器或设备不支持 Passkey。请改用支持 WebAuthn
            的浏览器或设备，然后返回首页重新开始。
          </VibeNotice>
          <div className="setup-feedback-actions">
            <VibeLink className="setup-secondary-action" href="/" variant="text">
              返回首页
            </VibeLink>
          </div>
        </>
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
