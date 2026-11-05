import { decimalAdd } from "@/domain/decimal";
import { createJsonDecoder, type JsonRecord } from "../../sdk/json";
import { integer } from "./binance-json";
import { positiveDecimal } from "../../sdk/value-guards";
import type { AssetHolding, AssetSnapshot } from "@/server/ports";

const { record, list, text, nonNegativeDecimal: decimal, identifier } = createJsonDecoder("Binance");
const positive = positiveDecimal;

export interface BinancePosition {
  asset: string;
  quantity: string;
  account: NonNullable<AssetHolding["sourceAccount"]>;
  product: string;
  providerPositionId: string | null;
  economicAssetKey: string;
  state: NonNullable<AssetHolding["positionState"]>;
  providerState: string | null;
}

function addPosition(
  positions: Map<string, BinancePosition>,
  asset: string,
  quantity: string,
  account: BinancePosition["account"],
  product: string,
  providerPositionId: string | null = null,
  options: {
    state?: BinancePosition["state"];
    providerState?: string;
    economicAssetKey?: string;
  } = {},
): void {
  if (!positive(quantity)) return;
  const key = providerPositionId === null
    ? `${account}:${asset}`
    : `${product}:${providerPositionId}`;
  const previous = positions.get(key);
  positions.set(key, {
    asset,
    account,
    product,
    providerPositionId,
    economicAssetKey: options.economicAssetKey ?? `binance:${account}:${asset}`,
    state: options.state ?? "active",
    providerState: options.providerState ?? null,
    quantity: previous ? decimalAdd(previous.quantity, quantity) : quantity,
  });
}

function rowsFromPositionPages(
  pages: unknown[],
  context: string,
  identity: (row: JsonRecord) => string,
): JsonRecord[] {
  if (pages.length === 0) throw new Error(`${context}分页为空`);
  const output: JsonRecord[] = [];
  const identities = new Set<string>();
  let expectedTotal: number | null = null;
  for (const raw of pages) {
    const page = record(raw, `${context}分页`);
    const total = integer(page.total, "total");
    if (expectedTotal === null) expectedTotal = total;
    if (total !== expectedTotal) throw new Error(`${context}分页 total 发生变化`);
    const rows = list(page.rows ?? page.list, `${context} rows`);
    if (rows.length === 0 && output.length < total) {
      throw new Error(`${context}分页提前结束`);
    }
    for (const row of rows) {
      const key = identity(row);
      if (identities.has(key)) throw new Error(`${context}分页出现重复仓位`);
      identities.add(key);
      output.push(row);
    }
  }
  if (output.length !== expectedTotal) throw new Error(`${context}分页不完整`);
  return output;
}

function rowsFromEarnPages(
  pages: unknown[],
  kind: "flexible" | "locked",
): JsonRecord[] {
  if (pages.length === 0) throw new Error(`Binance ${kind} Earn 分页为空`);
  const output: JsonRecord[] = [];
  const identities = new Set<string>();
  let expectedTotal: number | null = null;
  for (const [index, raw] of pages.entries()) {
    const page = record(raw, `Binance ${kind} Earn 分页`);
    const total = integer(page.total, "total");
    if (expectedTotal === null) expectedTotal = total;
    if (total !== expectedTotal) {
      throw new Error(`Binance ${kind} Earn 分页 total 发生变化`);
    }
    const rows = list(page.rows, `Binance ${kind} Earn rows`);
    if (rows.length === 0 && output.length < total) {
      throw new Error(`Binance ${kind} Earn 分页提前结束`);
    }
    for (const row of rows) {
      const identity = kind === "flexible"
        ? `${text(row.asset, "asset")}:${text(row.productId, "productId")}`
        : identifier(row.positionId, "positionId");
      if (identities.has(identity)) {
        throw new Error(`Binance ${kind} Earn 分页出现重复仓位`);
      }
      identities.add(identity);
      output.push(row);
    }
    if (output.length >= total) {
      if (output.length !== total) {
        throw new Error(`Binance ${kind} Earn 分页数量超过 total`);
      }
      if (index !== pages.length - 1) {
        throw new Error(`Binance ${kind} Earn 分页包含多余页面`);
      }
      return output;
    }
  }
  throw new Error(`Binance ${kind} Earn 分页不完整`);
}

