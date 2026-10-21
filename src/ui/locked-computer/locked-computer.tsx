"use client";

import { useEffect, useId, useRef, useState, type ReactNode, type PointerEvent } from "react";

import {
  ART, CABLE, CABLE_WIDTH, FRONT, GLASS, KEYS, KEYBOARD_TOP, MONITOR_SIDE, MONITOR_TOP,
  POWER_FACE, POWER_POINT, SCREEN_CONTENT, SCREEN_OUTLINE, SCREEN_RECESS, SYSTEM_FRONT,
} from "./geometry";
import type { SolidPaths } from "./iso-kit";

function Solid({ paths, dark = false }: { paths: SolidPaths; dark?: boolean }) {
  return (
    <g className={`locked-computer-solid${dark ? " locked-computer-solid--dark" : ""}`}>
      <path className="locked-computer-fill" d={paths.fill} />
      {paths.shades.map((d, shade) => d ? (
        <path className="locked-computer-shade" data-shade={shade} d={d} key={shade} />
      ) : null)}
      <path className="locked-computer-top" d={paths.top} />
      <path className="iso-line iso-crease locked-computer-edge" d={paths.crease} />
      <path className="iso-line iso-bevel locked-computer-bevel" d={paths.bevel} />
      <path className="iso-line iso-edge locked-computer-edge" d={paths.outline} />
    </g>
  );
}

