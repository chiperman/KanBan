"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { useState } from "react";

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
      <div className="setup-done" role="status">
        <p>已完成预置。预置不会自动登录，请返回所有者登录页验证身份。</p>
        <a className="login-primary provision-primary setup-home-link" href="/">
          <span>返回所有者登录</span>
          <span className="provision-primary-arrow" aria-hidden="true">
            →
          </span>
        </a>
      </div>
    );
  }

  return (
    <div className="setup-actions">
      {state === "failed" ? (
        <p className="login-error setup-feedback-message" role="alert">
          <span className="setup-feedback-code">[ ERROR ]</span>
          <span>
            预置失败或已取消。请重试；如系统未弹出 Passkey
            窗口，请改用支持 Passkey 的浏览器或设备。
          </span>
        </p>
      ) : null}
      {state === "unsupported" ? (
        <>
          <p className="login-error setup-feedback-message" role="alert">
            <span className="setup-feedback-code">[ UNSUPPORTED ]</span>
            <span>
              当前浏览器或设备不支持 Passkey。请改用支持 WebAuthn
              的浏览器或设备，然后返回首页重新开始。
            </span>
          </p>
          <div className="setup-feedback-actions">
            <a className="login-cancel setup-secondary-action" href="/">
              返回首页
            </a>
          </div>
        </>
      ) : (
        <div className={state === "failed" ? "setup-feedback-actions" : undefined}>
          <button
            type="button"
            className="login-primary provision-primary"
            disabled={state === "pending"}
            onClick={provision}
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
          </button>
          {state === "failed" ? (
            <a className="login-cancel setup-secondary-action" href="/">
              返回首页
            </a>
          ) : null}
        </div>
      )}
    </div>
  );
}
