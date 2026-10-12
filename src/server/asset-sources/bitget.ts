import {
  createHmac,
} from "node:crypto";

import {
  decimalAdd,
  decimalCompare,
  decimalDivide,
  decimalMultiply,
  decimalSubtract,
} from "@/domain/decimal";
import {
  createJsonDecoder,
  type JsonRecord,
} from "@/server/asset-sources/json";
import type {
  AssetHolding,
  AssetPermission,
  AssetSnapshot,
  AssetSourceRefresher,
  AssetSourceRefreshResult,
  BitgetAuthorizationResult,
  BitgetAccountMode,
  BitgetReadOnly,
  PriceQuote,
  Prices,
} from "@/server/ports";
import { assetResponseError, hasManagedAssetRetry } from "@/server/asset-sync-diagnostics";
import { positiveDecimal } from "@/server/asset-sources/value-guards";

type BitgetFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface BitgetRuntime {
  now(): number;
  sleep(milliseconds: number, signal?: AbortSignal): Promise<void>;
  earnRequestIntervalMs: number;
  retryDelaysMs: readonly number[];
}

function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Bitget 请求已取消"));
      return;
    }
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new Error("Bitget 请求已取消"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

const DEFAULT_RUNTIME: BitgetRuntime = {
  now: () => Date.now(),
  sleep: abortableSleep,
  earnRequestIntervalMs: 110,
  retryDelaysMs: [250, 750],
};

interface BitgetEnvelope {
  data: unknown;
  requestTime: string;
}

interface StoredBitgetCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
  accountMode: BitgetAccountMode;
}

interface BitgetPosition {
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

interface BitgetIdentity {
  permissions: AssetPermission[];
  userId: string;
  parentId: string;
  accountMode: BitgetAccountMode;
  scope: string[];
  registeredAt: string;
}

const BITGET_ORIGIN = "https://api.bitget.com";
const BITGET_RECONCILIATION_MIN_TOLERANCE = "0.5";
const BITGET_RECONCILIATION_RATE = "0.0001";
const BITGET_RECONCILIATION_MAX_TOLERANCE = "5";
const READ_ONLY_AUTHORITIES = new Set([
  "coor",
  "cpor",
  "stor",
  "smor",
  "ttor",
  "wtor",
  "taxr",
  "chor",
  "p2pr",
  "pllr",
]);
const {
  record,
  list,
  text,
  nonNegativeDecimal: decimal,
  identifier,
} = createJsonDecoder("Bitget");

const positive = positiveDecimal;

function optionalParentId(value: unknown): string {
  if (value === "") return "";
  return identifier(value, "parentId");
}

export function validateBitgetReadOnlyPermission(value: unknown): AssetPermission[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Bitget 无法证明只读权限");
  }
  const tokens = value.map((item) => text(item, "authorities"));
  const unique = new Set(tokens);
  if (
    unique.size !== tokens.length ||
    tokens.some((authority) => !READ_ONLY_AUTHORITIES.has(authority))
  ) {
    throw new Error("检测到 Bitget 写权限或未知权限，已拒绝连接");
  }
  return ["market-data", "account", "positions"];
}

function registrationTime(value: unknown): string {
  const timestamp = text(value, "regisTime");
  if (!/^\d+$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp))) {
    throw new Error("Bitget regisTime 格式无效");
  }
  return timestamp;
}

function responseTime(value: unknown): string {
  const milliseconds = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/.test(value)
      ? Number(value)
      : Number.NaN;
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new Error("Bitget requestTime 格式无效");
  }
  return new Date(milliseconds).toISOString();
}

function validateClassicAccountInfo(value: unknown): BitgetIdentity {
  const config = record(value, "Bitget spot/account/info data");
  const permissions = validateBitgetReadOnlyPermission(config.authorities);
  const scope = (config.authorities as string[]).slice().sort();
  return {
    permissions,
    userId: identifier(config.userId, "userId"),
    parentId: optionalParentId(config.parentId),
    accountMode: "classic",
    scope,
    registeredAt: registrationTime(config.regisTime),
  };
}

export function validateBitgetUtaReadOnlyPermission(
  permType: unknown,
  permissions: unknown,
): AssetPermission[] {
  if (permType !== "read-only" || !Array.isArray(permissions)) {
    throw new Error("Bitget UTA 无法证明 read-only 权限");
  }
  const values = permissions.map((item) => text(item, "permissions"));
  const unique = new Set(values);
  if (
    unique.size !== values.length ||
    unique.size !== 2 ||
    !unique.has("uta_mgt") ||
    !unique.has("uta_trade")
  ) {
    throw new Error("Bitget UTA 权限范围不是纯只读资产范围，已拒绝连接");
  }
  return ["market-data", "account", "positions"];
}

