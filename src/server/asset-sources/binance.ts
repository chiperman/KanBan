import {
  createHash,
  createHmac,
} from "node:crypto";

import {
  decimalAdd,
  decimalCompare,
  decimalDivide,
  decimalSubtract,
  decimalMultiply,
  decimalToFixed,
} from "@/domain/decimal";
import {
  createJsonDecoder,
  type JsonRecord,
} from "@/server/asset-sources/json";
import type {
  AssetHolding,
  AssetPermission,
  AssetSnapshot,
  AssetSourceRefreshResult,
  AssetSourceRefresher,
  BinanceAuthorizationResult,
  BinanceReadOnly,
  ExternalServiceConfiguration,
  PriceQuote,
  Prices,
} from "@/server/ports";
import { assetResponseError } from "@/server/asset-sync-diagnostics";
import { positiveDecimal } from "@/server/asset-sources/value-guards";

type BinanceFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const BINANCE_ORIGIN = "https://api.binance.com";
const WRITABLE_PERMISSION_FIELDS = [
  "enableSpotAndMarginTrading",
  "enableMargin",
  "enableFutures",
  "enablePortfolioMarginTrading",
  "enableVanillaOptions",
  "enableFixApiTrade",
  "enableWithdrawals",
  "enableInternalTransfer",
  "permitsUniversalTransfer",
] as const;
const REQUIRED_PERMISSION_FIELDS = [
  "enableReading",
  ...WRITABLE_PERMISSION_FIELDS,
] as const;
const READ_ONLY_PERMISSIONS: AssetPermission[] = [
  "market-data",
  "account",
  "positions",
];
const {
  record,
  list,
  text,
  nonNegativeDecimal: decimal,
  identifier,
} = createJsonDecoder("Binance");

const positive = positiveDecimal;

function integer(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`Binance 响应中的 ${field} 不是有效整数`);
  }
  return Number(value);
}

function scopeLabel(scope: AssetHolding["sourceAccount"]): string {
  switch (scope) {
    case "spot":
      return "现货";
    case "funding":
      return "资金";
    case "earn-flexible":
      return "活期 Earn";
    case "earn-locked":
      return "定期 Earn";
    case "earn":
      return "投资产品";
    case "staking":
      return "质押";
    default:
      return "Binance";
  }
}

export function validateBinanceReadOnlyPermissions(
  value: unknown,
): AssetPermission[] {
  const permissions = record(value, "Binance 权限响应");
  for (const field of REQUIRED_PERMISSION_FIELDS) {
    if (typeof permissions[field] !== "boolean") {
      throw new Error(`Binance 无法证明只读权限：缺少 ${field}`);
    }
  }
  if (permissions.enableReading !== true) {
    throw new Error("Binance API Key 未启用读取权限");
  }
  const enabled = WRITABLE_PERMISSION_FIELDS.filter(
    (field) => permissions[field] === true,
  );
  const unknownEnabled = Object.entries(permissions).flatMap(([field, enabled]) =>
    enabled === true &&
    !REQUIRED_PERMISSION_FIELDS.includes(
      field as (typeof REQUIRED_PERMISSION_FIELDS)[number],
    ) &&
    (/^(?:enable|permit)/i.test(field) || /^(?:canTrade|canWithdraw)$/i.test(field)) &&
    field !== "enableFixReadOnly"
      ? [field]
      : [],
  );
  if (enabled.length > 0 || unknownEnabled.length > 0) {
    throw new Error(
      `检测到 Binance 交易或资产写权限，已拒绝连接（${[
        ...enabled,
        ...unknownEnabled,
      ].join(", ")}）`,
    );
  }
  return [...READ_ONLY_PERMISSIONS];
}

interface BinancePosition {
  asset: string;
  quantity: string;
  account: NonNullable<AssetHolding["sourceAccount"]>;
  product: string;
  providerPositionId: string | null;
  economicAssetKey: string;
  state: NonNullable<AssetHolding["positionState"]>;
  providerState: string | null;
}

interface BinanceEquityQuote {
  symbol: string;
  bidPrice: string;
  askPrice: string;
}

interface BinanceEquityOrder {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: string;
  filledTotal: string;
  fee: string;
  updatedAt: number;
}

