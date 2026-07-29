"use client";

import {
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type InputHTMLAttributes,
  type MouseEvent,
  type Ref,
} from "react";

interface VibeVerificationCodeProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    | "className"
    | "defaultValue"
    | "id"
    | "maxLength"
    | "name"
    | "onChange"
    | "placeholder"
    | "type"
    | "value"
  > {
  fieldId: string;
  label: string;
  length?: number;
  name: string;
  ref?: Ref<HTMLInputElement>;
}

export function VibeVerificationCode({
  autoComplete = "one-time-code",
  fieldId,
  label,
  length = 6,
  name,
  onBlur,
  onClick,
  onFocus,
  ref,
  ...inputProps
}: VibeVerificationCodeProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [value, setValue] = useState("");
  const invalid =
    inputProps["aria-invalid"] === true ||
    inputProps["aria-invalid"] === "true";
  const activeIndex = Math.min(value.length, length - 1);

  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    setValue(event.currentTarget.value.replace(/\D/gu, "").slice(0, length));
  }

  function handleFocus(event: FocusEvent<HTMLInputElement>) {
    setFocused(true);
    if (invalid) event.currentTarget.select();
    onFocus?.(event);
  }

  function handleBlur(event: FocusEvent<HTMLInputElement>) {
    setFocused(false);
    onBlur?.(event);
  }

  function handleClick(event: MouseEvent<HTMLInputElement>) {
    if (!invalid) {
      const end = event.currentTarget.value.length;
      event.currentTarget.setSelectionRange(end, end);
    }
    onClick?.(event);
  }

  return (
    <div
      className="vibe-verification-code"
      data-testid={`vibe-field-${fieldId}`}
      data-vibe-component="verification-code"
    >
      <label className="vibe-field__label" htmlFor={fieldId}>
        {label}
      </label>
      <div
        className={[
          "vibe-verification-code__control",
          focused ? "is-focused" : "",
          invalid ? "is-invalid" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <span className="vibe-verification-code__slots" aria-hidden="true">
          {Array.from({ length }, (_, index) => {
            const digit = value[index] ?? "";
            const active = focused && index === activeIndex;
            return (
              <span
                className={[
                  "vibe-verification-code__slot",
                  digit ? "is-filled" : "",
                  active ? "is-active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-testid={`${fieldId}-slot-${index + 1}`}
                key={index}
              >
                {digit}
              </span>
            );
          })}
        </span>
        <input
          {...inputProps}
          ref={inputRef}
          autoCapitalize="off"
          autoComplete={autoComplete}
          className="vibe-verification-code__input"
          id={fieldId}
          inputMode="numeric"
          maxLength={length}
          name={name}
          pattern={`[0-9]{${length}}`}
          type="text"
          value={value}
          onBlur={handleBlur}
          onChange={handleChange}
          onClick={handleClick}
          onFocus={handleFocus}
        />
      </div>
    </div>
  );
}