function validateUtaAccountInfo(value: unknown): BitgetIdentity {
  const config = record(value, "Bitget UTA account/info data");
  const permissions = validateBitgetUtaReadOnlyPermission(
    config.permType,
    config.permissions,
  );
  const scope = (config.permissions as string[]).slice().sort();
  return {
    permissions,
    userId: identifier(config.userId, "userId"),
    parentId: optionalParentId(config.parentId),
    accountMode: "uta",
    scope,
    registeredAt: registrationTime(config.regisTime),
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

function extractClassicPositions(input: {
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

function extractUtaPositions(input: {
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

function scopeLabel(scope: AssetHolding["sourceAccount"]): string {
  if (scope === "spot") return "现货";
  if (scope === "funding") return "资金";
  if (scope === "trading-bot") return "合约交易机器人";
  if (scope === "earn-flexible") return "活期 Earn";
  if (scope === "earn-locked") return "定期 Earn";
  if (scope === "earn") return "Earn";
  if (scope === "staking") return "On-chain Elite";
  return "Bitget";
}

function positionScopeLabel(position: BitgetPosition): string {
  return position.sourceProduct === "cash-plus"
    ? "Cash+（现金宝）"
    : scopeLabel(position.account);
}

function bitgetCoverage(
  accountMode: BitgetAccountMode,
  positions: readonly BitgetPosition[],
  input: {
    status: NonNullable<AssetSnapshot["coverage"]>["status"];
    unexplainedValue: NonNullable<
      AssetSnapshot["coverage"]
    >["unexplainedValue"];
    excludedPositiveAccounts: string[];
  },
): NonNullable<AssetSnapshot["coverage"]> {
  const hasAggregateEarn = positions.some(
    ({ sourceProduct }) => sourceProduct === "savings",
  );
  const savingsCapability = hasAggregateEarn
    ? "aggregate-only" as const
    : "detailed" as const;
  const savingsMessage = hasAggregateEarn
    ? "Earn 总览与逐仓明细不一致，按币种保留平台汇总资产"
    : null;
  const products: NonNullable<AssetSnapshot["coverage"]>["products"] = [
    {
      product: "spot",
      capability: "detailed",
      freshness: "current",
      message: null,
    },
    {
      product: "funding",
      capability: "detailed",
      freshness: "current",
      message: null,
    },
    {
      product: "savings-flexible",
      capability: savingsCapability,
      freshness: "current",
      message: savingsMessage,
    },
    {
      product: "savings-fixed",
      capability: savingsCapability,
      freshness: "current",
      message: savingsMessage,
    },
    {
      product: "cash-plus",
      capability: "aggregate-only",
      freshness: "current",
      message: "读取 Cash+ 账户 USDT 估值，不将 BTC 估值重复计入",
    },
  ];
  if (accountMode === "classic") {
    products.push(
      {
        product: "futures-bot",
        capability: "aggregate-only",
        freshness: "current",
        message: "读取平台聚合账户权益，不展开机器人订单",
      },
      {
        product: "futures",
        capability: "aggregate-only",
        freshness: "current",
        message: "平台总额已覆盖普通合约相关权益，不与 Futures Bots 重复相加；不展开仓位、保证金或未实现盈亏",
      },
    );
  }
  products.push(
    {
      product: "sharkfin",
      capability: "aggregate-only",
      freshness: "current",
      message: "读取 SharkFin 账户聚合估值，官方当前记录不提供逐仓本金",
    },
    {
      product: "onchain-elite",
      capability: "detailed",
      freshness: "current",
      message: null,
    },
  );
  return {
    status: input.status,
    totalIsAuthoritative: input.excludedPositiveAccounts.length === 0,
    products,
    unexplainedValue: input.unexplainedValue,
    excludedPositiveAccounts: input.excludedPositiveAccounts,
  };
}

function classicAccountCoverage(input: {
  overview: unknown;
  snapshot: AssetSnapshot;
  positions: readonly BitgetPosition[];
}): {
  total: AssetSnapshot["total"];
  coverage: NonNullable<AssetSnapshot["coverage"]>;
} {
  const balances = new Map<string, string>();
  for (
    const item of list(
      input.overview,
      "Bitget account/all-account-balance data",
    )
  ) {
    const accountType = text(item.accountType, "accountType");
    if (balances.has(accountType)) {
      throw new Error("Bitget 全账户总览出现重复 accountType");
    }
    balances.set(
      accountType,
      decimal(item.usdtBalance, "usdtBalance"),
    );
  }
  const totalTypes = ["spot", "funding", "earn", "bots", "futures"] as const;
  const reconciledTypes = ["spot", "funding", "earn", "bots"] as const;
  const excludedPositiveAccounts = [...balances.entries()]
    .filter(([accountType, amount]) =>
      !totalTypes.includes(accountType as typeof totalTypes[number]) &&
      positive(amount)
    )
    .map(([accountType]) => accountType);
  const total = decimalAdd(
    ...totalTypes.map((accountType) => balances.get(accountType) ?? "0"),
    ...input.positions
      .filter(({ sourceProduct }) => sourceProduct === "cash-plus")
      .map(({ nativeValue }) =>
        nativeValue?.currency === "USDT" ? nativeValue.amount : "0"
      ),
  );
  const partitionByAccount = new Map<string, string>([
    ["spot", "spot"],
    ["funding", "funding"],
    ["trading-bot", "bots"],
    ["earn-flexible", "earn"],
    ["earn-locked", "earn"],
    ["earn", "earn"],
    ["staking", "earn"],
  ]);
  const detailedTotals = new Map<string, string>();
  const incompletePartitions = new Set<string>();
  for (const holding of input.snapshot.holdings) {
    if (holding.sourceProduct === "cash-plus") continue;
    const partition = holding.sourceAccount
      ? partitionByAccount.get(holding.sourceAccount)
      : undefined;
    if (!partition) continue;
    if (holding.sourceMarketValue === null) {
      incompletePartitions.add(partition);
      continue;
    }
    detailedTotals.set(
      partition,
      decimalAdd(
        detailedTotals.get(partition) ?? "0",
        holding.sourceMarketValue.amount,
      ),
    );
  }
  let netDifference = "0";
  for (const partition of reconciledTypes) {
    if (incompletePartitions.has(partition)) continue;
    const difference = decimalSubtract(
      balances.get(partition) ?? "0",
      detailedTotals.get(partition) ?? "0",
    );
    netDifference = decimalAdd(netDifference, difference);
  }
  const absoluteDifference = decimalCompare(netDifference, "0") < 0
    ? decimalSubtract("0", netDifference)
    : netDifference;
  const proportionalTolerance = decimalMultiply(
    total,
    BITGET_RECONCILIATION_RATE,
  );
  const cappedTolerance = decimalCompare(
      proportionalTolerance,
      BITGET_RECONCILIATION_MAX_TOLERANCE,
    ) > 0
    ? BITGET_RECONCILIATION_MAX_TOLERANCE
    : proportionalTolerance;
  const reconciliationTolerance = decimalCompare(
      cappedTolerance,
      BITGET_RECONCILIATION_MIN_TOLERANCE,
    ) < 0
    ? BITGET_RECONCILIATION_MIN_TOLERANCE
    : cappedTolerance;
  const unexplainedValue = decimalCompare(
      absoluteDifference,
      reconciliationTolerance,
    ) > 0
    ? { amount: absoluteDifference, currency: "USDT" }
    : null;
  const status =
    unexplainedValue === null && excludedPositiveAccounts.length === 0
      ? "complete"
      : "partial";
  return {
    total: { amount: total, currency: "USDT" },
    coverage: bitgetCoverage("classic", input.positions, {
        status,
        unexplainedValue,
        excludedPositiveAccounts,
      }),
  };
}

function compareHoldingValue(left: AssetHolding, right: AssetHolding): number {
  const leftValue = left.sourceMarketValue?.amount ?? null;
  const rightValue = right.sourceMarketValue?.amount ?? null;
  if (leftValue === null) return rightValue === null ? 0 : 1;
  if (rightValue === null) return -1;
  return decimalCompare(rightValue, leftValue);
}

function nativeUsdtUsdQuote(
  instruments: unknown,
  tickers: unknown,
  observedAt: string,
): PriceQuote | null {
  const available = list(instruments, "Bitget instruments data").some((item) =>
    item.status === "online" &&
    item.symbol === "USDTUSD" &&
    item.baseCoin === "USDT" &&
    item.quoteCoin === "USD"
  );
  if (!available) return null;
  const item = list(tickers, "Bitget tickers data").find(
    (candidate) => candidate.symbol === "USDTUSD",
  );
  if (!item) return null;
  const timestamp = typeof item.ts === "string" ? item.ts : "";
  if (!/^\d+$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp))) return null;
  const quotedAt = new Date(Number(timestamp));
  const age = Math.abs(Date.parse(observedAt) - quotedAt.getTime());
  const price = typeof item.lastPr === "string" &&
      /^\d+(?:\.\d+)?$/.test(item.lastPr)
    ? item.lastPr
    : null;
  if (
    price === null ||
    !Number.isFinite(age) ||
    age > 5 * 60_000 ||
    !positive(price)
  ) return null;
  return { symbol: "USDT", currency: "USD", price, quotedAt };
}

async function readUsdtUsdQuote(input: {
  instruments: unknown;
  tickers: unknown;
  observedAt: string;
  prices: Prices;
}): Promise<{ quote: PriceQuote | null; source: string | null }> {
  const native = nativeUsdtUsdQuote(
    input.instruments,
    input.tickers,
    input.observedAt,
  );
  if (native) return { quote: native, source: "Bitget 现货 USDTUSD" };
  return { quote: await input.prices.quote("USDT"), source: null };
}

function valuePositions(input: {
  positions: BitgetPosition[];
  instruments: unknown;
  tickers: unknown;
  observedAt: string;
  usdtUsdQuote: PriceQuote | null;
  usdtUsdSource?: string | null;
  targetCurrency: "USDT" | "USD";
  coverage?: AssetSnapshot["coverage"];
  authoritativeTotal?: AssetSnapshot["total"];
}): AssetSnapshot {
  const positionAssetKeys = new Set(
    input.positions.map((position) => position.asset.toUpperCase()),
  );
  const livePairs = new Map<string, { asset: string; symbol: string }>();
  const normalizedPairs = new Map<string, Array<{ asset: string; symbol: string }>>();
  for (const item of list(input.instruments, "Bitget instruments data")) {
    if (item.status === "online" && item.quoteCoin === "USDT") {
      if (
        typeof item.baseCoin !== "string" ||
        item.baseCoin.length === 0 ||
        !positionAssetKeys.has(item.baseCoin.toUpperCase()) ||
        typeof item.symbol !== "string" ||
        item.symbol.length === 0
      ) {
        continue;
      }
      const pair = {
        asset: item.baseCoin,
        symbol: item.symbol,
      };
      livePairs.set(pair.asset, pair);
      const key = pair.asset.toUpperCase();
      normalizedPairs.set(key, [...(normalizedPairs.get(key) ?? []), pair]);
    }
  }
  const neededInstruments = new Set(
    [...livePairs.values()].map((pair) => pair.symbol),
  );
  const tickerByInstrument = new Map<string, { price: string; pricedAt: string }>();
  for (const item of list(input.tickers, "Bitget tickers data")) {
    const symbol = typeof item.symbol === "string" ? item.symbol : null;
    if (symbol === null || !neededInstruments.has(symbol)) continue;
    const timestamp = typeof item.ts === "string" ? item.ts : "";
    if (!/^\d+$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp))) {
      continue;
    }
    const pricedAt = new Date(Number(timestamp));
    const age = Math.abs(Date.parse(input.observedAt) - pricedAt.getTime());
    if (!Number.isFinite(age) || age > 5 * 60_000) continue;
    const price = typeof item.lastPr === "string" &&
        /^\d+(?:\.\d+)?$/.test(item.lastPr)
      ? item.lastPr
      : null;
    if (price === null || !positive(price)) continue;
    tickerByInstrument.set(symbol, {
      price,
      pricedAt: pricedAt.toISOString(),
    });
  }
  const quoteAge = input.usdtUsdQuote
    ? Math.abs(Date.parse(input.observedAt) - input.usdtUsdQuote.quotedAt.getTime())
    : Number.POSITIVE_INFINITY;
  const usdtUsdQuote =
    input.usdtUsdQuote?.symbol === "USDT" &&
    input.usdtUsdQuote.currency === "USD" &&
    /^\d+(?:\.\d+)?$/.test(input.usdtUsdQuote.price) &&
    positive(input.usdtUsdQuote.price) &&
    Number.isFinite(quoteAge) &&
    quoteAge <= 5 * 60_000
      ? input.usdtUsdQuote
      : {
          symbol: "USDT",
          currency: "USD",
          price: "1",
          quotedAt: new Date(input.observedAt),
        };
  const usdtUsdSource = input.usdtUsdQuote === usdtUsdQuote
    ? input.usdtUsdSource ?? "CoinGecko Tether/USD 参考价格"
    : "USDT/USD 固定兜底（1:1）";
  let total = "0";
  const holdings: AssetHolding[] = input.positions.map((position) => {
    const pair = livePairs.get(position.asset) ?? (() => {
      const matches = normalizedPairs.get(position.asset.toUpperCase()) ?? [];
      return matches.length === 1 ? matches[0] : undefined;
    })();
    const displayAsset = pair?.asset ?? position.asset;
    let price: string | null = null;
    let marketValue: string | null = null;
    let pricedAt = input.observedAt;
    let priceSource = "";
    const nativeAge = position.nativeValue
      ? Math.abs(Date.parse(input.observedAt) - Date.parse(position.nativeValue.pricedAt))
      : Number.POSITIVE_INFINITY;
    if (
      position.nativeValue &&
      position.nativeValue.currency === input.targetCurrency &&
      positive(position.nativeValue.amount) &&
      Number.isFinite(nativeAge) &&
      nativeAge <= 5 * 60_000
    ) {
      marketValue = position.nativeValue.amount;
      price = decimalDivide(position.nativeValue.amount, position.quantity);
      pricedAt = position.nativeValue.pricedAt;
      priceSource = position.nativeValue.source;
    } else if (
      position.nativeValue &&
      position.nativeValue.currency === "USDT" &&
      input.targetCurrency === "USD" &&
      positive(position.nativeValue.amount) &&
      Number.isFinite(nativeAge) &&
      nativeAge <= 5 * 60_000
    ) {
      marketValue = decimalMultiply(
        position.nativeValue.amount,
        usdtUsdQuote.price,
      );
      price = decimalDivide(marketValue, position.quantity);
      pricedAt = position.nativeValue.pricedAt;
      priceSource = `${position.nativeValue.source} × ${usdtUsdSource}`;
    } else if (
      displayAsset === "USDT" &&
      input.targetCurrency === "USDT"
    ) {
      price = "1";
      marketValue = position.quantity;
      priceSource = "Bitget 账户 USDT 计价单位";
    } else if (
      displayAsset === "USDT" &&
      input.targetCurrency === "USD"
    ) {
      price = usdtUsdQuote.price;
      marketValue = decimalMultiply(position.quantity, price);
      pricedAt = usdtUsdQuote.quotedAt.toISOString();
      priceSource = usdtUsdSource;
    } else {
      const ticker = pair ? tickerByInstrument.get(pair.symbol) : undefined;
      if (ticker) {
        price = input.targetCurrency === "USDT"
          ? ticker.price
          : decimalMultiply(ticker.price, usdtUsdQuote.price);
        if (price !== null) {
          marketValue = decimalMultiply(position.quantity, price);
          pricedAt = ticker.pricedAt;
          priceSource = input.targetCurrency === "USDT"
            ? `Bitget 现货 ${pair?.symbol}`
            : `Bitget 现货 ${pair?.symbol} × ${usdtUsdSource}`;
        }
      }
    }
    if (price === null || marketValue === null) {
      return {
        symbol: displayAsset,
        name: `${displayAsset} · ${positionScopeLabel(position)}`,
        sourceAsset: position.asset,
        sourceAccount: position.account,
        sourceProduct: position.sourceProduct,
        ...(position.providerPositionId
          ? { providerPositionId: position.providerPositionId }
          : {}),
        quantity: position.quantity,
        currency: input.targetCurrency,
        assetClass: "crypto",
        currentPrice: null,
        marketValue: null,
        sourceMarketValue: null,
        valuation: input.authoritativeTotal
          ? {
              status: "quote-unavailable",
              reason: `Bitget 平台总额已包含，但没有可靠的 ${displayAsset} ${input.targetCurrency} 持仓行情`,
            }
          : {
              status: "unvalued",
              reason: `Bitget 没有可靠的 ${displayAsset} ${input.targetCurrency} 估值`,
            },
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      };
    }
    total = decimalAdd(total, marketValue);
    return {
      symbol: displayAsset,
      name: `${displayAsset} · ${positionScopeLabel(position)}`,
      sourceAsset: position.asset,
      sourceAccount: position.account,
      sourceProduct: position.sourceProduct,
      ...(position.providerPositionId
        ? { providerPositionId: position.providerPositionId }
        : {}),
      quantity: position.quantity,
      currency: input.targetCurrency,
      assetClass: "crypto",
      currentPrice: { amount: price, currency: input.targetCurrency },
      marketValue,
      sourceMarketValue: { amount: marketValue, currency: input.targetCurrency },
      valuation: {
        status: "valued",
        priceSource,
        pricedAt,
      },
      costPrice: null,
      platformProfit: null,
      changePercent: null,
    };
  });
  holdings.sort(compareHoldingValue);
  return {
    total: input.authoritativeTotal ?? {
      amount: total,
      currency: input.targetCurrency,
    },
    holdings,
    exchangeRates: input.targetCurrency === "USDT"
      ? [{
          baseCurrency: "USDT",
          quoteCurrency: "USD",
          rate: usdtUsdQuote.price,
          source: usdtUsdSource,
          observedAt: usdtUsdQuote.quotedAt.toISOString(),
        }]
      : [],
    syncedAt: input.observedAt,
    ...(input.coverage === undefined ? {} : { coverage: input.coverage }),
  };
}

function preserveNewerPrices(
  previous: AssetSnapshot,
  candidate: AssetSnapshot,
): AssetSnapshot {
  const previousByPosition = new Map(
    previous.holdings.map((holding) => [
      [
        holding.sourceAccount ?? "default",
        holding.sourceProduct ?? "legacy",
        holding.providerPositionId ?? "aggregate",
        holding.sourceAsset ?? holding.symbol,
      ].join(":"),
      holding,
    ]),
  );
  const holdings = candidate.holdings.map((holding) => {
    const prior = previousByPosition.get(
      [
        holding.sourceAccount ?? "default",
        holding.sourceProduct ?? "legacy",
        holding.providerPositionId ?? "aggregate",
        holding.sourceAsset ?? holding.symbol,
      ].join(":"),
    );
    if (
      prior?.valuation.status === "valued" &&
      holding.valuation.status === "valued" &&
      Date.parse(prior.valuation.pricedAt) > Date.parse(holding.valuation.pricedAt)
    ) {
      if (prior.currentPrice === null) return holding;
      const marketValue = decimalMultiply(
        holding.quantity,
        prior.currentPrice.amount,
      );
      return {
        ...holding,
        currentPrice: prior.currentPrice,
        marketValue,
        sourceMarketValue: { amount: marketValue, currency: holding.currency },
        valuation: prior.valuation,
      };
    }
    return holding;
  });
  const total = holdings.reduce(
    (sum, holding) =>
      holding.sourceMarketValue
        ? decimalAdd(sum, holding.sourceMarketValue.amount)
        : sum,
    "0",
  );
  return {
    ...candidate,
    total: candidate.coverage?.status === "complete"
      ? candidate.total
      : { amount: total, currency: candidate.total.currency },
    holdings: holdings.sort(compareHoldingValue),
  };
}

function parseCredentials(value: string): StoredBitgetCredentials {
  let credentials: JsonRecord;
  try {
    credentials = record(JSON.parse(value), "Bitget 凭证");
  } catch {
    throw new Error("Bitget 只读凭证格式无效");
  }
  const accountMode = credentials.accountMode;
  if (accountMode !== "classic" && accountMode !== "uta") {
    throw new Error("Bitget 账户类型无效");
  }
  return {
    apiKey: text(credentials.apiKey, "apiKey"),
    apiSecret: text(credentials.apiSecret, "apiSecret"),
    passphrase: text(credentials.passphrase, "passphrase"),
    accountMode,
  };
}

class BitgetClient {
  private timeOffsetMs = 0;
  private lastEarnRequestAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly credentials: StoredBitgetCredentials,
    private readonly request: BitgetFetch,
    private readonly signal?: AbortSignal,
    private readonly runtime: BitgetRuntime = DEFAULT_RUNTIME,
  ) {}

  private async envelope(
    path: string,
    query: Record<string, string> = {},
    privateRequest = true,
    retryTimestamp = true,
    retryAttempt = 0,
  ): Promise<BitgetEnvelope> {
    const url = new URL(path, BITGET_ORIGIN);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    const headers = new Headers();
    if (privateRequest) {
      const timestamp = String(this.runtime.now() + this.timeOffsetMs);
      const requestPath = `${url.pathname}${url.search}`;
      const signature = createHmac("sha256", this.credentials.apiSecret)
        .update(`${timestamp}GET${requestPath}`)
        .digest("base64");
      headers.set("ACCESS-KEY", this.credentials.apiKey);
      headers.set("ACCESS-SIGN", signature);
      headers.set("ACCESS-TIMESTAMP", timestamp);
      headers.set("ACCESS-PASSPHRASE", this.credentials.passphrase);
      headers.set("locale", "en-US");
    }
    const response = await this.request(url, {
      method: "GET",
      headers,
      cache: "no-store",
      redirect: "error",
      signal: this.signal,
    });
    const body = await response.json().catch(() => null);
    const root =
      typeof body === "object" && body !== null && !Array.isArray(body)
        ? body as JsonRecord
        : null;
    const code = typeof root?.code === "string" ? root.code : null;
    if (
      (code === "40005" || code === "40008") &&
      privateRequest &&
      retryTimestamp
    ) {
      await this.syncTime();
      return this.envelope(path, query, true, false, retryAttempt);
    }
    const transient =
      response.status === 429 ||
      response.status >= 500 ||
      ["40725", "45001", "40808", "25000", "25001"].includes(code ?? "");
    if (!hasManagedAssetRetry() && transient && retryAttempt < this.runtime.retryDelaysMs.length) {
      await this.runtime.sleep(
        this.runtime.retryDelaysMs[retryAttempt],
        this.signal,
      );
      return this.envelope(
        path,
        query,
        privateRequest,
        retryTimestamp,
        retryAttempt + 1,
      );
    }
    if (!response.ok || code !== "00000" || root === null) {
      const errorCode = code ?? `HTTP ${response.status}`;
      const message = typeof root?.msg === "string" && root.msg
        ? `：${root.msg}`
        : "";
      throw assetResponseError(`Bitget 读取失败（${errorCode}${message}）`, response, code);
    }
    return {
      data: root.data,
      requestTime: responseTime(root.requestTime),
    };
  }

  private async data(
    path: string,
    query: Record<string, string> = {},
    privateRequest = true,
  ): Promise<unknown> {
    return (await this.envelope(path, query, privateRequest)).data;
  }

  async syncTime(): Promise<void> {
    const row = record(
      await this.data("/api/v2/public/time", {}, false),
      "Bitget public/time data",
    );
    const timestamp = text(row.serverTime, "serverTime");
    if (!/^\d+$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp))) {
      throw new Error("Bitget public time 格式无效");
    }
    this.timeOffsetMs = Number(timestamp) - this.runtime.now();
  }

  accountInfo(mode: BitgetAccountMode) {
    return this.data(
      mode === "classic"
        ? "/api/v2/spot/account/info"
        : "/api/v3/account/info",
    );
  }
  accountAssets(mode: BitgetAccountMode) {
    return this.envelope(
      mode === "classic"
        ? "/api/v2/spot/account/assets"
        : "/api/v3/account/assets",
      mode === "classic" ? { assetType: "hold_only" } : {},
    );
  }
  funding(mode: BitgetAccountMode) {
    return this.envelope(
      mode === "classic"
        ? "/api/v2/account/funding-assets"
        : "/api/v3/account/funding-assets",
    );
  }
  botAssets() {
    return this.envelope(
      "/api/v2/account/bot-assets",
      { accountType: "futures" },
    );
  }
  allAccountBalance() {
    return this.data("/api/v2/account/all-account-balance");
  }
  private async waitForEarnSlot(
    intervalMs = this.runtime.earnRequestIntervalMs,
  ): Promise<void> {
    const wait = this.lastEarnRequestAt + intervalMs -
      this.runtime.now();
    if (wait > 0) await this.runtime.sleep(wait, this.signal);
    this.lastEarnRequestAt = this.runtime.now();
  }
  async earnOverview() {
    await this.waitForEarnSlot();
    return this.data("/api/v2/earn/account/assets");
  }
  async cashPlusAccount() {
    await this.waitForEarnSlot();
    return this.data("/api/v2/earn/savings/account");
  }
  async savings(
    periodType: "flexible" | "fixed",
    startTime: string,
    endTime: string,
    idLessThan?: string,
  ) {
    await this.waitForEarnSlot();
    return this.data("/api/v2/earn/savings/assets", {
      periodType,
      limit: "100",
      startTime,
      endTime,
      ...(idLessThan ? { idLessThan } : {}),
    });
  }
  async sharkfinAccount() {
    await this.waitForEarnSlot();
    return this.data("/api/v2/earn/sharkfin/account");
  }
  async eliteAssets() {
    await this.waitForEarnSlot(
      Math.max(this.runtime.earnRequestIntervalMs, 200),
    );
    return this.data("/api/v2/earn/elite/assets");
  }
  utaPositions(category: string) {
    return this.data("/api/v3/position/current-position", { category });
  }
  utaOrders(category: string, cursor?: string) {
    return this.data("/api/v3/trade/unfilled-orders", {
      category,
      limit: "100",
      ...(cursor ? { cursor } : {}),
    });
  }
  instruments() {
    return this.data("/api/v2/spot/public/symbols", {}, false);
  }
  tickers() {
    return this.data("/api/v2/spot/market/tickers", {}, false);
  }
}