export function LockedComputer({ children, reducedMotion }: {
  children: ReactNode;
  reducedMotion: boolean;
}) {
  const [powered, setPowered] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);
  const pressedKey = useRef<SVGGElement | null>(null);
  const keyPressedAt = useRef(0);
  const keyReleaseTimers = useRef(new Map<SVGGElement, ReturnType<typeof setTimeout>>());
  const id = useId();
  const screenId = `${id}-screen`;
  const scanlineId = `${id}-scanlines`;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    let visible = false;
    const update = () => {
      if (powered && visible && !document.hidden && !reducedMotion) svg.unpauseAnimations();
      else svg.pauseAnimations();
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    });
    observer.observe(svg);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, [powered, reducedMotion]);

  useEffect(() => {
    const timers = keyReleaseTimers.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  function releaseKey() {
    const key = pressedKey.current;
    if (!key) return;
    pressedKey.current = null;
    // A quick tap must survive a paint and finish its downstroke before returning.
    const remaining = Math.max(0, 150 - (performance.now() - keyPressedAt.current));
    if (remaining === 0) {
      key.removeAttribute("data-pressed");
      return;
    }
    keyReleaseTimers.current.set(key, setTimeout(() => {
      key.removeAttribute("data-pressed");
      keyReleaseTimers.current.delete(key);
    }, remaining));
  }

  function pressKey(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    const key = (event.target as Element).closest<SVGGElement>("[data-computer-key]");
    if (!key) return;
    releaseKey();
    clearTimeout(keyReleaseTimers.current.get(key));
    keyReleaseTimers.current.delete(key);
    pressedKey.current = key;
    keyPressedAt.current = performance.now();
    key.setAttribute("data-pressed", "true");
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  return (
    <div className="login-product-visual" data-powered={powered}>
      <svg
        aria-labelledby={`${id}-title ${id}-description`}
        className="locked-product-flow locked-computer"
        data-testid="locked-product-flow"
        focusable="false"
        onLostPointerCapture={releaseKey}
        onPointerCancel={releaseKey}
        onPointerDown={pressKey}
        onPointerUp={releaseKey}
        ref={svgRef}
        role="img"
        viewBox="0 0 680 600"
      >
        <title id={`${id}-title`}>{`个人资产看板电脑，${powered ? "已开机" : "已关机"}`}</title>
        <desc id={`${id}-description`}>
          屏幕展示 Longbridge、Binance、OKX、Bitget 和 Web3 只读资产汇总动画。
          电源可开关，键盘仅有按压反馈。
        </desc>
        <defs>
          <clipPath id={screenId}><path d={SCREEN_OUTLINE} /></clipPath>
          <pattern id={scanlineId} patternUnits="userSpaceOnUse" width="1" height="1.6">
            <rect className="locked-computer-scanline" width="1" height="0.45" />
          </pattern>
        </defs>
        <ellipse className="locked-computer-shadow" cx="326" cy="530" rx="250" ry="24" />
        {ART.chassisFeet.map((paths, index) => <Solid paths={paths} dark key={`foot-${index}`} />)}
        <Solid paths={ART.chassis} />
        <g className="locked-computer-panel" transform={SYSTEM_FRONT}>
          <rect className="locked-computer-recess" x="-65" y="-23" width="72" height="12" rx="1" />
          <rect className="locked-computer-drive" x="-61" y="-19" width="52" height="2.5" rx="0.5" />
          <rect className="locked-computer-drive" x="-6" y="-20" width="8" height="5" rx="0.6" />
          {Array.from({ length: 12 }, (_, i) => (
            <rect className="locked-computer-slot" x={48 + i * 4} y="-22" width="1.5" height="10" rx="0.7" key={i} />
          ))}
          <circle className="locked-computer-led" cx="97" cy="-16.5" r="1.2" />
        </g>
        <g className="locked-computer-panel" transform={POWER_FACE}>
          <circle className="locked-computer-recess" r="6.4" />
          <circle className="locked-computer-power-rim" r="5.8" />
          <g className="locked-computer-switch">
            <circle className="locked-computer-cap" cy="0.35" r="4.8" />
            <path className="iso-line locked-computer-power-mark" d="M0-2.5V0M-1.7-1.8A2.5 2.5 0 1 0 1.7-1.8" data-free="" />
          </g>
        </g>
        <Solid paths={ART.monitorFoot} />
        <Solid paths={ART.monitorNeck} dark />
        <Solid paths={ART.monitor} />
        <g className="locked-computer-panel" transform={MONITOR_TOP}>
          {Array.from({ length: 13 }, (_, i) => (
            <rect className="locked-computer-slot" x="-66" y={-61 + i * 3.5} width="132" height="1.4" rx="0.7" key={i} />
          ))}
        </g>
        <g className="locked-computer-panel" transform={MONITOR_SIDE}>
          <rect className="locked-computer-panel-seam" x="-24" y="-190" width="92" height="142" rx="4" />
          {Array.from({ length: 14 }, (_, i) => (
            <rect className="locked-computer-slot" x={-16 + i * 4} y="-180" width="1.5" height="38" rx="0.7" key={i} />
          ))}
          {[-19, 63].flatMap((x) => [-185, -53].map((y) => (
            <circle className="locked-computer-screw" cx={x} cy={y} r="0.9" key={`${x}-${y}`} />
          )))}
        </g>
        <g className="locked-computer-panel" transform={FRONT}>
          <rect className="locked-computer-panel-seam" x="-113" y="-192" width="226" height="146" rx="5" />
          <rect className="locked-computer-bezel" x="-109" y="-187" width="218" height="130" rx="9" />
          {[-110, 110].flatMap((x) => [-189, -49].map((y) => (
            <circle className="locked-computer-screw" cx={x} cy={y} r="0.8" key={`${x}-${y}`} />
          )))}
          {[75, 86, 97].map((x) => <rect className="locked-computer-recess" x={x} y="-52" width="6" height="3" rx="0.6" key={x} />)}
        </g>
        {SCREEN_RECESS.map((d, index) => <path className="locked-computer-crt-wall" data-wall={index < 16 ? "upper" : "lower"} d={d} key={index} />)}
        <g transform={GLASS}>
          <path className="locked-computer-glass" d={SCREEN_OUTLINE} />
          <g clipPath={`url(#${screenId})`}>
            <g className="locked-computer-picture">
              <g transform={SCREEN_CONTENT}>{children}</g>
              <g className="locked-computer-scanlines" aria-hidden="true">
                <path className="locked-computer-raster" d={SCREEN_OUTLINE} fill={`url(#${scanlineId})`} />
                {reducedMotion ? null : (
                  <g className="locked-computer-sweep">
                    <rect className="locked-computer-scanline" x="-103" y="-184" width="206" height="1.4">
                      <animateTransform attributeName="transform" type="translate" from="0 0" to="0 124" dur="7s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.04;0.96;1" dur="7s" repeatCount="indefinite" />
                    </rect>
                  </g>
                )}
              </g>
            </g>
          </g>
          <path className="locked-computer-reflection" d="M-97-174H48L-42-70H-97Z" />
          <path className="locked-computer-panel-seam" d={SCREEN_OUTLINE} />
        </g>
        <Solid paths={ART.chassisPort} dark />
        <Solid paths={ART.chassisPlug} />
        <Solid paths={ART.chassisBoot} dark />
        {ART.keyboardFeet.map((paths, index) => <Solid paths={paths} dark key={`keyboard-foot-${index}`} />)}
        <Solid paths={ART.keyboard} />
        <Solid paths={ART.keyboardWell} dark />
        {KEYS.map((key) => (
          <g className="locked-computer-key" data-computer-key={key.id} key={key.id}>
            <Solid paths={key.paths} />
            <path className="locked-computer-key-dish" d={key.dish} />
            <text className="locked-computer-key-legend" transform={key.legendPlane} textAnchor="middle" fontSize="2.5">{key.legend}</text>
          </g>
        ))}
        <g className="locked-computer-panel" transform={KEYBOARD_TOP}>
          {[-124, 124].map((x) => <circle className="locked-computer-screw" cx={x} cy="83" r="0.55" key={x} />)}
        </g>
        <Solid paths={ART.keyboardPlug} />
        <Solid paths={ART.keyboardBoot} dark />
        <g className="locked-computer-cable" aria-hidden="true">
          {CABLE.map(({ d }, index) => (
            <g key={index}>
              <path className="locked-computer-cable-edge" d={d} strokeWidth={CABLE_WIDTH + 1} />
              <path className="locked-computer-cable-body" d={d} strokeWidth={CABLE_WIDTH} />
              <path className="locked-computer-cable-shine" d={d} strokeWidth={CABLE_WIDTH * 0.25} />
            </g>
          ))}
        </g>
      </svg>
      <button
        aria-label={powered ? "关闭电脑" : "开启电脑"}
        aria-pressed={powered}
        className="locked-computer-power"
        onClick={() => setPowered((value) => !value)}
        style={{ left: `${POWER_POINT[0] / 6.8}%`, top: `${POWER_POINT[1] / 6}%` }}
        type="button"
      />
    </div>
  );
}
