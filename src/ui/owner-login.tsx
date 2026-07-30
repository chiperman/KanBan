"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import {
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FormEvent,
} from "react";

import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { VibeVerificationCode } from "@/ui/vibe/vibe-verification-code";

type LoginState = "idle" | "pending" | "failed" | "unavailable";
type LoginMode = "choice" | "recovery-totp";

interface OwnerLoginProps {
  ownerProvisioned: boolean;
  recoveryConfigured: boolean;
}

const LOCKED_PIXEL_ROWS = [
  { letter: "L", rows: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"] },
  { letter: "O", rows: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"] },
  { letter: "C", rows: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"] },
  { letter: "K", rows: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"] },
  { letter: "E", rows: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"] },
  { letter: "D", rows: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"] },
] as const;

type LockedPixelLetter = (typeof LOCKED_PIXEL_ROWS)[number]["letter"];

const LOCKED_PIXEL_PATHS: Record<LockedPixelLetter, readonly number[]> = {
  L: [0, 5, 10, 15, 20, 25, 30, 31, 32, 33, 34],
  O: [1, 2, 3, 9, 14, 19, 24, 29, 33, 32, 31, 25, 20, 15, 10, 5],
  C: [4, 3, 2, 1, 5, 10, 15, 20, 25, 31, 32, 33, 34],
  K: [4, 8, 12, 16, 22, 28, 34, 0, 5, 10, 15, 20, 25, 30],
  E: [4, 3, 2, 1, 0, 5, 10, 15, 20, 25, 30, 31, 32, 33, 34, 16, 17, 18],
  D: [0, 1, 2, 3, 9, 14, 19, 24, 29, 33, 32, 31, 30, 25, 20, 15, 10, 5],
};

const LOCKED_PIXEL_GLYPHS = (() => {
  let animationIndex = 0;
  return LOCKED_PIXEL_ROWS.map(({ letter, rows }) => {
    const path = LOCKED_PIXEL_PATHS[letter];
    const pathIndexByCell = new Map(
      path.map((cellIndex, pathIndex) => [cellIndex, pathIndex]),
    );
    const glyphStartIndex = animationIndex;
    animationIndex += path.length;

    return {
      letter,
      cells: rows.flatMap((row, rowIndex) =>
        [...row].map((value, columnIndex) => ({
          filled: value === "1",
          animationIndex:
            value === "1"
              ? glyphStartIndex +
                (pathIndexByCell.get(rowIndex * 5 + columnIndex) ?? 0)
              : null,
        })),
      ),
    };
  });
})();

type LockPixelStyle = CSSProperties & { "--lock-dot-index": number };

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
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

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

function subscribeReducedMotion(onStoreChange: () => void) {
  const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

function getReducedMotionSnapshot() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function getServerReducedMotionSnapshot() {
  return true;
}

function useReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getServerReducedMotionSnapshot,
  );
}

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

const LOCKED_KEYBOARD_ROWS = [
  {
    id: "number",
    gap: 3,
    height: 8,
    widths: Array.from({ length: 15 }, () => 21),
    x: 10,
    y: 4,
  },
  {
    id: "qwerty",
    gap: 3,
    height: 8,
    widths: [27, ...Array.from({ length: 12 }, () => 21), 39],
    x: 10,
    y: 13,
  },
  {
    id: "home",
    gap: 3,
    height: 8,
    widths: [34, ...Array.from({ length: 11 }, () => 21), 56],
    x: 10,
    y: 22,
  },
  {
    id: "shift",
    gap: 3,
    height: 8,
    widths: [46, ...Array.from({ length: 10 }, () => 21), 68],
    x: 10,
    y: 31,
  },
] as const;

interface LockedKeyboardKey {
  height: number;
  id: string;
  width: number;
  x: number;
  y: number;
}

const LOCKED_KEYBOARD_KEYS: LockedKeyboardKey[] = [
  ...LOCKED_KEYBOARD_ROWS.flatMap((row) => {
    let cursorX = row.x;
    return row.widths.map((width, index) => {
      const key = {
        height: row.height,
        id: `${row.id}-${index}`,
        width,
        x: cursorX,
        y: row.y,
      };
      cursorX += width + row.gap;
      return key;
    });
  }),
  { id: "modifier-control", x: 10, y: 40, width: 29, height: 8 },
  { id: "modifier-system", x: 42, y: 40, width: 29, height: 8 },
  { id: "modifier-alt-left", x: 74, y: 40, width: 29, height: 8 },
  { id: "space", x: 106, y: 40, width: 145, height: 8 },
  { id: "modifier-alt-right", x: 254, y: 40, width: 29, height: 8 },
  { id: "modifier-system-right", x: 286, y: 40, width: 29, height: 8 },
  { id: "modifier-control-right", x: 318, y: 40, width: 49, height: 8 },
  ...Array.from({ length: 3 }, (_, column) =>
    Array.from({ length: 2 }, (_, row) => ({
      id: `navigation-${column}-${row}`,
      x: 375 + column * 18,
      y: 4 + row * 9,
      width: 14,
      height: 8,
    })),
  ).flat(),
  { id: "arrow-up", x: 393, y: 31, width: 14, height: 8 },
  { id: "arrow-left", x: 375, y: 40, width: 14, height: 8 },
  { id: "arrow-down", x: 393, y: 40, width: 14, height: 8 },
  { id: "arrow-right", x: 411, y: 40, width: 14, height: 8 },
  ...Array.from({ length: 4 }, (_, column) => ({
    id: `numpad-top-${column}`,
    x: 445 + column * 25,
    y: 4,
    width: 20,
    height: 8,
  })),
  ...Array.from({ length: 3 }, (_, column) => ({
    id: `numpad-seven-${column}`,
    x: 445 + column * 25,
    y: 13,
    width: 20,
    height: 8,
  })),
  { id: "numpad-plus", x: 520, y: 13, width: 20, height: 17 },
  ...Array.from({ length: 3 }, (_, column) => ({
    id: `numpad-four-${column}`,
    x: 445 + column * 25,
    y: 22,
    width: 20,
    height: 8,
  })),
  ...Array.from({ length: 3 }, (_, column) => ({
    id: `numpad-one-${column}`,
    x: 445 + column * 25,
    y: 31,
    width: 20,
    height: 8,
  })),
  { id: "numpad-enter", x: 520, y: 31, width: 20, height: 17 },
  { id: "numpad-zero", x: 445, y: 40, width: 45, height: 8 },
  { id: "numpad-decimal", x: 495, y: 40, width: 20, height: 8 },
];

function getLockedKeyboardPoint(x: number, y: number) {
  const rowProgress = y / 48;
  const left = 53.5 + (38.5 - 53.5) * rowProgress;
  const right = 618 + (633 - 618) * rowProgress;

  return {
    x: left + (x / 544) * (right - left),
    y: 500 + y,
  };
}

function getLockedKeyboardKeyPath(key: LockedKeyboardKey) {
  const topLeft = getLockedKeyboardPoint(key.x, key.y);
  const topRight = getLockedKeyboardPoint(key.x + key.width, key.y);
  const bottomRight = getLockedKeyboardPoint(
    key.x + key.width,
    key.y + key.height,
  );
  const bottomLeft = getLockedKeyboardPoint(key.x, key.y + key.height);

  return [
    `M${topLeft.x.toFixed(2)} ${topLeft.y.toFixed(2)}`,
    `L${topRight.x.toFixed(2)} ${topRight.y.toFixed(2)}`,
    `L${bottomRight.x.toFixed(2)} ${bottomRight.y.toFixed(2)}`,
    `L${bottomLeft.x.toFixed(2)} ${bottomLeft.y.toFixed(2)}`,
    "Z",
  ].join("");
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

function LockedPixelDisplay() {
  return (
    <div
      className="login-display-state login-display-pixels"
      data-testid="locked-pixel-display"
      aria-hidden="true"
    >
      {LOCKED_PIXEL_GLYPHS.map((glyph) => (
        <span className="login-pixel-letter" key={glyph.letter}>
          {glyph.cells.map((cell, index) => (
            <span
              className={`login-pixel${cell.filled ? " is-filled" : ""}`}
              key={`${glyph.letter}-${index}`}
              style={
                cell.animationIndex === null
                  ? undefined
                  : ({ "--lock-dot-index": cell.animationIndex } as LockPixelStyle)
              }
            />
          ))}
        </span>
      ))}
    </div>
  );
}

function LockedProductFlow() {
  const reducedMotion = useReducedMotion();

  return (
    <div className="login-product-visual">
      <svg
        aria-labelledby="locked-product-flow-title locked-product-flow-description"
        className="locked-product-flow"
        data-testid="locked-product-flow"
        focusable="false"
        role="img"
        viewBox="0 0 680 600"
      >
        <title id="locked-product-flow-title">个人资产看板只读数据流</title>
        <desc id="locked-product-flow-description">
          Longbridge、Binance、OKX、Bitget 和 Web3
          只读资产来源经过同步与估值后，汇总到个人资产看板。
        </desc>

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

        <g className="locked-flow-device">
          <rect
            className="locked-flow-device-back"
            height="372"
            rx="10"
            width="640"
            x="20"
            y="20"
          />
          <rect
            className="locked-flow-device-front"
            height="340"
            rx="5"
            width="608"
            x="36"
            y="36"
          />

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

          <path className="locked-flow-device-neck" d="M58 392V418H622V392" />
          <path
            className="locked-flow-device-neck-base"
            d="M58 418H622L646 432H34L58 418Z"
          />

          <rect
            className="locked-flow-device-chassis"
            height="94"
            rx="6"
            width="640"
            x="20"
            y="424"
          />
          <path className="locked-flow-device-chassis-line" d="M20 488H660" />
          <rect
            className="locked-flow-device-drive"
            height="20"
            rx="1"
            width="156"
            x="57"
            y="447"
          />
          <circle className="locked-flow-device-power" cx="238" cy="457" r="5" />
          <g className="locked-flow-device-vent" aria-hidden="true">
            {Array.from({ length: 8 }, (_, column) =>
              Array.from({ length: 3 }, (_, row) => (
                <circle
                  cx={521 + column * 10}
                  cy={449 + row * 9}
                  key={`${column}-${row}`}
                  r="1.2"
                />
              )),
            )}
          </g>
          <circle className="locked-flow-device-status" cx="622" cy="457" r="3" />

          <g>
            <path
              className="locked-flow-keyboard-shell"
              d="M54 496H626Q630 496 631 501L650 553Q651 558 646 558H34Q29 558 30 553L49 501Q50 496 54 496Z"
            />
            <path
              className="locked-flow-keyboard-front"
              d="M30 558H650V570Q650 574 646 574H34Q30 574 30 570V558Z"
            />
            <g className="locked-flow-device-keys" aria-hidden="true">
              {LOCKED_KEYBOARD_KEYS.map((key) => (
                <path d={getLockedKeyboardKeyPath(key)} key={key.id} />
              ))}
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}

export function OwnerLogin({
  ownerProvisioned,
  recoveryConfigured,
}: OwnerLoginProps) {
  const [state, setState] = useState<LoginState>("idle");
  const [mode, setMode] = useState<LoginMode>("choice");
  const [recoveryError, setRecoveryError] = useState("");
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [recoveryRateLimited, setRecoveryRateLimited] = useState(false);
  const recoveryCodeRef = useRef<HTMLInputElement>(null);

  function showRecoveryTotp() {
    setRecoveryError("");
    setRecoveryRateLimited(false);
    setMode("recovery-totp");
  }

  function returnToLoginChoice() {
    setRecoveryError("");
    setRecoveryPending(false);
    setRecoveryRateLimited(false);
    setMode("choice");
  }

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
      window.location.reload();
    } catch {
      setState("failed");
    }
  }

  async function verifyRecoveryTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRecoveryPending(true);
    setRecoveryError("");
    try {
      const data = new FormData(event.currentTarget);
      const response = await fetch("/api/auth/recovery/totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: data.get("code") }),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        const rateLimited = response.status === 429;
        setRecoveryRateLimited(rateLimited);
        setRecoveryError(result?.error ?? "TOTP 验证失败");
        setRecoveryPending(false);
        if (!rateLimited) {
          window.requestAnimationFrame(() => recoveryCodeRef.current?.focus());
        }
        return;
      }
      window.location.reload();
    } catch {
      setRecoveryRateLimited(false);
      setRecoveryError("TOTP 验证失败，请检查连接后重试");
      setRecoveryPending(false);
      window.requestAnimationFrame(() => recoveryCodeRef.current?.focus());
    }
  }

  return (
    <section
      aria-labelledby="login-title"
      className={`login-gate vibe-auth-surface${
        ownerProvisioned
          ? ` login-gate--owner login-gate--owner-${mode}`
          : ""
      }`}
      data-testid="login-gate"
      data-vibe-surface="auth-panel"
    >
      <div className="login-intro">
        <p className="login-eyebrow">
          {ownerProvisioned
            ? "OWNER VERIFICATION REQUIRED"
            : "FIRST RUN · OWNER PROVISION REQUIRED"}
          {ownerProvisioned ? (
            <span
              aria-hidden="true"
              className="login-lock-progress"
              data-testid="locked-progress"
            >
              <span />
            </span>
          ) : null}
        </p>
        {ownerProvisioned ? (
          <LockedPixelDisplay />
        ) : (
          <p className="login-display-state" aria-hidden="true">
            SETUP
          </p>
        )}
        <h1
          id="login-title"
          className={ownerProvisioned ? "login-state-heading" : undefined}
        >
          {ownerProvisioned ? "个人资产看板已锁定" : "预置唯一所有者"}
        </h1>
        {ownerProvisioned ? null : (
          <p className="login-copy">
            此终端尚未预置所有者 Passkey，请先完成一次性预置。
          </p>
        )}
      </div>
      <div className="login-flow">
        {state === "failed" ? (
          <VibeNotice className="login-error" code="ERROR" role="alert" tone="error">
            验证失败或已取消，资产看板仍处于锁定状态。
          </VibeNotice>
        ) : null}
        {state === "unavailable" ? (
          <VibeNotice className="login-error" code="ERROR" role="alert" tone="error">
            所有者尚未预置登录凭证，请先完成首次预置。
          </VibeNotice>
        ) : null}
        {!ownerProvisioned ? (
          <div className="login-actions first-run-actions">
            <VibeLink className="provision-primary" href="/setup" variant="primary">
              <span>开始首次预置</span>
              <span className="provision-primary-arrow" aria-hidden="true">
                →
              </span>
            </VibeLink>
            <p className="login-hint">
              仅可预置一位所有者 / 完成后仍需使用 Passkey 登录
            </p>
          </div>
        ) : null}
        {ownerProvisioned && mode === "choice" ? (
          <div className="login-actions login-actions--choice">
            <VibeButton
              type="button"
              disabled={state === "pending"}
              onClick={login}
              variant="primary"
            >
              {state === "pending" ? "[ VERIFYING ]" : "使用 Passkey 登录"}
            </VibeButton>
            {recoveryConfigured ? (
              <VibeButton
                type="button"
                disabled={state === "pending"}
                onClick={showRecoveryTotp}
                variant="outline"
              >
                使用备用方式登录
              </VibeButton>
            ) : (
              <p className="login-hint">
                备用登录未配置 / 登录后可在本机设置
              </p>
            )}
          </div>
        ) : null}
        {mode === "recovery-totp" ? (
          <form
            className="login-form"
            data-vibe-surface="auth-flow"
            onSubmit={verifyRecoveryTotp}
          >
            <p className="login-copy">输入验证器当前显示的 6 位动态验证码。</p>
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
                code="ERROR"
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
                完成备用登录
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
        <div className="login-trust-line" aria-label="安全属性">
          <span>PASSKEY</span>
          <span>LOCAL</span>
          <span>READ ONLY</span>
        </div>
      </div>
      {ownerProvisioned ? <LockedProductFlow /> : null}
    </section>
  );
}