async function collectSavingsPages(
  client: BitgetClient,
  periodType: "flexible" | "fixed",
  registeredAt: string,
  observedAt: string,
): Promise<unknown[]> {
  const pages: unknown[] = [];
  const earliest = Number(registeredAt);
  const latest = Date.parse(observedAt);
  if (!Number.isSafeInteger(earliest) || earliest > latest) {
    throw new Error("Bitget Earn 注册时间范围无效");
  }
  const windowMs = 90 * 24 * 60 * 60_000;
  let windowEnd = latest;
  let requestCount = 0;
  while (windowEnd >= earliest) {
    const windowStart = Math.max(earliest, windowEnd - windowMs + 1);
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (;;) {
      requestCount += 1;
      if (requestCount > 1000) {
        throw new Error(`Bitget ${periodType} Earn 分页超过安全上限`);
      }
      const raw = await client.savings(
        periodType,
        String(windowStart),
        String(windowEnd),
        cursor,
      );
      const data = record(raw, `Bitget ${periodType} Earn data`);
      const rows = list(data.resultList, `Bitget ${periodType} Earn resultList`);
      pages.push(data);
      if (typeof data.endId !== "string") {
        throw new Error(`Bitget ${periodType} Earn 响应缺少 endId`);
      }
      const endId = data.endId;
      if (rows.length === 0 || endId === "") break;
      if (cursors.has(endId)) {
        throw new Error(`Bitget ${periodType} Earn 分页游标重复`);
      }
      cursors.add(endId);
      cursor = endId;
    }
    windowEnd = windowStart - 1;
  }
  return pages;
}