interface BinanceSpotTrade {
  id: number;
  symbol: string;
  price: string;
  quantity: string;
  quoteQuantity: string;
  commission: string;
  commissionAsset: string;
  isBuyer: boolean;
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

function extractPositions(input: {
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

interface BinanceInvestmentInput {
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

function addInvestmentPositions(
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

function reconcileWallet(input: {
  snapshot: AssetSnapshot;
  walletBalances: unknown;
  tickers: unknown;
  products: NonNullable<AssetSnapshot["coverage"]>["products"];
  incomplete: boolean;
}): AssetSnapshot {
  const rows = list(input.walletBalances, "Binance Wallet Balance 响应");
  const btcPrice = tickerPrices(
    input.tickers,
    new Set(["BTCUSDT"]),
  ).get("BTCUSDT") ?? null;
  let includedBtc = "0";
  const excludedPositiveAccounts: string[] = [];
  for (const row of rows) {
    const name = text(row.walletName, "walletName");
    const balance = decimal(row.balance, "balance");
    if (["Spot", "Funding", "Earn"].includes(name)) {
      includedBtc = decimalAdd(includedBtc, balance);
    } else if (positive(balance)) {
      excludedPositiveAccounts.push(name);
    }
  }
  if (btcPrice === null) {
    return {
      ...input.snapshot,
      coverage: {
        status: "partial",
        totalIsAuthoritative: false,
        products: input.products,
        unexplainedValue: null,
        excludedPositiveAccounts,
      },
    };
  }
  const walletValue = decimalAdd(
    decimalToFixed(decimalMultiply(includedBtc, btcPrice), 8),
  );
  const difference = decimalSubtract(walletValue, input.snapshot.total.amount);
  const absoluteDifference = decimalCompare(difference, "0") < 0
    ? decimalSubtract("0", difference)
    : difference;
  const proportionalTolerance = decimalMultiply(walletValue, "0.001");
  const tolerance = decimalCompare(proportionalTolerance, "1") < 0
    ? "1"
    : proportionalTolerance;
  const material = decimalCompare(absoluteDifference, tolerance) > 0;
  const unexplained = material
    ? decimalAdd(decimalToFixed(absoluteDifference, 2))
    : null;
  return {
    ...input.snapshot,
    total: {
      amount: walletValue,
      currency: input.snapshot.total.currency,
    },
    coverage: {
      status:
        input.incomplete || material || excludedPositiveAccounts.length > 0
          ? "partial"
          : "complete",
      totalIsAuthoritative: excludedPositiveAccounts.length === 0,
      products: input.products,
      unexplainedValue:
        unexplained === null
          ? null
          : { amount: unexplained, currency: input.snapshot.total.currency },
      excludedPositiveAccounts,
    },
  };
}

function eligibleUsdtSymbols(exchangeInfo: unknown): Set<string> {
  const root = record(exchangeInfo, "Binance exchangeInfo 响应");
  return new Set(
    list(root.symbols, "Binance exchangeInfo symbols").flatMap((item) =>
      item.status === "TRADING" &&
      item.isSpotTradingAllowed !== false &&
      item.quoteAsset === "USDT" &&
      typeof item.baseAsset === "string" &&
      typeof item.symbol === "string"
        ? [item.symbol]
        : [],
    ),
  );
}

function spotTrade(value: JsonRecord, symbol: string): BinanceSpotTrade {
  const returnedSymbol = text(value.symbol, "symbol");
  if (returnedSymbol !== symbol) {
    throw new Error(
      `Binance 现货成交返回的交易对不匹配：期望 ${symbol}，实际 ${returnedSymbol}`,
    );
  }
  if (typeof value.isBuyer !== "boolean") {
    throw new Error("Binance 现货成交响应缺少 isBuyer");
  }
  return {
    id: integer(value.id, "id"),
    symbol: returnedSymbol,
    price: decimal(value.price, "price"),
    quantity: decimal(value.qty, "qty"),
    quoteQuantity: decimal(value.quoteQty, "quoteQty"),
    commission: decimal(value.commission, "commission"),
    commissionAsset: text(value.commissionAsset, "commissionAsset"),
    isBuyer: value.isBuyer,
  };
}

function spotCostPrice(input: {
  asset: string;
  quantity: string;
  trades: readonly BinanceSpotTrade[];
}): string | null {
  if (!positive(input.quantity)) return null;

  let heldQuantity = "0";
  let heldCost = "0";
  for (const trade of [...input.trades].sort((left, right) => left.id - right.id)) {
    const commissionIsBaseAsset = trade.commissionAsset === input.asset;
    const commissionIsQuoteAsset = trade.commissionAsset === "USDT";
    if (trade.isBuyer) {
      if (
        positive(trade.commission) &&
        !commissionIsBaseAsset &&
        !commissionIsQuoteAsset
      ) {
        return null;
      }
      const acquiredQuantity = commissionIsBaseAsset
        ? decimalSubtract(trade.quantity, trade.commission)
        : trade.quantity;
      if (!positive(acquiredQuantity)) return null;
      const acquiredCost = commissionIsQuoteAsset
        ? decimalAdd(trade.quoteQuantity, trade.commission)
        : trade.quoteQuantity;
      heldQuantity = decimalAdd(heldQuantity, acquiredQuantity);
      heldCost = decimalAdd(heldCost, acquiredCost);
      continue;
    }

    const disposedQuantity = commissionIsBaseAsset
      ? decimalAdd(trade.quantity, trade.commission)
      : trade.quantity;
    if (decimalCompare(disposedQuantity, heldQuantity) > 0) return null;
    if (decimalCompare(disposedQuantity, heldQuantity) === 0) {
      heldQuantity = "0";
      heldCost = "0";
      continue;
    }
    heldCost = decimalSubtract(
      heldCost,
      decimalMultiply(
        heldCost,
        decimalDivide(disposedQuantity, heldQuantity),
      ),
    );
    heldQuantity = decimalSubtract(heldQuantity, disposedQuantity);
  }

  if (decimalCompare(heldQuantity, input.quantity) !== 0 || !positive(heldCost)) {
    return null;
  }
  return decimalDivide(heldCost, heldQuantity);
}

async function collectSpotTrades(
  client: BinanceClient,
  symbol: string,
): Promise<BinanceSpotTrade[]> {
  const output: BinanceSpotTrade[] = [];
  const seenIds = new Set<number>();
  let fromId = 0;
  for (let page = 0; page < 100; page += 1) {
    const rows = list(
      await client.spotTrades(symbol, fromId),
      `Binance ${symbol} 现货成交`,
    ).map((row) => spotTrade(row, symbol));
    if (rows.length > 1000) {
      throw new Error(`Binance ${symbol} 现货成交单页数量超过 1000`);
    }
    for (const row of rows) {
      if (row.id < fromId || seenIds.has(row.id)) {
        throw new Error(`Binance ${symbol} 现货成交分页重复或倒退`);
      }
      seenIds.add(row.id);
      output.push(row);
    }
    if (rows.length < 1000) return output;
    const largestId = rows.reduce(
      (largest, row) => Math.max(largest, row.id),
      fromId,
    );
    if (largestId === Number.MAX_SAFE_INTEGER) {
      throw new Error(`Binance ${symbol} 现货成交编号超出安全范围`);
    }
    fromId = largestId + 1;
  }
  throw new Error(`Binance ${symbol} 现货成交超过安全分页上限`);
}

async function readSpotCostPrices(input: {
  client: BinanceClient;
  positions: readonly BinancePosition[];
  exchangeInfo: unknown;
}): Promise<Map<string, string>> {
  const eligible = eligibleUsdtSymbols(input.exchangeInfo);
  const assets = new Set(
    input.positions.flatMap((position) =>
      position.account === "spot" &&
      position.asset !== "USDT" &&
      eligible.has(`${position.asset}USDT`)
        ? [position.asset]
        : []
    ),
  );
  const costs = new Map<string, string>();
  for (const asset of assets) {
    try {
      const cost = spotCostPrice({
        asset,
        quantity: input.positions.find(
          (position) => position.account === "spot" && position.asset === asset,
        )?.quantity ?? "0",
        trades: await collectSpotTrades(input.client, `${asset}USDT`),
      });
      if (cost !== null) costs.set(asset, cost);
    } catch {
      // 成交历史不足或无法严格换算时，保留成本价为空而不影响当前资产同步。
    }
  }
  return costs;
}

function spotCostPriceDetails(
  position: BinancePosition,
  spotCostPrices: ReadonlyMap<string, string>,
): Pick<AssetHolding, "costPrice" | "costPriceSource"> {
  const costPrice = position.account === "spot"
    ? spotCostPrices.get(position.asset) ?? null
    : null;
  return costPrice === null
    ? { costPrice: null }
    : {
        costPrice,
        costPriceSource: "Binance 现货成交计算",
      };
}

function tickerPrices(
  tickers: unknown,
  neededSymbols: ReadonlySet<string>,
): Map<string, string> {
  const values = Array.isArray(tickers) ? tickers : [tickers];
  const prices = new Map<string, string>();
  for (const raw of values) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const item = raw as JsonRecord;
    const symbol = typeof item.symbol === "string" ? item.symbol : null;
    if (symbol === null || !neededSymbols.has(symbol)) continue;
    const price = typeof item.price === "string" &&
        /^\d+(?:\.\d+)?$/.test(item.price)
      ? item.price
      : null;
    if (price === null || !positive(price)) continue;
    prices.set(symbol, price);
  }
  return prices;
}

function equityQuote(value: unknown, expectedSymbol: string): BinanceEquityQuote {
  const quote = record(value, "Binance Stocks 报价响应");
  const symbol = text(quote.symbol, "symbol");
  if (symbol !== expectedSymbol) {
    throw new Error(
      `Binance Stocks 返回的报价标的不匹配：期望 ${expectedSymbol}，实际 ${symbol}`,
    );
  }
  const bidPrice = decimal(quote.bidPrice, "bidPrice");
  const askPrice = decimal(quote.askPrice, "askPrice");
  if (!positive(bidPrice) || !positive(askPrice)) {
    throw new Error("Binance Stocks 返回了非正买卖报价");
  }
  return { symbol, bidPrice, askPrice };
}

function equityMidPrice(quote: BinanceEquityQuote): string {
  return decimalDivide(decimalAdd(quote.bidPrice, quote.askPrice), "2");
}

function equityOrder(value: JsonRecord, expectedSymbol: string): BinanceEquityOrder {
  const symbol = text(value.symbol, "symbol");
  if (symbol !== expectedSymbol) {
    throw new Error(
      `Binance Stocks 返回的订单标的不匹配：期望 ${expectedSymbol}，实际 ${symbol}`,
    );
  }
  const side = text(value.side, "side");
  if (side !== "BUY" && side !== "SELL") {
    throw new Error(`Binance Stocks 返回了不支持的订单方向：${side}`);
  }
  const quantity = decimal(value.filledQty, "filledQty");
  const filledTotal = decimal(value.filledTotal, "filledTotal");
  if (positive(quantity) && !positive(filledTotal)) {
    throw new Error("Binance Stocks 已成交订单缺少有效成交总额");
  }
  return {
    id: identifier(value.orderId, "orderId"),
    symbol,
    side,
    quantity,
    filledTotal,
    fee: decimal(value.fee, "fee"),
    updatedAt: integer(value.updatedAt, "updatedAt"),
  };
}

function equityCostPrice(input: {
  quantity: string;
  orders: readonly BinanceEquityOrder[];
}): string | null {
  if (!positive(input.quantity)) return null;

  let heldQuantity = "0";
  let heldCost = "0";
  for (const order of [...input.orders].sort(
    (left, right) => left.updatedAt - right.updatedAt || left.id.localeCompare(right.id),
  )) {
    if (!positive(order.quantity)) continue;

    if (order.side === "BUY") {
      heldQuantity = decimalAdd(heldQuantity, order.quantity);
      heldCost = decimalAdd(
        heldCost,
        decimalAdd(order.filledTotal, order.fee),
      );
      continue;
    }

    if (decimalCompare(order.quantity, heldQuantity) > 0) return null;
    if (decimalCompare(order.quantity, heldQuantity) === 0) {
      heldQuantity = "0";
      heldCost = "0";
      continue;
    }
    heldCost = decimalSubtract(
      heldCost,
      decimalMultiply(
        heldCost,
        decimalDivide(order.quantity, heldQuantity),
      ),
    );
    heldQuantity = decimalSubtract(heldQuantity, order.quantity);
  }

  if (decimalCompare(heldQuantity, input.quantity) !== 0 || !positive(heldCost)) {
    return null;
  }
  return decimalDivide(heldCost, heldQuantity);
}

function stocksSymbolForAsset(asset: string): string | null {
  if (!asset.startsWith("EQ_")) return null;
  const symbol = asset.slice("EQ_".length);
  return /^[A-Z][A-Z0-9.-]*$/.test(symbol) ? symbol : null;
}

function nativeUsdtUsdQuote(
  exchangeInfo: unknown,
  tickers: unknown,
  observedAt: string,
): PriceQuote | null {
  const root = record(exchangeInfo, "Binance exchangeInfo 响应");
  const available = list(root.symbols, "Binance exchangeInfo symbols").some((item) =>
    item.status === "TRADING" &&
    item.isSpotTradingAllowed !== false &&
    item.symbol === "USDTUSD" &&
    item.baseAsset === "USDT" &&
    item.quoteAsset === "USD"
  );
  if (!available) return null;
  const price = tickerPrices(
    tickers,
    new Set(["USDTUSD"]),
  ).get("USDTUSD") ?? null;
  if (price === null) return null;
  return {
    symbol: "USDT",
    currency: "USD",
    price,
    quotedAt: new Date(observedAt),
  };
}

async function readUsdtUsdQuote(input: {
  exchangeInfo: unknown;
  tickers: unknown;
  observedAt: string;
  prices: Prices;
}): Promise<{ quote: PriceQuote | null; source: string | null }> {
  const native = nativeUsdtUsdQuote(
    input.exchangeInfo,
    input.tickers,
    input.observedAt,
  );
  if (native) return { quote: native, source: "Binance 现货 USDTUSD" };
  return { quote: await input.prices.quote("USDT"), source: null };
}

async function readBinanceStocksMarketData(input: {
  client: BinanceClient;
  positions: readonly BinancePosition[];
}): Promise<{
  equityQuotes: Map<string, BinanceEquityQuote>;
}> {
  if (!input.positions.some((position) => position.asset.startsWith("EQ_"))) {
    return { equityQuotes: new Map() };
  }
  const symbols = new Set(
    input.positions.flatMap((position) => {
      const symbol = stocksSymbolForAsset(position.asset);
      return symbol === null ? [] : [symbol];
    }),
  );
  const quotes = await Promise.all(
    [...symbols].map(async (symbol) => [
      symbol,
      equityQuote(await input.client.equityQuote(symbol), symbol),
    ] as const),
  );
  return {
    equityQuotes: new Map(quotes),
  };
}

async function collectBinanceStocksOrders(input: {
  client: BinanceClient;
  symbol: string;
  observedAt: string;
}): Promise<BinanceEquityOrder[]> {
  const endTime = Date.parse(input.observedAt);
  if (!Number.isSafeInteger(endTime) || endTime <= 0) {
    throw new Error("Binance Stocks 成本读取时间无效");
  }
  const output: BinanceEquityOrder[] = [];
  const seenIds = new Set<string>();
  let expectedTotal: number | null = null;
  for (let current = 1; current <= 100; current += 1) {
    const response = record(
      await input.client.equityOrderHistory(
        input.symbol,
        0,
        endTime,
        current,
        100,
      ),
      `Binance Stocks ${input.symbol} 订单历史`,
    );
    const total = integer(response.total, "total");
    const returnedCurrent = integer(response.page, "page");
    const size = integer(response.size, "size");
    if (returnedCurrent !== current || size > 100) {
      throw new Error(`Binance Stocks ${input.symbol} 订单历史分页无效`);
    }
    if (expectedTotal === null) expectedTotal = total;
    if (total !== expectedTotal) {
      throw new Error(`Binance Stocks ${input.symbol} 订单历史 total 发生变化`);
    }
    const orders = list(
      response.rows,
      `Binance Stocks ${input.symbol} 订单历史 rows`,
    ).map((row) => equityOrder(row, input.symbol));
    if (orders.length > 100) {
      throw new Error(`Binance Stocks ${input.symbol} 订单历史单页数量超过 100`);
    }
    for (const order of orders) {
      if (seenIds.has(order.id)) {
        throw new Error(`Binance Stocks ${input.symbol} 订单历史分页重复`);
      }
      seenIds.add(order.id);
      output.push(order);
    }
    if (output.length >= total) {
      if (output.length !== total) {
        throw new Error(`Binance Stocks ${input.symbol} 订单历史数量超过 total`);
      }
      return output;
    }
    if (orders.length === 0) {
      throw new Error(`Binance Stocks ${input.symbol} 订单历史分页提前结束`);
    }
  }
  throw new Error(`Binance Stocks ${input.symbol} 订单历史超过安全分页上限`);
}

async function readBinanceStocksCostPrices(input: {
  client: BinanceClient;
  positions: readonly BinancePosition[];
  observedAt: string;
}): Promise<Map<string, string>> {
  const symbols = new Map<string, string>();
  for (const position of input.positions) {
    const symbol = stocksSymbolForAsset(position.asset);
    if (symbol === null) continue;
    symbols.set(
      symbol,
      decimalAdd(symbols.get(symbol) ?? "0", position.quantity),
    );
  }
  const costs = new Map<string, string>();
  for (const [symbol, quantity] of symbols) {
    try {
      const cost = equityCostPrice({
        quantity,
        orders: await collectBinanceStocksOrders({
          client: input.client,
          symbol,
          observedAt: input.observedAt,
        }),
      });
      if (cost !== null) costs.set(symbol, cost);
    } catch {
      // Binance Stocks 历史不足或无法严格换算时，保留成本价为空而不影响当前资产同步。
    }
  }
  return costs;
}

function valuePositions(input: {
  positions: BinancePosition[];
  exchangeInfo: unknown;
  tickers: unknown;
  equityQuotes?: ReadonlyMap<string, BinanceEquityQuote>;
  equityCostPrices?: ReadonlyMap<string, string>;
  spotCostPrices?: ReadonlyMap<string, string>;
  observedAt: string;
  usdtUsdQuote: PriceQuote | null;
  usdtUsdSource?: string | null;
  coverage?: AssetSnapshot["coverage"];
}): AssetSnapshot {
  const eligible = eligibleUsdtSymbols(input.exchangeInfo);
  const equityQuotes = input.equityQuotes ?? new Map<string, BinanceEquityQuote>();
  const equityCostPrices = input.equityCostPrices ?? new Map<string, string>();
  const spotCostPrices = input.spotCostPrices ?? new Map<string, string>();
  const neededSymbols = new Set(
    input.positions.flatMap((position) => {
      const symbol = `${position.asset}USDT`;
      return position.asset !== "USDT" && eligible.has(symbol) ? [symbol] : [];
    }),
  );
  const prices = tickerPrices(input.tickers, neededSymbols);
  const quoteAge = input.usdtUsdQuote
    ? Math.abs(
        Date.parse(input.observedAt) - input.usdtUsdQuote.quotedAt.getTime(),
      )
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
    if (position.asset === "USDT") {
      total = decimalAdd(total, position.quantity);
      return {
        symbol: position.asset,
        name: `${position.asset} · ${scopeLabel(position.account)}`,
        sourceAsset: position.asset,
        sourceAccount: position.account,
        sourceProduct: position.product,
        ...(position.providerPositionId === null
          ? {}
          : { providerPositionId: position.providerPositionId }),
        ...(position.providerState === null
          ? {}
          : { providerPositionState: position.providerState }),
        economicAssetKey: position.economicAssetKey,
        positionState: position.state,
        quantity: position.quantity,
        currency: "USDT",
        assetClass: "crypto",
        currentPrice: { amount: "1", currency: "USDT" },
        marketValue: position.quantity,
        sourceMarketValue: {
          amount: position.quantity,
          currency: "USDT",
        },
        valuation: {
          status: "valued",
          priceSource: "Binance 账户 USDT 计价单位",
          pricedAt: input.observedAt,
        },
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      };
    }
    const stocksSymbol = stocksSymbolForAsset(position.asset);
    if (position.asset.startsWith("EQ_")) {
      const costPrice = stocksSymbol === null
        ? null
        : equityCostPrices.get(stocksSymbol) ?? null;
      const base = {
        symbol: position.asset,
        name: `${position.asset} · ${scopeLabel(position.account)}`,
        sourceAsset: position.asset,
        sourceAccount: position.account,
        sourceProduct: position.product,
        ...(position.providerPositionId === null
          ? {}
          : { providerPositionId: position.providerPositionId }),
        ...(position.providerState === null
          ? {}
          : { providerPositionState: position.providerState }),
        economicAssetKey: position.economicAssetKey,
        positionState: position.state,
        quantity: position.quantity,
        currency: "USD",
        assetClass: "securities" as const,
        costPrice,
        ...(costPrice === null
          ? {}
          : { costPriceSource: "Binance Stocks 订单成交计算（含费用）" }),
        platformProfit: null,
        changePercent: null,
      };
      if (stocksSymbol === null) {
        return {
          ...base,
          currentPrice: null,
          marketValue: null,
          sourceMarketValue: null,
          valuation: {
            status: "unvalued" as const,
            reason: `Binance Stocks 资产代码 ${position.asset} 无法解析为证券代码`,
          },
        };
      }
      const quote = equityQuotes.get(stocksSymbol) ?? null;
      if (quote === null) {
        return {
          ...base,
          currentPrice: null,
          marketValue: null,
          sourceMarketValue: null,
          valuation: {
            status: "unvalued" as const,
            reason: `Binance Stocks 未返回 ${stocksSymbol} 的可靠报价`,
          },
        };
      }
      const unitPrice = equityMidPrice(quote);
      const marketValue = decimalMultiply(position.quantity, unitPrice);
      total = decimalAdd(
        total,
        decimalDivide(marketValue, usdtUsdQuote.price),
      );
      return {
        ...base,
        currentPrice: { amount: unitPrice, currency: "USD" },
        marketValue,
        sourceMarketValue: { amount: marketValue, currency: "USD" },
        valuation: {
          status: "valued" as const,
          priceSource: `Binance Stocks ${stocksSymbol} 买一/卖一中间价`,
          pricedAt: input.observedAt,
        },
      };
    }
    const symbol = `${position.asset}USDT`;
    const price = eligible.has(symbol) ? prices.get(symbol) ?? null : null;
    if (price === null) {
      return {
        symbol: position.asset,
        name: `${position.asset} · ${scopeLabel(position.account)}`,
        sourceAsset: position.asset,
        sourceAccount: position.account,
        sourceProduct: position.product,
        ...(position.providerPositionId === null
          ? {}
          : { providerPositionId: position.providerPositionId }),
        ...(position.providerState === null
          ? {}
          : { providerPositionState: position.providerState }),
        economicAssetKey: position.economicAssetKey,
        positionState: position.state,
        quantity: position.quantity,
        currency: "USDT",
        assetClass: "crypto",
        currentPrice: null,
        marketValue: null,
        sourceMarketValue: null,
        valuation: {
          status: "unvalued",
          reason: `Binance 没有可靠的 ${symbol} 现货价格`,
        },
        ...spotCostPriceDetails(position, spotCostPrices),
        platformProfit: null,
        changePercent: null,
      };
    }
    const marketValue = decimalMultiply(position.quantity, price);
    total = decimalAdd(total, marketValue);
    return {
      symbol: position.asset,
      name: `${position.asset} · ${scopeLabel(position.account)}`,
      sourceAsset: position.asset,
      sourceAccount: position.account,
      sourceProduct: position.product,
      ...(position.providerPositionId === null
        ? {}
        : { providerPositionId: position.providerPositionId }),
      ...(position.providerState === null
        ? {}
        : { providerPositionState: position.providerState }),
      economicAssetKey: position.economicAssetKey,
      positionState: position.state,
      quantity: position.quantity,
      currency: "USDT",
      assetClass: "crypto",
      currentPrice: { amount: price, currency: "USDT" },
      marketValue,
      sourceMarketValue: { amount: marketValue, currency: "USDT" },
      valuation: {
        status: "valued",
        priceSource: `Binance 现货 ${symbol}`,
        pricedAt: input.observedAt,
      },
      ...spotCostPriceDetails(position, spotCostPrices),
      platformProfit: null,
      changePercent: null,
    };
  });
  holdings.sort((left, right) => {
    const a = left.sourceMarketValue?.amount ?? null;
    const b = right.sourceMarketValue?.amount ?? null;
    if (a === null) return b === null ? 0 : 1;
    if (b === null) return -1;
    return decimalCompare(b, a);
  });
  return {
    total: { amount: total, currency: "USDT" },
    holdings,
    exchangeRates: [{
      baseCurrency: "USDT",
      quoteCurrency: "USD",
      rate: usdtUsdQuote.price,
      source: usdtUsdSource,
      observedAt: usdtUsdQuote.quotedAt.toISOString(),
    }],
    syncedAt: input.observedAt,
    ...(input.coverage === undefined ? {} : { coverage: input.coverage }),
  };
}

function baselineBinanceCoverage(): NonNullable<AssetSnapshot["coverage"]> {
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

export function mapBinanceSnapshot(input: {
  spotAccount: unknown;
  fundingAssets: unknown;
  flexiblePages: unknown[];
  lockedPages: unknown[];
  exchangeInfo: unknown;
  tickers: unknown;
  equityQuotes?: ReadonlyMap<string, BinanceEquityQuote>;
  equityCostPrices?: ReadonlyMap<string, string>;
  spotCostPrices?: ReadonlyMap<string, string>;
  observedAt: string;
  usdtUsdQuote: PriceQuote | null;
}): AssetSnapshot {
  return valuePositions({
    positions: extractPositions(input),
    exchangeInfo: input.exchangeInfo,
    tickers: input.tickers,
    equityQuotes: input.equityQuotes,
    equityCostPrices: input.equityCostPrices,
    spotCostPrices: input.spotCostPrices,
    observedAt: input.observedAt,
    usdtUsdQuote: input.usdtUsdQuote,
    coverage: baselineBinanceCoverage(),
  });
}

interface StoredBinanceCredentials {
  apiKey: string;
  apiSecret: string;
}

function parseCredentials(credentials: string): StoredBinanceCredentials {
  let value: JsonRecord;
  try {
    value = record(JSON.parse(credentials), "Binance 凭证");
  } catch {
    throw new Error("Binance 只读凭证格式无效");
  }
  return {
    apiKey: text(value.apiKey, "apiKey"),
    apiSecret: text(value.apiSecret, "apiSecret"),
  };
}

class BinanceClient {
  private timeOffsetMs = 0;

  constructor(
    private readonly credentials: StoredBinanceCredentials,
    private readonly request: BinanceFetch,
    private readonly signal?: AbortSignal,
  ) {}

  private async json(response: Response, context: string): Promise<unknown> {
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error = typeof body === "object" && body !== null
        ? body as { code?: unknown; msg?: unknown }
        : null;
      const message = typeof error?.msg === "string" ? `：${error.msg}` : "";
      throw assetResponseError(`${context}失败（HTTP ${response.status}${message}）`, response, error?.code);
    }
    if (
      typeof body === "object" &&
      body !== null &&
      !Array.isArray(body) &&
      typeof (body as { code?: unknown }).code === "number" &&
      Number((body as { code: number }).code) < 0
    ) {
      const value = body as { code: number; msg?: unknown };
      throw assetResponseError(
        `${context}失败（${value.code}${typeof value.msg === "string" ? `：${value.msg}` : ""}）`,
        response,
        value.code,
      );
    }
    return body;
  }

  async syncTime(): Promise<void> {
    const response = await this.request(`${BINANCE_ORIGIN}/api/v3/time`, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      signal: this.signal,
    });
    const body = record(await this.json(response, "Binance 时钟同步"));
    const serverTime = integer(body.serverTime, "serverTime");
    this.timeOffsetMs = serverTime - Date.now();
  }

  private async signed(
    method: "GET" | "POST",
    path: string,
    parameters: Record<string, string> = {},
    retryTimestamp = true,
  ): Promise<unknown> {
    const query = new URLSearchParams({
      ...parameters,
      recvWindow: "5000",
      timestamp: String(Date.now() + this.timeOffsetMs),
    });
    const signature = createHmac("sha256", this.credentials.apiSecret)
      .update(query.toString())
      .digest("hex");
    query.set("signature", signature);
    const url = new URL(path, BINANCE_ORIGIN);
    const init: RequestInit = {
      method,
      headers: {
        "x-mbx-apikey": this.credentials.apiKey,
        ...(method === "POST"
          ? { "content-type": "application/x-www-form-urlencoded" }
          : {}),
      },
      cache: "no-store",
      redirect: "error",
      signal: this.signal,
    };
    if (method === "GET") url.search = query.toString();
    else init.body = query;
    const response = await this.request(url, init);
    const body = await response.json().catch(() => null);
    const code = typeof body === "object" && body !== null
      ? (body as { code?: unknown }).code
      : null;
    if (code === -1021 && retryTimestamp) {
      await this.syncTime();
      return this.signed(method, path, parameters, false);
    }
    if (!response.ok || (typeof code === "number" && code < 0)) {
      const message = typeof body === "object" && body !== null &&
        typeof (body as { msg?: unknown }).msg === "string"
        ? `：${(body as { msg: string }).msg}`
        : "";
      throw assetResponseError(
        `Binance 读取失败${typeof code === "number" ? `（${code}${message}）` : `（HTTP ${response.status}${message}）`}`,
        response,
        code,
      );
    }
    return body;
  }

  private async apiKey(
    path: string,
    parameters: Record<string, string> = {},
  ): Promise<unknown> {
    const url = new URL(path, BINANCE_ORIGIN);
    for (const [key, value] of Object.entries(parameters)) {
      url.searchParams.set(key, value);
    }
    const response = await this.request(url, {
      method: "GET",
      headers: { "x-mbx-apikey": this.credentials.apiKey },
      cache: "no-store",
      redirect: "error",
      signal: this.signal,
    });
    return this.json(response, "Binance Stocks 行情读取");
  }

  permissions() {
    return this.signed("GET", "/sapi/v1/account/apiRestrictions");
  }

  spotAccount() {
    return this.signed("GET", "/api/v3/account", {
      omitZeroBalances: "true",
    });
  }

  fundingAssets() {
    return this.signed("POST", "/sapi/v1/asset/get-funding-asset", {
      needBtcValuation: "true",
    });
  }

  flexiblePage(current: number) {
    return this.signed("GET", "/sapi/v1/simple-earn/flexible/position", {
      current: String(current),
      size: "100",
    });
  }

  lockedPage(current: number) {
    return this.signed("GET", "/sapi/v1/simple-earn/locked/position", {
      current: String(current),
      size: "100",
    });
  }

  walletBalances() {
    return this.signed("GET", "/sapi/v1/asset/wallet/balance");
  }

  simpleEarnAccount() {
    return this.signed("GET", "/sapi/v1/simple-earn/account");
  }

  dualAccounts() {
    return this.signed("GET", "/sapi/v1/dci/product/accounts");
  }

  dualPage(pageIndex: number) {
    return this.signed("GET", "/sapi/v1/dci/product/positions", {
      pageIndex: String(pageIndex),
      pageSize: "100",
    });
  }

  discountAccount() {
    return this.signed("GET", "/sapi/v1/accumulator/product/sum-holding");
  }

  discountPage(pageIndex: number) {
    return this.signed("GET", "/sapi/v1/accumulator/product/position/list", {
      pageIndex: String(pageIndex),
      pageSize: "100",
    });
  }

  bfusdAccount() {
    return this.signed("GET", "/sapi/v1/bfusd/account");
  }

  rwusdAccount() {
    return this.signed("GET", "/sapi/v1/rwusd/account");
  }

  ethStakingAccount() {
    return this.signed("GET", "/sapi/v2/eth-staking/account");
  }

  solStakingAccount() {
    return this.signed("GET", "/sapi/v1/sol-staking/account");
  }

  onchainAccount() {
    return this.signed("GET", "/sapi/v1/onchain-yields/account");
  }

  onchainPage(pageIndex: number) {
    return this.signed("GET", "/sapi/v1/onchain-yields/locked/position", {
      pageIndex: String(pageIndex),
      pageSize: "100",
    });
  }

  softStaking() {
    return this.signed("GET", "/sapi/v1/soft-staking/list");
  }

  spotTrades(symbol: string, fromId: number) {
    return this.signed("GET", "/api/v3/myTrades", {
      symbol,
      fromId: String(fromId),
      limit: "1000",
    });
  }

  async exchangeInfo(): Promise<unknown> {
    const response = await this.request(`${BINANCE_ORIGIN}/api/v3/exchangeInfo`, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      signal: this.signal,
    });
    return this.json(response, "Binance 交易对读取");
  }

