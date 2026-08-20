import assert from "node:assert/strict";
import test from "node:test";

import type { AssetHolding } from "@/server/ports";
import { assetHoldingDisplayName } from "@/ui/asset-holding-display";

test("DCP 订单持仓展示订单号与标的，而非重复的币种标签", () => {
  const holding: AssetHolding = {
    symbol: "USDT",
    name: "DCP #7125082312731329000 · BTC-USDT · 进行中 · 2024-08-09 到期",
    sourceAsset: "bit:dcp:order:7125082312731329000",
    sourceAccount: "earn",
    sourceProduct: "dcp",
    providerPositionId: "7125082312731329000",
    providerPositionState: "进行中",
    quantity: "30",
    currency: "USDT",
    assetClass: "cash",
    currentPrice: null,
    marketValue: null,
    sourceMarketValue: null,
    valuation: {
      status: "quote-unavailable",
      reason: "BIT / Matrixport DCP 已含入 USD 总头寸，订单级当前估值未提供",
    },
    costPrice: null,
    platformProfit: null,
    changePercent: null,
  };

  assert.equal(
    assetHoldingDisplayName(holding),
    "DCP #7125082312731329000 · BTC-USDT · 进行中 · 2024-08-09 到期",
  );
});
