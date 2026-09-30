import {
  createHash,
  randomBytes,
} from "node:crypto";

import type {
  AssetCashBalance,
  AssetExchangeRate,
  AssetSourceRefreshResult,
  AssetSourceRefresher,
  AssetHolding,
  AssetSnapshot,
  AssetQuoteEvidence,
  FormalSettlementCandleReader,
  FormalSettlementDailyCandle,
  LongbridgeHoldingCandlestick,
  LongbridgeHoldingCandlestickReader,
  LongbridgeHoldingCandlestickPeriod,
  LongbridgeHoldingCandlePeriod,
  LongbridgeHoldingTrendPoint,
  LongbridgeBenchmarkCandlestick,
  LongbridgeBenchmarkCandlestickReader,
  LongbridgeBenchmarkSymbol,
  LongbridgeAuthorizationResult,
  LongbridgeOAuth,
} from "@/server/ports";
import {
  LongbridgeKeychainSdk,
  type LongbridgeNativeQuote,
} from "@/server/asset-sources/longbridge-keychain-sdk";
import {
  decimalAdd,
  decimalCompare,
  decimalDivide,
  decimalMultiply,
} from "@/domain/decimal";
import {
  isLongbridgeUsOptionSymbol,
  supportsLongbridgeCandlesticks,
} from "@/domain/longbridge-symbols";
import { assetResponseError, AssetRequestError, hasManagedAssetRetry } from "@/server/asset-sync-diagnostics";
import { LongbridgeServeMarketData } from "@/server/asset-sources/longbridge-serve-market-data";

export { isLongbridgeUsOptionSymbol } from "@/domain/longbridge-symbols";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("长桥响应格式无效");
  }
  return value as JsonRecord;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`长桥响应缺少 ${field}`);
  }
  return value;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalUnixSecondsIso(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  const seconds =
    typeof value === "number" && Number.isSafeInteger(value)
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(seconds) || seconds < 0) {
    throw new Error(`长桥响应 ${field} 格式无效`);
  }
  const timestamp = new Date(seconds * 1000);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`长桥响应 ${field} 格式无效`);
  }
  return timestamp.toISOString();
}

function safeQuoteTimestamp(value: unknown): string | null {
  try {
    return optionalUnixSecondsIso(value, "quote.timestamp");
  } catch {
    return null;
  }
}

function quotePrice(value: unknown): string | null {
  return typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)
    ? value
    : null;
}

type LongbridgeQuoteSession = Exclude<
  AssetQuoteEvidence["session"],
  "crypto-24h"
>;

interface LongbridgeQuoteSelection {
  price: string;
  session: LongbridgeQuoteSession;
  quotedAt: string | null;
  delivery: "delayed" | "unknown";
  tradeStatus: string | null;
}

interface KnownLongbridgeQuoteCandidate extends LongbridgeQuoteSelection {
  quotedAt: string;
}

function longbridgeQuoteCandidate(
  session: Exclude<LongbridgeQuoteSession, "unknown">,
  quote: { lastDone: string; timestamp: number } | null | undefined,
  delivery: "delayed" | "unknown",
  tradeStatus: string | null,
): KnownLongbridgeQuoteCandidate | null {
  const price = quotePrice(quote?.lastDone);
  const quotedAt = safeQuoteTimestamp(quote?.timestamp);
  return price === null || quotedAt === null
    ? null
    : { price, session, quotedAt, delivery, tradeStatus };
}

/**
 * 当前证券报价只由 Longbridge 返回的交易状态、盘外候选及其时间戳决定。
 * 不读取本机时间、市场日历或标的后缀来推断报价所属时段。
 */
function selectLongbridgeQuote(
  quote: LongbridgeNativeQuote,
): LongbridgeQuoteSelection | null {
  const tradeStatus = typeof quote.tradeStatus === "string"
    ? quote.tradeStatus
    : null;
  const delivery = quote.delivery === "delayed" ? "delayed" : "unknown";
  const primaryPrice = quotePrice(quote.lastDone);
  const primaryTimestamp = safeQuoteTimestamp(quote.timestamp);
  const candidates = [
    ...(tradeStatus === "NORMAL"
      ? [
          longbridgeQuoteCandidate(
            "regular",
            quote,
            delivery,
            tradeStatus,
          ),
        ]
      : []),
    longbridgeQuoteCandidate(
      "pre-market",
      quote.preMarketQuote,
      delivery,
      tradeStatus,
    ),
    longbridgeQuoteCandidate(
      "post-market",
      quote.postMarketQuote,
      delivery,
      tradeStatus,
    ),
    longbridgeQuoteCandidate(
      "overnight",
      quote.overnightQuote,
      delivery,
      tradeStatus,
    ),
  ].filter((candidate): candidate is KnownLongbridgeQuoteCandidate => candidate !== null);

  if (candidates.length > 0) {
    const latestAt = candidates.reduce(
      (latest, candidate) => latest > candidate.quotedAt ? latest : candidate.quotedAt,
      candidates[0].quotedAt,
    );
    const latest = candidates.filter((candidate) => candidate.quotedAt === latestAt);
    if (latest.length === 1) return latest[0];
    if (primaryPrice !== null) {
      return {
        price: primaryPrice,
        session: "unknown",
        quotedAt: primaryTimestamp,
        delivery,
        tradeStatus,
      };
    }
    return {
      ...latest[0],
      session: "unknown",
    };
  }

  return primaryPrice === null
    ? null
    : {
        price: primaryPrice,
        session: "unknown",
        quotedAt: primaryTimestamp,
        delivery,
        tradeStatus,
      };
}

