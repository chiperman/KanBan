import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { isLongbridgeUsOptionSymbol } from "@/domain/longbridge-symbols";
import { longbridgeQuoteTime } from "@/domain/longbridge-realtime";
import { LongbridgeKeychainSdk, type LongbridgeAccountIdentity, type LongbridgeNativeQuote } from "@/server/asset-sources/longbridge-keychain-sdk";
import { mapLongbridgeSnapshot, snapshotRetainingMissingQuotes, snapshotWithQuotes } from "@/server/asset-sources/longbridge";
import { LongbridgeServeClient } from "@/server/asset-sources/longbridge-serve-client";
import type { AssetSnapshot, AssetSourceRefresher, AssetSourceRefreshResult } from "@/server/ports";

const runFile = promisify(execFile);
type Serve = Pick<LongbridgeServeClient, "call" | "close">;
type IdentitySdk = Pick<LongbridgeKeychainSdk, "credentialReference" | "accountIdentity">;
type RefreshInput = Parameters<AssetSourceRefresher["refresh"]>[0];

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("长桥 CLI 资产响应格式无效");
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("长桥 CLI 资产字段缺失");
  return value;
}

function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("长桥 CLI 资产列表缺失");
  return value;
}

async function cliIdentity(signal: AbortSignal): Promise<LongbridgeAccountIdentity> {
  // auth status 只返回身份/状态，不读取 CLI 的 Token 文件，不接触凭证原文。
  const { stdout } = await runFile(process.env.LONGBRIDGE_SERVE_BIN ?? "longbridge", ["auth", "status", "--format", "json"], {
    signal, timeout: 15_000, maxBuffer: 1_048_576,
  });
  const account = record(record(JSON.parse(stdout)).account);
  if (!Number.isSafeInteger(account.member_id) || Number(account.member_id) <= 0) throw new Error("长桥 CLI 账户身份不可用");
  return { memberId: String(account.member_id), accountChannel: text(account.account_channel) };
}

function sameAccount(expected: LongbridgeAccountIdentity, actual: LongbridgeAccountIdentity): void {
  if (!expected.memberId || !expected.accountChannel || expected.memberId !== actual.memberId || expected.accountChannel !== actual.accountChannel) {
    throw new Error("长桥 CLI 与已连接来源的账户不一致");
  }
}

function positions(value: unknown, field: "stock_info" | "fund_info", identity: LongbridgeAccountIdentity): Record<string, unknown>[] {
  return list(record(value).list).flatMap((entry) => {
    const channel = record(entry);
    if (channel.account_channel !== identity.accountChannel) throw new Error("长桥 CLI 持仓账户不一致");
    return list(channel[field]).map((item) => {
      const position = record(item);
      text(position.symbol);
      text(position.currency);
      text(position.quantity ?? position.holding_units);
      return position;
    });
  });
}

function quoteTimestamp(value: unknown): number {
  const milliseconds = longbridgeQuoteTime(value);
  if (milliseconds === null) throw new Error("长桥 CLI 行情时间格式无效");
  return Math.floor(milliseconds / 1_000);
}

function quote(value: unknown): LongbridgeNativeQuote {
  const raw = record(value);
  const extended = (value: unknown) => {
    if (value === null || value === undefined) return null;
    const data = record(value);
    return { lastDone: text(data.last_done), timestamp: quoteTimestamp(data.timestamp) };
  };
  return {
    symbol: text(raw.symbol), lastDone: text(raw.last_done), prevClose: text(raw.prev_close),
    timestamp: quoteTimestamp(raw.timestamp),
    tradeStatus: raw.trade_status === "Normal" ? "NORMAL" : typeof raw.trade_status === "string" ? raw.trade_status : undefined,
    delivery: "unknown",
    preMarketQuote: extended(raw.pre_market_quote), postMarketQuote: extended(raw.post_market_quote), overnightQuote: extended(raw.overnight_quote),
  };
}

