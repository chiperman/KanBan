import { decimalCompare } from "@/domain/decimal";

/**
 * 为正值补 `+`。零值语义按展示场合区分：
 * 收益等相对变化用 `signZero` 让 0 显示为 `+0.00`，金额明细不加号。
 */
export function signedAmount(
  value: string,
  format: (value: string) => string = (input) => input,
  options: { signZero?: boolean } = {},
): string {
  const formatted = format(value);
  const comparison = decimalCompare(value, "0");
  return options.signZero === true
    ? comparison < 0 ? formatted : `+${formatted}`
    : comparison > 0 ? `+${formatted}` : formatted;
}

/** 已格式化后再判正负，避免同一数值重复格式化。 */
export function signedDisplayAmount(
  value: string,
  formatted: string,
  options: { signZero?: boolean } = {},
): string {
  const comparison = decimalCompare(value, "0");
  return options.signZero === true
    ? comparison < 0 ? formatted : `+${formatted}`
    : comparison > 0 ? `+${formatted}` : formatted;
}
