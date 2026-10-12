import {
  createHmac,
} from "node:crypto";

import {
  decimalAdd,
  decimalCompare,
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
  OkxAuthorizationResult,
  OkxReadOnly,
  OkxRegion,
  PriceQuote,
  Prices,
} from "@/server/ports";
import { assetResponseError } from "@/server/asset-sync-diagnostics";
import { positiveDecimal } from "@/server/asset-sources/value-guards";
import { compareSourceHoldingValue, effectiveUsdtUsdQuote } from "@/server/asset-sources/valuation-policy";

type OkxFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface StoredOkxCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
  region: OkxRegion;
}

interface OkxPosition {
  asset: string;
  quantity: string;
  account: NonNullable<AssetHolding["sourceAccount"]>;
  sourceProduct?: string;
  providerPositionId?: string;
  providerPositionState?: string;
}

const OKX_ORIGINS: Record<OkxRegion, string> = {
  global: "https://openapi.okx.com",
  us: "https://us.okx.com",
  eea: "https://eea.okx.com",
};
const OKX_EQUITY_ROUNDING_TOLERANCE = "0.000000000001";
const {
  record,
  list,
  text,
  nonNegativeDecimal: decimal,
} = createJsonDecoder("OKX");

const positive = positiveDecimal;

function zeroOrEmpty(value: unknown, field: string): boolean {
  if (value === "") return true;
  return decimalCompare(decimal(value, field), "0") === 0;
}

function first(value: unknown, context: string): JsonRecord {
  const values = list(value, context);
  if (values.length !== 1) throw new Error(`${context}必须仅包含一项`);
  return values[0];
}

function region(value: unknown): OkxRegion {
  if (value === undefined) return "global";
  if (value === "global" || value === "us" || value === "eea") return value;
  throw new Error("OKX 注册区域无效");
}

export function validateOkxReadOnlyPermission(value: unknown): AssetPermission[] {
  if (typeof value !== "string") {
    throw new Error("OKX 无法证明只读权限");
  }
  const tokens = value.split(",").map((item) => item.trim());
  const unique = new Set(tokens);
  if (
    tokens.length !== 1 ||
    unique.size !== tokens.length ||
    tokens[0] !== "read_only"
  ) {
    throw new Error("检测到 OKX 非只读权限，已拒绝连接");
  }
  return ["market-data", "account", "positions"];
}

function validateAccountConfig(value: unknown): {
  permissions: AssetPermission[];
  uid: string;
  mainUid: string;
  type: string;
} {
  const config = first(value, "OKX account/config data");
  const permissions = validateOkxReadOnlyPermission(config.perm);
  if (config.acctLv !== "1") {
    throw new Error("OKX 仅接受 Spot mode 账户");
  }
  for (const field of [
    "enableSpotBorrow",
    "spotBorrowAutoRepay",
    "autoLoan",
  ] as const) {
    if (config[field] !== false) {
      throw new Error(`OKX ${field} 未明确关闭，已拒绝连接`);
    }
  }
  return {
    permissions,
    uid: text(config.uid, "uid"),
    mainUid: text(config.mainUid, "mainUid"),
    type: text(config.type, "type"),
  };
}

function validateNoOptions(value: unknown): void {
  if (list(value, "OKX OPTION positions data").length !== 0) {
    throw new Error("OKX 账户存在 Option 持仓，已拒绝连接");
  }
}