/** 所有资产读取使用 CLI serve；失败由同步协调器保留上次快照。 */
export class ServeLongbridgeSourceRefresher implements AssetSourceRefresher {
  constructor(
    private readonly sdk: IdentitySdk = new LongbridgeKeychainSdk(),
    private readonly createClient: () => Serve = () => new LongbridgeServeClient(),
    private readonly readCliIdentity = cliIdentity,
  ) {}

  async refresh(input: RefreshInput): Promise<AssetSourceRefreshResult> {
    if (input.source.kind !== "longbridge" || input.credentials !== this.sdk.credentialReference()) {
      throw new Error("长桥来源不是当前 macOS Keychain 凭证，请重新连接");
    }
    input.signal.throwIfAborted();
    return this.readServe({ ...input, previousSnapshot: input.source.snapshot });
  }

  async readSnapshot(attemptedAt: string): Promise<AssetSnapshot> {
    return (await this.readServe({ attemptedAt, signal: new AbortController().signal })).snapshot;
  }

  private async readServe(input: Pick<RefreshInput, "attemptedAt" | "signal"> & {
    mode?: RefreshInput["mode"];
    previousSnapshot?: AssetSnapshot;
  }): Promise<AssetSourceRefreshResult> {
    // 限制整次读取时间；超时/取消必须回收本次创建的子进程。
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(40_000)]);
    const client = this.createClient();
    const close = () => { void client.close(); };
    signal.addEventListener("abort", close, { once: true });
    const call = async (method: string, params: Record<string, unknown> = {}) => {
      signal.throwIfAborted();
      const value = await client.call(method, params);
      signal.throwIfAborted();
      return value;
    };
    try {
      const identity = this.sdk.accountIdentity();
      sameAccount(identity, await this.readCliIdentity(signal));
      let snapshot;
      if (input.mode === "prices") {
        if (!input.previousSnapshot) throw new Error("长桥价格刷新缺少原快照");
        const symbols = input.previousSnapshot.holdings.map((holding) => holding.symbol)
          .filter((symbol) => !symbol.startsWith("CASH.") && !isLongbridgeUsOptionSymbol(symbol));
        const quotes = symbols.length ? list(await call("quote.quote", { symbols })).map(quote) : [];
        snapshot = snapshotWithQuotes(input.previousSnapshot, quotes, input.attemptedAt);
      } else {
        // 首个请求等待 initialize 完成，再并发读取其余只读接口。
        const accounts = list(await call("trade.account_balance", { currency: "USD" }));
        if (accounts.length !== 1) throw new Error("长桥 CLI 账户总额缺失或不唯一");
        const account = record(accounts[0]);
        if (account.currency !== "USD") throw new Error("长桥 CLI 账户币种不匹配");
        text(account.net_assets);
        text(account.total_cash);
        list(account.cash_infos);
        const [stockPage, fundPage, rates] = await Promise.all([
          call("trade.stock_positions"), call("trade.fund_positions"),
          call("api.get", { path: "/v1/asset/exchange_rates" }),
        ]);
        const stocks = positions(stockPage, "stock_info", identity);
        positions(fundPage, "fund_info", identity);
        const exchanges = list(record(rates).exchanges);
        if (!exchanges.length) throw new Error("长桥 CLI 官方汇率缺失");
        const symbols = [...new Set(stocks.map((item) => text(item.symbol)).filter((symbol) => !isLongbridgeUsOptionSymbol(symbol)))];
        const quotes = symbols.length ? list(await call("quote.quote", { symbols })).map(quote) : [];
        snapshot = mapLongbridgeSnapshot({
          accountPages: [{ list: accounts }], positionPages: [stockPage, fundPage],
          quotes, exchangeRates: exchanges, syncedAt: input.attemptedAt,
        });
        if (input.previousSnapshot) snapshot = snapshotRetainingMissingQuotes(snapshot, input.previousSnapshot);
      }
      // CLI 在读取期间若发生账户切换，丢弃整次结果。
      sameAccount(identity, await this.readCliIdentity(signal));
      signal.throwIfAborted();
      return { snapshot };
    } finally {
      signal.removeEventListener("abort", close);
      await client.close();
    }
  }
}
