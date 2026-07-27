import path from "node:path";

type NativeLongbridgeSdk = {
  beginAuthorization(clientId: string, callbackPort: number): string;
  authorizationStatus(clientId: string): string;
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
  forgetAuthorization(clientId: string): void;
};

export interface LongbridgeSdkAuthorization {
  status: "idle" | "authorizing" | "authorized";
  authorizationUrl: string | null;
}

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

export interface LongbridgeSdkQuote {
  symbol: string;
  lastDone: string;
  timestamp: number;
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

function nativeSdk(): NativeLongbridgeSdk {
  const nativePath = path.join(
    process.cwd(),
    "native/longbridge-keychain-sdk/kanban_longbridge_keychain_sdk.node",
  );
  try {
    // Native addon 必须只在服务端运行；避免被 Next 静态分析进浏览器包。
    const dynamicRequire = eval("require") as NodeRequire;
    return dynamicRequire(nativePath) as NativeLongbridgeSdk;
  } catch {
    throw new Error("长桥 Keychain SDK 未构建，请先运行 pnpm native:longbridge:build");
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
  private readonly clientId = requiredClientId();
  private readonly port = callbackPort();

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

  async readAssets(reportingCurrency: "USD"): Promise<LongbridgeSdkAssets> {
    return parse(
      await nativeSdk().readAssets(this.clientId, this.port, reportingCurrency),
      "长桥 SDK 资产响应格式无效",
    );
  }

  async readQuotes(symbols: string[]): Promise<LongbridgeSdkQuote[]> {
    return parse(
      await nativeSdk().readQuotes(this.clientId, this.port, symbols),
      "长桥 SDK 报价响应格式无效",
    );
  }

  forgetAuthorization(): void {
    nativeSdk().forgetAuthorization(this.clientId);
  }

  credentialReference(): string {
    return `macos-keychain:${this.clientId}`;
  }
}