export function extractPositions(input: {
  spotAccount: unknown;
  fundingAssets: unknown;
  flexiblePages: unknown[];
  lockedPages: unknown[];
  exchangeInfo: unknown;
}): BinancePosition[] {
  const positions = new Map<string, BinancePosition>();
  const flexibleRows = rowsFromEarnPages(input.flexiblePages, "flexible");
  const flexibleAssets = new Set(
    flexibleRows.map((item) => text(item.asset, "asset")),
  );
  const listedSpotAssets = new Set(
    list(record(input.exchangeInfo, "Binance exchangeInfo 响应").symbols, "Binance exchangeInfo symbols")
      .flatMap((item) =>
        item.status === "TRADING" &&
        item.isSpotTradingAllowed !== false &&
        typeof item.baseAsset === "string"
          ? [item.baseAsset]
          : []
      ),
  );
  const spot = record(input.spotAccount, "Binance 现货账户响应");
  for (const item of list(spot.balances, "Binance 现货 balances")) {
    const asset = text(item.asset, "asset");
    const quantity = decimalAdd(
      decimal(item.free, "free"),
      decimal(item.locked, "locked"),
    );
    const underlyingAsset = asset.startsWith("LD") ? asset.slice(2) : null;
    if (
      underlyingAsset &&
      flexibleAssets.has(underlyingAsset) &&
      !listedSpotAssets.has(asset)
    ) {
      continue;
    }
    addPosition(
      positions,
      asset,
      quantity,
      "spot",
      "spot",
    );
  }
  for (const item of list(input.fundingAssets, "Binance Funding 响应")) {
    addPosition(
      positions,
      text(item.asset, "asset"),
      decimalAdd(
        decimal(item.free, "free"),
        decimal(item.locked, "locked"),
        decimal(item.freeze, "freeze"),
        decimal(item.withdrawing, "withdrawing"),
      ),
      "funding",
      "funding",
    );
  }
  for (const item of flexibleRows) {
    const asset = text(item.asset, "asset");
    const productId = text(item.productId, "productId");
    addPosition(
      positions,
      asset,
      decimal(item.totalAmount, "totalAmount"),
      "earn-flexible",
      "simple-earn-flexible",
      `${asset}:${productId}`,
    );
  }
  for (const item of rowsFromEarnPages(input.lockedPages, "locked")) {
    if (item.status !== "HOLDING") {
      throw new Error("Binance Locked Earn 返回非持有中仓位");
    }
    addPosition(
      positions,
      text(item.asset, "asset"),
      decimal(item.amount, "amount"),
      "earn-locked",
      "simple-earn-locked",
      identifier(item.positionId, "positionId"),
    );
  }
  return [...positions.values()];
}

export interface BinanceInvestmentInput {
  dualPages: unknown[];
  discountPages: unknown[];
  bfusdAccount: unknown;
  rwusdAccount: unknown;
  ethStakingAccount: unknown;
  solStakingAccount: unknown;
  onchainAccount: unknown;
  onchainPages: unknown[];
  softStaking: unknown;
  failures?: Record<string, string>;
}

function productCoverage(
  product: string,
  capability: NonNullable<AssetSnapshot["coverage"]>["products"][number]["capability"],
  message: string | null = null,
) {
  return { product, capability, freshness: "current" as const, message };
}

