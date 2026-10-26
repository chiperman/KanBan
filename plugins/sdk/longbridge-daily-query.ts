export const LONG_BRIDGE_DAILY_PATH = "/v1/portfolio/profit-analysis-summary";

export function dailyAssetQuery(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) ||
      new Date(day).toISOString().slice(0, 10) !== day) throw new Error("长桥每日资产日期无效");
  return { start: String(Date.parse(`${day}T00:00:00+08:00`) / 1000), end: String(Date.parse(`${day}T23:59:59+08:00`) / 1000) };
}
