import { decimalCompare } from "@/domain/decimal";

export type ProfitColorScheme = "red-up" | "green-up";

export const DEFAULT_PROFIT_COLOR_SCHEME: ProfitColorScheme = "red-up";
export const PROFIT_COLOR_SCHEME_COOKIE_KEY = "profit-color-scheme";
export const PROFIT_COLOR_SCHEME_STORAGE_KEY = "profit-color-scheme";

export function isProfitColorScheme(
  value: string | null,
): value is ProfitColorScheme {
  return value === "red-up" || value === "green-up";
}

/**
 * 金额符号方向。`neutral` 不命中 `.profit-color-value` 的任何规则，
 * 因此零值天然不会被染成涨或跌的颜色——不要把这里写成二选一。
 */
export function profitDirection(
  value: string,
): "positive" | "negative" | "neutral" {
  const comparison = decimalCompare(value, "0");
  return comparison > 0 ? "positive" : comparison < 0 ? "negative" : "neutral";
}
