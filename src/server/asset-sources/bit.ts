import { createHmac } from "node:crypto";

import { decimalAdd, decimalMultiply } from "@/domain/decimal";
import type {
  AssetHolding,
  AssetSnapshot,
  AssetSourceRefresher,
  AssetSourceRefreshResult,
  BitAuthorizationResult,
  BitReadOnly,
  PriceQuote,
  Prices,
} from "@/server/ports";
import { assetResponseError } from "@/server/asset-sync-diagnostics";
import { positiveDecimal } from "@/server/asset-sources/value-guards";
import { createAbortableSleep } from "@/server/asset-sources/abortable-sleep";

type JsonRecord = Record<string, unknown>;
type BitFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface BitRuntime {
  now(): number;
  sleep(milliseconds: number, signal?: AbortSignal): Promise<void>;
  requestIntervalMs: number;
}

const BIT_ORIGIN = "https://mapi.matrixport.com";
const WALLET_BALANCE_PATH = "/mapi/v1/wallet/balance";
const BALANCE_PLUS_PATH = "/flexible/api/v2/app/homepage";
const DCP_PATH = "/dcp/api/v1/total-positions";
const DCP_ORDERS_PATH = "/dcp/api/v1/orders";
const DCP_ORDER_PAGE_SIZE = 100;
const DCP_ORDER_PAGE_LIMIT = 100;
const READ_ONLY_PATHS = new Set([
  WALLET_BALANCE_PATH,
  BALANCE_PLUS_PATH,
  DCP_PATH,
  DCP_ORDERS_PATH,
]);

const abortableSleep = createAbortableSleep("BIT 请求已取消");

const DEFAULT_RUNTIME: BitRuntime = {
  now: () => Date.now(),
  sleep: abortableSleep,
  // Wallet 私有接口按用户限频 1 rps；预览与完整同步宁可慢一点也不能突发请求。
  requestIntervalMs: 1_050,
};

interface StoredBitCredentials {
  apiKey: string;
  apiSecret: string;
  userId: string;
}

interface ProductRead {
  value: unknown | null;
  error: string | null;
}

function record(value: unknown, context: string): JsonRecord {
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
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`BIT 响应缺少 ${field}`);
  }
  return value;
}

function decimal(value: unknown, field: string): string {
  const raw = typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : value;
  if (typeof raw !== "string" || !/^\d+(?:\.\d+)?$/.test(raw)) {
    throw new Error(`BIT 响应中的 ${field} 不是有效非负十进制数`);
  }
  return raw;
}

function integer(value: unknown, field: string): number {
  const raw = typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : value;
  if (
    typeof raw !== "string" ||
    !/^\d+$/.test(raw) ||
    !Number.isSafeInteger(Number(raw))
  ) {
    throw new Error(`BIT 响应中的 ${field} 不是有效非负整数`);
  }
  return Number(raw);
}

function identifier(value: unknown, field: string): string {
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  throw new Error(`BIT 响应中的 ${field} 不是有效标识`);
}

const positive = positiveDecimal;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "读取失败";
}

function networkErrorMessage(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined;
  const code = typeof cause === "object" && cause !== null && "code" in cause &&
    typeof cause.code === "string"
    ? cause.code
    : null;
  return code ?? (error instanceof Error ? error.message : "未知网络错误");
}

function parseEnvelope(value: unknown, context: string): JsonRecord {
  const envelope = record(value, context);
  if (envelope.code !== 0 && envelope.code !== "0") {
    const message = typeof envelope.message === "string"
      ? envelope.message
      : "未知错误";
    throw new Error(`BIT ${context}失败（${String(envelope.code)} ${message}）`);
  }
  return record(envelope.data, `${context} data`);
}

