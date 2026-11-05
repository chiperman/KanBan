"use client";

import type { AssetHolding } from "@/server/ports";
import { AssetFinancialValue } from "@/ui/asset-financial-value";

export function SourceCashBalances({
  balances: cashBalances,
  showSensitiveInfo,
  formatAmount,
}: {
  balances: NonNullable<AssetHolding["cashBalances"]>;
  showSensitiveInfo: boolean;
  formatAmount: (value: string) => string;
}) {
  return (
    <>
      {cashBalances.length > 0 ? (
        <section
          className="asset-cash-balances"
          data-testid="asset-cash-balances"
        >
          <p className="card-label">现金</p>
          <ol className="holding-top-list">
            {cashBalances.map((balance) => (
              <li
                className="vibe-data-row"
                key={`${balance.currency}:${balance.amount}`}
              >
                <span>{balance.currency}</span>
                <strong>
                  <AssetFinancialValue unit={balance.currency}>
                    {showSensitiveInfo ? formatAmount(balance.amount) : "••••••"}
                  </AssetFinancialValue>
                </strong>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </>
  );
}
