"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { formatShanghaiDateTime } from "@/ui/shanghai-date-time";
import { useCloseOnFieldDisabled } from "@/ui/vibe/use-close-on-field-disabled";

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

/** 无效日期仅用此月份保持可格式化；调用方提供的范围仍决定可选日期。 */
const FALLBACK_MONTH = new Date(Date.UTC(1970, 0, 1));

function monthStart(day: string): Date {
  const date = dateForDay(day);
  if (!Number.isFinite(date.getTime())) return FALLBACK_MONTH;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function clampDay(day: string, min: string | undefined, max: string): string {
  if (min !== undefined && min > max) return max;
  return min !== undefined && day < min ? min : day > max ? max : day;
}

function calendarDay(value: string, min: string | undefined, max: string, today: string): string {
  const month = monthStart(value || max);
  const fallback = monthStart(today).getTime() === month.getTime() ? today : dayForDate(month);
  return clampDay(value || fallback, min, max);
}

function shiftMonth(day: string, offset: number): string {
  const current = dateForDay(day);
  const month = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + offset, 1));
  const lastDay = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
  month.setUTCDate(Math.min(current.getUTCDate(), lastDay));
  return dayForDate(month);
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
  const activeDayRef = useRef<HTMLButtonElement>(null);
  const focusDayRef = useRef(false);
  const [open, setOpen] = useState(false);
  const expanded = open && !disabled;
  const today = formatShanghaiDateTime(new Date()).slice(0, 10);
  const [activeDay, setActiveDay] = useState(() => calendarDay(value, min, max, today));
  // 范围变化只收拢导航位置，不改写表单中已经选择的日期。
  const availableDay = clampDay(activeDay, min, max);
  if (activeDay !== availableDay) setActiveDay(availableDay);
  const monthKey = availableDay.slice(0, 7);
  const month = useMemo(() => monthStart(`${monthKey}-01`), [monthKey]);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const maxMonth = monthStart(max);
  const minMonth = min ? monthStart(min) : undefined;
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

  useCloseOnFieldDisabled(triggerRef, open, setOpen);

  useEffect(() => {
    if (!expanded || !portalRoot) return;
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
      const nextPosition = {
        top: Math.max(12, Math.min(
          preferredTop + height > window.innerHeight - 12
            ? rect.top - height - 8
            : preferredTop,
          window.innerHeight - height - 12,
        )),
        left,
        width,
      };
      setPosition((current) =>
        current.top === nextPosition.top && current.left === left && current.width === width
          ? current
          : nextPosition,
      );
    };
    updatePosition();
    const frame = window.requestAnimationFrame(() => {
      updatePosition();
      if (triggerRef.current?.matches(":disabled")) return;
      const calendar = calendarRef.current;
      const target =
        calendar?.querySelector<HTMLButtonElement>('.vibe-date-field__day[tabindex="0"]:not(:disabled)') ??
        calendar?.querySelector<HTMLButtonElement>("button:not(:disabled)") ??
        calendar;
      target?.focus();
    });
    const observer = new ResizeObserver(updatePosition);
    if (triggerRef.current) observer.observe(triggerRef.current);
    if (calendarRef.current) observer.observe(calendarRef.current);
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
      observer.disconnect();
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [expanded, portalRoot]);

  useEffect(() => {
    if (!expanded || triggerRef.current?.matches(":disabled")) return;
    const active = document.activeElement;
    if (
      focusDayRef.current ||
      active === document.body ||
      (active instanceof HTMLElement && active.matches(":disabled"))
    ) activeDayRef.current?.focus();
    focusDayRef.current = false;
  }, [availableDay, expanded]);

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
    setActiveDay(clampDay(shiftMonth(availableDay, offset), min, max));
  }

  function navigateDay(event: ReactKeyboardEvent<HTMLButtonElement>, day: string) {
    const date = dateForDay(day);
    let nextDay: string;
    if (event.key === "PageUp" || event.key === "PageDown") {
      nextDay = shiftMonth(day, (event.key === "PageUp" ? -1 : 1) * (event.shiftKey ? 12 : 1));
    } else {
      const offset = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -7,
        ArrowDown: 7,
        Home: -date.getUTCDay(),
        End: 6 - date.getUTCDay(),
      }[event.key];
      if (offset === undefined) return;
      date.setUTCDate(date.getUTCDate() + offset);
      nextDay = dayForDate(date);
    }
    event.preventDefault();
    if (triggerRef.current?.matches(":disabled")) return;
    nextDay = clampDay(nextDay, min, max);
    if (nextDay === availableDay) return;
    focusDayRef.current = true;
    setActiveDay(nextDay);
  }

  const calendar = expanded && portalRoot ? createPortal(
    <section
      ref={calendarRef}
      aria-label={`选择${label}`}
      className="vibe-date-field__calendar"
      id={`${fieldId}-calendar`}
      role="dialog"
      style={position}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = [...(calendarRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])]
          .filter((button) => button.tabIndex >= 0);
        const boundary = event.shiftKey ? controls?.[0] : controls?.[controls.length - 1];
        if (document.activeElement !== boundary) return;
        setOpen(false);
        // 从原字段继续浏览器的 Tab 顺序，避免跳到 Portal 末尾。
        triggerRef.current?.focus();
      }}
    >
      <header className="vibe-date-field__calendar-head">
        <strong aria-live="polite" aria-atomic="true">{monthLabel(month)}</strong>
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
      <div className="vibe-date-field__day-grid" role="group" aria-label={monthLabel(month)}>
        {days.map((date, index) => {
          if (date === null) return <span key={`blank-${index}`} />;
          const day = dayForDate(date);
          const selected = value !== "" && day === value;
          const isToday = day === today;
          return (
            <button
              ref={day === availableDay ? activeDayRef : undefined}
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
              onFocus={() => setActiveDay(day)}
              onKeyDown={(event) => navigateDay(event, day)}
              tabIndex={day === availableDay ? 0 : -1}
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
        aria-expanded={expanded}
        aria-haspopup="dialog"
        aria-labelledby={`${fieldId}-label ${fieldId}-value`}
        ref={triggerRef}
        className="vibe-date-field__trigger"
        disabled={disabled}
        id={fieldId}
        onClick={() => {
          setActiveDay(calendarDay(value, min, max, today));
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
