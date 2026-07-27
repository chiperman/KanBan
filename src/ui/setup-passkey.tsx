"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { useState } from "react";

type SetupState = "idle" | "pending" | "done" | "failed";

export function SetupPasskey() {
  const [state, setState] = useState<SetupState>("idle");

  async function provision() {
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
        <p>已完成预置。预置不会自动登录，请返回资产看板验证身份。</p>
        <a className="login-primary setup-home-link" href="/">
          返回资产看板
        </a>
      </div>
    );
  }

  return (
    <div className="setup-actions">
      {state === "failed" ? (
        <p className="login-error" role="alert">
          预置失败或已取消，请重试。
        </p>
      ) : null}
      <button
        type="button"
        className="login-primary"
        disabled={state === "pending"}
        onClick={provision}
      >
        {state === "pending" ? "等待 Passkey…" : "创建所有者 Passkey"}
      </button>
    </div>
  );
}