function quoteEvidence(
  selection: LongbridgeQuoteSelection,
  observedAt: string,
): AssetQuoteEvidence {
  return {
    session: selection.session,
    quotedAt: selection.quotedAt,
    observedAt,
    freshness: "current",
    delivery: selection.delivery,
    provider: {
      name: "longbridge",
      tradeStatus: selection.tradeStatus,
    },
  };
}

function listFromPage(page: unknown): JsonRecord[] {
  const root = record(page);
  if (Array.isArray(root.data)) return root.data.map(record);
  const data =
    typeof root.data === "object" && root.data !== null
      ? record(root.data)
      : root;
  const direct = Array.isArray(data.list) ? data.list : null;
  if (direct) {
    return direct.flatMap((entry) => {
      const item = record(entry);
      const nested = Array.isArray(item.stock_info)
        ? item.stock_info
        : Array.isArray(item.fund_info)
          ? item.fund_info
        : Array.isArray(item.positions)
          ? item.positions
          : null;
      return nested ? nested.map(record) : [item];
    });
  }
  const channels = Array.isArray(data.channels) ? data.channels : [];
  return channels.flatMap((channel) => {
    const value = record(channel);
    const entries = Array.isArray(value.positions)
      ? value.positions
      : Array.isArray(value.stock_info)
        ? value.stock_info
        : Array.isArray(value.fund_info)
          ? value.fund_info
        : [];
    return entries.map(record);
  });
}

function compareDecimal(left: string, right: string): number {
  const normalize = (value: string) => {
    const [integer = "0", fraction = ""] = value.replace(/^\+/, "").split(".");
    return { integer: integer.replace(/^0+(?=\d)/, ""), fraction };
  };
  const a = normalize(left);
  const b = normalize(right);
  if (a.integer.length !== b.integer.length) {
    return a.integer.length - b.integer.length;
  }
  const integerOrder = a.integer.localeCompare(b.integer);
  if (integerOrder !== 0) return integerOrder;
  const width = Math.max(a.fraction.length, b.fraction.length);
  return a.fraction.padEnd(width, "0").localeCompare(b.fraction.padEnd(width, "0"));
}

function decimalText(value: unknown, field: string): string {
  if (
    typeof value === "string" &&
    /^\d+(?:\.\d+)?$/.test(value) &&
    Number(value) > 0
  ) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return String(value);
  }
  throw new Error(`长桥响应 ${field} 格式无效`);
}

function mapLongbridgeExchangeRates(
  values: unknown[],
  observedAt: string,
): AssetExchangeRate[] {
  return values.map((value) => {
    const rate = record(value);
    return {
      // Longbridge 的 average_rate 单位是 base_currency / other_currency，
      // 即一单位 other_currency 可换得多少 base_currency。
      baseCurrency: text(rate.other_currency, "other_currency"),
      quoteCurrency: text(rate.base_currency, "base_currency"),
      rate: decimalText(rate.average_rate, "average_rate"),
      source: "Longbridge 官方账户汇率",
      observedAt,
    };
  });
}

function convertLongbridgeAmount(
  amount: string,
  from: string,
  to: string,
  rates: AssetExchangeRate[],
): string | null {
  if (from === to) return amount;
  const direct = rates.find(
    (rate) => rate.baseCurrency === from && rate.quoteCurrency === to,
  );
  if (direct) return decimalMultiply(amount, direct.rate);
  const inverse = rates.find(
    (rate) => rate.baseCurrency === to && rate.quoteCurrency === from,
  );
  return inverse ? decimalDivide(amount, inverse.rate) : null;
}

