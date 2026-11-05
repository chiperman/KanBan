"use client";

import type {
  InputHTMLAttributes,
  KeyboardEvent,
  Ref,
  TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";

import { useCloseOnFieldDisabled } from "@/ui/vibe/use-close-on-field-disabled";

interface VibeFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "id"> {
  fieldId: string;
  label: string;
  density?: "regular" | "compact";
  ref?: Ref<HTMLInputElement>;
}

export function VibeField({ fieldId, label, density = "regular", ref, ...inputProps }: VibeFieldProps) {
  return (
    <label
      className={density === "compact" ? "vibe-field vibe-field--compact" : "vibe-field"}
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
  const optionsRef = useRef<HTMLDivElement>(null);
  const initialOptionRef = useRef<HTMLButtonElement>(null);
  const focusedElementRef = useRef<HTMLElement | null>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const expanded = open && !disabled;
  const labelId = `${fieldId}-label`;
  const valueId = `${fieldId}-value`;
  const listboxId = `${fieldId}-options`;
  const emptyId = `${fieldId}-empty`;
  const selected = options.find((option) => option.value === value);
  const initialOptionValue = selected?.value ?? options[0]?.value;
  const rootClassName = [
    "vibe-select",
    variant === "field" ? "vibe-field vibe-select--field" : "vibe-select--compact",
    variant === "wide" ? "vibe-select--wide" : "",
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    setPortalRoot(
      rootRef.current?.closest<HTMLElement>(".vibe-dialog-overlay") ??
        document.body,
    );
  }, []);

  useCloseOnFieldDisabled(triggerRef, open, setOpen);

  useEffect(() => {
    if (!expanded || !portalRoot) return;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewportPadding = 12;
      const gap = 4;
      const menuHeight = optionsRef.current?.getBoundingClientRect().height ?? 0;
      const width = Math.min(
        rect.width,
        window.innerWidth - viewportPadding * 2,
      );
      const left = Math.min(
        Math.max(viewportPadding, rect.left),
        window.innerWidth - width - viewportPadding,
      );
      const preferredTop = rect.bottom + gap;
      const top = preferredTop + menuHeight > window.innerHeight - viewportPadding
        ? rect.top - menuHeight - gap
        : preferredTop;
      const nextPosition = {
        top: Math.max(viewportPadding, Math.min(top, window.innerHeight - menuHeight - viewportPadding)),
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
    const frame = window.requestAnimationFrame(updatePosition);
    const observer = new ResizeObserver(updatePosition);
    if (triggerRef.current) observer.observe(triggerRef.current);
    if (optionsRef.current) observer.observe(optionsRef.current);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !optionsRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Node;
      focusedElementRef.current =
        optionsRef.current?.contains(target) && target instanceof HTMLElement ? target : null;
      if (
        !rootRef.current?.contains(target) &&
        !optionsRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [expanded, portalRoot]);

  useEffect(() => {
    if (!expanded || !portalRoot) {
      focusedElementRef.current = null;
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      if (!triggerRef.current?.matches(":disabled")) {
        (initialOptionRef.current ?? optionsRef.current)?.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expanded, portalRoot]);

  useEffect(() => {
    if (!expanded || triggerRef.current?.matches(":disabled")) return;
    const focusedElement = focusedElementRef.current;
    // 选项重读保留仍然有效的导航焦点，仅在焦点项消失或空列表恢复后重新定位。
    if (
      (focusedElement && !focusedElement.isConnected) ||
      document.activeElement === optionsRef.current
    ) {
      (initialOptionRef.current ?? optionsRef.current)?.focus();
    }
  }, [expanded, options, value]);

  function closeAndFocusTrigger() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function chooseOption(nextValue: Value) {
    // Portal 不继承表单 fieldset 的禁用状态，写入前以原字段为准。
    if (!triggerRef.current?.matches(":disabled") && nextValue !== value) onValueChange(nextValue);
    closeAndFocusTrigger();
  }

  function moveOptionFocus(
    event: KeyboardEvent<HTMLButtonElement>,
    destination: "next" | "previous" | "first" | "last",
  ) {
    event.preventDefault();
    if (triggerRef.current?.matches(":disabled")) {
      setOpen(false);
      return;
    }
    const optionElements = Array.from(
      optionsRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
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
    optionElements[nextIndex]?.focus();
  }

  const optionList = expanded && portalRoot ? createPortal(
    <div
      className="vibe-select vibe-select__portal"
      data-vibe-component="select-options"
      data-vibe-variant={variant}
      style={position}
    >
      <div
        ref={optionsRef}
        aria-describedby={options.length === 0 ? emptyId : undefined}
        aria-labelledby={options.length === 0 ? labelId : undefined}
        className="vibe-select__options"
        role={options.length === 0 ? "group" : undefined}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.defaultPrevented) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            closeAndFocusTrigger();
          } else if (event.key === "Tab") {
            closeAndFocusTrigger();
          }
        }}
      >
        <div
          aria-describedby={options.length === 0 ? emptyId : undefined}
          aria-labelledby={labelId}
          className="vibe-select__listbox"
          id={listboxId}
          role="listbox"
        >
          {options.map((option) => (
            <button
              key={option.value}
              ref={option.value === initialOptionValue ? initialOptionRef : undefined}
              type="button"
              aria-selected={option.value === selected?.value}
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
                }
              }}
              role="option"
              tabIndex={-1}
            >
              <span>{option.label}</span>
              {option.value === selected?.value ? (
                <span className="vibe-select__selected-mark" aria-hidden="true" />
              ) : null}
            </button>
          ))}
        </div>
        {options.length === 0 ? (
          <p className="vibe-select__empty" id={emptyId} role="status">暂无可选项</p>
        ) : null}
      </div>
    </div>,
    portalRoot,
  ) : null;

  return (
    <div
      ref={rootRef}
      className={rootClassName}
      data-vibe-component="select"
      data-vibe-variant={variant}
    >
      <span className="vibe-field__label" id={labelId}>
        {label}
      </span>
      <button
        ref={triggerRef}
        type="button"
        aria-controls={listboxId}
        aria-expanded={expanded}
        aria-haspopup="listbox"
        aria-labelledby={`${labelId} ${valueId}`}
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
        <span id={valueId}>{selected?.label ?? "请选择"}</span>
        <span className="vibe-select__chevron" aria-hidden="true" />
      </button>
      {optionList}
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
