import type { AssetHolding } from "@/server/ports";

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
  "lido-withdrawal-request": "Lido 提现申请",
  "lista-slisbnb-withdrawal-request": "Lista slisBNB 提现申请",
};

export function assetHoldingDisplayName(holding: AssetHolding): string {
  if (
    holding.sourceProduct === "dcp" &&
    holding.providerPositionId !== undefined &&
    holding.providerPositionId !== "aggregate"
  ) {
    return holding.name;
  }
  const productLabel = holding.sourceProduct
    ? HOLDING_PRODUCT_LABELS[holding.sourceProduct]
    : undefined;
  if (
    productLabel &&
    (holding.sourceProduct === "lido-withdrawal-request" ||
      holding.sourceProduct === "lista-slisbnb-withdrawal-request") &&
    holding.providerPositionId !== undefined &&
    holding.providerPositionId !== "aggregate"
  ) {
    return `${productLabel} #${holding.providerPositionId}`;
  }
  return productLabel ? `${holding.symbol} · ${productLabel}` : holding.name;
}
