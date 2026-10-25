import { createHmac } from "node:crypto";

import { createJsonDecoder, type JsonRecord } from "@/server/asset-sources/json";
import { responseTime } from "@/server/asset-sources/bitget-identity";
import { assetResponseError, hasManagedAssetRetry } from "@/server/asset-sync-diagnostics";
import { createAbortableSleep } from "@/server/asset-sources/abortable-sleep";
import type { BitgetAccountMode } from "@/server/ports";

export type BitgetFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface BitgetRuntime {
  now(): number;
  sleep(milliseconds: number, signal?: AbortSignal): Promise<void>;
  earnRequestIntervalMs: number;
  retryDelaysMs: readonly number[];
}

const { record, credentialRecord, text } = createJsonDecoder("Bitget");
const abortableSleep = createAbortableSleep("Bitget 请求已取消");

const DEFAULT_RUNTIME: BitgetRuntime = {
  now: () => Date.now(),
  sleep: abortableSleep,
  earnRequestIntervalMs: 110,
  retryDelaysMs: [250, 750],
};

const BITGET_ORIGIN = "https://api.bitget.com";

interface BitgetEnvelope {
  data: unknown;
  requestTime: string;
}

export interface StoredBitgetCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
  accountMode: BitgetAccountMode;
}

export function parseCredentials(value: string): StoredBitgetCredentials {
  const credentials = credentialRecord(value);
  const accountMode = credentials.accountMode;
  if (accountMode !== "classic" && accountMode !== "uta") {
    throw new Error("Bitget 账户类型无效");
  }
  return {
    apiKey: text(credentials.apiKey, "apiKey"),
    apiSecret: text(credentials.apiSecret, "apiSecret"),
    passphrase: text(credentials.passphrase, "passphrase"),
    accountMode,
  };
}

export const BITGET_DEFAULT_RUNTIME: BitgetRuntime = DEFAULT_RUNTIME;

