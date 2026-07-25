"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import { useState } from "react";

type LoginState = "idle" | "pending" | "failed" | "unavailable";

/**
 * 受限卡片占位：只接收卡片 id 与宽度，不接触任何真实内容。
 * 点击进入 Passkey 登录流程；失败或取消后保持访客状态。
 */
export function RestrictedCard({ span }: { span: 1 | 2 | 3 }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoginState>("idle");

  async function login() {
    setState("pending");
    try {
      const optionsResponse = await fetch("/api/auth/login/options", {
        method: "POST",
      });
      if (!optionsResponse.ok) {
        setState("unavailable");
        return;
      }
      const assertion = await startAuthentication({
        optionsJSON: await optionsResponse.json(),
      });
      const verifyResponse = await fetch("/api/auth/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assertion),
      });
      if (!verifyResponse.ok) {
        setState("failed");
        return;
      }
      // 重新加载以获得服务端按所有者身份渲染的页面，避免客户端残留访客视图。
      window.location.reload();
    } catch {
      // 用户取消或认证器失败：保持访客状态。
      setState("failed");
    }
  }

  return (
    <article
      className={`card card-restricted span-${span}`}
      data-testid="restricted-card"
    >
      <div className="restricted-mask" aria-hidden="true" />
      <p className="card-label">受限内容</p>
      <p className="restricted-hint">此卡片包含敏感信息，验证身份后可见。</p>
      <button
        type="button"
        className="restricted-unlock"
        onClick={() => {
          setOpen(true);
          setState("idle");
        }}
      >
        验证身份后查看
      </button>
      {open ? (
        <div className="login-overlay" role="dialog" aria-modal="true">
          <div className="login-dialog">
            <p className="card-label">所有者验证</p>
            <p className="login-copy">
              使用预置的 Passkey 验证身份后，此页面将显示敏感内容。
            </p>
            {state === "failed" ? (
              <p className="login-error" role="alert">
                验证失败或已取消，仍处于访客状态。
              </p>
            ) : null}
            {state === "unavailable" ? (
              <p className="login-error" role="alert">
                所有者尚未预置登录凭证。
              </p>
            ) : null}
            <div className="login-actions">
              <button
                type="button"
                className="login-primary"
                disabled={state === "pending"}
                onClick={login}
              >
                {state === "pending" ? "等待 Passkey…" : "使用 Passkey 解锁"}
              </button>
              <button
                type="button"
                className="login-cancel"
                disabled={state === "pending"}
                onClick={() => setOpen(false)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}