async function validateUtaCashOnly(client: BitgetClient): Promise<void> {
  for (const category of ["USDT-FUTURES", "USDC-FUTURES", "COIN-FUTURES"]) {
    const data = record(
      await client.utaPositions(category),
      `Bitget UTA ${category} positions`,
    );
    for (const position of list(data.list, `Bitget UTA ${category} position list`)) {
      if (decimalCompare(decimal(position.total, "total"), "0") !== 0) {
        throw new Error(`Bitget UTA ${category} 存在合约持仓`);
      }
    }
  }
  for (const category of [
    "MARGIN",
    "USDT-FUTURES",
    "USDC-FUTURES",
    "COIN-FUTURES",
  ]) {
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      const data = record(
        await client.utaOrders(category, cursor),
        `Bitget UTA ${category} open orders`,
      );
      if (list(data.list, `Bitget UTA ${category} order list`).length > 0) {
        throw new Error(`Bitget UTA ${category} 存在未成交挂单`);
      }
      if (typeof data.cursor !== "string") {
        throw new Error("Bitget UTA 挂单响应缺少 cursor");
      }
      const next = data.cursor;
      if (next === "") break;
      if (cursors.has(next)) throw new Error("Bitget UTA 挂单分页游标重复");
      cursors.add(next);
      cursor = next;
      if (page === 99) throw new Error("Bitget UTA 挂单分页超过安全上限");
    }
  }
}

