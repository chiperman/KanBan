"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { LockedComputer } from "@/ui/locked-computer/locked-computer";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import { VibeDotIcon } from "@/ui/vibe/vibe-dot-icon";
import { VibeIcon } from "@/ui/vibe/vibe-icon";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { VibeVerificationCode } from "@/ui/vibe/vibe-verification-code";

type LoginState = "idle" | "pending";
type LoginMode = "choice" | "recovery-totp";

interface OwnerLoginProps {
  ownerProvisioned: boolean;
  recoveryConfigured: boolean;
}

function recoveryRetryAt(response: Response): number {
  const value = response.headers.get("Retry-After");
  if (value && /^\d+$/.test(value)) {
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Date.now() + seconds * 1000;
  }
  const date = value ? Date.parse(value) : NaN;
  return Number.isFinite(date) ? date : Date.now() + 300_000;
}

const LOCKED_FLOW_DURATION = "12s";
const LOCKED_FLOW_BEGIN = "0s";
const LOCKED_FLOW_SOURCE_ACTIVE = 0.06;
const LOCKED_FLOW_SYNC_ACTIVE = 0.3;
const LOCKED_FLOW_VALUE_ACTIVE = 0.56;
const LOCKED_FLOW_DASHBOARD_ACTIVE = 0.82;
const LOCKED_FLOW_FADE_DURATION = 0.03;
const LOCKED_FLOW_DIM_START = 0.92;
const LOCKED_FLOW_MASK_HOLD = 0.949;
const LOCKED_FLOW_RESET = 0.95;

const LOCKED_FLOW_SOURCES = [
  {
    id: "source-1",
    label: "Longbridge",
    tone: "signal",
    y: 72,
    route: "M148 88H160C184 88 184 212 212 212",
    start: LOCKED_FLOW_SOURCE_ACTIVE,
    end: LOCKED_FLOW_SYNC_ACTIVE,
  },
  {
    id: "source-2",
    label: "Binance",
    tone: "signal",
    y: 134,
    route: "M148 150H170C190 150 190 212 212 212",
    start: LOCKED_FLOW_SOURCE_ACTIVE,
    end: LOCKED_FLOW_SYNC_ACTIVE,
  },
  {
    id: "source-3",
    label: "OKX",
    tone: "signal",
    y: 196,
    route: "M148 212H212",
    start: LOCKED_FLOW_SOURCE_ACTIVE,
    end: LOCKED_FLOW_SYNC_ACTIVE,
  },
  {
    id: "source-4",
    label: "Bitget",
    tone: "signal",
    y: 258,
    route: "M148 274H170C190 274 190 212 212 212",
    start: LOCKED_FLOW_SOURCE_ACTIVE,
    end: LOCKED_FLOW_SYNC_ACTIVE,
  },
  {
    id: "source-5",
    label: "Web3",
    tone: "signal",
    y: 320,
    route: "M148 336H160C184 336 184 212 212 212",
    start: LOCKED_FLOW_SOURCE_ACTIVE,
    end: LOCKED_FLOW_SYNC_ACTIVE,
  },
] as const;

const LOCKED_FLOW_CONTINUATION = [
  {
    id: "sync-value",
    tone: "signal",
    route: "M276 212H328",
    start: 0.4,
    end: LOCKED_FLOW_VALUE_ACTIVE,
  },
  {
    id: "value-dashboard",
    tone: "signal",
    route: "M392 212H436",
    start: 0.64,
    end: LOCKED_FLOW_DASHBOARD_ACTIVE,
  },
] as const;

const LOCKED_FLOW_ROUTES = [...LOCKED_FLOW_SOURCES, ...LOCKED_FLOW_CONTINUATION];

interface LockedFlowOpacityProps {
  activeAt: number;
  inactiveOpacity: number;
  reducedMotion: boolean;
}

