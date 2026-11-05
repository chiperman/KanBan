import type { LongbridgeAccountIdentity } from "../../sdk/longbridge-connection";
import path from "node:path";
import { createRequire } from "node:module";

type NativeLongbridgeSdk = {
  accountIdentity(clientId: string): string;
  beginAuthorization(clientId: string, callbackPort: number): string;
  authorizationStatus(clientId: string): string;
  authorizationExpiry(clientId: string): string;
  renewAuthorization(clientId: string): Promise<unknown>;
  beginBrowserAuthorization(clientId: string, redirectUri: string): string;
  completeBrowserAuthorization(
    clientId: string,
    state: string,
    code: string,
    redirectUri: string,
  ): unknown;
  readAssets(
    clientId: string,
    callbackPort: number,
    reportingCurrency: string,
  ): Promise<unknown>;
  readQuotes(
    clientId: string,
    callbackPort: number,
    symbols: string[],
  ): Promise<unknown>;
  readDailyCandles(
    clientId: string,
    callbackPort: number,
    symbols: string[],
  ): Promise<unknown>;
  readCandlesticks(
    clientId: string,
    callbackPort: number,
    symbol: string,
    period: string,
    count: number,
  ): Promise<unknown>;
  readFiveDayTrend(
    clientId: string,
    callbackPort: number,
    symbol: string,
    count: number,
  ): Promise<unknown>;
  readDailyAsset(clientId: string, callbackPort: number, start: string, end: string): Promise<unknown>;
  readTradingDays(clientId: string, callbackPort: number, market: string, start: string, end: string): Promise<unknown>;
  forgetAuthorization(clientId: string): void;
};

export interface LongbridgeSdkAuthorization {
  status: "idle" | "authorizing" | "authorized";
  authorizationUrl: string | null;
}

export interface LongbridgeSdkRenewal {
  expiresAt: number;
  error: string | null;
  retryable: boolean;
}

export type { LongbridgeAccountIdentity } from "../../sdk/longbridge-connection";

export interface LongbridgeBrowserAuthorization {
  authorizationUrl: string;
  state: string;
}

export interface LongbridgeSdkAssets {
  accountPage: unknown;
  stockPage: unknown;
  fundPage: unknown;
  exchangeRates: unknown[];
}

/** 原生 addon 已归一化的报价 DTO，不是官方 SDK 对象。 */
export interface LongbridgeNativeQuote {
  symbol: string;
  lastDone: string;
  prevClose: string;
  timestamp: number;
  /** 原生 SDK 原样传递的交易状态枚举；未知枚举保持原值。 */
  tradeStatus?: string;
  /** Longbridge 仅在可由请求规则直接判断时标注延迟。 */
  delivery?: "delayed" | "unknown";
  preMarketQuote?: LongbridgeNativePrePostQuote | null;
  postMarketQuote?: LongbridgeNativePrePostQuote | null;
  overnightQuote?: LongbridgeNativePrePostQuote | null;
}

export interface LongbridgeNativePrePostQuote {
  lastDone: string;
  timestamp: number;
}

export interface LongbridgeSdkDailyCandle {
  symbol: string;
  close: string;
  timestamp: number;
  tradeSession: "intraday";
}

/** 原生 addon 已归一化的 OHLCV DTO。 */
export interface LongbridgeSdkCandlestick {
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  turnover: string;
}

/** 原生 addon 已归一化的近五日收盘价点。 */
export interface LongbridgeSdkTrendPoint {
  timestamp: number;
  close: string;
}

function requiredClientId(): string {
  const clientId = process.env.LONGBRIDGE_OAUTH_CLIENT_ID;
  if (!clientId) throw new Error("未配置 LONGBRIDGE_OAUTH_CLIENT_ID");
  return clientId;
}

function callbackPort(): number {
  const configured = process.env.LONGBRIDGE_OAUTH_CALLBACK_PORT;
  if (!configured) return 60355;
  const port = Number(configured);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("LONGBRIDGE_OAUTH_CALLBACK_PORT 必须是有效端口");
  }
  return port;
}

let loadedSdk: NativeLongbridgeSdk | undefined;
function nativeSdk(): NativeLongbridgeSdk {
  if (loadedSdk) return loadedSdk;
  const nativePath = path.join(
    process.cwd(),
    "plugins/longbridge/native/kanban_longbridge_keychain_sdk.node",
  );
  try {
    // Native addon 必须只在服务端运行；避免被 Next 静态分析进浏览器包。
    const dynamicRequire = createRequire(path.join(process.cwd(), "package.json"));
    const artifact = dynamicRequire(path.join(process.cwd(), "plugins/longbridge/native-artifact.mjs")) as { checkNativeArtifact(root: string): void };
    artifact.checkNativeArtifact(process.cwd());
    loadedSdk = dynamicRequire(nativePath) as NativeLongbridgeSdk;
    return loadedSdk;
  } catch {
    throw new Error("长桥 SDK 原生产物缺失、过期或不兼容，请运行 pnpm native:longbridge:build");
  }
}