async function readFullSnapshot(input: {
  client: BitgetClient;
  prices: Prices;
  observedAt: string;
  accountMode: BitgetAccountMode;
}): Promise<{
  identity: BitgetIdentity;
  snapshot: AssetSnapshot;
}> {
  await input.client.syncTime();
  const accountInfo = await input.client.accountInfo(input.accountMode);
  const identity = input.accountMode === "classic"
    ? validateClassicAccountInfo(accountInfo)
    : validateUtaAccountInfo(accountInfo);
  if (input.accountMode === "uta") await validateUtaCashOnly(input.client);
  const accountAssetsObservation = await input.client.accountAssets(input.accountMode);
  const fundingObservation = await input.client.funding(input.accountMode);
  const botObservation = input.accountMode === "classic"
    ? await input.client.botAssets()
    : null;
  const allAccountBalance = input.accountMode === "classic"
    ? await input.client.allAccountBalance()
    : null;
  const accountAssets = accountAssetsObservation.data;
  const funding = fundingObservation.data;
  const savingsOverview = await input.client.earnOverview();
  const cashPlusAccount = await input.client.cashPlusAccount();
  const flexiblePages = await collectSavingsPages(
    input.client,
    "flexible",
    identity.registeredAt,
    input.observedAt,
  );
  const fixedPages = await collectSavingsPages(
    input.client,
    "fixed",
    identity.registeredAt,
    input.observedAt,
  );
  const sharkfinAccount = await input.client.sharkfinAccount();
  const eliteAssets = await input.client.eliteAssets();
  const [instruments, tickers] = await Promise.all([
    input.client.instruments(),
    input.client.tickers(),
  ]);
  const usdtUsd = await readUsdtUsdQuote({
    instruments,
    tickers,
    observedAt: input.observedAt,
    prices: input.prices,
  });
  const positions = input.accountMode === "classic"
    ? extractClassicPositions({
        spot: accountAssets,
        funding,
        botFutures: botObservation?.data ?? [],
        savingsOverview,
        cashPlusAccount,
        flexiblePages,
        fixedPages,
        sharkfinAccount,
        eliteAssets,
        observedAt: input.observedAt,
        fundingObservedAt: fundingObservation.requestTime,
        botObservedAt: botObservation?.requestTime,
      })
    : extractUtaPositions({
        assets: accountAssets,
        funding,
        savingsOverview,
        cashPlusAccount,
        flexiblePages,
        fixedPages,
        sharkfinAccount,
        eliteAssets,
        observedAt: input.observedAt,
        assetsObservedAt: accountAssetsObservation.requestTime,
      });
  const provisionalCoverage = bitgetCoverage(input.accountMode, positions, {
    status: "complete",
    unexplainedValue: null,
    excludedPositiveAccounts: [],
  });
  const provisionalSnapshot = valuePositions({
      positions,
      instruments,
      tickers,
      observedAt: input.observedAt,
      usdtUsdQuote: usdtUsd.quote,
      usdtUsdSource: usdtUsd.source,
      targetCurrency: input.accountMode === "uta" ? "USD" : "USDT",
      coverage: provisionalCoverage,
      ...(input.accountMode === "classic"
        ? {
            authoritativeTotal: {
              amount: "0",
              currency: "USDT",
            },
          }
        : {}),
    });
  if (input.accountMode === "classic") {
    const accountCoverage = classicAccountCoverage({
      overview: allAccountBalance,
      snapshot: provisionalSnapshot,
      positions,
    });
    provisionalSnapshot.total = accountCoverage.total;
    provisionalSnapshot.coverage = accountCoverage.coverage;
  }
  return {
    identity,
    snapshot: provisionalSnapshot,
  };
}

