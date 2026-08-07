import { decimalToFixed } from "@/domain/decimal";
import type {
  AssetHolding,
  AssetProductCoverage,
  AssetSnapshotCoverage,
} from "@/server/ports";
import { VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";

const ASSET_PRODUCT_LABELS: Record<string, string> = {
  spot: "Spot",
  funding: "Funding",
  "trading-bot": "Trading Bots",
  "simple-earn-flexible": "Simple Earn Flexible",
  "simple-earn-locked": "Simple Earn Locked",
  "simple-earn-fixed": "Simple Earn Fixed",
  "savings-flexible": "Savings Flexible",
  "savings-fixed": "Savings Fixed",
  "futures-bot": "Futures Bots",
  futures: "Futures",
  "dual-investment": "Dual Investment",
  "dual-investment-rfq": "Dual Investment RFQ",
  "discount-buy": "Discount Buy",
  bfusd: "BFUSD",
  rwusd: "RWUSD",
  "eth-staking": "ETH Staking",
  "sol-staking": "SOL Staking",
  "onchain-yields": "On-chain Yields",
  "onchain-earn": "On-chain Earn",
  "onchain-elite": "On-chain Elite",
  sharkfin: "SharkFin",
  "soft-staking": "Soft Staking",
  "smart-arbitrage": "Smart Arbitrage",
  "bnb-vault": "BNB Vault",
  launchpool: "Launchpool",
  megadrop: "Megadrop",
  wallet: "Wallet",
  "fixed-income": "Fixed Income",
  "balance-plus": "Balance+",
  dcp: "DCP",
};

export function assetProductDisplayName(product: string): string {
  return ASSET_PRODUCT_LABELS[product] ?? product;
}

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
  "onchain-earn": "链上 Earn",
  "onchain-elite": "On-chain Elite",
  sharkfin: "SharkFin",
  savings: "Savings",
  "soft-staking": "软质押",
  wallet: "Wallet",
  "fixed-income": "Fixed Income",
  "balance-plus": "Balance+",
  dcp: "DCP",
};

const CAPABILITY_LABELS = {
  detailed: "明细",
  "aggregate-only": "仅汇总",
  indirect: "间接",
  unsupported: "未覆盖",
  unknown: "未知",
} as const;

const CAPABILITY_ORDER: readonly AssetProductCoverage["capability"][] = [
  "detailed",
  "aggregate-only",
  "indirect",
  "unsupported",
  "unknown",
];

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

export function assetHoldingDisplayName(holding: AssetHolding): string {
  const productLabel = holding.sourceProduct
    ? HOLDING_PRODUCT_LABELS[holding.sourceProduct]
    : undefined;
  return productLabel ? `${holding.symbol} · ${productLabel}` : holding.name;
}

export function AssetProductCoverage({
  coverage,
  sourceKind,
}: {
  coverage: AssetSnapshotCoverage | undefined;
  sourceKind: string;
}) {
  const aggregateOnlyCount = coverage?.products.filter(
    ({ capability, freshness }) =>
      capability === "aggregate-only" && freshness === "current",
  ).length ?? 0;
  const label = coverage?.status === "partial"
    ? coverage.totalIsAuthoritative
      ? "持仓明细待对账"
      : "当前总额不完整"
    : coverage?.status === "unknown"
      ? "当前总额未验证"
      : aggregateOnlyCount > 0
        ? "当前总额完整 · 部分产品仅汇总"
        : null;
  const currentProductCount = coverage?.products.filter(
    ({ freshness }) => freshness === "current",
  ).length ?? 0;
  const expiredProductCount = (coverage?.products.length ?? 0) - currentProductCount;
  const capabilityGroups = coverage
    ? CAPABILITY_ORDER.flatMap((capability) => {
        const products = coverage.products.filter(
          (product) => product.capability === capability,
        );
        return products.length > 0 ? [{ capability, products }] : [];
      })
    : [];
  return (
    <>
      {label ? (
        <VibeStatusTag
          className={`asset-sync-status${
            coverage?.status === "complete" || coverage?.totalIsAuthoritative
              ? ""
              : " is-incomplete"
          }`}
          data-testid={`${sourceKind}-coverage-status`}
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
        <details
          className="vibe-coverage"
          data-testid={`${sourceKind}-product-coverage`}
        >
          <summary>
            <span className="vibe-coverage-summary-label">产品覆盖</span>
            <strong className="vibe-coverage-summary-count">
              {String(coverage.products.length).padStart(2, "0")} PRODUCTS
            </strong>
            <span
              className="vibe-coverage-summary-freshness"
              data-freshness={expiredProductCount > 0 ? "expired" : "current"}
            >
              {String(currentProductCount).padStart(2, "0")} CURRENT
              {expiredProductCount > 0
                ? ` / ${String(expiredProductCount).padStart(2, "0")} STALE`
                : ""}
            </span>
            <span aria-hidden="true" className="vibe-coverage-summary-toggle" />
          </summary>
          <div className="vibe-coverage-panel">
            {capabilityGroups.map(({ capability, products }, groupIndex) => (
              <section
                className="vibe-coverage-group"
                data-capability={capability}
                key={capability}
              >
                <header className="vibe-coverage-group-head">
                  <span>{String(groupIndex + 1).padStart(2, "0")}</span>
                  <strong>{CAPABILITY_LABELS[capability]}</strong>
                  <span>
                    {String(products.length).padStart(2, "0")} PRODUCTS
                  </span>
                </header>
                <ul className="vibe-coverage-products">
                  {products.map((product, productIndex) => (
                    <li className="vibe-coverage-product" key={product.product}>
                      <span className="vibe-coverage-product-index">
                        {String(productIndex + 1).padStart(2, "0")}
                      </span>
                      <div className="vibe-coverage-product-copy">
                        <div className="vibe-coverage-product-head">
                          <strong>
                            {assetProductDisplayName(product.product)}
                          </strong>
                          {product.freshness === "expired" ? (
                            <span className="vibe-coverage-product-stale">
                              STALE
                            </span>
                          ) : null}
                        </div>
                        {product.message ? <p>{product.message}</p> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}