export function mapLongbridgeSnapshot(input: {
  accountPages: unknown[];
  positionPages: unknown[];
  syncedAt: string;
  quotes?: LongbridgeNativeQuote[];
  exchangeRates?: unknown[];
}): AssetSnapshot {
  const account = listFromPage(input.accountPages[0] ?? {}).at(0);
  if (!account) throw new Error("长桥账户预览为空");
  const accountCurrency = text(account.currency, "currency");
  const quotes = new Map(
    (input.quotes ?? []).map((quote) => [quote.symbol, quote]),
  );
  const exchangeRates = mapLongbridgeExchangeRates(
    input.exchangeRates ?? [],
    input.syncedAt,
  );
  const positionHoldings: AssetHolding[] = input.positionPages
    .flatMap(listFromPage)
    .map((item) => {
      const symbol = text(item.symbol, "symbol");
      const quantity = text(item.quantity ?? item.holding_units, "quantity");
      const nativePrice = optionalText(item.current_net_asset_value);
      const quote = quotes.get(symbol);
      const selectedQuote = quote && !isLongbridgeUsOptionSymbol(symbol)
        ? selectLongbridgeQuote(quote)
        : null;
      const price = nativePrice ?? selectedQuote?.price ?? null;
      const currency = text(item.currency, "currency");
      const marketValue =
        optionalText(item.market_value) ??
        (price ? multiplyDecimal(quantity, price) : null);
      const sourceAmount =
        marketValue === null
          ? null
          : convertLongbridgeAmount(
              marketValue,
              currency,
              accountCurrency,
              exchangeRates,
            );
      const pricedAt = nativePrice
        ? optionalUnixSecondsIso(
            item.net_asset_value_day,
            "net_asset_value_day",
          ) ?? input.syncedAt
        : selectedQuote
          ? selectedQuote.quotedAt ?? input.syncedAt
        : input.syncedAt;
      const priceSource = nativePrice
        ? "Longbridge 基金净值"
        : selectedQuote
          ? "Longbridge 行情"
        : optionalText(item.market_value)
          ? "Longbridge 账户估值"
          : null;
      return {
        symbol,
        name: text(item.symbol_name ?? item.name ?? item.fund_name, "symbol_name"),
        quantity,
        currency,
        assetClass: "securities" as const,
        currentPrice: price ? { amount: price, currency } : null,
        ...(nativePrice === null && selectedQuote
          ? { quoteEvidence: quoteEvidence(selectedQuote, input.syncedAt) }
          : {}),
        previousClose: quote
          ? { amount: quote.prevClose, currency }
          : null,
        marketValue,
        sourceMarketValue:
          sourceAmount === null
            ? null
            : { amount: sourceAmount, currency: accountCurrency },
        valuation:
          sourceAmount !== null && priceSource
            ? { status: "valued" as const, priceSource, pricedAt }
            : marketValue === null && isLongbridgeUsOptionSymbol(symbol)
              ? {
                  status: "quote-unavailable" as const,
                  reason: "Longbridge Open API 未接入期权行情",
                }
            : {
                status: "unvalued" as const,
                reason: marketValue === null
                  ? "Longbridge 未返回可靠价格"
                  : `缺少 ${currency}/${accountCurrency} 来源汇率`,
              },
        costPrice: optionalText(item.cost_price ?? item.cost_net_asset_value),
        platformProfit: optionalText(
          item.unrealized_pl ?? item.platform_profit,
        ),
        changePercent:
          optionalText(item.change_rate ?? item.change_percent),
      };
    });
  const totalCash = optionalText(account.total_cash);
  const cashBalances: AssetCashBalance[] = (
    Array.isArray(account.cash_infos) ? account.cash_infos : []
  )
    .map((value) => {
      const cash = record(value);
      const availableCash = text(cash.available_cash, "available_cash");
      const frozenCash = text(cash.frozen_cash, "frozen_cash");
      return {
        amount: decimalAdd(availableCash, frozenCash),
        availableCash,
        currency: text(cash.currency, "currency"),
        frozenCash,
        settlingCash: text(cash.settling_cash, "settling_cash"),
        withdrawCash: text(cash.withdraw_cash, "withdraw_cash"),
      };
    })
    .filter(({ amount }) => decimalCompare(amount, "0") !== 0);
  const cashHoldings: AssetHolding[] = totalCash === null
    ? []
    : [{
        symbol: `CASH.${accountCurrency}`,
        name: "账户现金",
        sourceAsset: `cash:${accountCurrency}`,
        quantity: totalCash,
        currency: accountCurrency,
        assetClass: "cash",
        ...(cashBalances.length > 0 ? { cashBalances } : {}),
        currentPrice: { amount: "1", currency: accountCurrency },
        previousClose: null,
        marketValue: totalCash,
        sourceMarketValue: {
          amount: totalCash,
          currency: accountCurrency,
        },
        valuation: {
          status: "valued",
          priceSource: "Longbridge 账户现金总额",
          pricedAt: input.syncedAt,
        },
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      }];
  const holdings = [...positionHoldings, ...cashHoldings]
    .sort((left, right) => {
      if (left.sourceMarketValue === null) return right.sourceMarketValue === null ? 0 : 1;
      if (right.sourceMarketValue === null) return -1;
      return compareDecimal(right.sourceMarketValue.amount, left.sourceMarketValue.amount);
    });
  return {
    total: {
      amount: text(account.net_assets, "net_assets"),
      currency: accountCurrency,
    },
    holdings,
    exchangeRates,
    syncedAt: input.syncedAt,
  };
}

function multiplyDecimal(left: string, right: string): string {
  const parts = (value: string) => {
    const negative = value.startsWith("-");
    const unsigned = value.replace(/^[+-]/, "");
    const [integer = "0", fraction = ""] = unsigned.split(".");
    return {
      negative,
      digits: BigInt(`${integer}${fraction}` || "0"),
      scale: fraction.length,
    };
  };
  const a = parts(left);
  const b = parts(right);
  const scale = a.scale + b.scale;
  const sign = a.negative !== b.negative ? "-" : "";
  const digits = (a.digits * b.digits).toString().padStart(scale + 1, "0");
  if (scale === 0) return `${sign}${digits}`;
  const integer = digits.slice(0, -scale);
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  return fraction ? `${sign}${integer}.${fraction}` : `${sign}${integer}`;
}

interface StartedAuthorization {
  codeVerifier: string;
  redirectUri: string;
  reauthorization?: {
    sourceId: string;
    expectedAccountId: string;
  };
  expiresAt: number;
}

/** OAuth PKCE 临时态只在服务端内存中存活。 */
export class LongbridgeOAuthState {
  private readonly starts = new Map<string, StartedAuthorization>();
  private readonly startTimers = new Map<string, NodeJS.Timeout>();

  private clearStart(state: string): void {
    this.starts.delete(state);
    const timer = this.startTimers.get(state);
    if (timer) clearTimeout(timer);
    this.startTimers.delete(state);
  }

  rememberStart(
    state: string,
    value: Omit<StartedAuthorization, "expiresAt">,
  ): void {
    this.clearStart(state);
    const expiresAt = Date.now() + 10 * 60_000;
    this.starts.set(state, { ...value, expiresAt });
    const timer = setTimeout(() => this.clearStart(state), expiresAt - Date.now());
    timer.unref();
    this.startTimers.set(state, timer);
  }

  consumeStart(state: string): StartedAuthorization | null {
    const value = this.starts.get(state) ?? null;
    this.clearStart(state);
    return value && value.expiresAt >= Date.now() ? value : null;
  }

}

const LONGBRIDGE_AUTHORIZATION_ENDPOINT =
  "https://openapi.longbridge.com/oauth2/authorize";
const LONGBRIDGE_TOKEN_ENDPOINT =
  "https://openapi.longbridge.com/oauth2/token";
const LONGBRIDGE_API_ORIGIN = "https://openapi.longbridge.com";
const READ_ONLY_SCOPE = "6";
const ACCOUNT_READ_SCOPE = "account.read";
const COMBINED_READ_ONLY_SCOPES = [
  "watchlist",
  ACCOUNT_READ_SCOPE,
  "trade.read",
] as const;
const ASSET_PATHS = [
  "/v1/asset/account",
  "/v1/asset/stock",
  "/v1/asset/fund",
] as const;

type LongbridgeFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface TokenResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  scopes: string[];
}

interface StoredLongbridgeCredentials {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  obtainedAt: string | null;
  validatedScopes: string[];
}

function base64Url(value: Buffer): string {
  return value.toString("base64url");
}

function oauthClientId(): string {
  const value = process.env.LONGBRIDGE_OAUTH_CLIENT_ID;
  if (!value) throw new Error("未配置 LONGBRIDGE_OAUTH_CLIENT_ID");
  return value;
}

function validateReadOnlyScopes(scopes: string[]): string[] {
  if (scopes.includes("11")) {
    throw new Error("检测到长桥交易写权限，已拒绝连接");
  }
  const isSingleReadOnly =
    scopes.length === 1 &&
    [READ_ONLY_SCOPE, ACCOUNT_READ_SCOPE].includes(scopes[0] ?? "");
  const isCombinedReadOnly =
    scopes.length === COMBINED_READ_ONLY_SCOPES.length &&
    COMBINED_READ_ONLY_SCOPES.every((scope) => scopes.includes(scope));
  if (!isSingleReadOnly && !isCombinedReadOnly) {
    throw new Error(`长桥授权范围不是允许的只读范围（实际：${scopes.join(" ")}）`);
  }
  return scopes;
}

function parseTokenResponse(value: unknown): TokenResponse {
  const token = record(value);
  const scope = token.scope;
  if (typeof scope !== "string" || scope.trim().length === 0) {
    throw new Error("长桥未返回授权范围，无法证明凭证为只读");
  }
  const scopes = validateReadOnlyScopes(scope.trim().split(/\s+/));
  if (token.token_type !== "Bearer") {
    throw new Error("长桥 token 类型不是 Bearer，已拒绝连接");
  }
  return {
    accessToken: text(token.access_token, "access_token"),
    refreshToken: optionalText(token.refresh_token),
    expiresIn:
      typeof token.expires_in === "number" && Number.isFinite(token.expires_in)
        ? token.expires_in
        : null,
    scopes,
  };
}

function parseStoredCredentials(credentials: string): StoredLongbridgeCredentials {
  let value: JsonRecord;
  try {
    value = record(JSON.parse(credentials));
  } catch {
    throw new Error("长桥只读凭证格式无效");
  }
  const rawScopes = value.validatedScopes;
  if (!Array.isArray(rawScopes) || !rawScopes.every((scope) => typeof scope === "string")) {
    throw new Error("长桥凭证无法证明授权范围，已停止同步");
  }
  return {
    accessToken: text(value.accessToken, "accessToken"),
    refreshToken: optionalText(value.refreshToken),
    expiresIn:
      typeof value.expiresIn === "number" && Number.isFinite(value.expiresIn)
        ? value.expiresIn
        : null,
    obtainedAt: optionalText(value.obtainedAt),
    validatedScopes: validateReadOnlyScopes(rawScopes),
  };
}

function parseRefreshTokenResponse(
  value: unknown,
  previous: StoredLongbridgeCredentials,
  obtainedAt: string,
): StoredLongbridgeCredentials {
  const token = record(value);
  if (token.token_type !== "Bearer") {
    throw new Error("长桥刷新 token 类型不是 Bearer，已拒绝使用");
  }
  let scopes: string[];
  if (!Object.hasOwn(token, "scope")) {
    scopes = validateReadOnlyScopes(previous.validatedScopes);
  } else if (typeof token.scope === "string" && token.scope.trim().length > 0) {
    scopes = validateReadOnlyScopes(token.scope.trim().split(/\s+/));
  } else {
    throw new Error("长桥刷新响应 scope 格式无效，已拒绝使用");
  }
  return {
    accessToken: text(token.access_token, "access_token"),
    refreshToken: optionalText(token.refresh_token) ?? previous.refreshToken,
    expiresIn:
      typeof token.expires_in === "number" && Number.isFinite(token.expires_in)
        ? token.expires_in
        : previous.expiresIn,
    obtainedAt,
    validatedScopes: scopes,
  };
}

function responseData(value: unknown): unknown {
  const root = record(value);
  if (typeof root.code === "number" && root.code !== 0) {
    throw new Error(
      typeof root.message === "string" && root.message.length > 0
        ? `长桥读取失败：${root.message}`
        : `长桥读取失败（${root.code}）`,
    );
  }
  return value;
}

function jwtAccountIdentity(
  accessToken: string,
): { channel: string; fingerprint: string } | null {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return null;
    const claims = record(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    const subjectText = text(claims.sub, "sub");
    const subject = JSON.parse(subjectText) as unknown;
    const channel = optionalText(record(subject).account_channel);
    return channel
      ? {
          channel,
          fingerprint: createHash("sha256")
            .update(subjectText)
            .digest("hex")
            .slice(0, 12),
        }
      : null;
  } catch {
    return null;
  }
}

/**
 * 受控 OAuth 只请求官方 account.read(6)，并以 token 响应中的实际 scope
 * 作为保存前的权限证明。外部数据请求固定为三个 GET 资产端点。
 */
export class ProductionLongbridgeOAuth implements LongbridgeOAuth {
  constructor(private readonly request: LongbridgeFetch = globalThis.fetch) {}

