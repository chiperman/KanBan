export type ProfitColorScheme = "red-up" | "green-up";

export const DEFAULT_PROFIT_COLOR_SCHEME: ProfitColorScheme = "red-up";
export const PROFIT_COLOR_SCHEME_COOKIE_KEY = "profit-color-scheme";
export const PROFIT_COLOR_SCHEME_STORAGE_KEY = "profit-color-scheme";

export function isProfitColorScheme(
  value: string | null,
): value is ProfitColorScheme {
  return value === "red-up" || value === "green-up";
}
