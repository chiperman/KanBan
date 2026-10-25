import { createHmac } from "node:crypto";

import { createJsonDecoder } from "@/server/asset-sources/json";
import { assetResponseError } from "@/server/asset-sync-diagnostics";
import { integer } from "@/server/asset-sources/binance-json";

const { record, credentialRecord, text } = createJsonDecoder("Binance");

export type BinanceFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const BINANCE_ORIGIN = "https://api.binance.com";

export interface StoredBinanceCredentials {
  apiKey: string;
  apiSecret: string;
}

export function parseCredentials(credentials: string): StoredBinanceCredentials {
  const value = credentialRecord(credentials);
  return {
    apiKey: text(value.apiKey, "apiKey"),
    apiSecret: text(value.apiSecret, "apiSecret"),
  };
}

export class BinanceClient {
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