function addPosition(
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

function extractPositions(input: {
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

function scopeLabel(scope: AssetHolding["sourceAccount"]): string {
  if (scope === "spot") return "现货";
  if (scope === "trading-bot") return "交易机器人";
  if (scope === "funding") return "资金";
  if (scope === "earn-flexible") return "活期 Earn";
  if (scope === "staking") return "链上 Earn";
  return "OKX";
}

function accountValuation(value: unknown): {
  total: string;
  coverage: NonNullable<AssetSnapshot["coverage"]>;
} {
  const row = first(value, "OKX asset/asset-valuation data");
  const total = decimal(row.totalBal, "totalBal");
  const timestamp = text(row.ts, "ts");
  if (!/^\d+$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp))) {
    throw new Error("OKX asset-valuation ts 格式无效");
  }
  const details = record(row.details, "OKX asset-valuation details");
  const trading = decimal(details.trading, "details.trading");
  const funding = decimal(details.funding, "details.funding");
  const earn = decimal(details.earn, "details.earn");
  const classic = decimal(details.classic, "details.classic");
  const partitionTotal = decimalAdd(trading, funding, earn, classic);
  const difference = decimalSubtract(total, partitionTotal);
  const absoluteDifference = decimalCompare(difference, "0") < 0
    ? decimalSubtract("0", difference)
    : difference;
  const hasResidual = decimalCompare(
    absoluteDifference,
    OKX_EQUITY_ROUNDING_TOLERANCE,
  ) > 0;
  const excludedPositiveAccounts = positive(classic)
    ? ["Classic account"]
    : [];
  return {
    total,
    coverage: okxCoverage({
      unexplainedValue: hasResidual
        ? { amount: absoluteDifference, currency: "USDT" }
        : null,
      excludedPositiveAccounts,
    }),
  };
}

function okxCoverage(input: {
  unexplainedValue: NonNullable<
    AssetSnapshot["coverage"]
  >["unexplainedValue"];
  excludedPositiveAccounts: string[];
}): NonNullable<AssetSnapshot["coverage"]> {
  const complete =
    input.unexplainedValue === null &&
    input.excludedPositiveAccounts.length === 0;
  return {
    status: complete ? "complete" : "partial",
    products: [
      {
        product: "spot",
        capability: "detailed",
        freshness: "current",
        message: null,
      },
      {
        product: "trading-bot",
        capability: "aggregate-only",
        freshness: "current",
        message: "按币种读取 Trading stgyEq，不展开机器人和策略明细",
      },
      {
        product: "funding",
        capability: "detailed",
        freshness: "current",
        message: null,
      },
      {
        product: "simple-earn-flexible",
        capability: "detailed",
        freshness: "current",
        message: null,
      },
      {
        product: "simple-earn-fixed",
        capability: "aggregate-only",
        freshness: "current",
        message: "平台 Earn 总额已包含，官方当前仓位 API 无法逐仓展开",
      },
      {
        product: "onchain-earn",
        capability: "detailed",
        freshness: "current",
        message: null,
      },
    ],
    unexplainedValue: input.unexplainedValue,
    excludedPositiveAccounts: input.excludedPositiveAccounts,
  };
}

function nativeUsdtUsdQuote(
  instruments: unknown,
  tickers: unknown,
  observedAt: string,
): PriceQuote | null {
  const available = list(instruments, "OKX instruments data").some((item) =>
    item.instType === "SPOT" &&
    item.state === "live" &&
    item.instId === "USDT-USD" &&
    item.baseCcy === "USDT" &&
    item.quoteCcy === "USD"
  );
  if (!available) return null;
  const item = list(tickers, "OKX tickers data").find(
    (candidate) => candidate.instId === "USDT-USD",
  );
  if (!item) return null;
  const timestamp = text(item.ts, "ts");
  if (!/^\d+$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp))) return null;
  const quotedAt = new Date(Number(timestamp));
  const age = Math.abs(Date.parse(observedAt) - quotedAt.getTime());
  if (
    typeof item.last !== "string" ||
    !/^\d+(?:\.\d+)?$/.test(item.last)
  ) {
    return null;
  }
  const price = item.last;
  if (!Number.isFinite(age) || age > 5 * 60_000 || !positive(price)) return null;
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
  if (native) return { quote: native, source: "OKX 现货 USDT-USD" };
  return { quote: await input.prices.quote("USDT"), source: null };
}

