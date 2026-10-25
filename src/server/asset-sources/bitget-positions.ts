import {
  decimalAdd,
  decimalCompare,
} from "@/domain/decimal";
import { createJsonDecoder } from "@/server/asset-sources/json";
import type { AssetHolding } from "@/server/ports";
import { positiveDecimal } from "@/server/asset-sources/value-guards";

const { record, list, text, nonNegativeDecimal: decimal } = createJsonDecoder("Bitget");
const positive = positiveDecimal;

export interface BitgetPosition {
  asset: string;
  quantity: string;
  account: NonNullable<AssetHolding["sourceAccount"]>;
  sourceProduct: string;
  providerPositionId?: string;
  nativeValue?: {
    amount: string;
    currency: "USDT" | "USD";
    pricedAt: string;
    source: string;
  };
}

function addPosition(
  values: Map<string, BitgetPosition>,
  asset: string,
  quantity: string,
  account: BitgetPosition["account"],
  nativeValue?: BitgetPosition["nativeValue"],
  detail: {
    sourceProduct?: string;
    providerPositionId?: string;
  } = {},
): void {
  if (!positive(quantity)) return;
  const sourceProduct = detail.sourceProduct ?? (
    account === "spot"
      ? "spot"
      : account === "funding"
        ? "funding"
        : account === "trading-bot"
          ? "futures-bot"
          : account === "earn-flexible"
            ? "savings-flexible"
            : account === "earn-locked"
              ? "savings-fixed"
              : account === "staking"
                ? "onchain-elite"
                : "savings"
  );
  const key = [
    account,
    sourceProduct,
    detail.providerPositionId ?? "aggregate",
    asset,
  ].join(":");
  const previous = values.get(key);
  values.set(key, {
    asset,
    account,
    sourceProduct,
    ...(detail.providerPositionId
      ? { providerPositionId: detail.providerPositionId }
      : {}),
    quantity: previous ? decimalAdd(previous.quantity, quantity) : quantity,
    nativeValue: previous ? undefined : nativeValue,
  });
}

export function extractClassicPositions(input: {
  spot: unknown;
  funding: unknown;
  botFutures: unknown;
  savingsOverview: unknown;
  cashPlusAccount: unknown;
  flexiblePages: unknown[];
  fixedPages: unknown[];
  sharkfinAccount: unknown;
  eliteAssets: unknown;
  observedAt: string;
  fundingObservedAt?: string;
  botObservedAt?: string;
}): BitgetPosition[] {
  const positions = new Map<string, BitgetPosition>();
  for (const item of list(input.spot, "Bitget spot/account/assets data")) {
    addPosition(
      positions,
      text(item.coin, "coin"),
      decimalAdd(
        decimal(item.available, "available"),
        decimal(item.frozen, "frozen"),
        decimal(item.locked, "locked"),
        decimal(item.limitAvailable, "limitAvailable"),
      ),
      "spot",
    );
  }
  for (const item of list(input.funding, "Bitget account/funding-assets data")) {
    addPosition(
      positions,
      text(item.coin, "coin"),
      decimalAdd(
        decimal(item.available, "available"),
        decimal(item.frozen, "frozen"),
      ),
      "funding",
      {
        amount: decimal(item.usdtValue, "usdtValue"),
        currency: "USDT",
        pricedAt: input.fundingObservedAt ?? input.observedAt,
        source: "Bitget Funding usdtValue",
      },
    );
  }
  for (const item of list(input.botFutures, "Bitget bot account data")) {
    addPosition(
      positions,
      text(item.coin, "coin"),
      decimal(item.equity, "equity"),
      "trading-bot",
      {
        amount: decimal(item.usdtValue, "usdtValue"),
        currency: "USDT",
        pricedAt: input.botObservedAt ?? input.observedAt,
        source: "Bitget 合约交易机器人 usdtValue",
      },
    );
  }
  const savingsTotals = new Map<string, string>();
  for (const [pages, account] of [
    [input.flexiblePages, "earn-flexible"],
    [input.fixedPages, "earn-locked"],
  ] as const) {
    const seen = new Map<string, string>();
    for (const rawPage of pages) {
      const page = record(rawPage, "Bitget savings assets data");
      for (const item of list(page.resultList, "Bitget savings resultList")) {
        const periodType = account === "earn-flexible" ? "flexible" : "fixed";
        if (item.periodType !== periodType) {
          throw new Error(`Bitget Earn 返回错误 periodType：${String(item.periodType)}`);
        }
        const identity = typeof item.orderId === "string" && item.orderId
          ? item.orderId
          : `${text(item.productId, "productId")}:${periodType}`;
        const amount = decimal(item.holdAmount, "holdAmount");
        const previous = seen.get(identity);
        if (previous !== undefined) {
          if (decimalCompare(previous, amount) !== 0) {
            throw new Error("Bitget Earn 重复仓位数量不一致");
          }
          continue;
        }
        seen.set(identity, amount);
        const coin = text(item.productCoin, "productCoin");
        savingsTotals.set(
          coin,
          decimalAdd(savingsTotals.get(coin) ?? "0", amount),
        );
        addPosition(
          positions,
          coin,
          amount,
          account,
        );
      }
    }
  }
  const overview = new Map<string, string>();
  for (const item of list(input.savingsOverview, "Bitget earn/account/assets data")) {
    const coin = text(item.coin, "coin");
    if (overview.has(coin)) throw new Error("Bitget Earn 总览出现重复币种");
    overview.set(coin, decimal(item.amount, "amount"));
  }
  for (const [coin, overviewAmount] of overview) {
    const detailedAmount = savingsTotals.get(coin);
    if (
      detailedAmount !== undefined &&
      decimalCompare(overviewAmount, detailedAmount) === 0
    ) {
      continue;
    }
    positions.delete(
      ["earn-flexible", "savings-flexible", "aggregate", coin].join(":"),
    );
    positions.delete(
      ["earn-locked", "savings-fixed", "aggregate", coin].join(":"),
    );
    addPosition(
      positions,
      coin,
      overviewAmount,
      "earn",
      undefined,
      { sourceProduct: "savings" },
    );
  }
  const cashPlus = record(
    input.cashPlusAccount,
    "Bitget earn/savings/account data",
  );
  const cashPlusAmount = decimal(cashPlus.usdtAmount, "usdtAmount");
  addPosition(
    positions,
    "USDT",
    cashPlusAmount,
    "earn",
    {
      amount: cashPlusAmount,
      currency: "USDT",
      pricedAt: input.observedAt,
      source: "Bitget Cash+ usdtAmount",
    },
    {
      sourceProduct: "cash-plus",
      providerPositionId: "aggregate",
    },
  );
  const sharkfin = record(
    input.sharkfinAccount,
    "Bitget earn/sharkfin/account data",
  );
  const sharkfinAmount = decimal(
    sharkfin.usdtSubscribeAmount,
    "usdtSubscribeAmount",
  );
  addPosition(
    positions,
    "USDT",
    sharkfinAmount,
    "earn",
    {
      amount: sharkfinAmount,
      currency: "USDT",
      pricedAt: input.observedAt,
      source: "Bitget SharkFin usdtSubscribeAmount",
    },
    {
      sourceProduct: "sharkfin",
      providerPositionId: "aggregate",
    },
  );
  const elite = record(input.eliteAssets, "Bitget earn/elite/assets data");
  const eliteIds = new Set<string>();
  for (
    const item of list(
      elite.resultList,
      "Bitget earn/elite/assets resultList",
    )
  ) {
    const productId = text(item.productId, "productId");
    if (eliteIds.has(productId)) {
      throw new Error("Bitget On-chain Elite 出现重复 productId");
    }
    eliteIds.add(productId);
    addPosition(
      positions,
      text(item.productCoin, "productCoin"),
      decimal(item.holdingAmount, "holdingAmount"),
      "staking",
      {
        amount: decimal(item.usdtHoldingAmount, "usdtHoldingAmount"),
        currency: "USDT",
        pricedAt: input.observedAt,
        source: "Bitget On-chain Elite usdtHoldingAmount",
      },
      {
        sourceProduct: "onchain-elite",
        providerPositionId: productId,
      },
    );
  }
  return [...positions.values()];
}