  async tickers(): Promise<unknown> {
    const response = await this.request(`${BINANCE_ORIGIN}/api/v3/ticker/price`, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      signal: this.signal,
    });
    return this.json(response, "Binance 行情读取");
  }

  equityQuote(symbol: string) {
    return this.apiKey("/sapi/v1/equity/market/quote", { symbol });
  }

  equityOrderHistory(
    symbol: string,
    startTime: number,
    endTime: number,
    current: number,
    size: number,
  ) {
    return this.signed("GET", "/sapi/v1/equity/order/history", {
      symbol,
      startTime: String(startTime),
      endTime: String(endTime),
      current: String(current),
      size: String(size),
    });
  }
}

async function collectEarnPages(
  kind: "flexible" | "locked",
  fetchPage: (current: number) => Promise<unknown>,
): Promise<unknown[]> {
  const pages: unknown[] = [];
  let collected = 0;
  let expectedTotal: number | null = null;
  for (let current = 1; current <= 100; current += 1) {
    const page = record(await fetchPage(current), `Binance ${kind} Earn 分页`);
    const total = integer(page.total, "total");
    if (expectedTotal === null) expectedTotal = total;
    if (total !== expectedTotal) {
      throw new Error(`Binance ${kind} Earn 分页 total 发生变化`);
    }
    const rows = list(page.rows, `Binance ${kind} Earn rows`);
    pages.push(page);
    collected += rows.length;
    if (collected >= total) {
      if (collected !== total) {
        throw new Error(`Binance ${kind} Earn 分页数量超过 total`);
      }
      return pages;
    }
    if (rows.length === 0) {
      throw new Error(`Binance ${kind} Earn 分页提前结束`);
    }
  }
  throw new Error(`Binance ${kind} Earn 分页超过安全上限`);
}

