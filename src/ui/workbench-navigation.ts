export const WORKBENCH_DESTINATIONS = [
  { href: "/", label: "总览", shortLabel: "总览", icon: "overview" },
  { href: "/assets", label: "资产", shortLabel: "资产", icon: "holdings" },
  { href: "/performance", label: "投资账本", shortLabel: "账本", icon: "performance" },
  { href: "/settings", label: "设置", shortLabel: "设置", icon: "security" },
] as const;

export const ASSET_VIEWS = [
  { href: "/assets", label: "持仓" },
  { href: "/assets?view=sources", label: "账户与来源" },
] as const;
