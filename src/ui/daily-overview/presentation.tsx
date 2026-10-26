import { formatAssetAmount } from "@/ui/asset-price-display";

import { type ReportingCurrency } from "@/domain/valuation";
import { profitDirection, type ProfitColorScheme } from "@/ui/profit-color-scheme";
import { signedAmount } from "@/ui/signed-amount";
import { VibeMetric } from "@/ui/vibe/vibe-data-instrument";

export function amount(value: string): string {
  return formatAssetAmount(value);
}

export function MetricValue({
  currency,
  hidden,
  profitColorScheme,
  signed = false,
  unavailableLabel = "数据不足",
  value,
}: {
  currency: ReportingCurrency;
  hidden: boolean;
  profitColorScheme?: ProfitColorScheme;
  signed?: boolean;
  unavailableLabel?: string;
  value: string | null;
}) {
  if (hidden) {
    return <VibeMetric className="daily-overview__private" unit={currency} value="••••••" />;
  }
  if (value === null) {
    return <span className="daily-overview__unavailable">{unavailableLabel}</span>;
  }
  return (
    <VibeMetric
      className={profitColorScheme ? "profit-color-value" : undefined}
      data-profit-color-scheme={profitColorScheme}
      data-profit-direction={profitColorScheme ? profitDirection(value) : undefined}
      unit={currency}
      value={signed ? signedAmount(value, amount, { signZero: true }) : amount(value)}
    />
  );
}