function valuePositions(input: {
  positions: OkxPosition[];
  instruments: unknown;
  tickers: unknown;
  observedAt: string;
  usdtUsdQuote: PriceQuote | null;
  usdtUsdSource?: string | null;
  coverage?: AssetSnapshot["coverage"];
  authoritativeTotal?: AssetSnapshot["total"];
}): AssetSnapshot {
  const positionAssets = new Set(input.positions.map((position) => position.asset));
  const livePairs = new Map<string, string>();
  for (const item of list(input.instruments, "OKX instruments data")) {
    if (
      item.instType === "SPOT" &&
      item.state === "live" &&
      item.quoteCcy === "USDT"
    ) {
      const baseCcy = text(item.baseCcy, "baseCcy");
      if (positionAssets.has(baseCcy)) {
        livePairs.set(baseCcy, text(item.instId, "instId"));
      }
    }
  }
  const neededInstruments = new Set(livePairs.values());
  const tickerByInstrument = new Map<string, { price: string; pricedAt: string }>();
  for (const item of list(input.tickers, "OKX tickers data")) {
    const instrument = text(item.instId, "instId");
    if (!neededInstruments.has(instrument)) continue;
    const timestamp = text(item.ts, "ts");
    if (!/^\d+$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp))) {
      throw new Error("OKX ticker ts 格式无效");
    }
    const pricedAt = new Date(Number(timestamp));
    const age = Math.abs(Date.parse(input.observedAt) - pricedAt.getTime());
    if (!Number.isFinite(age) || age > 5 * 60_000) continue;
    if (
      typeof item.last !== "string" ||
      !/^\d+(?:\.\d+)?$/.test(item.last)
    ) {
      continue;
    }
    const price = item.last;
    if (!positive(price)) continue;
    tickerByInstrument.set(instrument, {
      price,
      pricedAt: pricedAt.toISOString(),
    });
  }
  const usdtUsdQuote = effectiveUsdtUsdQuote(input.usdtUsdQuote, input.observedAt);
  const usdtUsdSource = input.usdtUsdQuote === usdtUsdQuote
    ? input.usdtUsdSource ?? "CoinGecko Tether/USD 参考价格"
    : "USDT/USD 固定兜底（1:1）";
  let total = "0";
  const holdings: AssetHolding[] = input.positions.map((position) => {
    if (position.asset === "USDT") {
      total = decimalAdd(total, position.quantity);
      return {
        symbol: "USDT",
        name: `USDT · ${scopeLabel(position.account)}`,
        sourceAsset: "USDT",
        sourceAccount: position.account,
        ...(position.sourceProduct
          ? { sourceProduct: position.sourceProduct }
          : {}),
        ...(position.providerPositionId
          ? { providerPositionId: position.providerPositionId }
          : {}),
        ...(position.providerPositionState
          ? { providerPositionState: position.providerPositionState }
          : {}),
        quantity: position.quantity,
        currency: "USDT",
        assetClass: "crypto",
        currentPrice: { amount: "1", currency: "USDT" },
        marketValue: position.quantity,
        sourceMarketValue: { amount: position.quantity, currency: "USDT" },
        valuation: {
          status: "valued",
          priceSource: "OKX 账户 USDT 计价单位",
          pricedAt: input.observedAt,
        },
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      };
    }
    const instrument = livePairs.get(position.asset);
    const ticker = instrument ? tickerByInstrument.get(instrument) : undefined;
    if (!instrument || !ticker) {
      return {
        symbol: position.asset,
        name: `${position.asset} · ${scopeLabel(position.account)}`,
        sourceAsset: position.asset,
        sourceAccount: position.account,
        ...(position.sourceProduct
          ? { sourceProduct: position.sourceProduct }
          : {}),
        ...(position.providerPositionId
          ? { providerPositionId: position.providerPositionId }
          : {}),
        ...(position.providerPositionState
          ? { providerPositionState: position.providerPositionState }
          : {}),
        quantity: position.quantity,
        currency: "USDT",
        assetClass: "crypto",
        currentPrice: null,
        marketValue: null,
        sourceMarketValue: null,
        valuation: input.coverage?.status === "complete"
          ? {
              status: "quote-unavailable",
              reason: `OKX 平台总额已包含，但没有可靠的 ${position.asset}-USDT 持仓行情`,
            }
          : {
              status: "unvalued",
              reason: `OKX 没有可靠的 ${position.asset}-USDT 现货价格`,
            },
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      };
    }
    const marketValue = decimalMultiply(position.quantity, ticker.price);
    total = decimalAdd(total, marketValue);
    return {
      symbol: position.asset,
      name: `${position.asset} · ${scopeLabel(position.account)}`,
      sourceAsset: position.asset,
      sourceAccount: position.account,
      ...(position.sourceProduct
        ? { sourceProduct: position.sourceProduct }
        : {}),
      ...(position.providerPositionId
        ? { providerPositionId: position.providerPositionId }
        : {}),
      ...(position.providerPositionState
        ? { providerPositionState: position.providerPositionState }
        : {}),
      quantity: position.quantity,
      currency: "USDT",
      assetClass: "crypto",
      currentPrice: { amount: ticker.price, currency: "USDT" },
      marketValue,
      sourceMarketValue: { amount: marketValue, currency: "USDT" },
      valuation: {
        status: "valued",
        priceSource: `OKX 现货 ${instrument}`,
        pricedAt: ticker.pricedAt,
      },
      costPrice: null,
      platformProfit: null,
      changePercent: null,
    };
  });
  holdings.sort(compareSourceHoldingValue);
  return {
    total: input.authoritativeTotal ?? { amount: total, currency: "USDT" },
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
        sourceMarketValue: { amount: marketValue, currency: "USDT" },
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
      : { amount: total, currency: "USDT" },
    holdings: holdings.sort(compareSourceHoldingValue),
  };
}