  private async readAuthorization(
    credentials: string,
    accessToken: string,
    observedAt: string,
  ): Promise<LongbridgeAuthorizationResult> {
    const identity = jwtAccountIdentity(accessToken);
    if (!identity) throw new Error("长桥未返回可确认的 OAuth 账户主体");
    const pages: unknown[] = [];
    for (const path of ASSET_PATHS) {
      const response = await this.request(`${LONGBRIDGE_API_ORIGIN}${path}`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: "application/json",
        },
        cache: "no-store",
      });
      if (!response.ok) {
        throw assetResponseError(`长桥资产读取失败（HTTP ${response.status}）`, response);
      }
      pages.push(responseData(await response.json()));
    }
    const [accountPage, stockPage, fundPage] = pages;
    const account = listFromPage(accountPage).at(0);
    if (!account) throw new Error("长桥账户预览为空");
    const accountCurrency = text(account.currency, "currency");
    return {
      credentials,
      permissions: ["account", "positions"],
      account: {
        id: `longbridge:${identity.fingerprint}`,
        label: `长桥账户（类型 ${identity.channel} · ${accountCurrency} · ${identity.fingerprint}）`,
      },
      snapshot: mapLongbridgeSnapshot({
        accountPages: [accountPage],
        positionPages: [stockPage, fundPage],
        syncedAt: observedAt,
      }),
    };
  }

  async start(redirectUri: string): Promise<{
    authorizationUrl: string;
    state: string;
    codeVerifier: string;
  }> {
    const state = base64Url(randomBytes(32));
    const codeVerifier = base64Url(randomBytes(32));
    const codeChallenge = base64Url(
      createHash("sha256").update(codeVerifier).digest(),
    );
    const authorizationUrl = new URL(LONGBRIDGE_AUTHORIZATION_ENDPOINT);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", oauthClientId());
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("scope", READ_ONLY_SCOPE);
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("code_challenge", codeChallenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    return { authorizationUrl: authorizationUrl.toString(), state, codeVerifier };
  }

  async finish(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<LongbridgeAuthorizationResult> {
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      client_id: oauthClientId(),
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    });
    const tokenResponse = await this.request(LONGBRIDGE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
      cache: "no-store",
    });
    if (!tokenResponse.ok) {
      throw new Error(`长桥授权兑换失败（HTTP ${tokenResponse.status}）`);
    }
    const token = parseTokenResponse(await tokenResponse.json());
    const syncedAt = new Date().toISOString();
    const credentials = JSON.stringify({
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresIn: token.expiresIn,
        obtainedAt: syncedAt,
        validatedScopes: token.scopes,
      });
    return this.readAuthorization(
      credentials,
      token.accessToken,
      syncedAt,
    );
  }

  async revalidate(input: {
    credentials: string;
    observedAt: string;
  }): Promise<LongbridgeAuthorizationResult> {
    const stored = parseStoredCredentials(input.credentials);
    return this.readAuthorization(
      input.credentials,
      stored.accessToken,
      input.observedAt,
    );
  }
}

function needsCredentialRefresh(
  credentials: StoredLongbridgeCredentials,
  attemptedAt: string,
): boolean {
  if (credentials.refreshToken === null) return false;
  if (credentials.obtainedAt === null) return true;
  if (credentials.expiresIn === null) return false;
  const obtainedAt = Date.parse(credentials.obtainedAt);
  const attempted = Date.parse(attemptedAt);
  if (!Number.isFinite(obtainedAt) || !Number.isFinite(attempted)) return true;
  return attempted >= obtainedAt + credentials.expiresIn * 1000 - 5 * 60_000;
}

/** 已保存来源的只读刷新器；由统一完整批次或手动单来源意图调用。 */
export class ProductionLongbridgeSourceRefresher
  implements AssetSourceRefresher
{
  constructor(private readonly request: LongbridgeFetch = globalThis.fetch) {}

  private async rotateCredentials(
    previous: StoredLongbridgeCredentials,
    attemptedAt: string,
    signal: AbortSignal,
  ): Promise<StoredLongbridgeCredentials> {
    if (previous.refreshToken === null) {
      throw new Error("长桥 refresh token 不可用，需要重新授权");
    }
    const form = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: oauthClientId(),
      refresh_token: previous.refreshToken,
    });
    const response = await this.request(LONGBRIDGE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
      cache: "no-store",
      signal,
    });
    if (!response.ok) {
      throw assetResponseError(`长桥 token 刷新失败（HTTP ${response.status}）`, response, undefined, "credentials");
    }
    return parseRefreshTokenResponse(
      await response.json(),
      previous,
      attemptedAt,
    );
  }

  async refresh({
    source,
    credentials,
    mode,
    attemptedAt,
    signal,
    persistCredentials,
  }: Parameters<AssetSourceRefresher["refresh"]>[0]): Promise<AssetSourceRefreshResult> {
    if (source.kind !== "longbridge") {
      throw new Error(`暂不支持刷新来源类型：${source.kind}`);
    }
    if (mode === "prices") {
      return { snapshot: source.snapshot };
    }
    let stored = parseStoredCredentials(credentials);
    if (needsCredentialRefresh(stored, attemptedAt)) {
      stored = await this.rotateCredentials(stored, attemptedAt, signal);
      await persistCredentials(JSON.stringify(stored));
    }
    const accessToken = stored.accessToken;
    const pages: unknown[] = [];
    for (const path of ASSET_PATHS) {
      const response = await this.request(`${LONGBRIDGE_API_ORIGIN}${path}`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: "application/json",
        },
        cache: "no-store",
        signal,
      });
      if (!response.ok) {
        throw assetResponseError(`长桥资产读取失败（HTTP ${response.status}）`, response);
      }
      pages.push(responseData(await response.json()));
    }
    const [accountPage, stockPage, fundPage] = pages;
    const positionPages = [stockPage, fundPage];
    return {
      snapshot: mapLongbridgeSnapshot({
        accountPages: [accountPage],
        positionPages,
        syncedAt: attemptedAt,
      }),
    };
  }
}

