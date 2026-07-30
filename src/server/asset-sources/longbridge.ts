import {
  createHash,
  randomBytes,
} from "node:crypto";

import type {
  AssetExchangeRate,
  AssetSourceRefreshResult,
  AssetSourceRefresher,
  AssetHolding,
  AssetSnapshot,
  LongbridgeAuthorizationResult,
  LongbridgeOAuth,
} from "@/server/ports";
import { LongbridgeKeychainSdk } from "@/server/asset-sources/longbridge-keychain-sdk";
import { decimalDivide, decimalMultiply } from "@/domain/decimal";

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
  quotes?: Array<{ symbol: string; lastDone: string; timestamp: number }>;
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
  const holdings: AssetHolding[] = input.positionPages
    .flatMap(listFromPage)
    .map((item) => {
      const symbol = text(item.symbol, "symbol");
      const quantity = text(item.quantity ?? item.holding_units, "quantity");
      const nativePrice = optionalText(item.current_net_asset_value);
      const quote = quotes.get(symbol);
      const price = nativePrice ?? quote?.lastDone ?? null;
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
        : quote
          ? optionalUnixSecondsIso(quote.timestamp, "quote.timestamp") ?? input.syncedAt
        : input.syncedAt;
      const priceSource = nativePrice
        ? "Longbridge 基金净值"
        : quote
          ? "Longbridge 实时行情"
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
        marketValue,
        sourceMarketValue:
          sourceAmount === null
            ? null
            : { amount: sourceAmount, currency: accountCurrency },
        valuation:
          sourceAmount !== null && priceSource
            ? { status: "valued" as const, priceSource, pricedAt }
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
    })
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
  if (
    scopes.length !== 1 ||
    ![READ_ONLY_SCOPE, ACCOUNT_READ_SCOPE].includes(scopes[0] ?? "")
  ) {
    throw new Error(`长桥授权范围不是仅账户读取（实际：${scopes.join(" ")}）`);
  }
  return scopes;
}

function parseTokenResponse(value: unknown): TokenResponse {
  const token = record(value);
  const scope = token.scope;
  if (typeof scope !== "string" || scope.trim().length === 0) {
    throw new Error("长桥未返回授权范围，无法证明凭证为只读");
  }
  const scopes = validateReadOnlyScopes([
    ...new Set(scope.trim().split(/\s+/)),
  ]);
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
    validatedScopes: validateReadOnlyScopes([...new Set(rawScopes)]),
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
    scopes = validateReadOnlyScopes([
      ...new Set(token.scope.trim().split(/\s+/)),
    ]);
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
        throw new Error(`长桥资产读取失败（HTTP ${response.status}）`);
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

/** 已保存来源的只读刷新器；30 秒价格周期不访问长桥。 */
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
      throw new Error(`长桥 token 刷新失败（HTTP ${response.status}）`);
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
        throw new Error(`长桥资产读取失败（HTTP ${response.status}）`);
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
  return [...new Set(listFromPage(page).map((item) => text(item.symbol, "symbol")))];
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

function snapshotWithQuotes(
  snapshot: AssetSnapshot,
  quotes: Array<{ symbol: string; lastDone: string; timestamp: number }>,
  syncedAt: string,
): AssetSnapshot {
  const bySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
  return {
    ...snapshot,
    syncedAt,
    holdings: snapshot.holdings.map((holding) => {
      const quote = bySymbol.get(holding.symbol);
      if (!quote) return holding;
      const marketValue = multiplyDecimal(holding.quantity, quote.lastDone);
      const pricedAt = optionalUnixSecondsIso(quote.timestamp, "quote.timestamp") ?? syncedAt;
      return {
        ...holding,
        currentPrice: { amount: quote.lastDone, currency: holding.currency },
        marketValue,
        sourceMarketValue:
          holding.currency === snapshot.total.currency
            ? { amount: marketValue, currency: snapshot.total.currency }
            : null,
        valuation:
          holding.currency === snapshot.total.currency
            ? {
                status: "valued" as const,
                priceSource: "Longbridge 实时行情",
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
 * 生产路径：官方 Rust SDK OAuth + macOS Keychain。
 *
 * Source credentials 仅保存一个不含 Token 的 Keychain 引用；Token 刷新由 SDK
 * 直接写回 Keychain，TypeScript、数据库和浏览器均无法读取 Token 正文。
 */
export class KeychainLongbridgeOAuth implements LongbridgeOAuth {
  constructor(private readonly sdk: LongbridgeKeychainReadSdk = new LongbridgeKeychainSdk()) {}

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
      snapshot = await keychainSnapshot(this.sdk, input.observedAt);
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
          source.snapshot.holdings.map((holding) => holding.symbol),
        ),
      );
      return { snapshot: snapshotWithQuotes(source.snapshot, quotes, attemptedAt) };
    }
    return { snapshot: await keychainSnapshot(this.sdk, attemptedAt) };
  }
}