function quoteFor(
  symbol: string,
  quote: PriceQuote | null,
): {
  currentPrice: AssetHolding["currentPrice"];
  sourceMarketValue: AssetHolding["sourceMarketValue"];
  marketValue: string | null;
  valuation: AssetHolding["valuation"];
} {
  if (symbol === "USD") {
    return {
      currentPrice: { amount: "1", currency: "USD" },
      sourceMarketValue: null,
      marketValue: null,
      valuation: { status: "unvalued", reason: "数量尚未绑定到持仓" },
    };
  }
  if (quote !== null && quote.currency === "USD") {
    return {
      currentPrice: { amount: quote.price, currency: "USD" },
      sourceMarketValue: null,
      marketValue: null,
      valuation: {
        status: "valued",
        priceSource: `CoinGecko ${symbol}/USD 参考价格`,
        pricedAt: quote.quotedAt.toISOString(),
      },
    };
  }
  return {
    currentPrice: null,
    sourceMarketValue: null,
    marketValue: null,
    valuation: {
      status: "unvalued",
      reason: `${symbol} 暂无可靠 USD 参考价格`,
    },
  };
}

function valuedHolding(input: {
  symbol: string;
  name: string;
  quantity: string;
  sourceAsset: string;
  sourceAccount: NonNullable<AssetHolding["sourceAccount"]>;
  sourceProduct: string;
  quote: PriceQuote | null;
}): AssetHolding {
  const quoted = quoteFor(input.symbol, input.quote);
  if (quoted.currentPrice === null) {
    return {
      symbol: input.symbol,
      name: input.name,
      quantity: input.quantity,
      currency: "USD",
      assetClass: "crypto",
      sourceAsset: input.sourceAsset,
      sourceAccount: input.sourceAccount,
      sourceProduct: input.sourceProduct,
      currentPrice: null,
      marketValue: null,
      sourceMarketValue: null,
      valuation: quoted.valuation,
      costPrice: null,
      platformProfit: null,
      changePercent: null,
    };
  }
  const marketValue = decimalMultiply(input.quantity, quoted.currentPrice.amount);
  return {
    symbol: input.symbol,
    name: input.name,
    quantity: input.quantity,
    currency: "USD",
    assetClass: input.symbol === "USD" || input.symbol === "USDT" ? "cash" : "crypto",
    sourceAsset: input.sourceAsset,
    sourceAccount: input.sourceAccount,
    sourceProduct: input.sourceProduct,
    currentPrice: quoted.currentPrice,
    marketValue,
    sourceMarketValue: { amount: marketValue, currency: "USD" },
    valuation: quoted.valuation,
    costPrice: null,
    platformProfit: null,
    changePercent: null,
  };
}

function usdAggregateHolding(input: {
  product: "dcp";
  value: string;
  name: string;
  observedAt: string;
}): AssetHolding | null {
  if (!positive(input.value)) return null;
  return {
    symbol: "USD",
    name: input.name,
    quantity: input.value,
    currency: "USD",
    assetClass: "cash",
    sourceAsset: `bit:${input.product}:aggregate`,
    sourceAccount: "earn",
    sourceProduct: input.product,
    providerPositionId: "aggregate",
    currentPrice: { amount: "1", currency: "USD" },
    marketValue: input.value,
    sourceMarketValue: { amount: input.value, currency: "USD" },
    valuation: {
      status: "valued",
      priceSource: "BIT / Matrixport 产品 USD 汇总",
      pricedAt: input.observedAt,
    },
    costPrice: null,
    platformProfit: null,
    changePercent: null,
  };
}

function dcpOrderState(status: number): string {
  switch (status) {
    case 0:
    case 100:
      return "处理中";
    case 200:
      return "进行中";
    case 210:
    case 220:
      return "结算中";
    case 230:
      return "已结算";
    case 240:
      return "赎回处理中";
    case 250:
      return "已赎回";
    default:
      return `状态 ${status}`;
  }
}

function dcpMaturityDay(value: unknown): string {
  const timestamp = integer(value, "DCP order maturity_time");
  if (timestamp === 0) {
    throw new Error("BIT 响应中的 DCP order maturity_time 不能为零");
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    throw new Error("BIT 响应中的 DCP order maturity_time 无效");
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error("BIT 响应中的 DCP order maturity_time 无法格式化");
  }
  return `${year}-${month}-${day}`;
}