type LongbridgeKeychainReadSdk = Pick<
  LongbridgeKeychainSdk,
  | "beginAuthorization"
  | "beginBrowserAuthorization"
  | "completeBrowserAuthorization"
  | "authorizationStatus"
  | "credentialReference"
  | "readAssets"
  | "readQuotes"
  | "readDailyCandles"
  | "readCandlesticks"
  | "readFiveDayTrend"
>;

const LONGBRIDGE_KEYCHAIN_REPAIR_COMMAND =
  "pnpm longbridge:keychain:repair";

function isKeychainAuthenticationFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("Platform secure storage failure") ||
    error.message.includes(
      "The user name or passphrase you entered is not correct",
    )
  );
}

function keychainRepairError(): Error {
  return new Error(
    `macOS 登录钥匙串暂时无法读取长桥凭证，请运行 ${LONGBRIDGE_KEYCHAIN_REPAIR_COMMAND} 后重试同步`,
  );
}

async function withKeychainAuthenticationRetry<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isKeychainAuthenticationFailure(error)) throw error;
    if (hasManagedAssetRetry()) {
      throw new AssetRequestError("长桥凭证不可用", 401, null, null, "credentials");
    }
  }

  try {
    return await operation();
  } catch (error) {
    if (isKeychainAuthenticationFailure(error)) {
      throw keychainRepairError();
    }
    throw error;
  }
}

function stockSymbols(page: unknown): string[] {
  return [
    ...new Set(
      listFromPage(page)
        .map((item) => text(item.symbol, "symbol"))
        .filter((symbol) => !isLongbridgeUsOptionSymbol(symbol)),
    ),
  ];
}

async function keychainSnapshot(
  sdk: LongbridgeKeychainReadSdk,
  syncedAt: string,
): Promise<AssetSnapshot> {
  return withKeychainAuthenticationRetry(async () => {
    const assets = await sdk.readAssets("USD");
    const quotes = await sdk.readQuotes(stockSymbols(assets.stockPage));
    return mapLongbridgeSnapshot({
      accountPages: [assets.accountPage],
      positionPages: [assets.stockPage, assets.fundPage],
      quotes,
      exchangeRates: assets.exchangeRates,
      syncedAt,
    });
  });
}

export function snapshotWithQuotes(
  snapshot: AssetSnapshot,
  quotes: LongbridgeNativeQuote[],
  syncedAt: string,
): AssetSnapshot {
  const bySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
  return {
    ...snapshot,
    syncedAt,
    holdings: snapshot.holdings.map((holding) => {
      const quote = bySymbol.get(holding.symbol);
      const selectedQuote = quote && !isLongbridgeUsOptionSymbol(holding.symbol)
        ? selectLongbridgeQuote(quote)
        : null;
      if (!quote || !selectedQuote) {
        return holding.quoteEvidence === undefined
          ? holding
          : {
              ...holding,
              quoteEvidence: {
                ...holding.quoteEvidence,
                freshness: "retained",
              },
            };
      }
      const marketValue = multiplyDecimal(holding.quantity, selectedQuote.price);
      const pricedAt = selectedQuote.quotedAt ?? syncedAt;
      return {
        ...holding,
        currentPrice: { amount: selectedQuote.price, currency: holding.currency },
        quoteEvidence: quoteEvidence(selectedQuote, syncedAt),
        previousClose: { amount: quote.prevClose, currency: holding.currency },
        marketValue,
        sourceMarketValue:
          holding.currency === snapshot.total.currency
            ? { amount: marketValue, currency: snapshot.total.currency }
            : null,
        valuation:
          holding.currency === snapshot.total.currency
            ? {
              status: "valued" as const,
                priceSource: "Longbridge 行情",
                pricedAt,
              }
            : {
                status: "unvalued" as const,
                reason: `缺少 ${holding.currency}/${snapshot.total.currency} 来源汇率`,
              },
      };
    }),
  };
}

/**
 * 完整持仓刷新已成功时，单标的报价仍可能因权限或供应商部分响应缺失。
 * 保留最后一份可核验报价，并明确其不是本次确认的报价。
 */
export function snapshotRetainingMissingQuotes(
  snapshot: AssetSnapshot,
  previous: AssetSnapshot,
): AssetSnapshot {
  const previousBySymbol = new Map(
    previous.holdings.map((holding) => [holding.symbol, holding]),
  );
  return {
    ...snapshot,
    holdings: snapshot.holdings.map((holding) => {
      if (holding.currentPrice !== null || holding.quoteEvidence !== undefined) {
        return holding;
      }
      const retained = previousBySymbol.get(holding.symbol);
      if (
        retained?.currentPrice === null ||
        retained?.currentPrice === undefined ||
        retained.quoteEvidence === undefined
      ) {
        return holding;
      }
      const marketValue = multiplyDecimal(
        holding.quantity,
        retained.currentPrice.amount,
      );
      const sourceAmount = convertLongbridgeAmount(
        marketValue,
        holding.currency,
        snapshot.total.currency,
        snapshot.exchangeRates,
      );
      return {
        ...holding,
        currentPrice: retained.currentPrice,
        quoteEvidence: {
          ...retained.quoteEvidence,
          freshness: "retained",
        },
        previousClose: retained.previousClose ?? holding.previousClose,
        marketValue,
        sourceMarketValue:
          sourceAmount === null
            ? null
            : { amount: sourceAmount, currency: snapshot.total.currency },
        valuation:
          sourceAmount !== null && retained.valuation.status === "valued"
            ? retained.valuation
            : {
                status: "unvalued" as const,
                reason: sourceAmount === null
                  ? `保留的 Longbridge 行情缺少 ${holding.currency}/${snapshot.total.currency} 来源汇率`
                  : "保留的 Longbridge 行情此前不可估值",
              },
      };
    }),
  };
}