async function collectPositionPages(
  context: string,
  fetchPage: (pageIndex: number) => Promise<unknown>,
): Promise<unknown[]> {
  const pages: unknown[] = [];
  let collected = 0;
  let expectedTotal: number | null = null;
  for (let pageIndex = 1; pageIndex <= 100; pageIndex += 1) {
    const page = record(await fetchPage(pageIndex), `${context}分页`);
    const total = integer(page.total, "total");
    if (expectedTotal === null) expectedTotal = total;
    if (total !== expectedTotal) throw new Error(`${context}分页 total 发生变化`);
    const rows = list(page.rows ?? page.list, `${context} rows`);
    pages.push(page);
    collected += rows.length;
    if (collected >= total) {
      if (collected !== total) throw new Error(`${context}分页数量超过 total`);
      return pages;
    }
    if (rows.length === 0) throw new Error(`${context}分页提前结束`);
  }
  throw new Error(`${context}分页超过安全上限`);
}

async function optionalProductRead<T>(
  label: string,
  fallback: T,
  operation: () => Promise<T>,
): Promise<{ value: T; error: string | null }> {
  try {
    return { value: await operation(), error: null };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "未知错误";
    return { value: fallback, error: `${label}读取失败：${detail}` };
  }
}

async function readFullSnapshot(input: {
  client: BinanceClient;
  observedAt: string;
  prices: Prices;
}): Promise<{ snapshot: AssetSnapshot; account: JsonRecord }> {
  await input.client.syncTime();
  validateBinanceReadOnlyPermissions(await input.client.permissions());
  const spotAccount = await input.client.spotAccount();
  const fundingAssets = await input.client.fundingAssets();
  const flexiblePages = await collectEarnPages(
    "flexible",
    (page) => input.client.flexiblePage(page),
  );
  const lockedPages = await collectEarnPages(
    "locked",
    (page) => input.client.lockedPage(page),
  );
  const walletBalances = await input.client.walletBalances();
  const [
    simpleEarn,
    dual,
    discount,
    bfusd,
    rwusd,
    ethStaking,
    solStaking,
    onchain,
    softStakingResult,
  ] = await Promise.all([
    optionalProductRead("Simple Earn 账户汇总", {}, () =>
      input.client.simpleEarnAccount()),
    optionalProductRead(
      "Dual Investment",
      { pages: [{ total: 0, list: [] }] as unknown[] },
      async () => {
        await input.client.dualAccounts();
        return {
          pages: await collectPositionPages(
            "Binance Dual Investment",
            (page) => input.client.dualPage(page),
          ),
        };
      },
    ),
    optionalProductRead(
      "Discount Buy",
      { pages: [{ total: 0, list: [] }] as unknown[] },
      async () => {
        await input.client.discountAccount();
        return {
          pages: await collectPositionPages(
            "Binance Discount Buy",
            (page) => input.client.discountPage(page),
          ),
        };
      },
    ),
    optionalProductRead("BFUSD", { bfusdAmount: "0" } as unknown, () =>
      input.client.bfusdAccount()),
    optionalProductRead("RWUSD", { rwusdAmount: "0" } as unknown, () =>
      input.client.rwusdAccount()),
    optionalProductRead("ETH Staking", { holdingInETH: "0" } as unknown, () =>
      input.client.ethStakingAccount()),
    optionalProductRead(
      "SOL Staking",
      { holdingInSOL: "0", bnsolAmount: "0" } as unknown,
      () => input.client.solStakingAccount(),
    ),
    optionalProductRead(
      "On-chain Yields",
      {
        account: { totalFlexibleAmountInUSDT: "0" },
        pages: [{ total: 0, rows: [] }] as unknown[],
      },
      async () => ({
        account: await input.client.onchainAccount(),
        pages: await collectPositionPages(
          "Binance On-chain Yields Locked",
          (page) => input.client.onchainPage(page),
        ),
      }),
    ),
    optionalProductRead("Soft Staking", [] as unknown, () =>
      input.client.softStaking()),
  ]);
  const failures: Record<string, string> = {};
  if (simpleEarn.error) {
    failures["simple-earn-flexible"] = simpleEarn.error;
    failures["simple-earn-locked"] = simpleEarn.error;
  }
  for (const [product, result] of [
    ["dual-investment", dual],
    ["discount-buy", discount],
    ["bfusd", bfusd],
    ["rwusd", rwusd],
    ["eth-staking", ethStaking],
    ["sol-staking", solStaking],
    ["onchain-yields", onchain],
    ["soft-staking", softStakingResult],
  ] as const) {
    if (result.error) failures[product] = result.error;
  }
  const [exchangeInfo, tickers] = await Promise.all([
    input.client.exchangeInfo(),
    input.client.tickers(),
  ]);
  const usdtUsd = await readUsdtUsdQuote({
    exchangeInfo,
    tickers,
    observedAt: input.observedAt,
    prices: input.prices,
  });
  const investment = addInvestmentPositions(
    extractPositions({
      spotAccount,
      fundingAssets,
      flexiblePages,
      lockedPages,
      exchangeInfo,
    }),
    {
      dualPages: dual.value.pages,
      discountPages: discount.value.pages,
      bfusdAccount: bfusd.value,
      rwusdAccount: rwusd.value,
      ethStakingAccount: ethStaking.value,
      solStakingAccount: solStaking.value,
      onchainAccount: onchain.value.account,
      onchainPages: onchain.value.pages,
      softStaking: softStakingResult.value,
      failures,
    },
  );
  const [spotCostPrices, equityCostPrices, equities] = await Promise.all([
    readSpotCostPrices({
      client: input.client,
      positions: investment.positions,
      exchangeInfo,
    }),
    readBinanceStocksCostPrices({
      client: input.client,
      positions: investment.positions,
      observedAt: input.observedAt,
    }),
    readBinanceStocksMarketData({
      client: input.client,
      positions: investment.positions,
    }),
  ]);
  return {
    account: record(spotAccount, "Binance 现货账户响应"),
    snapshot: reconcileWallet({
      snapshot: valuePositions({
        positions: investment.positions,
        exchangeInfo,
        tickers,
        equityQuotes: equities.equityQuotes,
        equityCostPrices,
        spotCostPrices,
        observedAt: input.observedAt,
        usdtUsdQuote: usdtUsd.quote,
        usdtUsdSource: usdtUsd.source,
      }),
      walletBalances,
      tickers,
      products: investment.products,
      incomplete: investment.incomplete,
    }),
  };
}

