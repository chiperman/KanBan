"use client";

import { useLayoutEffect, useRef } from "react";

const COUNTER_DURATION_MS = 1_200;
const EASING_PRECISION = 1_000_000;

interface ParsedCounterValue {
  forcePlus: boolean;
  grouped: boolean;
  scale: number;
  scaledValue: bigint;
}

function parseCounterValue(value: string): ParsedCounterValue | null {
  const match = /^([+-]?)(\d+(?:,\d{3})*)(?:\.(\d+))?$/.exec(value);
  if (!match) return null;

  const [, sign, integer, fraction = ""] = match;
  if (integer.includes(",") && !/^\d{1,3}(?:,\d{3})+$/.test(integer)) {
    return null;
  }

  const digits = `${integer.replaceAll(",", "")}${fraction}`;
  const magnitude = BigInt(digits);

  return {
    forcePlus: sign === "+",
    grouped: integer.includes(","),
    scale: fraction.length,
    scaledValue: sign === "-" ? -magnitude : magnitude,
  };
}

function rescale(value: ParsedCounterValue, scale: number): bigint {
  if (value.scale === scale) return value.scaledValue;
  if (value.scale < scale) {
    return value.scaledValue * (10n ** BigInt(scale - value.scale));
  }
  return value.scaledValue / (10n ** BigInt(value.scale - scale));
}

function formatCounterValue(
  scaledValue: bigint,
  style: ParsedCounterValue,
): string {
  const negative = scaledValue < 0n;
  const absolute = negative ? -scaledValue : scaledValue;
  const padded = absolute.toString().padStart(style.scale + 1, "0");
  const integerEnd = padded.length - style.scale;
  const rawInteger = padded.slice(0, integerEnd);
  const integer = style.grouped
    ? rawInteger.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    : rawInteger;
  const fraction = style.scale > 0 ? `.${padded.slice(integerEnd)}` : "";
  const sign = negative ? "-" : style.forcePlus ? "+" : "";

  return `${sign}${integer}${fraction}`;
}

function zeroValue(style: ParsedCounterValue): ParsedCounterValue {
  return { ...style, scaledValue: 0n };
}

export function VibeLiveCounter({
  animate = true,
  animationKey,
  resetKey,
  value,
}: {
  animate?: boolean;
  /** 同一批次内的实时值直接更新；换批次时恢复计数动画。 */
  animationKey?: string;
  resetKey?: string;
  value: string;
}) {
  const counterRef = useRef<HTMLSpanElement>(null);
  const renderedValueRef = useRef<ParsedCounterValue | null>(null);
  const previousResetKeyRef = useRef(resetKey);
  const previousAnimationRef = useRef<{ key?: string; animate: boolean } | null>(null);
  const cancelAnimationRef = useRef<(() => void) | null>(null);
  const latestValueRef = useRef(value);
  // 文本由计数器管理，避免 React 在行情到达时覆盖正在播放的帧。
  const initialValueRef = useRef(value);

  useLayoutEffect(() => {
    const counter = counterRef.current;
    if (!counter) return;

    const target = parseCounterValue(value);
    latestValueRef.current = value;
    const sameBatch = animationKey !== undefined &&
      previousAnimationRef.current?.key === animationKey &&
      previousAnimationRef.current?.animate === animate &&
      previousResetKeyRef.current === resetKey &&
      renderedValueRef.current !== null;
    previousAnimationRef.current = { key: animationKey, animate };
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (sameBatch && target && animate && !reducedMotion) {
      // 不打断首次/刷新动画；结束时一次显示期间收到的最新金额。
      if (cancelAnimationRef.current === null) {
        counter.textContent = value;
        renderedValueRef.current = target;
      }
      return;
    }
    cancelAnimationRef.current?.();
    cancelAnimationRef.current = null;
    if (!target) {
      counter.textContent = value;
      counter.dataset.counterState = "static";
      renderedValueRef.current = null;
      previousResetKeyRef.current = resetKey;
      return;
    }

    if (!animate || reducedMotion) {
      counter.textContent = value;
      counter.dataset.counterState = "complete";
      renderedValueRef.current = target;
      previousResetKeyRef.current = resetKey;
      return;
    }

    const renderedValue = renderedValueRef.current;
    const startValue =
      renderedValue === null || previousResetKeyRef.current !== resetKey
      ? zeroValue(target)
      : renderedValue;
    const startScaledValue = rescale(startValue, target.scale);
    const targetScaledValue = target.scaledValue;
    const delta = targetScaledValue - startScaledValue;
    let animationFrame = 0;
    let observer: IntersectionObserver | null = null;
    let cancelled = false;

    counter.dataset.counterState = "waiting";
    renderedValueRef.current = {
      ...target,
      scaledValue: startScaledValue,
    };
    previousResetKeyRef.current = resetKey;

    const startAnimation = () => {
      if (cancelled) return;
      counter.textContent = formatCounterValue(startScaledValue, target);
      counter.dataset.counterState = "running";
      const startedAt = performance.now();

      const step = (now: number) => {
        if (cancelled) return;
        const progress = Math.min((now - startedAt) / COUNTER_DURATION_MS, 1);
        const eased =
          progress < 0.5
            ? 4 * (progress ** 3)
            : 1 - (((-2 * progress + 2) ** 3) / 2);
        const easingStep = BigInt(
          Math.round(eased * EASING_PRECISION),
        );
        const nextValue =
          startScaledValue +
          (delta * easingStep) / BigInt(EASING_PRECISION);

        counter.textContent = formatCounterValue(nextValue, target);
        renderedValueRef.current = {
          ...target,
          scaledValue: nextValue,
        };

        if (progress < 1) {
          animationFrame = window.requestAnimationFrame(step);
          return;
        }

        counter.textContent = latestValueRef.current;
        counter.dataset.counterState = "complete";
        renderedValueRef.current = parseCounterValue(latestValueRef.current);
        cancelAnimationRef.current = null;
      };

      animationFrame = window.requestAnimationFrame(step);
    };

    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver(
        ([entry]) => {
          if (!entry?.isIntersecting) return;
          observer?.disconnect();
          startAnimation();
        },
        { threshold: 0.6 },
      );
      observer.observe(counter);
    } else {
      startAnimation();
    }

    cancelAnimationRef.current = () => {
      cancelled = true;
      observer?.disconnect();
      window.cancelAnimationFrame(animationFrame);
    };
  }, [animate, animationKey, resetKey, value]);

  useLayoutEffect(() => () => {
    cancelAnimationRef.current?.();
    cancelAnimationRef.current = null;
    renderedValueRef.current = null;
    previousAnimationRef.current = null;
  }, []);

  return (
    <span
      aria-label={value}
      className="vibe-live-counter"
      data-counter-state="idle"
      data-counter-target={value}
      data-vibe-component="live-counter"
      ref={counterRef}
    >
      {initialValueRef.current}
    </span>
  );
}
