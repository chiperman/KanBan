"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatShanghaiDateTime } from "@/ui/shanghai-date-time";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function dateForDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function dayForDate(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

const EMPTY_LABEL = "未设置";

/** 空日期没有有效月份；回退到 1970-01 只为保持月份可格式化，调用方会用 max 打开日历。 */
const FALLBACK_MONTH = new Date(Date.UTC(1970, 0, 1));

function monthStart(day: string): Date {
  const date = dateForDay(day);
  if (!Number.isFinite(date.getTime())) return FALLBACK_MONTH;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** 已有日期用所在月份，空日期落在可选范围末月，避免打开日历时读到无效月份。 */
function calendarMonth(value: string, max: string): Date {
  return value !== "" ? monthStart(value) : monthStart(max);
}

function monthLabel(month: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
  }).format(month);
}

function displayDay(day: string): string {
  if (day === "") return EMPTY_LABEL;
  return day.replaceAll("-", " / ");
}

export function VibeDateField({
  clearable = false,
  disabled = false,
  fieldId,
  label,
  max,
  min,
  onValueChange,
  value,
}: {
  clearable?: boolean;
  disabled?: boolean;
  fieldId: string;
  label: string;
  max: string;
  min?: string;
  onValueChange(value: string): void;
  value: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const calendarRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => calendarMonth(value, max));
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const maxMonth = monthStart(max);
  const minMonth = min ? monthStart(min) : undefined;
  const today = formatShanghaiDateTime(new Date()).slice(0, 10);
  const days = useMemo(() => {
    const firstWeekday = month.getUTCDay();
    const count = new Date(
      Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0),
    ).getUTCDate();
    return Array.from({ length: firstWeekday + count }, (_, index) =>
      index < firstWeekday
        ? null
        : new Date(
          Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), index - firstWeekday + 1),
        ),
    );
  }, [month]);

  useEffect(() => {
    setPortalRoot(
      rootRef.current?.closest<HTMLElement>(".vibe-dialog-overlay") ?? document.body,
    );
  }, []);

  useEffect(() => {
    if (!open) return;
    if (triggerRef.current?.matches(":disabled")) {
      setOpen(false);
      return;
    }
    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 300), 360, window.innerWidth - 24);
      const height = calendarRef.current?.getBoundingClientRect().height ?? 336;
      const left = Math.min(
        Math.max(12, rect.left),
        window.innerWidth - width - 12,
      );
      const preferredTop = rect.bottom + 8;
      setPosition({
        top: Math.max(12, Math.min(
          preferredTop + height > window.innerHeight - 12
            ? rect.top - height - 8
            : preferredTop,
          window.innerHeight - height - 12,
        )),
        left,
        width,
      });
    };
    updatePosition();
    const frame = window.requestAnimationFrame(() => {
      updatePosition();
      const calendar = calendarRef.current;
      const target =
        calendar?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]:not(:disabled)') ??
        calendar?.querySelector<HTMLButtonElement>('button[aria-current="date"]:not(:disabled)') ??
        calendar?.querySelector<HTMLButtonElement>(".vibe-date-field__day:not(:disabled)") ??
        calendar?.querySelector<HTMLButtonElement>("button:not(:disabled)");
      target?.focus({ preventScroll: true });
    });
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !calendarRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !calendarRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const calendars = document.querySelectorAll(".vibe-date-field__calendar");
      if (calendars.item(calendars.length - 1) !== calendarRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    // 日历是表单中的上层弹层，先于外层 dialog 消费 Escape。
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, portalRoot, disabled]);

  function chooseDay(day: string) {
    // Portal 不继承表单 fieldset 的禁用状态，写入前以原字段为准。
    if (!triggerRef.current?.matches(":disabled")) onValueChange(day);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function moveMonth(offset: number) {
    if (triggerRef.current?.matches(":disabled")) {
      setOpen(false);
      return;
    }
    setMonth((current) =>
      new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + offset, 1)),
    );
  }

  const calendar = open && !disabled && portalRoot ? createPortal(
    <section
      ref={calendarRef}
      aria-label="选择记录日期"
      className="vibe-date-field__calendar"
      id={`${fieldId}-calendar`}
      role="dialog"
      style={position}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = calendarRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        const boundary = event.shiftKey ? controls?.[0] : controls?.[controls.length - 1];
        if (document.activeElement !== boundary) return;
        setOpen(false);
        // 从原字段继续浏览器的 Tab 顺序，避免跳到 Portal 末尾。
        triggerRef.current?.focus();
      }}
    >
      <header className="vibe-date-field__calendar-head">
        <strong>{monthLabel(month)}</strong>
        <span className="vibe-date-field__head-actions">
          {clearable && !disabled ? <button
            aria-label="清空日期"
            className="vibe-date-field__clear"
            onClick={() => chooseDay("")}
            type="button"
          >清空</button> : null}
          <button
            aria-label="上个月"
            className="vibe-date-field__month-button is-previous"
            disabled={disabled || (minMonth !== undefined && month <= minMonth)}
            onClick={() => moveMonth(-1)}
            type="button"
          />
          <button
            aria-label="下个月"
            className="vibe-date-field__month-button is-next"
            disabled={disabled || month >= maxMonth}
            onClick={() => moveMonth(1)}
            type="button"
          />
        </span>
      </header>
      <div className="vibe-date-field__weekday-row" aria-hidden="true">
        {WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
      </div>
      <div className="vibe-date-field__day-grid">
        {days.map((date, index) => {
          if (date === null) return <span key={`blank-${index}`} />;
          const day = dayForDate(date);
          const selected = value !== "" && day === value;
          const isToday = day === today;
          return (
            <button
              aria-label={`${day}${isToday ? "，今天" : ""}`}
              aria-current={isToday ? "date" : undefined}
              aria-pressed={selected}
              className={[
                "vibe-date-field__day",
                selected ? "is-selected" : "",
                isToday ? "is-today" : "",
              ].filter(Boolean).join(" ")}
              disabled={disabled || day > max || (min !== undefined && day < min)}
              key={day}
              onClick={() => chooseDay(day)}
              type="button"
            >
              {date.getUTCDate()}
            </button>
          );
        })}
      </div>
    </section>,
    portalRoot,
  ) : null;

  return (
    <div ref={rootRef} className="vibe-date-field" data-vibe-component="calendar">
      <span className="vibe-field__label" id={`${fieldId}-label`}>{label}</span>
      <button
        aria-controls={`${fieldId}-calendar`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-labelledby={`${fieldId}-label ${fieldId}-value`}
        ref={triggerRef}
        className="vibe-date-field__trigger"
        disabled={disabled}
        id={fieldId}
        onClick={() => {
          setMonth(calendarMonth(value, max));
          setOpen((current) => !current);
        }}
        type="button"
      >
        <span id={`${fieldId}-value`}>{displayDay(value)}</span>
        <span className="vibe-date-field__calendar-icon" aria-hidden="true" />
      </button>
      {calendar}
    </div>
  );
}
