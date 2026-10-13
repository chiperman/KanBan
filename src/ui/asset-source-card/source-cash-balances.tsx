"use client";

import type { AssetHolding } from "@/server/ports";

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
          <p className="card-label">CASH BALANCE</p>
          <ol className="holding-top-list">
            {cashBalances.map((balance) => (
              <li
                className="vibe-data-row"
                key={`${balance.currency}:${balance.amount}`}
              >
                <span>{balance.currency} CASH</span>
                <strong>
                  {showSensitiveInfo
                    ? `${formatAmount(balance.amount)} ${balance.currency}`
                    : "••••••"}
                </strong>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </>
  );
}
