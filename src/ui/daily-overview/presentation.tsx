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
  if (value === null) {
    return <span className="daily-overview__unavailable">{unavailableLabel}</span>;
  }
  return (
    <VibeMetric
      className={hidden ? "daily-overview__private" : profitColorScheme ? "profit-color-value" : undefined}
      data-profit-color-scheme={hidden ? undefined : profitColorScheme}
      data-profit-direction={!hidden && profitColorScheme ? profitDirection(value) : undefined}
      masked={hidden}
      unit={currency}
      value={signed ? signedAmount(value, amount, { signZero: true }) : amount(value)}
    />
  );
}