/**
 * 生产路径：官方 Rust SDK OAuth + macOS Keychain。
 *
 * Source credentials 仅保存一个不含 Token 的 Keychain 引用；Token 刷新由 SDK
 * 直接写回 Keychain，TypeScript、数据库和浏览器均无法读取 Token 正文。
 */
export class KeychainLongbridgeOAuth implements LongbridgeOAuth {
  constructor(
    private readonly sdk: LongbridgeKeychainReadSdk = new LongbridgeKeychainSdk(),
    private readonly readSnapshot: (observedAt: string) => Promise<AssetSnapshot> =
      (observedAt) => keychainSnapshot(this.sdk, observedAt),
  ) {}

  async start(redirectUri: string): Promise<{
    authorizationUrl: string;
    state: string;
    codeVerifier: string;
  }> {
    const started = this.sdk.beginBrowserAuthorization(redirectUri);
    return {
      authorizationUrl: started.authorizationUrl,
      state: started.state,
      // 原生 SDK 保管真正的 PKCE verifier；这里仅把 CSRF state 留在服务端临时态。
      codeVerifier: started.state,
    };
  }

  async finish(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<LongbridgeAuthorizationResult> {
    try {
      await this.sdk.completeBrowserAuthorization({
        state: input.codeVerifier,
        code: input.code,
        redirectUri: input.redirectUri,
      });
    } catch (error) {
      throw new Error(
        `长桥 OAuth 令牌保存失败：${error instanceof Error ? error.message : "未知错误"}`,
      );
    }
    return this.revalidate({
      credentials: this.sdk.credentialReference(),
      observedAt: new Date().toISOString(),
    });
  }

  async revalidate(input: {
    credentials: string;
    observedAt: string;
  }): Promise<LongbridgeAuthorizationResult> {
    const status = this.sdk.authorizationStatus();
    if (status.status !== "authorized") {
      throw new Error("长桥 OAuth 令牌未写入 macOS Keychain");
    }
    const credentialReference = this.sdk.credentialReference();
    if (input.credentials !== credentialReference) {
      throw new Error("长桥 OAuth 凭证引用已变化，请重新授权");
    }
    let snapshot: AssetSnapshot;
    try {
      snapshot = await this.readSnapshot(input.observedAt);
    } catch (error) {
      throw new Error(
        `长桥授权后读取账户失败：${error instanceof Error ? error.message : "未知错误"}`,
      );
    }
    const fingerprint = createHash("sha256")
      .update(credentialReference)
      .digest("hex")
      .slice(0, 12);
    return {
      credentials: credentialReference,
      permissions: ["account", "positions", "market-data"],
      account: {
        id: `longbridge:${fingerprint}`,
        label: `长桥账户（macOS Keychain · ${snapshot.total.currency} · ${fingerprint}）`,
      },
      snapshot,
    };
  }
}

/** Keychain SDK 来源刷新器；不接受旧的明文 OAuth 凭证。 */
export class KeychainLongbridgeSourceRefresher implements AssetSourceRefresher {
  constructor(private readonly sdk: LongbridgeKeychainReadSdk = new LongbridgeKeychainSdk()) {}

  async refresh({
    source,
    credentials,
    mode,
    attemptedAt,
  }: Parameters<AssetSourceRefresher["refresh"]>[0]): Promise<AssetSourceRefreshResult> {
    if (source.kind !== "longbridge") {
      throw new Error(`暂不支持刷新来源类型：${source.kind}`);
    }
    if (credentials !== this.sdk.credentialReference()) {
      throw new Error("长桥来源不是 macOS Keychain 凭证，请重新连接");
    }
    if (mode === "prices") {
      const quotes = await withKeychainAuthenticationRetry(() =>
        this.sdk.readQuotes(
          source.snapshot.holdings
            .map((holding) => holding.symbol)
            .filter((symbol) => !isLongbridgeUsOptionSymbol(symbol)),
        ),
      );
      return { snapshot: snapshotWithQuotes(source.snapshot, quotes, attemptedAt) };
    }
    const snapshot = await keychainSnapshot(this.sdk, attemptedAt);
    return {
      snapshot: snapshotRetainingMissingQuotes(snapshot, source.snapshot),
    };
  }
}

/** 正式日结只读取 Longbridge 官方日 K 的常规盘数据，绝不使用实时/盘后报价。 */
export class ServeLongbridgeFormalSettlementCandleReader
  implements FormalSettlementCandleReader
{
  constructor(private readonly sdk: Pick<LongbridgeServeMarketData, "credentialReference" | "readDailyCandles"> = new LongbridgeServeMarketData()) {}

  async readDailyCandles(input: {
    source: import("@/server/ports").AssetSourceSummary;
    symbols: string[];
  }): Promise<FormalSettlementDailyCandle[]> {
    if (input.source.kind !== "longbridge") {
      throw new Error(`正式日结不支持证券来源类型：${input.source.kind}`);
    }
    if (input.source.credentialReference !== this.sdk.credentialReference()) {
      throw new Error("长桥来源不是 macOS Keychain 凭证，请重新连接");
    }
    const candles = await this.sdk.readDailyCandles(input.symbols);
    return candles.map((candle) => ({
      symbol: candle.symbol,
      close: candle.close,
      timestamp: optionalUnixSecondsIso(candle.timestamp, "dailyCandle.timestamp")
        ?? (() => {
          throw new Error("长桥日 K 缺少时间");
        })(),
      tradeSession: candle.tradeSession,
    }));
  }
}

const LONG_BRIDGE_FIVE_DAY_TREND_COUNT = 1_000;

const LONG_BRIDGE_CANDLE_COUNTS: Record<LongbridgeHoldingCandlestickPeriod, number> = {
  day: 120,
  week: 104,
  month: 120,
  year: 30,
  "min-1": 240,
};

function candleValue(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value)) {
    throw new Error(`长桥 K 线 ${field} 格式无效`);
  }
  return value;
}

