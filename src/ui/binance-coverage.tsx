import { decimalToFixed } from "@/domain/decimal";
import type { AssetHolding, AssetSnapshotCoverage } from "@/server/ports";
import { VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";

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

const HOLDING_PRODUCT_LABELS: Record<string, string> = {
  spot: "现货",
  funding: "资金",
  "simple-earn-flexible": "活期 Earn",
  "simple-earn-locked": "定期 Earn",
  "dual-investment": "双币投资",
  "discount-buy": "折价买币",
  bfusd: "BFUSD",
  rwusd: "RWUSD",
  "eth-staking": "ETH 质押",
  "sol-staking": "SOL 质押",
  "onchain-yields": "链上收益",
  "onchain-yields-locked": "链上收益（定期）",
  "soft-staking": "软质押",
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

export function binanceHoldingDisplayName(holding: AssetHolding): string {
  const productLabel = holding.sourceProduct
    ? HOLDING_PRODUCT_LABELS[holding.sourceProduct]
    : undefined;
  return productLabel ? `${holding.symbol} · ${productLabel}` : holding.name;
}

export function BinanceCoverage({
  coverage,
}: {
  coverage: AssetSnapshotCoverage | undefined;
}) {
  const label = coverage?.status === "partial"
    ? "产品统计不完整"
    : "产品覆盖未验证";
  return (
    <>
      {coverage?.status !== "complete" ? (
        <VibeStatusTag
          className="asset-sync-status is-incomplete"
          data-testid="binance-coverage-status"
          tone="warning"
        >
          {label}
          {coverage?.unexplainedValue
            ? ` · 未解释 ${money(coverage.unexplainedValue.amount)} ${coverage.unexplainedValue.currency}`
            : ""}
          {coverage && coverage.excludedPositiveAccounts.length > 0
            ? ` · 未纳入 ${coverage.excludedPositiveAccounts.join("、")}`
            : ""}
        </VibeStatusTag>
      ) : null}
      {coverage && coverage.products.length > 0 ? (
        <details className="vibe-coverage" data-testid="binance-product-coverage">
          <summary>产品覆盖（{coverage.products.length}）</summary>
          <ul>
            {coverage.products.map((product) => (
              <li className="vibe-data-row" key={product.product}>
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