export class ProductionBitgetReadOnly implements BitgetReadOnly {
  constructor(
    private readonly prices: Prices,
    private readonly request: BitgetFetch = globalThis.fetch,
    private readonly runtime: BitgetRuntime = DEFAULT_RUNTIME,
  ) {}

  preview(input: {
    apiKey: string;
    apiSecret: string;
    passphrase: string;
    accountMode: BitgetAccountMode;
    observedAt: string;
  }): Promise<BitgetAuthorizationResult> {
    if (
      input.apiKey.trim().length < 8 ||
      input.apiSecret.trim().length < 8 ||
      input.passphrase.trim().length < 4
    ) {
      return Promise.reject(new Error("Bitget API Key、Secret 或 Passphrase 格式无效"));
    }
    return this.authorize({
      apiKey: input.apiKey.trim(),
      apiSecret: input.apiSecret.trim(),
      passphrase: input.passphrase.trim(),
      accountMode: input.accountMode,
    }, input.observedAt);
  }

  revalidate(input: {
    credentials: string;
    observedAt: string;
  }): Promise<BitgetAuthorizationResult> {
    return this.authorize(parseCredentials(input.credentials), input.observedAt);
  }

  private async authorize(
    credentials: StoredBitgetCredentials,
    observedAt: string,
  ): Promise<BitgetAuthorizationResult> {
    const result = await readFullSnapshot({
      client: new BitgetClient(credentials, this.request, undefined, this.runtime),
      prices: this.prices,
      observedAt,
      accountMode: credentials.accountMode,
    });
    return {
      credentials: JSON.stringify(credentials),
      accountMode: result.identity.accountMode,
      permissions: result.identity.permissions,
      account: {
        id: `bitget:${result.identity.userId}`,
        label: `Bitget 账户 · UID ${result.identity.userId}`,
      },
      scopeFingerprint: [
        result.identity.userId,
        result.identity.parentId,
        result.identity.accountMode,
        ...result.identity.scope,
      ].join(":"),
      snapshot: result.snapshot,
    };
  }
}