function marketTimeZone(symbol: string): string {
  const market = symbol.split(".").at(-1)?.toUpperCase();
  switch (market) {
    case "US": return "America/New_York";
    case "HK": return "Asia/Hong_Kong";
    case "SG": return "Asia/Singapore";
    case "SH":
    case "SZ": return "Asia/Shanghai";
    default: return "Asia/Shanghai";
  }
}

function marketTradeDate(time: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(time));
  const field = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = field("year");
  const month = field("month");
  const day = field("day");
  if (!year || !month || !day) throw new Error("长桥近五日走势日期格式无效");
  return `${year}-${month}-${day}`;
}

function latestFiveTradingDayTrend(
  points: LongbridgeHoldingTrendPoint[],
  symbol: string,
): LongbridgeHoldingTrendPoint[] {
  const sorted = [...points].sort((left, right) =>
    Date.parse(left.time) - Date.parse(right.time),
  );
  const timeZone = marketTimeZone(symbol);
  const dates = new Set<string>();
  for (const point of [...sorted].reverse()) {
    dates.add(marketTradeDate(point.time, timeZone));
    if (dates.size === 5) break;
  }
  return sorted.filter((point) => dates.has(marketTradeDate(point.time, timeZone)));
}

/**
 * 单标的行情读取与日结读取分离：前者仅按需读取当前持仓，始终使用常规盘与未复权。
 */
export class ServeLongbridgeHoldingCandlestickReader
  implements LongbridgeHoldingCandlestickReader
{
  constructor(private readonly sdk: Pick<LongbridgeServeMarketData, "credentialReference" | "readCandlesticks" | "readFiveDayTrend"> = new LongbridgeServeMarketData()) {}

  async readCandlesticks(input: {
    source: import("@/server/ports").AssetSourceSummary;
    symbol: string;
    period: LongbridgeHoldingCandlestickPeriod;
  }): Promise<LongbridgeHoldingCandlestick[]> {
    if (input.source.kind !== "longbridge") {
      throw new Error(`K 线不支持证券来源类型：${input.source.kind}`);
    }
    if (input.source.credentialReference !== this.sdk.credentialReference()) {
      throw new Error("长桥来源不是 macOS Keychain 凭证，请重新连接");
    }
    if (!supportsLongbridgeCandlesticks(input.symbol)) {
      throw new Error("该持仓暂不支持查看 K 线");
    }
    const candles = await this.sdk.readCandlesticks(
      input.symbol,
      input.period,
      LONG_BRIDGE_CANDLE_COUNTS[input.period],
    );
    return candles.map((candle) => ({
      time: optionalUnixSecondsIso(candle.timestamp, "candlestick.timestamp")
        ?? (() => { throw new Error("长桥 K 线缺少时间"); })(),
      open: candleValue(candle.open, "open"),
      high: candleValue(candle.high, "high"),
      low: candleValue(candle.low, "low"),
      close: candleValue(candle.close, "close"),
      volume: candleValue(candle.volume, "volume"),
      turnover: candleValue(candle.turnover, "turnover"),
    }));
  }

  async readFiveDayTrend(input: {
    source: import("@/server/ports").AssetSourceSummary;
    symbol: string;
  }): Promise<LongbridgeHoldingTrendPoint[]> {
    if (input.source.kind !== "longbridge") {
      throw new Error(`K线不支持证券来源类型：${input.source.kind}`);
    }
    if (input.source.credentialReference !== this.sdk.credentialReference()) {
      throw new Error("长桥来源不是 macOS Keychain 凭证，请重新连接");
    }
    if (!supportsLongbridgeCandlesticks(input.symbol)) {
      throw new Error("该持仓暂不支持查看 K 线");
    }
    const points = await this.sdk.readFiveDayTrend(input.symbol, LONG_BRIDGE_FIVE_DAY_TREND_COUNT);
    return latestFiveTradingDayTrend(points.map((point) => ({
      time: optionalUnixSecondsIso(point.timestamp, "fiveDayTrend.timestamp")
        ?? (() => { throw new Error("长桥近五日走势缺少时间"); })(),
      price: candleValue(point.close, "fiveDayTrend.close"),
    })), input.symbol);
  }
}

const LONGBRIDGE_BENCHMARK_SYMBOLS = new Set<LongbridgeBenchmarkSymbol>([
  ".SPX.US",
  ".NDX.US",
]);

/**
 * 收益分析指数与账户持仓 K 线隔离：只读固定指数的日 K，
 * 使用 CLI serve、常规盘和未复权价格，绝不读取账户资产。
 */
export class ServeLongbridgeBenchmarkCandlestickReader
  implements LongbridgeBenchmarkCandlestickReader
{
  constructor(private readonly sdk: Pick<LongbridgeServeMarketData, "readCandlesticks"> = new LongbridgeServeMarketData()) {}

  async readDailyCandlesticks(input: {
    count: number;
    symbol: LongbridgeBenchmarkSymbol;
  }): Promise<LongbridgeBenchmarkCandlestick[]> {
    if (!LONGBRIDGE_BENCHMARK_SYMBOLS.has(input.symbol)) {
      throw new Error("收益分析不支持该指数。");
    }
    if (!Number.isInteger(input.count) || input.count < 1 || input.count > 1000) {
      throw new Error("长桥指数日 K 数量必须介于 1 到 1000。");
    }
    const candles = await this.sdk.readCandlesticks(input.symbol, "day", input.count);
    return candles.map((candle) => ({
      close: candleValue(candle.close, "close"),
      time: optionalUnixSecondsIso(candle.timestamp, "benchmark.timestamp")
        ?? (() => { throw new Error("长桥指数日 K 缺少时间。"); })(),
    }));
  }
}