function LockedFlowOpacity({
  activeAt,
  inactiveOpacity,
  reducedMotion,
}: LockedFlowOpacityProps) {
  if (reducedMotion) {
    return null;
  }

  const fullyActiveAt = activeAt + LOCKED_FLOW_FADE_DURATION;

  return (
    <animate
      attributeName="opacity"
      begin={LOCKED_FLOW_BEGIN}
      calcMode="linear"
      dur={LOCKED_FLOW_DURATION}
      keyTimes={`0;${activeAt};${fullyActiveAt};${LOCKED_FLOW_DIM_START};${LOCKED_FLOW_RESET};1`}
      repeatCount="indefinite"
      values={`${inactiveOpacity};${inactiveOpacity};1;1;${inactiveOpacity};${inactiveOpacity}`}
    />
  );
}

interface LockedFlowRouteProps {
  reducedMotion: boolean;
  route: (typeof LOCKED_FLOW_ROUTES)[number];
}

function LockedFlowRoute({ reducedMotion, route }: LockedFlowRouteProps) {
  const maskId = `locked-flow-mask-${route.id}`;
  const motionKeyTimes = `0;${route.start};${route.end};${LOCKED_FLOW_RESET};1`;

  return (
    <g className={`locked-flow-route locked-flow-route--${route.tone}`}>
      <path className="locked-flow-route-base" d={route.route} />
      {reducedMotion ? null : (
        <>
          <path
            className="locked-flow-route-active"
            d={route.route}
            mask={`url(#${maskId})`}
          >
            <animate
              attributeName="opacity"
              begin={LOCKED_FLOW_BEGIN}
              calcMode="linear"
              dur={LOCKED_FLOW_DURATION}
              keyTimes={`0;${LOCKED_FLOW_DIM_START};${LOCKED_FLOW_RESET};1`}
              repeatCount="indefinite"
              values="0.92;0.92;0;0"
            />
          </path>
          <circle className="locked-flow-route-runner" r="3.5">
            <animate
              attributeName="opacity"
              begin={LOCKED_FLOW_BEGIN}
              calcMode="discrete"
              dur={LOCKED_FLOW_DURATION}
              keyTimes={motionKeyTimes}
              repeatCount="indefinite"
              values="0;1;0;0;0"
            />
            <animateMotion
              begin={LOCKED_FLOW_BEGIN}
              calcMode="linear"
              dur={LOCKED_FLOW_DURATION}
              keyPoints="0;0;1;1;1"
              keyTimes={motionKeyTimes}
              path={route.route}
              repeatCount="indefinite"
            />
          </circle>
        </>
      )}
    </g>
  );
}