function dcpOrderHolding(item: JsonRecord): AssetHolding {
  const id = identifier(item.id, "DCP order id");
  const currency = text(item.invest_currency, "DCP order invest_currency")
    .toUpperCase();
  const amount = decimal(item.invest_amount, "DCP order invest_amount");
  const underlyingPair = text(
    item.underlying_pair,
    "DCP order underlying_pair",
  );
  const state = dcpOrderState(integer(item.status, "DCP order status"));
  const maturityDay = dcpMaturityDay(item.maturity_time);
  return {
    symbol: currency,
    name: `DCP #${id} · ${underlyingPair} · ${state} · ${maturityDay} 到期`,
    quantity: amount,
    currency,
    // DCP 是锁定中的加密理财订单，不是可用现金余额；归入持仓明细，
    // 但不带订单级市值，避免与 USD 总头寸重复计入。
    assetClass: "crypto",
    sourceAsset: `bit:dcp:order:${id}`,
    sourceAccount: "earn",
    sourceProduct: "dcp",
    providerPositionId: id,
    providerPositionState: state,
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
}

function productCoverage(
  product: string,
  capability: "detailed" | "aggregate-only",
  result: ProductRead,
  message: string | null = null,
) {
  return {
    product,
    capability,
    freshness: result.error === null ? "current" as const : "expired" as const,
    message: result.error === null ? message : `本次未读取：${result.error}`,
  };
}

function bitReferenceQuote(
  symbol: string,
  btcUsd: PriceQuote | null,
  usdtUsd: PriceQuote | null,
): PriceQuote | null {
  if (symbol === "BTC") return btcUsd;
  if (symbol === "USDT") return usdtUsd;
  return null;
}

function revalueBitHolding(
  holding: AssetHolding,
  quote: PriceQuote | null,
): AssetHolding {
  const quoted = quoteFor(holding.symbol, quote);
  if (quoted.currentPrice === null) {
    return {
      ...holding,
      currentPrice: null,
      marketValue: null,
      sourceMarketValue: null,
      valuation: quoted.valuation,
    };
  }
  const marketValue = decimalMultiply(holding.quantity, quoted.currentPrice.amount);
  return {
    ...holding,
    currentPrice: quoted.currentPrice,
    marketValue,
    sourceMarketValue: { amount: marketValue, currency: "USD" },
    valuation: quoted.valuation,
  };
}

async function refreshBitReferencePrices(
  snapshot: AssetSnapshot,
  prices: Prices,
  observedAt: string,
): Promise<AssetSnapshot> {
  const [btcUsd, usdtUsd] = await Promise.all([
    prices.quote("BTC"),
    prices.quote("USDT"),
  ]);
  const holdings = snapshot.holdings.map((holding) =>
    holding.sourceProduct === "wallet" || holding.sourceProduct === "balance-plus"
      ? revalueBitHolding(
        holding,
        bitReferenceQuote(holding.symbol, btcUsd, usdtUsd),
      )
      : holding,
  );
  const total = decimalAdd(
    ...holdings.flatMap((holding) =>
      holding.sourceMarketValue?.currency === "USD"
        ? [holding.sourceMarketValue.amount]
        : [],
    ),
  );
  const hasUnvalued = holdings.some(({ valuation }) => valuation.status === "unvalued");
  const productReadFailed = snapshot.coverage?.products.some(
    ({ freshness }) => freshness === "expired",
  ) ?? false;
  return {
    ...snapshot,
    total: { amount: total, currency: "USD" },
    holdings,
    syncedAt: observedAt,
    ...(snapshot.coverage === undefined ? {} : {
      coverage: {
        ...snapshot.coverage,
        status: hasUnvalued || productReadFailed ? "partial" : "unknown",
      },
    }),
  };
}

export async function mapBitSnapshot(input: {
  wallet: unknown;
  balancePlus: ProductRead;
  dcp: ProductRead;
  dcpOrders: ProductRead;
  observedAt: string;
  prices: Prices;
}): Promise<AssetSnapshot> {
  const wallet = record(input.wallet, "BIT Wallet balance data");
  const walletItems = list(wallet.items, "BIT Wallet balance items");
  const [btcUsd, usdtUsd] = await Promise.all([
    input.prices.quote("BTC"),
    input.prices.quote("USDT"),
  ]);
  const holdings = walletItems.flatMap((item) => {
    const currency = text(item.currency, "currency").toUpperCase();
    const balance = decimal(item.balance, "balance");
    if (!positive(balance)) return [];
    const available = decimal(item.available_balance ?? "0", "available_balance");
    const frozen = decimal(item.frozen_balance ?? "0", "frozen_balance");
    const unconfirmed = decimal(
      item.unconfirmed_balance ?? "0",
      "unconfirmed_balance",
    );
    return [valuedHolding({
      symbol: currency,
      name: `${currency} · Wallet（可用 ${available}，冻结 ${frozen}，待确认 ${unconfirmed}）`,
      quantity: balance,
      sourceAsset: `bit:wallet:${currency}`,
      sourceAccount: "wallet",
      sourceProduct: "wallet",
      quote: bitReferenceQuote(currency, btcUsd, usdtUsd),
    })];
  });

  if (input.balancePlus.value !== null) {
    const balancePlus = record(input.balancePlus.value, "BIT Balance+ homepage data");
    for (const item of list(balancePlus.currencies, "BIT Balance+ currencies")) {
      const currency = text(item.currency, "currency").toUpperCase();
      const balance = decimal(item.balance, "balance");
      if (!positive(balance)) continue;
      holdings.push(valuedHolding({
        symbol: currency,
        name: `${currency} · Balance+`,
        quantity: balance,
        sourceAsset: `bit:balance-plus:${currency}`,
        sourceAccount: "earn",
        sourceProduct: "balance-plus",
        quote: bitReferenceQuote(currency, btcUsd, usdtUsd),
      }));
    }
  }

  let dcpCapability: "detailed" | "aggregate-only" = "aggregate-only";
  let dcpMessage: string | null = "仅读取 USD 总头寸，订单明细本次未读取";
  if (input.dcp.value !== null) {
    const dcp = record(input.dcp.value, "BIT DCP total-positions data");
    if (dcp.ask_price_status === 1 || dcp.ask_price_status === "1") {
      dcpMessage = "平台报价失败，DCP 总头寸未计入本次快照";
    } else {
      const holding = usdAggregateHolding({
        product: "dcp",
        value: decimal(dcp.total_position, "total_position"),
        name: "DCP（USD 总头寸）",
        observedAt: input.observedAt,
      });
      if (holding) holdings.push(holding);
      if (input.dcpOrders.value !== null) {
        const dcpOrders = record(input.dcpOrders.value, "BIT DCP orders data");
        const orders = list(dcpOrders.items, "BIT DCP order items");
        for (const order of orders) holdings.push(dcpOrderHolding(order));
        dcpCapability = "detailed";
        dcpMessage = `已读取 ${orders.length} 个活跃订单；总额仍以平台 USD 总头寸为准`;
      } else if (input.dcpOrders.error !== null) {
        dcpMessage = `订单明细本次未读取；保留 USD 总头寸：${input.dcpOrders.error}`;
      }
    }
  }

  const total = decimalAdd(
    ...holdings.flatMap((holding) =>
      holding.sourceMarketValue?.currency === "USD"
        ? [holding.sourceMarketValue.amount]
        : [],
    ),
  );
  const hasUnvalued = holdings.some((holding) => holding.valuation.status === "unvalued");
  const productReadFailed = [input.balancePlus, input.dcp].some(
    (result) => result.error !== null,
  );
  return {
    total: { amount: total, currency: "USD" },
    holdings,
    exchangeRates: [],
    syncedAt: input.observedAt,
    coverage: {
      status: hasUnvalued || productReadFailed ? "partial" : "complete",
      totalIsAuthoritative: false,
      products: [
        {
          product: "wallet",
          capability: "detailed",
          freshness: "current",
          message: "余额明细已读取；未估值币种不会按零计入总额",
        },
        productCoverage(
          "balance-plus",
          "detailed",
          input.balancePlus,
          "逐币余额；total_balance_amount 未作为总资产口径",
        ),
        productCoverage("dcp", dcpCapability, input.dcp, dcpMessage),
      ],
      unexplainedValue: null,
      excludedPositiveAccounts: [],
    },
  };
}

function parseCredentials(value: string): StoredBitCredentials {
  let credentials: unknown;
  try {
    credentials = JSON.parse(value);
  } catch {
    throw new Error("BIT 只读凭证格式无效");
  }
  const input = record(credentials, "BIT 只读凭证");
  const apiKey = text(input.apiKey, "apiKey").trim();
  const apiSecret = text(input.apiSecret, "apiSecret").trim();
  const userId = text(input.userId, "userId").trim();
  if (!/^\d+$/.test(userId)) {
    throw new Error("BIT 用户 ID 格式无效");
  }
  return { apiKey, apiSecret, userId };
}

class BitClient {
  private lastRequestAt: number | null = null;

  constructor(
    private readonly credentials: StoredBitCredentials,
    private readonly prices: Prices,
    private readonly request: BitFetch,
    private readonly signal?: AbortSignal,
    private readonly runtime: BitRuntime = DEFAULT_RUNTIME,
  ) {}

  private async get(
    apiPath: string,
    query: URLSearchParams = new URLSearchParams(),
    extraHeaders: HeadersInit = {},
    parseJson: (raw: string) => unknown = JSON.parse,
  ): Promise<JsonRecord> {
    if (!READ_ONLY_PATHS.has(apiPath)) {
      throw new Error(`BIT 只读适配器拒绝未白名单路径：${apiPath}`);
    }
    const previous = this.lastRequestAt;
    const now = this.runtime.now();
    if (previous !== null) {
      const delay = this.runtime.requestIntervalMs - (now - previous);
      if (delay > 0) await this.runtime.sleep(delay, this.signal);
    }
    const timestamp = String(this.runtime.now());
    const queryString = query.toString();
    const signature = createHmac("sha256", this.credentials.apiSecret)
      .update(`${timestamp}GET${apiPath}&${queryString}`)
      .digest("hex");
    const url = new URL(`${BIT_ORIGIN}${apiPath}`);
    url.search = queryString;
    this.lastRequestAt = this.runtime.now();
    let response: Response;
    try {
      response = await this.request(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          "X-MatrixPort-Access-Key": this.credentials.apiKey,
          "X-Signature": signature,
          "X-Timestamp": timestamp,
          "X-Auth-Version": "v2",
          ...extraHeaders,
        },
        cache: "no-store",
        redirect: "error",
        signal: this.signal,
      });
    } catch (error) {
      throw new Error(
        `BIT ${apiPath} 网络请求失败（${networkErrorMessage(error)}）`,
        { cause: error },
      );
    }
    const raw = await response.text().catch(() => "");
    let body: unknown = null;
    try {
      body = parseJson(raw);
    } catch {
      body = null;
    }
    if (!response.ok) {
      const message = body && typeof body === "object" && "message" in body &&
        typeof body.message === "string"
        ? body.message
        : `HTTP ${response.status}`;
      throw assetResponseError(`BIT ${apiPath}读取失败（${message}）`, response);
    }
    return parseEnvelope(body, apiPath);
  }

  wallet() {
    return this.get(WALLET_BALANCE_PATH);
  }

  balancePlus() {
    return this.get(
      BALANCE_PLUS_PATH,
      new URLSearchParams({
        product_type: "flexi_saving",
        subject_type: "flexi_saving",
      }),
    );
  }

  dcp() {
    return this.get(DCP_PATH);
  }

  private dcpOrderPage(offset: number) {
    return this.get(
      DCP_ORDERS_PATH,
      new URLSearchParams([
        ["status_category", "1"],
        ["order_sort_by", "4"],
        ["limit", String(DCP_ORDER_PAGE_SIZE)],
        ["offset", String(offset)],
      ]),
      {},
      (raw) =>
        JSON.parse(
          raw.replace(
            /("id"\s*:\s*)(\d{16,})(?=\s*[,}])/g,
            "$1\"$2\"",
          ),
        ),
    );
  }

  async dcpOrders(): Promise<JsonRecord> {
    const items: JsonRecord[] = [];
    let total: number | null = null;
    for (let page = 0; page < DCP_ORDER_PAGE_LIMIT; page += 1) {
      const response = await this.dcpOrderPage(items.length);
      const pageTotal = integer(response.total, "DCP order total");
      if (total === null) {
        total = pageTotal;
      } else if (total !== pageTotal) {
        throw new Error("BIT DCP 订单总数在分页期间变化");
      }
      const pageItems = list(response.items, "BIT DCP order items");
      if (pageItems.length === 0) {
        if (items.length !== total) {
          throw new Error("BIT DCP 订单分页提前结束");
        }
        return { total, items };
      }
      items.push(...pageItems);
      if (items.length === total) return { total, items };
      if (items.length > total) {
        throw new Error("BIT DCP 订单分页超出平台总数");
      }
    }
    throw new Error("BIT DCP 订单分页超过安全上限");
  }

  async snapshot(observedAt: string): Promise<AssetSnapshot> {
    const wallet = await this.wallet();
    const optional = async (read: () => Promise<JsonRecord>): Promise<ProductRead> => {
      try {
        return { value: await read(), error: null };
      } catch (error) {
        return { value: null, error: errorMessage(error) };
      }
    };
    const balancePlus = await optional(() => this.balancePlus());
    const dcp = await optional(() => this.dcp());
    const dcpOrders = dcp.value === null
      ? {
        value: null,
        error: "DCP 总头寸未读取，未请求订单明细",
      }
      : await optional(() => this.dcpOrders());
    return mapBitSnapshot({
      wallet,
      balancePlus,
      dcp,
      dcpOrders,
      observedAt,
      prices: this.prices,
    });
  }
}

