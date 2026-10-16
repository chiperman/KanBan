import type { VibeSelectOption } from "@/ui/vibe/vibe-field";

/** 工作台与来源详情共用的记账币种与区间选项，避免逐处复制同一份文案。 */
export const CURRENCY_OPTIONS: readonly VibeSelectOption<"USD" | "CNY" | "HKD">[] = [
  { value: "USD", label: "USD" },
  { value: "CNY", label: "CNY" },
  { value: "HKD", label: "HKD" },
];

export const INTERVAL_OPTIONS: readonly VibeSelectOption<
  | "month-to-date"
  | "1m"
  | "6m"
  | "year-to-date"
  | "1y"
  | "all"
  | "custom"
>[] = [
  { value: "month-to-date", label: "本月" },
  { value: "1m", label: "近 1 月" },
  { value: "6m", label: "近 6 月" },
  { value: "year-to-date", label: "本年" },
  { value: "1y", label: "近 1 年" },
  { value: "all", label: "全部" },
  { value: "custom", label: "自定义" },
];
