"use client";

import type {
  InputHTMLAttributes,
  KeyboardEvent,
  Ref,
  TextareaHTMLAttributes,
} from "react";
import { useEffect, useRef, useState } from "react";

interface VibeFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "id"> {
  fieldId: string;
  label: string;
  ref?: Ref<HTMLInputElement>;
}

export function VibeField({ fieldId, label, ref, ...inputProps }: VibeFieldProps) {
  return (
    <label
      className="vibe-field"
      data-testid={`vibe-field-${fieldId}`}
      data-vibe-component="field"
      htmlFor={fieldId}
    >
      <span className="vibe-field__label">{label}</span>
      <input ref={ref} className="vibe-field__input" id={fieldId} {...inputProps} />
    </label>
  );
}

export interface VibeSelectOption<Value extends string = string> {
  label: string;
  value: Value;
}

export interface VibeSelectProps<Value extends string = string> {
  disabled?: boolean;
  fieldId: string;
  label: string;
  onValueChange(value: Value): void;
  options: readonly VibeSelectOption<Value>[];
  value: Value;
  variant?: "field" | "compact" | "wide";
}

export function VibeSelect<Value extends string>({
  disabled = false,
  fieldId,
  label,
  onValueChange,
  options,
  value,
  variant = "field",
}: VibeSelectProps<Value>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedOptionRef = useRef<HTMLButtonElement>(null);
  const labelId = `${fieldId}-label`;
  const listboxId = `${fieldId}-options`;
  const selected = options.find((option) => option.value === value) ?? options[0];
  const rootClassName = [
    "vibe-select",
    variant === "field" ? "vibe-field vibe-select--field" : "vibe-select--compact",
    variant === "wide" ? "vibe-select--wide" : "",
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      selectedOptionRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  function closeAndFocusTrigger() {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function chooseOption(nextValue: Value) {
    if (nextValue !== value) onValueChange(nextValue);
    closeAndFocusTrigger();
  }

  function moveOptionFocus(
    event: KeyboardEvent<HTMLButtonElement>,
    destination: "next" | "previous" | "first" | "last",
  ) {
    const optionElements = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
    );
    if (optionElements.length === 0) return;
    const currentIndex = optionElements.indexOf(event.currentTarget);
    const nextIndex =
      destination === "first"
        ? 0
        : destination === "last"
          ? optionElements.length - 1
          : destination === "next"
            ? (currentIndex + 1) % optionElements.length
            : (currentIndex - 1 + optionElements.length) % optionElements.length;
    event.preventDefault();
    optionElements[nextIndex]?.focus();
  }

  return (
    <div
      ref={rootRef}
      className={rootClassName}
      data-vibe-component="select"
      data-vibe-variant={variant}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (
          !(nextTarget instanceof Node) ||
          !event.currentTarget.contains(nextTarget)
        ) {
          setOpen(false);
        }
      }}
    >
      <span className="vibe-field__label" id={labelId}>
        {label}
      </span>
      <button
        ref={triggerRef}
        type="button"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={labelId}
        className="vibe-select__trigger"
        disabled={disabled}
        id={fieldId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            setOpen(false);
          }
        }}
      >
        <span>{selected?.label ?? "请选择"}</span>
        <span className="vibe-select__chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div
          aria-labelledby={labelId}
          className="vibe-select__options"
          id={listboxId}
          role="listbox"
        >
          {options.map((option) => (
            <button
              key={option.value}
              ref={option.value === value ? selectedOptionRef : undefined}
              type="button"
              aria-selected={option.value === value}
              className="vibe-select__option"
              onClick={() => chooseOption(option.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") moveOptionFocus(event, "next");
                else if (event.key === "ArrowUp") moveOptionFocus(event, "previous");
                else if (event.key === "Home") moveOptionFocus(event, "first");
                else if (event.key === "End") moveOptionFocus(event, "last");
                else if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  chooseOption(option.value);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  closeAndFocusTrigger();
                }
              }}
              role="option"
            >
              <span>{option.label}</span>
              {option.value === value ? (
                <span className="vibe-select__selected-mark" aria-hidden="true" />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function VibeSelectField<Value extends string>(
  props: Omit<VibeSelectProps<Value>, "variant">,
) {
  return <VibeSelect {...props} variant="field" />;
}

interface VibeTextAreaFieldProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className" | "id"> {
  fieldId: string;
  label: string;
}

export function VibeTextAreaField({
  fieldId,
  label,
  ...textareaProps
}: VibeTextAreaFieldProps) {
  return (
    <label className="vibe-field" data-vibe-component="field" htmlFor={fieldId}>
      <span className="vibe-field__label">{label}</span>
      <textarea className="vibe-field__input" id={fieldId} {...textareaProps} />
    </label>
  );
}