export function addInvestmentPositions(
  baseline: BinancePosition[],
  input: BinanceInvestmentInput,
): {
  positions: BinancePosition[];
  products: NonNullable<AssetSnapshot["coverage"]>["products"];
  incomplete: boolean;
} {
  const positions = new Map(
    baseline.map((position) => [
      `${position.product}:${position.providerPositionId ?? position.economicAssetKey}`,
      position,
    ]),
  );
  const products = baselineBinanceCoverage().products;
  let incomplete = false;

  let dualMessage: string | null = null;
  for (const row of rowsFromPositionPages(
    input.dualPages,
    "Binance Dual Investment",
    (item) => identifier(item.id ?? item.orderId, "id"),
  )) {
    const status = text(row.purchaseStatus ?? row.status, "purchaseStatus");
    const id = identifier(row.id ?? row.orderId, "id");
    if (["SETTLED", "PURCHASE_FAIL", "REFUND_SUCCESS"].includes(status)) continue;
    if (!["PENDING", "PURCHASE_SUCCESS", "SETTLING", "REFUNDING"].includes(status)) {
      incomplete = true;
      dualMessage = `发现未知状态 ${status}，未把该仓位假定为当前资产`;
      continue;
    }
    addPosition(
      positions,
      text(row.investCoin ?? row.asset, "investCoin"),
      decimal(row.subscriptionAmount ?? row.amount, "subscriptionAmount"),
      "earn",
      "dual-investment",
      id,
      {
        state: status === "SETTLING"
          ? "settling"
          : status === "REFUNDING"
            ? "redeeming"
            : "active",
        providerState: status,
      },
    );
  }
  products.push(productCoverage(
    "dual-investment",
    dualMessage === null ? "detailed" : "unknown",
    dualMessage,
  ));

  let discountMessage: string | null = null;
  for (const row of rowsFromPositionPages(
    input.discountPages,
    "Binance Discount Buy",
    (item) => identifier(item.positionId ?? item.orderId ?? item.id, "positionId"),
  )) {
    const status = text(row.status ?? row.purchaseStatus, "status");
    const id = identifier(row.positionId ?? row.orderId ?? row.id, "positionId");
    if (["SETTLED", "PURCHASE_FAIL", "REFUND_SUCCESS"].includes(status)) continue;
    if (!["PENDING", "PURCHASE_SUCCESS", "SETTLING", "REFUNDING"].includes(status)) {
      incomplete = true;
      discountMessage = `发现未知状态 ${status}，未把该仓位假定为当前资产`;
      continue;
    }
    addPosition(
      positions,
      text(row.subscriptionAsset ?? row.investCoin ?? row.asset, "subscriptionAsset"),
      decimal(row.subscriptionAmount ?? row.amount, "subscriptionAmount"),
      "earn",
      "discount-buy",
      id,
      {
        state: status === "SETTLING"
          ? "settling"
          : status === "REFUNDING"
            ? "redeeming"
            : "active",
        providerState: status,
      },
    );
  }
  products.push(productCoverage(
    "discount-buy",
    discountMessage === null ? "detailed" : "unknown",
    discountMessage,
  ));

  const bfusd = record(input.bfusdAccount, "Binance BFUSD 账户响应");
  addPosition(
    positions,
    "BFUSD",
    decimal(bfusd.bfusdAmount, "bfusdAmount"),
    "earn",
    "bfusd",
    "account",
  );
  products.push(productCoverage("bfusd", "detailed"));

  const rwusd = record(input.rwusdAccount, "Binance RWUSD 账户响应");
  addPosition(
    positions,
    "RWUSD",
    decimal(rwusd.rwusdAmount, "rwusdAmount"),
    "earn",
    "rwusd",
    "account",
  );
  products.push(productCoverage("rwusd", "detailed"));

  const eth = record(input.ethStakingAccount, "Binance ETH Staking 账户响应");
  const ethHolding = decimal(eth.holdingInETH, "holdingInETH");
  const ethWrappers = [...positions.values()].filter(
    (position) => ["BETH", "WBETH"].includes(position.asset),
  );
  if (ethWrappers.length > 0) {
    for (const wrapper of ethWrappers) wrapper.economicAssetKey = "binance:staking:ETH";
  } else {
    addPosition(
      positions,
      "ETH",
      ethHolding,
      "staking",
      "eth-staking",
      "account",
      { economicAssetKey: "binance:staking:ETH" },
    );
  }
  products.push(productCoverage(
    "eth-staking",
    "detailed",
    ethWrappers.length > 0 ? "Spot 包装代币作为本金主源，账户 ETH 等值仅用于对账" : null,
  ));

  const sol = record(input.solStakingAccount, "Binance SOL Staking 账户响应");
  const solHolding = decimal(sol.holdingInSOL, "holdingInSOL");
  const solWrappers = [...positions.values()].filter(
    (position) => position.asset === "BNSOL",
  );
  if (solWrappers.length > 0) {
    for (const wrapper of solWrappers) wrapper.economicAssetKey = "binance:staking:SOL";
  } else {
    addPosition(
      positions,
      "SOL",
      solHolding,
      "staking",
      "sol-staking",
      "account",
      { economicAssetKey: "binance:staking:SOL" },
    );
  }
  products.push(productCoverage(
    "sol-staking",
    "detailed",
    solWrappers.length > 0 ? "Spot BNSOL 作为本金主源，账户 SOL 等值仅用于对账" : null,
  ));

  let onchainMessage: string | null = null;
  for (const row of rowsFromPositionPages(
    input.onchainPages,
    "Binance On-chain Yields Locked",
    (item) => identifier(item.positionId ?? item.id, "positionId"),
  )) {
    const status = text(row.status, "status");
    const id = identifier(row.positionId ?? row.id, "positionId");
    if (["REDEEMED", "SETTLED"].includes(status)) continue;
    if (!["HOLDING", "REDEEMING"].includes(status)) {
      incomplete = true;
      onchainMessage = `发现未知状态 ${status}，未把该仓位假定为当前资产`;
      continue;
    }
    addPosition(
      positions,
      text(row.asset, "asset"),
      decimal(row.amount, "amount"),
      "earn",
      "onchain-yields-locked",
      id,
      {
        state: status === "REDEEMING" ? "redeeming" : "active",
        providerState: status,
      },
    );
  }
  const onchainAccount = record(input.onchainAccount, "Binance On-chain Yields 账户响应");
  const flexibleAmount = typeof onchainAccount.totalFlexibleAmountInUSDT === "string"
    ? decimal(onchainAccount.totalFlexibleAmountInUSDT, "totalFlexibleAmountInUSDT")
    : typeof onchainAccount.flexibleAmount === "string"
      ? decimal(onchainAccount.flexibleAmount, "flexibleAmount")
      : "0";
  if (positive(flexibleAmount)) {
    incomplete = true;
    onchainMessage = "账户存在无法由公开逐仓接口展开的 Flexible 余额";
  }
  products.push(productCoverage(
    "onchain-yields",
    onchainMessage === null ? "detailed" : "aggregate-only",
    onchainMessage,
  ));

  if (!Array.isArray(input.softStaking)) {
    record(input.softStaking, "Binance Soft Staking 响应");
  }
  products.push(productCoverage(
    "soft-staking",
    "indirect",
    "本金复用 Spot/Funding 等钱包，仅使用当前列表作为覆盖证据",
  ));
  products.push(
    productCoverage(
      "dual-investment-rfq",
      "unsupported",
      "公开 API 没有专用当前仓位合同，依赖 Earn 钱包守恒发现残差",
    ),
    productCoverage(
      "smart-arbitrage",
      "indirect",
      "公开 API 没有专用明细，监测 Earn 与 Trading Bots 钱包残差",
    ),
    productCoverage("bnb-vault", "indirect", "复用底层 BNB/Simple Earn，不复制本金"),
    productCoverage("launchpool", "indirect", "复用底层资产，奖励到账后由钱包计一次"),
    productCoverage("megadrop", "indirect", "资格与积分不作为当前资产"),
  );

  for (const [product, message] of Object.entries(input.failures ?? {})) {
    const coverage = products.find((item) => item.product === product);
    if (coverage) {
      coverage.capability = "unknown";
      coverage.message = message;
      incomplete = true;
    }
  }

  return { positions: [...positions.values()], products, incomplete };
}

export function baselineBinanceCoverage(): NonNullable<AssetSnapshot["coverage"]> {
  return {
    status: "unknown",
    products: [
      "spot",
      "funding",
      "simple-earn-flexible",
      "simple-earn-locked",
    ].map((product) => ({
      product,
      capability: "detailed" as const,
      freshness: "current" as const,
      message: null,
    })),
    unexplainedValue: null,
    excludedPositiveAccounts: [],
  };
}