export function extractUtaPositions(input: {
  assets: unknown;
  funding: unknown;
  savingsOverview: unknown;
  cashPlusAccount: unknown;
  flexiblePages: unknown[];
  fixedPages: unknown[];
  sharkfinAccount: unknown;
  eliteAssets: unknown;
  observedAt: string;
  assetsObservedAt: string;
}): BitgetPosition[] {
  const root = record(input.assets, "Bitget UTA account/assets data");
  for (const field of ["unrealisedPnl", "positionValue", "mmr", "imr"] as const) {
    if (decimalCompare(decimal(root[field], field), "0") !== 0) {
      throw new Error(`Bitget UTA ${field} 非零，无法证明纯现金范围`);
    }
  }
  const spot = list(root.assets, "Bitget UTA assets").map((item) => {
    if (decimalCompare(decimal(item.debt, "debt"), "0") !== 0) {
      throw new Error("Bitget UTA debt 非零，无法证明纯现金范围");
    }
    return item;
  });
  const funding = list(input.funding, "Bitget UTA funding assets").map((item) => {
    const balance = decimal(item.balance, "balance");
    const components = decimalAdd(
      decimal(item.available, "available"),
      decimal(item.frozen, "frozen"),
    );
    if (decimalCompare(balance, components) !== 0) {
      throw new Error("Bitget UTA Funding balance 与 available/frozen 不一致");
    }
    return item;
  });
  const classicShape = extractClassicPositions({
    spot: spot.map((item) => ({
      coin: item.coin,
      available: item.balance,
      frozen: "0",
      locked: "0",
      limitAvailable: "0",
    })),
    funding: funding.map((item) => ({
      coin: item.coin,
      available: item.balance,
      frozen: "0",
      usdtValue: "0",
    })),
    botFutures: [],
    savingsOverview: input.savingsOverview,
    cashPlusAccount: input.cashPlusAccount,
    flexiblePages: input.flexiblePages,
    fixedPages: input.fixedPages,
    sharkfinAccount: input.sharkfinAccount,
    eliteAssets: input.eliteAssets,
    observedAt: input.observedAt,
  });
  const nativeByCoin = new Map(
    spot.map((item) => [text(item.coin, "coin"), decimal(item.usdValue, "usdValue")]),
  );
  return classicShape.map((position) =>
    position.account === "spot"
      ? {
          ...position,
          nativeValue: {
            amount: nativeByCoin.get(position.asset) ?? "0",
            currency: "USD" as const,
            pricedAt: input.assetsObservedAt,
            source: "Bitget UTA usdValue",
          },
        }
      : position.account === "funding"
        ? { ...position, nativeValue: undefined }
        : position,
  );
}