function LockedProductFlow() {
  const reducedMotion = true;

  return (
    <LockedComputer reducedMotion={reducedMotion}>
      <defs>
        {reducedMotion
          ? null
          : LOCKED_FLOW_ROUTES.map((route) => (
              <mask
                height="580"
                id={`locked-flow-mask-${route.id}`}
                key={route.id}
                maskUnits="userSpaceOnUse"
                width="680"
                x="0"
                y="0"
              >
                <path
                  className="locked-flow-route-reveal"
                  d={route.route}
                  pathLength="1"
                >
                  <animate
                    attributeName="stroke-dashoffset"
                    begin={LOCKED_FLOW_BEGIN}
                    calcMode="linear"
                    dur={LOCKED_FLOW_DURATION}
                    keyTimes={`0;${route.start};${route.end};${LOCKED_FLOW_MASK_HOLD};${LOCKED_FLOW_RESET};1`}
                    repeatCount="indefinite"
                    values="1;1;0;0;1;1"
                  />
                </path>
              </mask>
            ))}
      </defs>
      <g className="locked-flow-screen">
        {LOCKED_FLOW_SOURCES.map((source, index) => {
          const centerY = source.y + 16;
          return (
            <g
              className={`locked-flow-source locked-flow-source--${index + 1}`}
              key={source.label}
            >
              <LockedFlowOpacity
                activeAt={source.start}
                inactiveOpacity={0.54}
                reducedMotion={reducedMotion}
              />
              <rect height="32" rx="3" width="96" x="52" y={source.y} />
              <text dominantBaseline="middle" textAnchor="middle" x="100" y={centerY}>
                {source.label}
              </text>
            </g>
          );
        })}
        {LOCKED_FLOW_SOURCES.map((route) => (
          <LockedFlowRoute
            key={route.id}
            reducedMotion={reducedMotion}
            route={route}
          />
        ))}
        {LOCKED_FLOW_CONTINUATION.map((route) => (
          <LockedFlowRoute
            key={route.id}
            reducedMotion={reducedMotion}
            route={route}
          />
        ))}

        <g className="locked-flow-stage locked-flow-stage--sync">
          <LockedFlowOpacity
            activeAt={LOCKED_FLOW_SYNC_ACTIVE}
            inactiveOpacity={0.5}
            reducedMotion={reducedMotion}
          />
          <rect height="76" rx="4" width="64" x="212" y="174" />
          <text dominantBaseline="middle" textAnchor="middle" x="244" y="212">
            SYNC
          </text>
        </g>

        <g className="locked-flow-stage locked-flow-stage--value">
          <LockedFlowOpacity
            activeAt={LOCKED_FLOW_VALUE_ACTIVE}
            inactiveOpacity={0.5}
            reducedMotion={reducedMotion}
          />
          <rect height="76" rx="4" width="64" x="328" y="174" />
          <text dominantBaseline="middle" textAnchor="middle" x="360" y="212">
            VALUE
          </text>
        </g>

        <g className="locked-flow-stage locked-flow-stage--dashboard">
          <LockedFlowOpacity
            activeAt={LOCKED_FLOW_DASHBOARD_ACTIVE}
            inactiveOpacity={0.5}
            reducedMotion={reducedMotion}
          />
          <text className="locked-flow-dashboard-label" x="436" y="142">
            READ ONLY
          </text>
          <rect height="134" rx="4" width="184" x="436" y="154" />
          <circle cx="458" cy="182" r="10" />
          <path d="M476 176H526M476 186H518" />
          <path d="M448 212H608" />
          <path d="M448 226H520M448 238H510" />
          <rect height="5" width="8" x="450" y="252" />
          <rect height="5" width="8" x="468" y="252" />
          <rect height="5" width="8" x="486" y="252" />
          <rect height="5" width="8" x="450" y="266" />
          <rect height="5" width="8" x="468" y="266" />
          <rect height="5" width="8" x="486" y="266" />
          <circle cx="550" cy="232" r="3" />
          <circle cx="568" cy="232" r="3" />
          <circle cx="586" cy="232" r="3" />
          <circle
            className="locked-flow-dashboard-point-base"
            cx="606"
            cy="232"
            r="3"
          />
          <circle className="locked-flow-dashboard-point" cx="606" cy="232" r="3">
            <LockedFlowOpacity
              activeAt={LOCKED_FLOW_DASHBOARD_ACTIVE}
              inactiveOpacity={0}
              reducedMotion={reducedMotion}
            />
          </circle>
          <rect height="12" width="12" x="544" y="252" />
          <rect height="12" width="12" x="568" y="252" />
          <rect height="12" width="12" x="592" y="252" />
          <path className="locked-flow-dashboard-chart" d="M546 196L560 182L574 192L594 170" />
          <circle
            className="locked-flow-dashboard-point-base"
            cx="594"
            cy="170"
            r="3"
          />
          <circle className="locked-flow-dashboard-point" cx="594" cy="170" r="3">
            <LockedFlowOpacity
              activeAt={LOCKED_FLOW_DASHBOARD_ACTIVE}
              inactiveOpacity={0}
              reducedMotion={reducedMotion}
            />
          </circle>
        </g>
      </g>
    </LockedComputer>
  );
}

