import { createHmac } from "node:crypto";

import { createJsonDecoder } from "../../sdk/json";
import { assetResponseError } from "../../sdk/asset-sync-diagnostics";
import type { OkxRegion } from "@/server/ports";
import { first, type JsonRecord } from "./okx-json";
import { region } from "./okx-identity";

const { record, credentialRecord, text } = createJsonDecoder("OKX");

export type OkxFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface StoredOkxCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
  region: OkxRegion;
}

const OKX_ORIGINS: Record<OkxRegion, string> = {
  global: "https://openapi.okx.com",
  us: "https://us.okx.com",
  eea: "https://eea.okx.com",
};

export function parseCredentials(value: string): StoredOkxCredentials {
  const credentials = credentialRecord(value);
  return {
    apiKey: text(credentials.apiKey, "apiKey"),
    apiSecret: text(credentials.apiSecret, "apiSecret"),
    passphrase: text(credentials.passphrase, "passphrase"),
    region: region(credentials.region),
  };
}

export class OkxClient {
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
