import {
  createHash,
  createHmac,
} from "node:crypto";

import {
  decimalAdd,
  decimalCompare,
  decimalSubtract,
  decimalMultiply,
  decimalToFixed,
} from "@/domain/decimal";
import type {
  AssetHolding,
  AssetPermission,
  AssetSnapshot,
  AssetSourceRefreshResult,
  AssetSourceRefresher,
  BinanceAuthorizationResult,
  BinanceReadOnly,
  PriceQuote,
  Prices,
} from "@/server/ports";

type JsonRecord = Record<string, unknown>;
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

function record(value: unknown, context = "Binance 响应"): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context}格式无效`);
  }
  return value as JsonRecord;
}

function list(value: unknown, context: string): JsonRecord[] {
  if (!Array.isArray(value)) throw new Error(`${context}格式无效`);
  return value.map((item) => record(item, context));
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Binance 响应缺少 ${field}`);
  }
  return value;
}

function identifier(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  throw new Error(`Binance 响应缺少 ${field}`);
}

function decimal(value: unknown, field: string): string {
  const output = typeof value === "string" ? value : "";
  if (!/^\d+(?:\.\d+)?$/.test(output)) {
    throw new Error(`Binance 响应中的 ${field} 不是有效非负十进制数`);
  }
  return output;
}

function positive(value: string): boolean {
  return decimalCompare(value, "0") > 0;
}

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
  const btcPrice = tickerPrices(input.tickers).get("BTCUSDT") ?? null;
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
        products: input.products,
        unexplainedValue: null,
        excludedPositiveAccounts,
      },
    };
  }
  const walletValue = decimalMultiply(includedBtc, btcPrice);
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
  const walletAboveDetail = decimalCompare(difference, "0") > 0;
  return {
    ...input.snapshot,
    total: material && walletAboveDetail && unexplained !== null
      ? {
          amount: decimalAdd(input.snapshot.total.amount, unexplained),
          currency: input.snapshot.total.currency,
        }
      : input.snapshot.total,
    coverage: {
      status:
        input.incomplete || material || excludedPositiveAccounts.length > 0
          ? "partial"
          : "complete",
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

function tickerPrices(tickers: unknown): Map<string, string> {
  const values = Array.isArray(tickers) ? tickers : [tickers];
  return new Map(
    values.map((raw) => {
      const item = record(raw, "Binance ticker 响应");
      return [text(item.symbol, "symbol"), decimal(item.price, "price")] as const;
    }),
  );
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
  const price = tickerPrices(tickers).get("USDTUSD") ?? null;
  if (price === null || !positive(price)) return null;
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

function valuePositions(input: {
  positions: BinancePosition[];
  exchangeInfo: unknown;
  tickers: unknown;
  observedAt: string;
  usdtUsdQuote: PriceQuote | null;
  usdtUsdSource?: string | null;
  coverage?: AssetSnapshot["coverage"];
}): AssetSnapshot {
  const eligible = eligibleUsdtSymbols(input.exchangeInfo);
  const prices = tickerPrices(input.tickers);
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
        costPrice: null,
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
      costPrice: null,
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
  observedAt: string;
  usdtUsdQuote: PriceQuote | null;
}): AssetSnapshot {
  return valuePositions({
    positions: extractPositions(input),
    exchangeInfo: input.exchangeInfo,
    tickers: input.tickers,
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
      throw new Error(`${context}失败（HTTP ${response.status}${message}）`);
    }
    if (
      typeof body === "object" &&
      body !== null &&
      !Array.isArray(body) &&
      typeof (body as { code?: unknown }).code === "number" &&
      Number((body as { code: number }).code) < 0
    ) {
      const value = body as { code: number; msg?: unknown };
      throw new Error(
        `${context}失败（${value.code}${typeof value.msg === "string" ? `：${value.msg}` : ""}）`,
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
      throw new Error(
        `Binance 读取失败${typeof code === "number" ? `（${code}${message}）` : `（HTTP ${response.status}${message}）`}`,
      );
    }
    return body;
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
  return {
    account: record(spotAccount, "Binance 现货账户响应"),
    snapshot: (() => {
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
      return reconcileWallet({
        snapshot: valuePositions({
          positions: investment.positions,
          exchangeInfo,
          tickers,
          observedAt: input.observedAt,
          usdtUsdQuote: usdtUsd.quote,
          usdtUsdSource: usdtUsd.source,
        }),
        walletBalances,
        tickers,
        products: investment.products,
        incomplete: investment.incomplete,
      });
    })(),
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
      return {
        snapshot: valuePositions({
          positions: source.snapshot.holdings.map((holding) => {
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
          }),
          exchangeInfo,
          tickers,
          observedAt: attemptedAt,
          usdtUsdQuote: usdtUsd.quote,
          usdtUsdSource: usdtUsd.source,
          coverage: source.snapshot.coverage,
        }),
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

export class CoinGeckoUsdtUsdPrices implements Prices {
  constructor(private readonly request: BinanceFetch = globalThis.fetch) {}

  async quote(symbol: string): Promise<PriceQuote | null> {
    if (symbol !== "USDT") return null;
    try {
      const url = new URL("https://api.coingecko.com/api/v3/simple/price");
      url.searchParams.set("ids", "tether");
      url.searchParams.set("vs_currencies", "usd");
      url.searchParams.set("include_last_updated_at", "true");
      const apiKey = process.env.COINGECKO_DEMO_API_KEY;
      const response = await this.request(url, {
        method: "GET",
        headers: apiKey ? { "x-cg-demo-api-key": apiKey } : undefined,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return null;
      const body = record(
        await response.json().catch(() => null),
        "CoinGecko 响应",
      );
      const tether = record(body.tether, "CoinGecko Tether 响应");
      const price = typeof tether.usd === "number" && Number.isFinite(tether.usd)
        ? String(tether.usd)
        : typeof tether.usd === "string"
          ? tether.usd
          : null;
      const updatedAt = typeof tether.last_updated_at === "number"
        ? new Date(tether.last_updated_at * 1000)
        : null;
      if (
        !price ||
        !/^\d+(?:\.\d+)?$/.test(price) ||
        !updatedAt ||
        Number.isNaN(updatedAt.getTime())
      ) {
        return null;
      }
      return { symbol, currency: "USD", price, quotedAt: updatedAt };
    } catch {
      return null;
    }
  }
}