export class ProductionBitReadOnly implements BitReadOnly {
  constructor(
    private readonly prices: Prices,
    private readonly request: BitFetch = globalThis.fetch,
    private readonly runtime: BitRuntime = DEFAULT_RUNTIME,
  ) {}

  async preview(input: {
    apiKey: string;
    apiSecret: string;
    userId: string;
    observedAt: string;
  }): Promise<BitAuthorizationResult> {
    const credentials = parseCredentials(JSON.stringify(input));
    return this.read(credentials, input.observedAt);
  }

  async revalidate(input: {
    credentials: string;
    observedAt: string;
  }): Promise<BitAuthorizationResult> {
    return this.read(parseCredentials(input.credentials), input.observedAt);
  }

  private async read(
    credentials: StoredBitCredentials,
    observedAt: string,
  ): Promise<BitAuthorizationResult> {
    return {
      credentials: JSON.stringify(credentials),
      // 官方未提供 API Key 权限查询接口；此处只声明本应用实际使用的读取能力。
      permissions: ["account", "positions"],
      account: {
        id: `bit:${credentials.userId}`,
        label: `BIT / Matrixport 账户 · UID ${credentials.userId}`,
      },
      snapshot: await new BitClient(
        credentials,
        this.prices,
        this.request,
        undefined,
        this.runtime,
      ).snapshot(observedAt),
    };
  }
}

