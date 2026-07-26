import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";

import { decimalAdd } from "@/domain/decimal";

import type {
  AssetSourceRefreshResult,
  AssetSourceRefresher,
  AssetHolding,
  AssetSnapshot,
  LongbridgeAuthorizationResult,
  LongbridgeOAuth,
} from "@/server/ports";

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

function decimalText(value: unknown, field: string): string {
  const output =
    typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : typeof value === "string"
        ? value
        : "";
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(output)) {
    throw new Error(`长桥响应缺少 ${field}`);
  }
  return output;
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

export function mapLongbridgeSnapshot(input: {
  accountPages: unknown[];
  positionPages: unknown[];
  syncedAt: string;
  exchangeRatePages?: unknown[];
  profitPages?: unknown[];
}): AssetSnapshot {
  const account = listFromPage(input.accountPages[0] ?? {}).at(0);
  if (!account) throw new Error("长桥账户预览为空");
  const accountCurrency = text(account.currency, "currency");
  const exchangeRateObservations = (input.exchangeRatePages ?? []).flatMap((page) => {
    const root = record(page);
    const data =
      typeof root.data === "object" && root.data !== null
        ? record(root.data)
        : root;
    return (Array.isArray(data.exchanges) ? data.exchanges : []).map((raw) => {
      const rate = record(raw);
      return {
        baseCurrency: text(rate.base_currency, "base_currency"),
        quoteCurrency: text(rate.other_currency, "other_currency"),
        rate: decimalText(rate.average_rate, "average_rate"),
        source: "Longbridge 账户汇率",
        observedAt: input.syncedAt,
      };
    });
  });
  const exchangeRates = Object.fromEntries(
    exchangeRateObservations.flatMap((rate) =>
      rate.baseCurrency === accountCurrency
        ? [[rate.quoteCurrency, rate.rate] as const]
        : [],
    ),
  );
  const platformProfits = Object.fromEntries(
    (input.profitPages ?? []).flatMap((page) => {
      const root = record(page);
      const data =
        typeof root.data === "object" && root.data !== null
          ? record(root.data)
          : root;
      return (Array.isArray(data.stock_items) ? data.stock_items : []).flatMap((raw) => {
        const item = record(raw);
        const code = text(item.code, "code");
        const market = text(item.market, "market");
        const profit = optionalText(item.profit);
        return profit ? [[code.includes(".") ? code : `${code}.${market}`, profit] as const] : [];
      });
    }),
  );
  const holdings: AssetHolding[] = input.positionPages
    .flatMap(listFromPage)
    .map((item) => {
      const symbol = text(item.symbol, "symbol");
      const quantity = text(item.quantity ?? item.holding_units, "quantity");
      const nativePrice = optionalText(item.current_net_asset_value);
      const price = nativePrice;
      const currency = text(item.currency, "currency");
      const marketValue =
        optionalText(item.market_value) ??
        (price ? multiplyDecimal(quantity, price) : null);
      const sourceAmount =
        marketValue === null
          ? null
          : currency === accountCurrency
          ? marketValue
          : exchangeRates[currency]
            ? divideDecimal(
              marketValue,
              exchangeRates[currency],
            )
            : null;
      const pricedAt = nativePrice
        ? optionalText(item.net_asset_value_day) ?? input.syncedAt
        : input.syncedAt;
      const priceSource = nativePrice
        ? "Longbridge 基金净值"
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
        ) ?? platformProfits[symbol] ?? null,
        changePercent:
          optionalText(item.change_rate ?? item.change_percent),
      };
    })
    .sort((left, right) => {
      if (left.sourceMarketValue === null) return right.sourceMarketValue === null ? 0 : 1;
      if (right.sourceMarketValue === null) return -1;
      return compareDecimal(right.sourceMarketValue.amount, left.sourceMarketValue.amount);
    });
  const totalAmount = holdings.every((holding) => holding.sourceMarketValue !== null)
    ? text(account.net_assets, "net_assets")
    : holdings.reduce(
        (sum, holding) =>
          holding.sourceMarketValue
            ? decimalAdd(sum, holding.sourceMarketValue.amount)
            : sum,
        optionalText(account.total_cash) ?? "0",
      );
  return {
    total: {
      amount: totalAmount,
      currency: accountCurrency,
    },
    holdings,
    exchangeRates: exchangeRateObservations,
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

function divideDecimal(left: string, right: string): string {
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
  const dividend = parts(left);
  const divisor = parts(right);
  if (divisor.digits === 0n) throw new Error("长桥汇率不能为零");
  const scale = 12;
  const numerator =
    dividend.digits * 10n ** BigInt(divisor.scale + scale);
  const denominator = divisor.digits * 10n ** BigInt(dividend.scale);
  const quotient = numerator / denominator;
  const sign = dividend.negative !== divisor.negative ? "-" : "";
  const digits = quotient.toString().padStart(scale + 1, "0");
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  return `${sign}${digits.slice(0, -scale)}${fraction ? `.${fraction}` : ""}`;
}

export interface LongbridgePendingPreview extends LongbridgeAuthorizationResult {
  id: string;
  expiresAt: number;
}

export type LongbridgePublicPreview = Omit<
  LongbridgePendingPreview,
  "credentials"
>;

interface StoredPreview {
  id: string;
  expiresAt: number;
  result: Omit<LongbridgeAuthorizationResult, "credentials">;
  credentials: { iv: string; tag: string; value: string };
}

interface StartedAuthorization {
  codeVerifier: string;
  redirectUri: string;
  expiresAt: number;
}

/** OAuth 临时态只在服务端内存中存活；确认前不写来源或安全存储。 */
export class LongbridgeConnectionState {
  private readonly starts = new Map<string, StartedAuthorization>();
  private readonly previews = new Map<string, StoredPreview>();
  private readonly startTimers = new Map<string, NodeJS.Timeout>();
  private readonly previewTimers = new Map<string, NodeJS.Timeout>();
  private readonly claimedPreviews = new Set<string>();
  private readonly transientKey = randomBytes(32);

  private clearStart(state: string): void {
    this.starts.delete(state);
    const timer = this.startTimers.get(state);
    if (timer) clearTimeout(timer);
    this.startTimers.delete(state);
  }

  private clearPreview(id: string): void {
    this.previews.delete(id);
    this.claimedPreviews.delete(id);
    const timer = this.previewTimers.get(id);
    if (timer) clearTimeout(timer);
    this.previewTimers.delete(id);
  }

  private seal(credentials: string): StoredPreview["credentials"] {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.transientKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(credentials, "utf8"),
      cipher.final(),
    ]);
    return {
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      value: encrypted.toString("base64"),
    };
  }

  private open(value: StoredPreview): LongbridgePendingPreview {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.transientKey,
      Buffer.from(value.credentials.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(value.credentials.tag, "base64"));
    const credentials = Buffer.concat([
      decipher.update(Buffer.from(value.credentials.value, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return {
      ...value.result,
      credentials,
      id: value.id,
      expiresAt: value.expiresAt,
    };
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

  rememberPreview(result: LongbridgeAuthorizationResult): string {
    const id = randomUUID();
    const expiresAt = Date.now() + 10 * 60_000;
    const { credentials, ...safeResult } = result;
    this.previews.set(id, {
      id,
      expiresAt,
      result: safeResult,
      credentials: this.seal(credentials),
    });
    const timer = setTimeout(() => this.clearPreview(id), expiresAt - Date.now());
    timer.unref();
    this.previewTimers.set(id, timer);
    return id;
  }

  getPreview(id: string): LongbridgePendingPreview | null {
    if (this.claimedPreviews.has(id)) return null;
    const value = this.previews.get(id) ?? null;
    if (value && value.expiresAt < Date.now()) {
      this.clearPreview(id);
      return null;
    }
    return value ? this.open(value) : null;
  }

  getPublicPreview(id: string): LongbridgePublicPreview | null {
    const value = this.previews.get(id) ?? null;
    if (value && value.expiresAt < Date.now()) {
      this.clearPreview(id);
      return null;
    }
    return value
      ? { ...value.result, id: value.id, expiresAt: value.expiresAt }
      : null;
  }

  discardPreview(id: string): void {
    this.clearPreview(id);
  }

  consumePreview(id: string): LongbridgePendingPreview | null {
    const value = this.previews.get(id) ?? null;
    this.clearPreview(id);
    return value && value.expiresAt >= Date.now() ? this.open(value) : null;
  }

  claimPreview(id: string): LongbridgePendingPreview | null {
    if (this.claimedPreviews.has(id)) return null;
    const value = this.previews.get(id) ?? null;
    if (!value || value.expiresAt < Date.now()) {
      if (value) this.clearPreview(id);
      return null;
    }
    this.claimedPreviews.add(id);
    return this.open(value);
  }

  releasePreview(id: string): void {
    this.claimedPreviews.delete(id);
  }

  completePreview(id: string): void {
    this.clearPreview(id);
  }
}

function hasMore(page: JsonRecord): boolean {
  const data =
    typeof page.data === "object" && page.data !== null && !Array.isArray(page.data)
      ? record(page.data)
      : page;
  return page.has_more === true || data.has_more === true;
}

export async function collectLongbridgePages(
  fetchPage: (page: number) => Promise<unknown>,
): Promise<unknown[]> {
  const pages: unknown[] = [];
  let pageNumber = 1;
  do {
    const page = record(await fetchPage(pageNumber));
    pages.push(page);
    if (!hasMore(page)) break;
    pageNumber += 1;
  } while (pageNumber <= 100);
  if (pageNumber > 100) throw new Error("长桥分页超过安全上限");
  return pages;
}

const LONGBRIDGE_AUTHORIZATION_ENDPOINT =
  "https://openapi.longbridge.com/oauth2/authorize";
const LONGBRIDGE_TOKEN_ENDPOINT =
  "https://openapi.longbridge.com/oauth2/token";
const LONGBRIDGE_API_ORIGIN = "https://openapi.longbridge.com";
const READ_ONLY_SCOPE = "6";
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
  if (scopes.length !== 1 || scopes[0] !== READ_ONLY_SCOPE) {
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

    const pages: unknown[] = [];
    for (const path of ASSET_PATHS) {
      const response = await this.request(`${LONGBRIDGE_API_ORIGIN}${path}`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${token.accessToken}`,
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
    const positionPages = [stockPage, fundPage];
    const exchangeRateResponse = await this.request(
      `${LONGBRIDGE_API_ORIGIN}/v1/asset/exchange_rates`,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${token.accessToken}`,
          accept: "application/json",
        },
        cache: "no-store",
      },
    );
    if (!exchangeRateResponse.ok) {
      throw new Error(`长桥汇率读取失败（HTTP ${exchangeRateResponse.status}）`);
    }
    const exchangeRatePage = responseData(await exchangeRateResponse.json());
    const profitPages = await collectLongbridgePages(async (page) => {
      const url = new URL(
        "/v1/portfolio/profit-analysis/by-market",
        LONGBRIDGE_API_ORIGIN,
      );
      url.searchParams.set("page", String(page));
      url.searchParams.set("size", "100");
      const response = await this.request(url, {
        method: "GET",
        headers: {
          authorization: `Bearer ${token.accessToken}`,
          accept: "application/json",
        },
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`长桥平台盈亏读取失败（HTTP ${response.status}）`);
      }
      return responseData(await response.json());
    });
    const identity = jwtAccountIdentity(token.accessToken);
    if (!identity) throw new Error("长桥未返回可确认的 OAuth 账户主体");
    const account = listFromPage(accountPage).at(0);
    if (!account) throw new Error("长桥账户预览为空");
    const accountCurrency = text(account.currency, "currency");
    const syncedAt = new Date().toISOString();
    return {
      credentials: JSON.stringify({
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresIn: token.expiresIn,
        obtainedAt: syncedAt,
        validatedScopes: token.scopes,
      }),
      permissions: ["account", "positions"],
      account: {
        id: `longbridge:${identity.fingerprint}`,
        label: `长桥账户（类型 ${identity.channel} · ${accountCurrency} · ${identity.fingerprint}）`,
      },
      snapshot: mapLongbridgeSnapshot({
        accountPages: [accountPage],
        positionPages,
        syncedAt,
        exchangeRatePages: [exchangeRatePage],
        profitPages,
      }),
    };
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
    const exchangeRateResponse = await this.request(
      `${LONGBRIDGE_API_ORIGIN}/v1/asset/exchange_rates`,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: "application/json",
        },
        cache: "no-store",
        signal,
      },
    );
    if (!exchangeRateResponse.ok) {
      throw new Error(`长桥汇率读取失败（HTTP ${exchangeRateResponse.status}）`);
    }
    const exchangeRatePage = responseData(await exchangeRateResponse.json());
    const profitPages = await collectLongbridgePages(async (page) => {
      const url = new URL(
        "/v1/portfolio/profit-analysis/by-market",
        LONGBRIDGE_API_ORIGIN,
      );
      url.searchParams.set("page", String(page));
      url.searchParams.set("size", "100");
      const response = await this.request(url, {
        method: "GET",
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: "application/json",
        },
        cache: "no-store",
        signal,
      });
      if (!response.ok) {
        throw new Error(`长桥平台盈亏读取失败（HTTP ${response.status}）`);
      }
      return responseData(await response.json());
    });
    return {
      snapshot: mapLongbridgeSnapshot({
        accountPages: [accountPage],
        positionPages,
        syncedAt: attemptedAt,
        exchangeRatePages: [exchangeRatePage],
        profitPages,
      }),
    };
  }
}