export class ProductionBinanceReadOnly implements BinanceReadOnly {
  constructor(
    private readonly prices: Prices,
    private readonly request: BinanceFetch = globalThis.fetch,
  ) {}

  async preview(input: {
    apiKey: string;
    apiSecret: string;
    observedAt: string;
  }): Promise<BinanceAuthorizationResult> {
    if (input.apiKey.trim().length < 8 || input.apiSecret.trim().length < 8) {
      throw new Error("Binance API Key 或 Secret 格式无效");
    }
    return this.authorize({
      apiKey: input.apiKey.trim(),
      apiSecret: input.apiSecret.trim(),
    }, input.observedAt);
  }

  revalidate(input: {
    credentials: string;
    observedAt: string;
  }): Promise<BinanceAuthorizationResult> {
    return this.authorize(parseCredentials(input.credentials), input.observedAt);
  }

  private async authorize(
    credentials: StoredBinanceCredentials,
    observedAt: string,
  ): Promise<BinanceAuthorizationResult> {
    const client = new BinanceClient(credentials, this.request);
    const { snapshot, account } = await readFullSnapshot({
      client,
      observedAt,
      prices: this.prices,
    });
    const uid = typeof account.uid === "number" || typeof account.uid === "string"
      ? String(account.uid)
      : createHash("sha256").update(credentials.apiKey).digest("hex").slice(0, 12);
    return {
      credentials: JSON.stringify(credentials),
      permissions: [...READ_ONLY_PERMISSIONS],
      account: {
        id: `binance:${uid}`,
        label: `Binance 账户 · UID ${uid}`,
      },
      snapshot,
    };
  }
}

