import {
  createHash,
  createHmac,
} from "node:crypto";

import {
  decimalAdd,
  decimalCompare,
  decimalMultiply,
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
}

function addPosition(
  positions: Map<string, BinancePosition>,
  asset: string,
  quantity: string,
  account: BinancePosition["account"],
): void {
  if (!positive(quantity)) return;
  const key = `${account}:${asset}`;
  const previous = positions.get(key);
  positions.set(key, {
    asset,
    account,
    quantity: previous ? decimalAdd(previous.quantity, quantity) : quantity,
  });
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
}): BinancePosition[] {
  const positions = new Map<string, BinancePosition>();
  const spot = record(input.spotAccount, "Binance 现货账户响应");
  for (const item of list(spot.balances, "Binance 现货 balances")) {
    addPosition(
      positions,
      text(item.asset, "asset"),
      decimalAdd(
        decimal(item.free, "free"),
        decimal(item.locked, "locked"),
      ),
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
    );
  }
  for (const item of rowsFromEarnPages(input.flexiblePages, "flexible")) {
    addPosition(
      positions,
      text(item.asset, "asset"),
      decimal(item.totalAmount, "totalAmount"),
      "earn-flexible",
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
    );
  }
  return [...positions.values()];
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

function valuePositions(input: {
  positions: BinancePosition[];
  exchangeInfo: unknown;
  tickers: unknown;
  observedAt: string;
  usdtUsdQuote: PriceQuote | null;
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
      : null;
  let total = "0";
  const holdings: AssetHolding[] = input.positions.map((position) => {
    if (position.asset === "USDT") {
      total = decimalAdd(total, position.quantity);
      return {
        symbol: position.asset,
        name: `${position.asset} · ${scopeLabel(position.account)}`,
        sourceAsset: position.asset,
        sourceAccount: position.account,
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
    exchangeRates: usdtUsdQuote
      ? [{
          baseCurrency: "USDT",
          quoteCurrency: "USD",
          rate: usdtUsdQuote.price,
          source: "CoinGecko Tether/USD 参考价格",
          observedAt: usdtUsdQuote.quotedAt.toISOString(),
        }]
      : [],
    syncedAt: input.observedAt,
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
  const [exchangeInfo, tickers, usdtUsdQuote] = await Promise.all([
    input.client.exchangeInfo(),
    input.client.tickers(),
    input.prices.quote("USDT"),
  ]);
  return {
    account: record(spotAccount, "Binance 现货账户响应"),
    snapshot: mapBinanceSnapshot({
      spotAccount,
      fundingAssets,
      flexiblePages,
      lockedPages,
      exchangeInfo,
      tickers,
      observedAt: input.observedAt,
      usdtUsdQuote,
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
      const [exchangeInfo, tickers, usdtUsdQuote] = await Promise.all([
        client.exchangeInfo(),
        client.tickers(),
        this.prices.quote("USDT"),
      ]);
      return {
        snapshot: valuePositions({
          positions: source.snapshot.holdings.map((holding) => {
            if (!holding.sourceAsset || !holding.sourceAccount) {
              throw new Error("Binance 旧快照缺少来源资产分区");
            }
            return {
              asset: holding.sourceAsset,
              account: holding.sourceAccount,
              quantity: holding.quantity,
            };
          }),
          exchangeInfo,
          tickers,
          observedAt: attemptedAt,
          usdtUsdQuote,
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
