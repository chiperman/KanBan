import { formatAssetAmount } from "@/ui/asset-price-display";
import { useId, useState } from "react";

import type {
  AssetHolding,
  AssetProductCoverage,
  AssetSnapshotCoverage,
} from "@/server/ports";
import { assetHoldingDisplayName } from "@/ui/asset-holding-display";
import { AssetFinancialValue } from "@/ui/asset-financial-value";
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
  "cash-plus": "Cash+（现金宝）",
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
  "lido-withdrawal-request": "Lido 提现申请",
  "lista-slisbnb-withdrawal-request": "Lista slisBNB 提现申请",
};

export function assetProductDisplayName(product: string): string {
  return ASSET_PRODUCT_LABELS[product] ?? product;
}

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
  return formatAssetAmount(value);
}

export function assetHoldingKey(holding: AssetHolding): string {
  return [
    holding.sourceAccount ?? "default",
    holding.sourceProduct ?? "legacy",
    holding.providerPositionId ?? holding.economicAssetKey ?? "aggregate",
    holding.sourceAsset ?? holding.symbol,
  ].join(":");
}

export { assetHoldingDisplayName };

export function AssetHoldingPositionStatus({
  holding,
}: {
  holding: AssetHolding;
}) {
  if (!holding.providerPositionState) return null;
  const tone = holding.providerPositionState === "可领取"
    ? "success"
    : holding.providerPositionState === "排队中" ||
        holding.providerPositionState === "锁仓中"
      ? "warning"
      : "muted";
  return (
    <span className="asset-provider-position">
      <VibeStatusTag tone={tone}>{holding.providerPositionState}</VibeStatusTag>
      {holding.providerPositionAvailableOn ? (
        <small>最早预计可领取 {holding.providerPositionAvailableOn}</small>
      ) : null}
    </span>
  );
}

export function AssetProductCoverage({
  coverage,
  sourceKind,
  variant = "default",
  isOpen: controlledOpen,
  onOpenChange,
  panelId: controlledPanelId,
  renderInlinePanel = true,
}: {
  coverage: AssetSnapshotCoverage | undefined;
  sourceKind: string;
  variant?: "default" | "source-row";
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  panelId?: string;
  renderInlinePanel?: boolean;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const internalPanelId = useId();
  const isSourceRowOpen = controlledOpen ?? internalOpen;
  const panelId = controlledPanelId ?? internalPanelId;
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
        ? "当前总额完整，部分产品仅汇总"
        : null;
  const expiredProductCount = coverage?.products.filter(
    ({ freshness }) => freshness === "expired",
  ).length ?? 0;
  const summary = (
    <>
      <span className="vibe-coverage-summary-label">产品覆盖</span>
      <strong className="vibe-coverage-summary-count">
        {coverage?.products.length ?? 0} 项
        {expiredProductCount > 0 ? (
          <span className="vibe-coverage-summary-freshness">
            {expiredProductCount} 项待更新
          </span>
        ) : null}
      </strong>
      <span aria-hidden="true" className="vibe-coverage-summary-toggle" />
    </>
  );
  const setSourceRowOpen = (open: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(open);
    onOpenChange?.(open);
  };
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
          tone={coverage?.status === "partial" && !coverage.totalIsAuthoritative
            ? "error"
            : coverage?.status === "complete" && !coverage.unexplainedValue && coverage.excludedPositiveAccounts.length === 0
              ? "success"
              : "warning"}
        >
          {label}
          {coverage?.unexplainedValue ? (
            <>
              {`，${coverage.totalIsAuthoritative ? "明细差额" : "未解释"} `}
              <AssetFinancialValue unit={coverage.unexplainedValue.currency}>
                {money(coverage.unexplainedValue.amount)}
              </AssetFinancialValue>
            </>
          ) : ""}
          {coverage && coverage.excludedPositiveAccounts.length > 0
            ? `，未纳入 ${coverage.excludedPositiveAccounts.join("、")}`
            : ""}
        </VibeStatusTag>
      ) : null}
      {coverage && coverage.products.length > 0 ? (
        variant === "source-row" ? (
          <div
            className="vibe-coverage-inline"
            data-testid={`${sourceKind}-product-coverage`}
          >
            <button
              aria-controls={panelId}
              aria-expanded={isSourceRowOpen}
              className={`vibe-coverage-summary-trigger${
                isSourceRowOpen ? " is-open" : ""
              }`}
              onClick={() => setSourceRowOpen(!isSourceRowOpen)}
              type="button"
            >
              {summary}
            </button>
            {renderInlinePanel && isSourceRowOpen ? (
              <AssetProductCoveragePanel
                className="vibe-coverage-panel--inline"
                coverage={coverage}
                id={panelId}
              />
            ) : null}
          </div>
        ) : (
          <details
            className="vibe-coverage"
            data-testid={`${sourceKind}-product-coverage`}
          >
            <summary>{summary}</summary>
            <AssetProductCoveragePanel coverage={coverage} />
          </details>
        )
      ) : null}
    </>
  );
}

export function AssetProductCoveragePanel({
  className,
  coverage,
  id,
}: {
  className?: string;
  coverage: AssetSnapshotCoverage;
  id?: string;
}) {
  const capabilityGroups = CAPABILITY_ORDER.flatMap((capability) => {
    const products = coverage.products.filter(
      (product) => product.capability === capability,
    );
    return products.length > 0 ? [{ capability, products }] : [];
  });

  return (
    <div
      className={["vibe-coverage-panel", className].filter(Boolean).join(" ")}
      id={id}
    >
      {capabilityGroups.map(({ capability, products }) => (
        <section
          className="vibe-coverage-group"
          data-capability={capability}
          key={capability}
        >
          <header className="vibe-coverage-group-head">
            <strong>{CAPABILITY_LABELS[capability]}</strong>
            <span>{products.length} 项</span>
          </header>
          <ul className="vibe-coverage-products">
            {products.map((product) => (
              <li className="vibe-coverage-product" key={product.product}>
                <div className="vibe-coverage-product-copy">
                  <div className="vibe-coverage-product-head">
                    <strong>
                      {assetProductDisplayName(product.product)}
                    </strong>
                    {product.freshness === "expired" ? (
                      <span className="vibe-coverage-product-stale">
                        待更新
                      </span>
                    ) : null}
                  </div>
                  {product.message ? (
                    <p>{product.message.replace(/\s+[·・]\s+/g, "，")}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