function nativeErrorMessage(value: unknown): string | null {
  if (value instanceof Error && value.message) return value.message;
  if (typeof value !== "object" || value === null) return null;
  const nativeError = value as { code?: unknown; message?: unknown };
  if (typeof nativeError.code !== "string") return null;
  if (typeof nativeError.message === "string" && nativeError.message) {
    return nativeError.message;
  }
  return `长桥 SDK 调用失败（${nativeError.code}）`;
}

function parse<T>(value: unknown, message: string): T {
  const nativeError = nativeErrorMessage(value);
  if (nativeError) throw new Error(nativeError);
  if (typeof value === "object" && value !== null) return value as T;
  if (typeof value !== "string") {
    throw new Error(`${message}（SDK 返回类型：${typeof value}）`);
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(message);
  }
}

/** 仅暴露 SDK 的 OAuth 状态与只读数据；Token 不会进入 TypeScript 进程。 */
export class LongbridgeKeychainSdk {
  private get clientId() { return requiredClientId(); }
  private get port() { return callbackPort(); }

  accountIdentity(): LongbridgeAccountIdentity {
    return parse(nativeSdk().accountIdentity(this.clientId), "长桥账户身份格式无效");
  }

  beginAuthorization(): LongbridgeSdkAuthorization {
    return parse(
      nativeSdk().beginAuthorization(this.clientId, this.port),
      "长桥 SDK 授权状态格式无效",
    );
  }

  beginBrowserAuthorization(redirectUri: string): LongbridgeBrowserAuthorization {
    return parse(
      nativeSdk().beginBrowserAuthorization(this.clientId, redirectUri),
      "长桥 SDK 授权链接格式无效",
    );
  }

  async completeBrowserAuthorization(input: {
    state: string;
    code: string;
    redirectUri: string;
  }): Promise<void> {
    const result = await nativeSdk().completeBrowserAuthorization(
      this.clientId,
      input.state,
      input.code,
      input.redirectUri,
    );
    const completion = parse<{ status?: unknown; message?: unknown }>(
      result,
      "长桥 SDK 授权完成响应格式无效",
    );
    if (completion.status === "authorized") return;
    throw new Error(
      typeof completion.message === "string" && completion.message
        ? completion.message
        : "长桥授权完成失败",
    );
  }

  authorizationStatus(): LongbridgeSdkAuthorization {
    return parse(
      nativeSdk().authorizationStatus(this.clientId),
      "长桥 SDK 授权状态格式无效",
    );
  }

  authorizationExpiry(): number {
    return parse<{ expiresAt: number }>(nativeSdk().authorizationExpiry(this.clientId), "长桥 SDK 到期时间无效").expiresAt;
  }

  async renewAuthorization(): Promise<LongbridgeSdkRenewal> {
    return parse(await nativeSdk().renewAuthorization(this.clientId), "长桥 SDK 续期响应无效");
  }

  async readAssets(reportingCurrency: "USD"): Promise<LongbridgeSdkAssets> {
    return parse(
      await nativeSdk().readAssets(this.clientId, this.port, reportingCurrency),
      "长桥 SDK 资产响应格式无效",
    );
  }

  async readQuotes(symbols: string[]): Promise<LongbridgeNativeQuote[]> {
    return parse(
      await nativeSdk().readQuotes(this.clientId, this.port, symbols),
      "长桥 SDK 报价响应格式无效",
    );
  }

  async readDailyCandles(symbols: string[]): Promise<LongbridgeSdkDailyCandle[]> {
    return parse(
      await nativeSdk().readDailyCandles(this.clientId, this.port, symbols),
      "长桥日 K 响应格式无效",
    );
  }

  async readCandlesticks(
    symbol: string,
    period: "day" | "week" | "month" | "year" | "min-1",
    count: number,
  ): Promise<LongbridgeSdkCandlestick[]> {
    return parse(
      await nativeSdk().readCandlesticks(
        this.clientId,
        this.port,
        symbol,
        period,
        count,
      ),
      "长桥 K 线响应格式无效",
    );
  }

  async readFiveDayTrend(
    symbol: string,
    count: number,
  ): Promise<LongbridgeSdkTrendPoint[]> {
    return parse(
      await nativeSdk().readFiveDayTrend(this.clientId, this.port, symbol, count),
      "长桥近五日走势响应格式无效",
    );
  }

  async readDailyAsset(query: { start: string; end: string }): Promise<unknown> {
    return parse(await nativeSdk().readDailyAsset(this.clientId, this.port, query.start, query.end), "长桥每日资产响应无效");
  }

  async readTradingDays(input: { market: string; start: string; end: string }): Promise<{ trading_days: string[]; half_trading_days: string[] }> {
    return parse(await nativeSdk().readTradingDays(this.clientId, this.port, input.market, input.start, input.end), "长桥交易日历响应无效");
  }

  forgetAuthorization(): void {
    nativeSdk().forgetAuthorization(this.clientId);
  }

  credentialReference(): string {
    return `macos-keychain:${this.clientId}`;
  }
}