function parseCredentials(value: string): StoredOkxCredentials {
  let credentials: JsonRecord;
  try {
    credentials = record(JSON.parse(value), "OKX 凭证");
  } catch {
    throw new Error("OKX 只读凭证格式无效");
  }
  return {
    apiKey: text(credentials.apiKey, "apiKey"),
    apiSecret: text(credentials.apiSecret, "apiSecret"),
    passphrase: text(credentials.passphrase, "passphrase"),
    region: region(credentials.region),
  };
}

class OkxClient {
  private timeOffsetMs = 0;

  constructor(
    private readonly credentials: StoredOkxCredentials,
    private readonly request: OkxFetch,
    private readonly signal?: AbortSignal,
  ) {}

  private async data(
    path: string,
    query: Record<string, string> = {},
    privateRequest = true,
    retryTimestamp = true,
  ): Promise<unknown> {
    const url = new URL(path, OKX_ORIGINS[this.credentials.region]);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    const headers = new Headers();
    if (privateRequest) {
      const timestamp = new Date(Date.now() + this.timeOffsetMs).toISOString();
      const requestPath = `${url.pathname}${url.search}`;
      const signature = createHmac("sha256", this.credentials.apiSecret)
        .update(`${timestamp}GET${requestPath}`)
        .digest("base64");
      headers.set("OK-ACCESS-KEY", this.credentials.apiKey);
      headers.set("OK-ACCESS-SIGN", signature);
      headers.set("OK-ACCESS-TIMESTAMP", timestamp);
      headers.set("OK-ACCESS-PASSPHRASE", this.credentials.passphrase);
    }
    const response = await this.request(url, {
      method: "GET",
      headers,
      cache: "no-store",
      redirect: "error",
      signal: this.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok && (body === null || typeof body !== "object")) {
      throw assetResponseError("OKX 读取失败", response);
    }
    const root = record(body, "OKX 响应");
    if (root.code === "50102" && privateRequest && retryTimestamp) {
      await this.syncTime();
      return this.data(path, query, true, false);
    }
    if (!response.ok || root.code !== "0") {
      const code = typeof root.code === "string" ? root.code : `HTTP ${response.status}`;
      const message = typeof root.msg === "string" && root.msg ? `：${root.msg}` : "";
      throw assetResponseError(`OKX 读取失败（${code}${message}）`, response, root.code);
    }
    return root.data;
  }

  async syncTime(): Promise<void> {
    const row = first(
      await this.data("/api/v5/public/time", {}, false),
      "OKX public/time data",
    );
    const timestamp = text(row.ts, "ts");
    if (!/^\d+$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp))) {
      throw new Error("OKX public time 格式无效");
    }
    this.timeOffsetMs = Number(timestamp) - Date.now();
  }

  config() { return this.data("/api/v5/account/config"); }
  options() {
    return this.data("/api/v5/account/positions", { instType: "OPTION" });
  }
  trading() { return this.data("/api/v5/account/balance"); }
  funding() { return this.data("/api/v5/asset/balances"); }
  assetValuation() {
    return this.data("/api/v5/asset/asset-valuation", { ccy: "USDT" });
  }
  savings() { return this.data("/api/v5/finance/savings/balance"); }
  onchainActiveOrders() {
    return this.data("/api/v5/finance/staking-defi/orders-active");
  }
  instruments() {
    return this.data(
      "/api/v5/public/instruments",
      { instType: "SPOT" },
      false,
    );
  }
  tickers() {
    return this.data(
      "/api/v5/market/tickers",
      { instType: "SPOT" },
      false,
    );
  }
}