export class ProductionBinanceSourceRefresher
  implements AssetSourceRefresher
{
  constructor(
    private readonly prices: Prices,
    private readonly request: BinanceFetch = globalThis.fetch,
  ) {}

  async refresh({
    source,
    credentials,
    mode,
    attemptedAt,
    signal,
  }: Parameters<AssetSourceRefresher["refresh"]>[0]): Promise<AssetSourceRefreshResult> {
    if (source.kind !== "binance") {
      throw new Error(`Binance 刷新器不支持来源类型：${source.kind}`);
    }
    const stored = parseCredentials(credentials);
    const client = new BinanceClient(stored, this.request, signal);
    if (mode === "prices") {
      const [exchangeInfo, tickers] = await Promise.all([
        client.exchangeInfo(),
        client.tickers(),
      ]);
      const usdtUsd = await readUsdtUsdQuote({
        exchangeInfo,
        tickers,
        observedAt: attemptedAt,
        prices: this.prices,
      });
      const positions = source.snapshot.holdings.map((holding) => {
        if (!holding.sourceAsset || !holding.sourceAccount) {
          throw new Error("Binance 旧快照缺少来源资产分区");
        }
        return {
          asset: holding.sourceAsset,
          account: holding.sourceAccount,
          product: holding.sourceProduct ?? holding.sourceAccount,
          providerPositionId: holding.providerPositionId ?? null,
          providerState: holding.providerPositionState ?? null,
          economicAssetKey:
            holding.economicAssetKey ??
            `binance:${holding.sourceAccount}:${holding.sourceAsset}`,
          state: holding.positionState ?? "active",
          quantity: holding.quantity,
        };
      });
      const equities = await readBinanceStocksMarketData({
        client,
        positions,
      });
      const spotCostPrices = new Map(
        source.snapshot.holdings.flatMap((holding) =>
          holding.sourceAccount === "spot" &&
          holding.costPrice !== null &&
          holding.sourceAsset
            ? [[holding.sourceAsset, holding.costPrice] as const]
            : []
        ),
      );
      const equityCostPrices = new Map(
        source.snapshot.holdings.flatMap((holding) => {
          const symbol = holding.sourceAsset === undefined
            ? null
            : stocksSymbolForAsset(holding.sourceAsset);
          return symbol !== null && holding.costPrice !== null
            ? [[symbol, holding.costPrice] as const]
            : [];
        }),
      );
      const snapshot = valuePositions({
        positions,
        exchangeInfo,
        tickers,
        equityQuotes: equities.equityQuotes,
        equityCostPrices,
        spotCostPrices,
        observedAt: attemptedAt,
        usdtUsdQuote: usdtUsd.quote,
        usdtUsdSource: usdtUsd.source,
        coverage: source.snapshot.coverage,
      });
      return {
        snapshot: source.snapshot.coverage?.totalIsAuthoritative
          ? { ...snapshot, total: source.snapshot.total }
          : snapshot,
      };
    }
    return {
      snapshot: (await readFullSnapshot({
        client,
        observedAt: attemptedAt,
        prices: this.prices,
      })).snapshot,
    };
  }
}

