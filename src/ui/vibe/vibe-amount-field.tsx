"use client";

import { useEffect, useRef, useState } from "react";
import { parseManualAssetRecordAmount } from "@/domain/manual-asset-records";
import { parseSourceInvestmentRecordAmount, type SourceInvestmentRecordKind } from "@/domain/source-investment-records";
import { VibeField } from "@/ui/vibe/vibe-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";

/** 金额规则与写入端共用；失焦或提交后提示，修正输入时立即更新。 */
export function VibeAmountField({ fieldId, label, value, onValueChange, disabled, kind = "balance" }: {
  fieldId: string;
  label: string;
  value: string;
  onValueChange(value: string): void;
  disabled?: boolean;
  kind?: "balance" | SourceInvestmentRecordKind;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [touched, setTouched] = useState(false);
  let error = "";
  try {
    if (kind === "balance") parseManualAssetRecordAmount(value);
    else parseSourceInvestmentRecordAmount(value, kind);
  } catch {
    error = value.trim() === "" ? "请输入金额"
      : kind === "balance" ? "请输入非负金额，最多两位小数、18 位整数"
        : `请输入${kind === "deposit" || kind === "withdrawal" ? "大于 0 的" : "非负"}金额，最多八位小数、18 位整数`;
  }
  useEffect(() => {
    inputRef.current?.setCustomValidity(error);
  }, [error]);
  const errorId = `${fieldId}-error`;
  return <>
    <VibeField
      ref={inputRef}
      fieldId={fieldId}
      label={label}
      value={value}
      inputMode="decimal"
      required
      disabled={disabled}
      onChange={event => onValueChange(event.target.value)}
      onBlur={() => setTouched(true)}
      onInvalid={event => {
        event.preventDefault();
        setTouched(true);
        event.currentTarget.focus();
      }}
      aria-invalid={touched && !!error ? true : undefined}
      aria-describedby={touched && error ? errorId : undefined}
    />
    {touched && error ? <VibeNotice id={errorId} tone="error">{error}</VibeNotice> : null}
  </>;
}