export function OwnerLogin({
  ownerProvisioned,
  recoveryConfigured,
}: OwnerLoginProps) {
  const [state, setState] = useState<LoginState>("idle");
  const [mode, setMode] = useState<LoginMode>("choice");
  const [loginError, setLoginError] = useState("");
  const [notice, setNotice] = useState("");
  const authPendingRef = useRef(false);
  const [recoveryError, setRecoveryError] = useState("");
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [recoveryRetryDeadline, setRecoveryRetryDeadline] = useState<number | null>(null);
  const recoveryRateLimited = recoveryRetryDeadline !== null;
  const recoveryCodeRef = useRef<HTMLInputElement>(null);
  // 只要存在任一登录方式即为锁定态：允许仅剩 TOTP 时仍能登录与恢复。
  const locked = ownerProvisioned || recoveryConfigured;

  useEffect(() => {
    if (recoveryRetryDeadline === null) return;
    const timer = window.setTimeout(() => {
      setRecoveryRetryDeadline(null);
      setRecoveryError("");
      if (mode === "recovery-totp") setNotice("可以重新输入 TOTP 验证码。");
    }, Math.max(0, recoveryRetryDeadline - Date.now()));
    return () => window.clearTimeout(timer);
  }, [recoveryRetryDeadline, mode]);

  function showRecoveryTotp() {
    if (authPendingRef.current) return;
    setState("idle");
    setLoginError("");
    setNotice("");
    if (!recoveryRateLimited) setRecoveryError("");
    setMode("recovery-totp");
  }

  function returnToLoginChoice() {
    if (authPendingRef.current) return;
    if (!recoveryRateLimited) setRecoveryError("");
    setNotice("");
    setMode("choice");
  }

  async function login() {
    if (authPendingRef.current) return;
    setLoginError("");
    setNotice("");
    if (typeof window.PublicKeyCredential === "undefined") {
      setLoginError(`当前浏览器或设备不支持 Passkey，请换用支持 Passkey 的浏览器${recoveryConfigured ? "或使用 TOTP 登录" : "或设备"}。`);
      return;
    }
    authPendingRef.current = true;
    setState("pending");
    let stage: "options" | "ceremony" | "verify" = "options";
    let authenticated = false;
    try {
      const optionsResponse = await fetch("/api/auth/login/options", {
        method: "POST",
      });
      if (!optionsResponse.ok) {
        const result = await optionsResponse.json().catch(() => null);
        setLoginError(result?.error ?? "暂时无法开始 Passkey 登录，请稍后重试。");
        return;
      }
      const optionsJSON = await optionsResponse.json();
      stage = "ceremony";
      const assertion = await startAuthentication({
        optionsJSON,
      });
      stage = "verify";
      const verifyResponse = await fetch("/api/auth/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assertion),
      });
      const result = await verifyResponse.json().catch(() => null);
      if (!verifyResponse.ok) {
        setLoginError(result?.error ?? "Passkey 登录验证未通过，请重试。");
        return;
      }
      if (result?.ok !== true) {
        setLoginError("尚未确认登录结果，请重试。");
        return;
      }
      authenticated = true;
      window.location.reload();
    } catch (caught) {
      if (stage === "ceremony") {
        const cause = caught instanceof Error && caught.cause instanceof Error ? caught.cause : caught;
        if (cause instanceof Error && ["AbortError", "NotAllowedError"].includes(cause.name)) {
          setNotice("Passkey 验证未完成，可能已取消或等待超时；可重新发起登录。");
        } else {
          setLoginError("设备未能完成 Passkey 验证，请重试或换用支持 Passkey 的浏览器与设备。");
        }
      } else {
        setLoginError(stage === "verify" ? "连接中断，尚未确认登录结果，请检查连接后重试。" : "无法开始 Passkey 登录，请检查连接后重试。");
      }
    } finally {
      if (!authenticated) {
        authPendingRef.current = false;
        setState("idle");
      }
    }
  }

  async function verifyRecoveryTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authPendingRef.current || recoveryRateLimited) return;
    const data = new FormData(event.currentTarget);
    authPendingRef.current = true;
    setRecoveryPending(true);
    setRecoveryError("");
    setNotice("");
    let authenticated = false;
    try {
      const response = await fetch("/api/auth/recovery/totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: data.get("code") }),
      });
      const result = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok) {
        const rateLimited = response.status === 429;
        if (rateLimited) setRecoveryRetryDeadline(recoveryRetryAt(response));
        setRecoveryError(result?.error ?? "TOTP 验证失败");
        if (!rateLimited) {
          window.requestAnimationFrame(() => recoveryCodeRef.current?.focus());
        }
        return;
      }
      if (result?.ok !== true) {
        setRecoveryError("尚未确认登录结果，请重试。");
        return;
      }
      authenticated = true;
      window.location.reload();
    } catch {
      setRecoveryError("TOTP 验证失败，请检查连接后重试");
      window.requestAnimationFrame(() => recoveryCodeRef.current?.focus());
    } finally {
      if (!authenticated) {
        authPendingRef.current = false;
        setRecoveryPending(false);
      }
    }
  }

  return (
    <section
      aria-labelledby="login-title"
      className="login-gate vibe-auth-surface"
      data-testid="login-gate"
      data-vibe-surface="auth-panel"
    >
      <div className="login-auth-column">
        <h1 id="login-title">资产看板</h1>
        <div className="login-flow" key={locked ? mode : "setup"}>
          <div role="status" className={notice ? "login-error" : undefined}>
            {notice ? <VibeNotice tone="info">{notice}</VibeNotice> : null}
          </div>
          {loginError ? (
            <VibeNotice className="login-error" role="alert" tone="error">
              {loginError}
            </VibeNotice>
          ) : null}
          {!locked ? (
            <div className="login-actions first-run-actions">
              <VibeLink className="login-enter" href="/setup" variant="primary">
                <VibeDotIcon name="key" />
                <span>设置 Passkey</span>
                <VibeIcon name="arrow-right" />
              </VibeLink>
            </div>
          ) : null}
          {locked && mode === "choice" ? (
            <div className="login-actions login-actions--choice">
              {ownerProvisioned ? (
                <VibeButton
                  className="login-enter"
                  type="button"
                  disabled={state === "pending"}
                  onClick={login}
                  variant="primary"
                >
                  <VibeDotIcon name="key" />
                  <span>{state === "pending" ? "正在验证…" : "使用 Passkey 登录"}</span>
                  <VibeIcon name="arrow-right" />
                </VibeButton>
              ) : null}
              {recoveryConfigured && !ownerProvisioned ? (
                <VibeButton
                  className="login-enter"
                  type="button"
                  onClick={showRecoveryTotp}
                  variant="primary"
                >
                  <VibeDotIcon name="key" />
                  <span>使用 TOTP 登录</span>
                  <VibeIcon name="arrow-right" />
                </VibeButton>
              ) : null}
            </div>
          ) : null}
          {mode === "recovery-totp" ? (
            <form
              className="login-form"
              data-vibe-surface="auth-flow"
              onSubmit={verifyRecoveryTotp}
            >
              <VibeVerificationCode
                aria-describedby={recoveryError ? "recovery-totp-error" : undefined}
                aria-invalid={recoveryError ? true : undefined}
                disabled={recoveryPending || recoveryRateLimited}
                fieldId="recovery-totp-code"
                label="TOTP 验证码"
                name="code"
                ref={recoveryCodeRef}
                required
                spellCheck={false}
              />
              {recoveryError ? (
                <VibeNotice
                  className="login-error"
                  id="recovery-totp-error"
                  role="alert"
                  tone="error"
                >
                  {recoveryError}
                </VibeNotice>
              ) : null}
              <div className="login-actions">
                <VibeButton
                  type="submit"
                  disabled={recoveryPending || recoveryRateLimited}
                  variant="primary"
                >
                  {recoveryPending ? "正在验证…" : "完成 TOTP 登录"}
                </VibeButton>
                <VibeButton
                  type="button"
                  disabled={recoveryPending}
                  onClick={returnToLoginChoice}
                  variant="text"
                >
                  返回
                </VibeButton>
              </div>
            </form>
          ) : null}
        </div>
        <div className="login-alternatives">
          {locked && ownerProvisioned && recoveryConfigured && mode === "choice" ? (
            <VibeButton
              className="login-totp-entry"
              type="button"
              disabled={state === "pending"}
              onClick={showRecoveryTotp}
              variant="text"
            >
              使用 TOTP 登录
            </VibeButton>
          ) : null}
          <VibeLink href="/?mode=demo" variant="text" aria-label="进入演示模式">
            演示模式
          </VibeLink>
        </div>
      </div>
      <div className="login-visual-stage">
        <LockedProductFlow />
      </div>
    </section>
  );
}
