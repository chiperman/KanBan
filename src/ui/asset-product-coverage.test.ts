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

test("协议提现仓位名称不重复承载状态与可领取日期", () => {
  const holding: AssetHolding = {
    symbol: "BNB",
    name: "Lista slisBNB 提现申请 #101 · 锁仓中 · 最早预计可领取 2026-08-27",
    sourceAsset: "evm:56:lista-slisbnb-withdrawal:101",
    sourceAccount: "wallet",
    sourceProduct: "lista-slisbnb-withdrawal-request",
    providerPositionId: "101",
    providerPositionState: "锁仓中",
    providerPositionAvailableOn: "2026-08-27",
    quantity: "1.2",
    currency: "USD",
    assetClass: "crypto",
    currentPrice: { amount: "600", currency: "USD" },
    marketValue: "720",
    sourceMarketValue: { amount: "720", currency: "USD" },
    valuation: {
      status: "valued",
      priceSource: "CoinGecko BNB Smart Chain/USD 参考价格",
      pricedAt: "2026-02-01T00:00:00.000Z",
    },
    costPrice: null,
    platformProfit: null,
    changePercent: null,
  };

  assert.equal(assetHoldingDisplayName(holding), "Lista slisBNB 提现申请 #101");
});