export class BitgetClient {
  private timeOffsetMs = 0;
  private lastEarnRequestAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly credentials: StoredBitgetCredentials,
    private readonly request: BitgetFetch,
    private readonly signal?: AbortSignal,
    private readonly runtime: BitgetRuntime = DEFAULT_RUNTIME,
  ) {}

  private async envelope(
    path: string,
    query: Record<string, string> = {},
    privateRequest = true,
    retryTimestamp = true,
    retryAttempt = 0,
  ): Promise<BitgetEnvelope> {
    const url = new URL(path, BITGET_ORIGIN);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    const headers = new Headers();
    if (privateRequest) {
      const timestamp = String(this.runtime.now() + this.timeOffsetMs);
      const requestPath = `${url.pathname}${url.search}`;
      const signature = createHmac("sha256", this.credentials.apiSecret)
        .update(`${timestamp}GET${requestPath}`)
        .digest("base64");
      headers.set("ACCESS-KEY", this.credentials.apiKey);
      headers.set("ACCESS-SIGN", signature);
      headers.set("ACCESS-TIMESTAMP", timestamp);
      headers.set("ACCESS-PASSPHRASE", this.credentials.passphrase);
      headers.set("locale", "en-US");
    }
    const response = await this.request(url, {
      method: "GET",
      headers,
      cache: "no-store",
      redirect: "error",
      signal: this.signal,
    });
    const body = await response.json().catch(() => null);
    const root =
      typeof body === "object" && body !== null && !Array.isArray(body)
        ? body as JsonRecord
        : null;
    const code = typeof root?.code === "string" ? root.code : null;
    if (
      (code === "40005" || code === "40008") &&
      privateRequest &&
      retryTimestamp
    ) {
      await this.syncTime();
      return this.envelope(path, query, true, false, retryAttempt);
    }
    const transient =
      response.status === 429 ||
      response.status >= 500 ||
      ["40725", "45001", "40808", "25000", "25001"].includes(code ?? "");
    if (!hasManagedAssetRetry() && transient && retryAttempt < this.runtime.retryDelaysMs.length) {
      await this.runtime.sleep(
        this.runtime.retryDelaysMs[retryAttempt],
        this.signal,
      );
      return this.envelope(
        path,
        query,
        privateRequest,
        retryTimestamp,
        retryAttempt + 1,
      );
    }
    if (!response.ok || code !== "00000" || root === null) {
      const errorCode = code ?? `HTTP ${response.status}`;
      const message = typeof root?.msg === "string" && root.msg
        ? `：${root.msg}`
        : "";
      throw assetResponseError(`Bitget 读取失败（${errorCode}${message}）`, response, code);
    }
    return {
      data: root.data,
      requestTime: responseTime(root.requestTime),
    };
  }

  private async data(
    path: string,
    query: Record<string, string> = {},
    privateRequest = true,
  ): Promise<unknown> {
    return (await this.envelope(path, query, privateRequest)).data;
  }

  async syncTime(): Promise<void> {
    const row = record(
      await this.data("/api/v2/public/time", {}, false),
      "Bitget public/time data",
    );
    const timestamp = text(row.serverTime, "serverTime");
    if (!/^\d+$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp))) {
      throw new Error("Bitget public time 格式无效");
    }
    this.timeOffsetMs = Number(timestamp) - this.runtime.now();
  }

  accountInfo(mode: BitgetAccountMode) {
    return this.data(
      mode === "classic"
        ? "/api/v2/spot/account/info"
        : "/api/v3/account/info",
    );
  }
  accountAssets(mode: BitgetAccountMode) {
    return this.envelope(
      mode === "classic"
        ? "/api/v2/spot/account/assets"
        : "/api/v3/account/assets",
      mode === "classic" ? { assetType: "hold_only" } : {},
    );
  }
  funding(mode: BitgetAccountMode) {
    return this.envelope(
      mode === "classic"
        ? "/api/v2/account/funding-assets"
        : "/api/v3/account/funding-assets",
    );
  }
  botAssets() {
    return this.envelope(
      "/api/v2/account/bot-assets",
      { accountType: "futures" },
    );
  }
  allAccountBalance() {
    return this.data("/api/v2/account/all-account-balance");
  }
  private async waitForEarnSlot(
    intervalMs = this.runtime.earnRequestIntervalMs,
  ): Promise<void> {
    const wait = this.lastEarnRequestAt + intervalMs -
      this.runtime.now();
    if (wait > 0) await this.runtime.sleep(wait, this.signal);
    this.lastEarnRequestAt = this.runtime.now();
  }
  async earnOverview() {
    await this.waitForEarnSlot();
    return this.data("/api/v2/earn/account/assets");
  }
  async cashPlusAccount() {
    await this.waitForEarnSlot();
    return this.data("/api/v2/earn/savings/account");
  }
  async savings(
    periodType: "flexible" | "fixed",
    startTime: string,
    endTime: string,
    idLessThan?: string,
  ) {
    await this.waitForEarnSlot();
    return this.data("/api/v2/earn/savings/assets", {
      periodType,
      limit: "100",
      startTime,
      endTime,
      ...(idLessThan ? { idLessThan } : {}),
    });
  }
  async sharkfinAccount() {
    await this.waitForEarnSlot();
    return this.data("/api/v2/earn/sharkfin/account");
  }
  async eliteAssets() {
    await this.waitForEarnSlot(
      Math.max(this.runtime.earnRequestIntervalMs, 200),
    );
    return this.data("/api/v2/earn/elite/assets");
  }
  utaPositions(category: string) {
    return this.data("/api/v3/position/current-position", { category });
  }
  utaOrders(category: string, cursor?: string) {
    return this.data("/api/v3/trade/unfilled-orders", {
      category,
      limit: "100",
      ...(cursor ? { cursor } : {}),
    });
  }
  instruments() {
    return this.data("/api/v2/spot/public/symbols", {}, false);
  }
  tickers() {
    return this.data("/api/v2/spot/market/tickers", {}, false);
  }
}