const COINGECKO_USD_REFERENCE_IDS = {
  BTC: "bitcoin",
  USDT: "tether",
} as const;

export class CoinGeckoUsdtUsdPrices implements Prices {
  private inFlightQuotes: Promise<ReadonlyMap<string, PriceQuote>> | null = null;

  constructor(
    private readonly services: ExternalServiceConfiguration,
    private readonly request: BinanceFetch = globalThis.fetch,
  ) {}

  async quote(symbol: string): Promise<PriceQuote | null> {
    const normalized = symbol.toUpperCase();
    if (!(normalized in COINGECKO_USD_REFERENCE_IDS)) return null;
    return (await this.quotes()).get(normalized) ?? null;
  }

  private quotes(): Promise<ReadonlyMap<string, PriceQuote>> {
    if (this.inFlightQuotes !== null) return this.inFlightQuotes;
    const current = this.readQuotes();
    this.inFlightQuotes = current;
    void current.finally(() => {
      if (this.inFlightQuotes === current) this.inFlightQuotes = null;
    });
    return current;
  }

  private async readQuotes(): Promise<ReadonlyMap<string, PriceQuote>> {
    try {
      const url = new URL("https://api.coingecko.com/api/v3/simple/price");
      url.searchParams.set(
        "ids",
        Object.values(COINGECKO_USD_REFERENCE_IDS).join(","),
      );
      url.searchParams.set("vs_currencies", "usd");
      url.searchParams.set("include_last_updated_at", "true");
      const apiKey = await this.services.coinGeckoDemoApiKey();
      if (!apiKey) return new Map();
      const response = await this.request(url, {
        method: "GET",
        headers: apiKey ? { "x-cg-demo-api-key": apiKey } : undefined,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return new Map();
      const body = record(
        await response.json().catch(() => null),
        "CoinGecko 响应",
      );
      const quotes = new Map<string, PriceQuote>();
      for (const [symbol, coinId] of Object.entries(
        COINGECKO_USD_REFERENCE_IDS,
      )) {
        try {
          const coin = record(body[coinId], `CoinGecko ${symbol} 响应`);
          const price = typeof coin.usd === "number" && Number.isFinite(coin.usd)
            ? String(coin.usd)
            : typeof coin.usd === "string"
              ? coin.usd
              : null;
          const updatedAt = typeof coin.last_updated_at === "number"
            ? new Date(coin.last_updated_at * 1000)
            : null;
          if (
            !price ||
            !/^\d+(?:\.\d+)?$/.test(price) ||
            !updatedAt ||
            Number.isNaN(updatedAt.getTime())
          ) {
            continue;
          }
          quotes.set(symbol, {
            symbol,
            currency: "USD",
            price,
            quotedAt: updatedAt,
          });
        } catch {
          // 单一参考币缺价不应掩盖同批其他有效报价。
        }
      }
      return quotes;
    } catch {
      return new Map();
    }
  }
}