export class ProductionBitgetSourceRefresher implements AssetSourceRefresher {
  constructor(
    private readonly prices: Prices,
    private readonly request: BitgetFetch = globalThis.fetch,
    private readonly runtime: BitgetRuntime = DEFAULT_RUNTIME,
  ) {}

  async refresh({
    source,
    credentials,
    mode,
    attemptedAt,
    signal,
  }: Parameters<AssetSourceRefresher["refresh"]>[0]): Promise<AssetSourceRefreshResult> {
    if (source.kind !== "bitget") {
      throw new Error(`Bitget 刷新器不支持来源类型：${source.kind}`);
    }
    const stored = parseCredentials(credentials);
    const client = new BitgetClient(stored, this.request, signal, this.runtime);
    if (mode === "prices") {
      const [instruments, tickers] = await Promise.all([
        client.instruments(),
        client.tickers(),
      ]);
      const usdtUsd = await readUsdtUsdQuote({
        instruments,
        tickers,
        observedAt: attemptedAt,
        prices: this.prices,
      });
      const candidate = valuePositions({
          positions: source.snapshot.holdings.map((holding) => {
            if (!holding.sourceAsset || !holding.sourceAccount) {
              throw new Error("Bitget 旧快照缺少来源资产分区");
            }
            return {
              asset: holding.sourceAsset,
              account: holding.sourceAccount,
              quantity: holding.quantity,
              sourceProduct: holding.sourceProduct ?? "legacy",
              ...(holding.providerPositionId
                ? { providerPositionId: holding.providerPositionId }
                : {}),
            };
          }),
          instruments,
          tickers,
          observedAt: attemptedAt,
          usdtUsdQuote: usdtUsd.quote,
          usdtUsdSource: usdtUsd.source,
          targetCurrency: source.snapshot.total.currency === "USD" ? "USD" : "USDT",
          coverage: source.snapshot.coverage,
          ...(source.snapshot.coverage?.status === "complete"
            ? { authoritativeTotal: source.snapshot.total }
            : {}),
        });
      return {
        snapshot: preserveNewerPrices(source.snapshot, candidate),
      };
    }
    const candidate = (await readFullSnapshot({
        client,
        prices: this.prices,
        observedAt: attemptedAt,
        accountMode: stored.accountMode,
      })).snapshot;
    return {
      snapshot: preserveNewerPrices(source.snapshot, candidate),
    };
  }
}
