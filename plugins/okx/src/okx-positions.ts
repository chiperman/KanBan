import {
  decimalAdd,
  decimalCompare,
  decimalSubtract,
} from "@/domain/decimal";
import { createJsonDecoder } from "../../sdk/json";
import type { AssetHolding } from "@/server/ports";
import { positiveDecimal } from "../../sdk/value-guards";
import {
  first,
  zeroOrEmpty,
  OKX_EQUITY_ROUNDING_TOLERANCE,
} from "./okx-json";

const { list, text, nonNegativeDecimal: decimal } = createJsonDecoder("OKX");
const positive = positiveDecimal;

export interface OkxPosition {
  asset: string;
  quantity: string;
  account: NonNullable<AssetHolding["sourceAccount"]>;
  sourceProduct?: string;
  providerPositionId?: string;
  providerPositionState?: string;
}

export function addPosition(
  values: Map<string, OkxPosition>,
  asset: string,
  quantity: string,
  account: OkxPosition["account"],
  detail: Pick<
    OkxPosition,
    "sourceProduct" | "providerPositionId" | "providerPositionState"
  > = {},
): void {
  if (!positive(quantity)) return;
  const key = [
    account,
    detail.sourceProduct ?? "account",
    detail.providerPositionId ?? "aggregate",
    asset,
  ].join(":");
  const previous = values.get(key);
  values.set(key, {
    asset,
    account,
    quantity: previous ? decimalAdd(previous.quantity, quantity) : quantity,
    ...detail,
  });
}

export function extractPositions(input: {
  trading: unknown;
  funding: unknown;
  savings: unknown;
  onchainActiveOrders: unknown;
}): OkxPosition[] {
  const positions = new Map<string, OkxPosition>();
  const trading = first(input.trading, "OKX account/balance data");
  for (const item of list(trading.details, "OKX account/balance details")) {
    const asset = text(item.ccy, "ccy");
    for (const field of ["liab", "crossLiab", "borrowFroz", "interest"] as const) {
      if (!zeroOrEmpty(item[field], field)) {
        throw new Error(`OKX Trading 出现非零 ${field}，已拒绝借贷资产`);
      }
    }
    const cashBalance = decimal(item.cashBal, "cashBal");
    const strategyEquity = decimal(item.stgyEq, "stgyEq");
    const equity = decimal(item.eq, "eq");
    const expectedEquity = decimalAdd(cashBalance, strategyEquity);
    const equityDifference = decimalSubtract(equity, expectedEquity);
    const absoluteDifference = decimalCompare(equityDifference, "0") < 0
      ? decimalSubtract("0", equityDifference)
      : equityDifference;
    if (
      decimalCompare(
        absoluteDifference,
        OKX_EQUITY_ROUNDING_TOLERANCE,
      ) > 0
    ) {
      throw new Error(
        `OKX Trading ${asset} 权益无法守恒（eq 与 cashBal + stgyEq 差异超过舍入容差）`,
      );
    }
    addPosition(
      positions,
      asset,
      cashBalance,
      "spot",
    );
    addPosition(positions, asset, strategyEquity, "trading-bot");
  }
  for (const item of list(input.funding, "OKX asset/balances data")) {
    addPosition(
      positions,
      text(item.ccy, "ccy"),
      decimal(item.bal, "bal"),
      "funding",
    );
  }
  for (const item of list(input.savings, "OKX savings/balance data")) {
    addPosition(
      positions,
      text(item.ccy, "ccy"),
      decimal(item.amt, "amt"),
      "earn-flexible",
    );
  }
  const orderIds = new Set<string>();
  for (
    const item of list(
      input.onchainActiveOrders,
      "OKX staking-defi/orders-active data",
    )
  ) {
    const orderId = text(item.ordId ?? item.orderId, "ordId");
    if (orderIds.has(orderId)) {
      throw new Error("OKX On-chain Earn Active Orders 出现重复订单");
    }
    orderIds.add(orderId);
    addPosition(
      positions,
      text(item.ccy, "ccy"),
      decimal(item.amt, "amt"),
      "staking",
      {
        sourceProduct: "onchain-earn",
        providerPositionId: orderId,
        providerPositionState: text(item.state, "state"),
      },
    );
  }
  return [...positions.values()];
}