export class ProductionBitSourceRefresher implements AssetSourceRefresher {
  constructor(
    private readonly prices: Prices,
    private readonly request: BitFetch = globalThis.fetch,
    private readonly runtime: BitRuntime = DEFAULT_RUNTIME,
  ) {}

  async refresh(input: Parameters<AssetSourceRefresher["refresh"]>[0]): Promise<AssetSourceRefreshResult> {
    if (input.source.kind !== "bit") {
      throw new Error(`BIT 刷新器不支持来源类型：${input.source.kind}`);
    }
    // 行情刷新只请求独立参考价格，避免把全局轮询变成 BIT 私有接口调用。
    if (input.mode === "prices") {
      return {
        snapshot: await refreshBitReferencePrices(
          input.source.snapshot,
          this.prices,
          input.attemptedAt,
        ),
      };
    }
    const credentials = parseCredentials(input.credentials);
    return {
      snapshot: await new BitClient(
        credentials,
        this.prices,
        this.request,
        input.signal,
        this.runtime,
      ).snapshot(input.attemptedAt),
    };
  }
}

export const BIT_READ_ONLY_ENDPOINTS = [
  WALLET_BALANCE_PATH,
  BALANCE_PLUS_PATH,
  DCP_PATH,
  DCP_ORDERS_PATH,
] as const;
