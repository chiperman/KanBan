import type { VibeSelectOption } from "@/ui/vibe/vibe-field";

/** 工作台与来源详情共用的记账币种选项，避免逐处复制同一份文案。 */
export const CURRENCY_OPTIONS: readonly VibeSelectOption<"USD" | "CNY" | "HKD">[] = [
  { value: "USD", label: "USD" },
  { value: "CNY", label: "CNY" },
  { value: "HKD", label: "HKD" },
];
