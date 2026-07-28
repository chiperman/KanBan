import { decimalToFixed } from "@/domain/decimal";
import type { AssetHolding, AssetSnapshotCoverage } from "@/server/ports";

const PRODUCT_LABELS: Record<string, string> = {
  spot: "Spot",
  funding: "Funding",
  "simple-earn-flexible": "Simple Earn Flexible",
  "simple-earn-locked": "Simple Earn Locked",
  "dual-investment": "Dual Investment",
  "dual-investment-rfq": "Dual Investment RFQ",
  "discount-buy": "Discount Buy",
  bfusd: "BFUSD",
  rwusd: "RWUSD",
  "eth-staking": "ETH Staking",
  "sol-staking": "SOL Staking",
  "onchain-yields": "On-chain Yields",
  "soft-staking": "Soft Staking",
  "smart-arbitrage": "Smart Arbitrage",
  "bnb-vault": "BNB Vault",
  launchpool: "Launchpool",
  megadrop: "Megadrop",
};

const CAPABILITY_LABELS = {
  detailed: "明细",
  "aggregate-only": "仅汇总",
  indirect: "间接",
  unsupported: "无公开明细",
  unknown: "未知",
} as const;

function money(value: string): string {
  const [integer, fraction] = decimalToFixed(value, 2).split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export function assetHoldingKey(holding: AssetHolding): string {
  return [
    holding.sourceAccount ?? "default",
    holding.sourceProduct ?? "legacy",
    holding.providerPositionId ?? holding.economicAssetKey ?? "aggregate",
    holding.sourceAsset ?? holding.symbol,
  ].join(":");
}

export function BinanceCoverage({
  coverage,
}: {
  coverage: AssetSnapshotCoverage | undefined;
}) {
  const label = coverage?.status === "complete"
    ? "产品覆盖完整"
    : coverage?.status === "partial"
      ? "产品统计不完整"
      : "产品覆盖未验证";
  return (
    <>
      <p
        className={`asset-sync-status${coverage?.status === "complete" ? "" : " is-incomplete"}`}
        data-testid="binance-coverage-status"
      >
        {label}
        {coverage?.unexplainedValue
          ? ` · 未解释 ${money(coverage.unexplainedValue.amount)} ${coverage.unexplainedValue.currency}`
          : ""}
        {coverage && coverage.excludedPositiveAccounts.length > 0
          ? ` · 未纳入 ${coverage.excludedPositiveAccounts.join("、")}`
          : ""}
      </p>
      {coverage && coverage.products.length > 0 ? (
        <details data-testid="binance-product-coverage">
          <summary>产品覆盖（{coverage.products.length}）</summary>
          <ul>
            {coverage.products.map((product) => (
              <li key={product.product}>
                <strong>{PRODUCT_LABELS[product.product] ?? product.product}</strong>
                {` · ${CAPABILITY_LABELS[product.capability]} · ${product.freshness === "current" ? "当前" : "过期"}`}
                {product.message ? ` · ${product.message}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