async function readFullSnapshot(input: {
  client: OkxClient;
  prices: Prices;
  observedAt: string;
}): Promise<{
  identity: ReturnType<typeof validateAccountConfig>;
  snapshot: AssetSnapshot;
}> {
  await input.client.syncTime();
  const identity = validateAccountConfig(await input.client.config());
  validateNoOptions(await input.client.options());
  const trading = await input.client.trading();
  const funding = await input.client.funding();
  const valuation = accountValuation(await input.client.assetValuation());
  const savings = await input.client.savings();
  const onchainActiveOrders = await input.client.onchainActiveOrders();
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
  return {
    identity,
    snapshot: valuePositions({
      positions: extractPositions({
        trading,
        funding,
        savings,
        onchainActiveOrders,
      }),
      instruments,
      tickers,
      observedAt: input.observedAt,
      usdtUsdQuote: usdtUsd.quote,
      usdtUsdSource: usdtUsd.source,
      coverage: valuation.coverage,
      authoritativeTotal: {
        amount: valuation.total,
        currency: "USDT",
      },
    }),
  };
}

export class ProductionOkxReadOnly implements OkxReadOnly {
  constructor(
    private readonly prices: Prices,
    private readonly request: OkxFetch = globalThis.fetch,
  ) {}

  preview(input: {
    apiKey: string;
    apiSecret: string;
    passphrase: string;
    region?: OkxRegion;
    observedAt: string;
  }): Promise<OkxAuthorizationResult> {
    if (
      input.apiKey.trim().length < 8 ||
      input.apiSecret.trim().length < 8 ||
      input.passphrase.trim().length < 4
    ) {
      return Promise.reject(new Error("OKX API Key、Secret 或 Passphrase 格式无效"));
    }
    return this.authorize({
      apiKey: input.apiKey.trim(),
      apiSecret: input.apiSecret.trim(),
      passphrase: input.passphrase.trim(),
      region: region(input.region),
    }, input.observedAt);
  }

  revalidate(input: {
    credentials: string;
    observedAt: string;
  }): Promise<OkxAuthorizationResult> {
    return this.authorize(parseCredentials(input.credentials), input.observedAt);
  }

  private async authorize(
    credentials: StoredOkxCredentials,
    observedAt: string,
  ): Promise<OkxAuthorizationResult> {
    const result = await readFullSnapshot({
      client: new OkxClient(credentials, this.request),
      prices: this.prices,
      observedAt,
    });
    return {
      credentials: JSON.stringify(credentials),
      permissions: result.identity.permissions,
      account: {
        id: `okx:${result.identity.uid}`,
        label: `OKX 账户 · UID ${result.identity.uid}`,
      },
      scopeFingerprint: [
        result.identity.uid,
        result.identity.mainUid,
        result.identity.type,
      ].join(":"),
      snapshot: result.snapshot,
    };
  }
}

export class ProductionOkxSourceRefresher implements AssetSourceRefresher {
  constructor(
    private readonly prices: Prices,
    private readonly request: OkxFetch = globalThis.fetch,
  ) {}

  async refresh({
    source,
    credentials,
    mode,
    attemptedAt,
    signal,
  }: Parameters<AssetSourceRefresher["refresh"]>[0]): Promise<AssetSourceRefreshResult> {
    if (source.kind !== "okx") {
      throw new Error(`OKX 刷新器不支持来源类型：${source.kind}`);
    }
    const stored = parseCredentials(credentials);
    const client = new OkxClient(stored, this.request, signal);
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
              throw new Error("OKX 旧快照缺少来源资产分区");
            }
            return {
              asset: holding.sourceAsset,
              account: holding.sourceAccount,
              quantity: holding.quantity,
              ...(holding.sourceProduct
                ? { sourceProduct: holding.sourceProduct }
                : {}),
              ...(holding.providerPositionId
                ? { providerPositionId: holding.providerPositionId }
                : {}),
              ...(holding.providerPositionState
                ? { providerPositionState: holding.providerPositionState }
                : {}),
            };
          }),
          instruments,
          tickers,
          observedAt: attemptedAt,
          usdtUsdQuote: usdtUsd.quote,
          usdtUsdSource: usdtUsd.source,
          coverage: source.snapshot.coverage,
          authoritativeTotal: source.snapshot.total,
        });
      return {
        snapshot: preserveNewerPrices(source.snapshot, candidate),
      };
    }
    const candidate = (await readFullSnapshot({
        client,
        prices: this.prices,
        observedAt: attemptedAt,
      })).snapshot;
    return {
      snapshot: preserveNewerPrices(source.snapshot, candidate),
    };
  }
}
