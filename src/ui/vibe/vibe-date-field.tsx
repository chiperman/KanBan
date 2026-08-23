"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";

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

function monthStart(day: string): Date {
  const date = dateForDay(day);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function monthLabel(month: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
  }).format(month);
}

function displayDay(day: string): string {
  return day.replaceAll("-", " / ");
}

function isSameMonth(left: Date, right: Date): boolean {
  return left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth();
}

export function VibeDateField({
  disabled = false,
  fieldId,
  label,
  max,
  min,
  onValueChange,
  value,
}: {
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
  const [month, setMonth] = useState(() => monthStart(value));
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const maxMonth = monthStart(max);
  const minMonth = min ? monthStart(min) : undefined;
  const today = max;
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
      rootRef.current?.closest<HTMLElement>(".vibe-dialog-overlay") ?? null,
    );
  }, []);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 300), 360);
      const left = Math.min(
        Math.max(12, rect.left),
        window.innerWidth - width - 12,
      );
      const preferredTop = rect.bottom + 8;
      setPosition({
        top: preferredTop + 336 > window.innerHeight
          ? Math.max(12, rect.top - 344)
          : preferredTop,
        left,
        width,
      });
    };
    updatePosition();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !calendarRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  const calendar = open && portalRoot ? createPortal(
    <section
      ref={calendarRef}
      aria-label="选择记录日期"
      className="vibe-date-field__calendar"
      id={`${fieldId}-calendar`}
      role="dialog"
      style={position}
    >
      <header className="vibe-date-field__calendar-head">
        <strong>{monthLabel(month)}</strong>
        <span>
          <button
            aria-label="上个月"
            className="vibe-date-field__month-button is-previous"
            disabled={minMonth !== undefined && isSameMonth(month, minMonth)}
            onClick={() => setMonth((current) =>
              new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1)),
            )}
            type="button"
          />
          <button
            aria-label="下个月"
            className="vibe-date-field__month-button is-next"
            disabled={isSameMonth(month, maxMonth)}
            onClick={() => setMonth((current) =>
              new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1)),
            )}
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
          const selected = day === value;
          const isToday = day === today;
          return (
            <button
              aria-label={`${day}${isToday ? "，今天" : ""}`}
              aria-pressed={selected}
              className={[
                "vibe-date-field__day",
                selected ? "is-selected" : "",
                isToday ? "is-today" : "",
              ].filter(Boolean).join(" ")}
              disabled={day > max || (min !== undefined && day < min)}
              key={day}
              onClick={() => {
                onValueChange(day);
                setOpen(false);
              }}
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
        aria-labelledby={`${fieldId}-label`}
        ref={triggerRef}
        className="vibe-date-field__trigger"
        disabled={disabled}
        id={fieldId}
        onClick={() => {
          setMonth(monthStart(value));
          setOpen((current) => !current);
        }}
        type="button"
      >
        <span>{displayDay(value)}</span>
        <span className="vibe-date-field__calendar-icon" aria-hidden="true" />
      </button>
      {calendar}
    </div>
  );
}
