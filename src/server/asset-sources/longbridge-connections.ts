import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AssetReadError } from "@/server/asset-sync-diagnostics";
import type { AssetSourceRefresher, AssetSourceSummary, LongbridgeAuthorizationResult, LongbridgeOAuth, LongbridgeHoldingCandlestickReader, LongbridgeBenchmarkCandlestickReader, FormalSettlementCandleReader, FormalSettlementTradingCalendar } from "@/server/ports";
import { LongbridgeKeychainSdk, type LongbridgeAccountIdentity } from "./longbridge-keychain-sdk";
import { cliIdentity, sameAccount } from "./longbridge-cli-identity";
import { connectionReference, parseConnection, type LongbridgeConnection, type LongbridgeConnectionMode, type LongbridgeTransportStatus } from "./longbridge-connection";
import { KeychainLongbridgeOAuth, KeychainLongbridgeSourceRefresher, ServeLongbridgeHoldingCandlestickReader, ServeLongbridgeBenchmarkCandlestickReader, ServeLongbridgeFormalSettlementCandleReader, selectLongbridgeQuote } from "./longbridge";
import { ServeLongbridgeSourceRefresher } from "./longbridge-serve-assets";
import { LongbridgeServeMarketData } from "./longbridge-serve-market-data";
import { LongbridgeServeQuoteHub, type LongbridgeServeQuote, type LongbridgeServeStatus, LongbridgeServeClient } from "./longbridge-serve-client";
import { LongbridgeTradingCalendar } from "./longbridge-trading-calendar";
import { dailyAssetQuery, LONG_BRIDGE_DAILY_PATH } from "./longbridge-daily-assets";

const runFile = promisify(execFile);
interface ConnectionStore {
  listSources(): Promise<AssetSourceSummary[]>;
  longbridgeAccount(sourceId: string): LongbridgeAccountIdentity | null;
  pinLongbridgeAccount(sourceId: string, account: LongbridgeAccountIdentity): void;
  longbridgeTransport(sourceId: string): LongbridgeTransportStatus | null;
  recordLongbridgeTransport(reference: string, status: LongbridgeTransportStatus): void;
}
/** 原生 SDK 无取消接口；取消后立即丢弃其迟到结果，不进入持久化。 */
function abortable<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(operation).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
const label = (account: LongbridgeAccountIdentity) => `长桥账户 · ${account.accountChannel} · 尾号 ${account.memberId.slice(-4)}`;
const stableId = (account: LongbridgeAccountIdentity) => `longbridge:${createHash("sha256").update(`${account.accountChannel}:${account.memberId}`).digest("hex").slice(0, 16)}`;

/** 一个来源对应一个真实账户；CLI / SDK 只决定读取通道，不参与账本计算。 */
export class LongbridgeConnections implements LongbridgeOAuth, AssetSourceRefresher {
  private readonly sdk = new LongbridgeKeychainSdk();
  private login: Promise<void> | null = null;
  constructor(private readonly store: ConnectionStore) {}

  private binding(source: AssetSourceSummary): LongbridgeConnection {
    if (source.kind !== "longbridge" || !source.credentialReference) throw new Error("长桥来源不存在或未连接");
    const current = parseConnection(source.credentialReference);
    if (current) {
      if (current.accountId !== source.accountId) throw new Error("长桥账户绑定已改变");
      return current;
    }
    let account = this.store.longbridgeAccount(source.id);
    if (!account) {
      if (source.credentialReference !== this.sdk.credentialReference()) throw new Error("请重新连接长桥");
      account = this.sdk.accountIdentity();
      this.store.pinLongbridgeAccount(source.id, account);
    }
    return { version: 1, mode: "both", account, accountId: source.accountId, sdkReference: source.credentialReference };
  }

  async prepareSdkAuthorization(): Promise<void> {
    // 必须在 OAuth 覆盖 Keychain 前固定旧来源身份。
    for (const source of await this.store.listSources()) {
      if (source.kind === "longbridge" && source.credentialReference && !parseConnection(source.credentialReference)) this.binding(source);
    }
  }

  async start(redirectUri: string) {
    await this.prepareSdkAuthorization();
    return new KeychainLongbridgeOAuth(this.sdk).start(redirectUri);
  }

  async finish(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<LongbridgeAuthorizationResult> {
    await this.sdk.completeBrowserAuthorization({ state: input.codeVerifier, code: input.code, redirectUri: input.redirectUri });
    return this.previewConnection("sdk", new Date().toISOString());
  }

  async finishConnection(input: { code: string; codeVerifier: string; redirectUri: string; connectionMode?: LongbridgeConnectionMode; sourceId?: string }, at: string) {
    await this.sdk.completeBrowserAuthorization({ state: input.codeVerifier, code: input.code, redirectUri: input.redirectUri });
    return this.previewConnection(input.connectionMode ?? "sdk", at, input.sourceId);
  }

  private async target(account: LongbridgeAccountIdentity, sourceId?: string) {
    const sources = (await this.store.listSources()).filter(source => source.kind === "longbridge");
    if (sourceId) {
      const source = sources.find(source => source.id === sourceId);
      if (!source) throw new Error("长桥来源不存在");
      sameAccount(this.binding(source).account, account);
      return source.accountId;
    }
    for (const source of sources) {
      const bound = this.binding(source);
      if (bound.account.memberId === account.memberId && bound.account.accountChannel === account.accountChannel) return source.accountId;
    }
    return stableId(account);
  }

  async previewConnection(mode: LongbridgeConnectionMode, at: string, sourceId?: string): Promise<LongbridgeAuthorizationResult> {
    const signal = AbortSignal.timeout(45_000);
    let account: LongbridgeAccountIdentity;
    if (mode === "sdk") {
      if (this.sdk.authorizationStatus().status !== "authorized") throw new Error("请先授权 SDK");
      account = this.sdk.accountIdentity();
    } else {
      account = await cliIdentity(signal);
      if (mode === "both") {
        if (this.sdk.authorizationStatus().status !== "authorized") throw new Error("请先授权 SDK 备用连接");
        sameAccount(account, this.sdk.accountIdentity());
      }
    }
    const accountId = await this.target(account, sourceId);
    const connection: LongbridgeConnection = { version: 1, mode, account, accountId,
      ...(mode === "cli" ? {} : { sdkReference: this.sdk.credentialReference() }) };
    return this.revalidate({ credentials: connectionReference(connection), observedAt: at });
  }

  async revalidate(input: { credentials: string; observedAt: string }): Promise<LongbridgeAuthorizationResult> {
    const connection = parseConnection(input.credentials);
    if (!connection) throw new Error("长桥连接预览已过期，请重新检测");
    const snapshot = await this.read(input.credentials, connection,
      () => new ServeLongbridgeSourceRefresher({ credentialReference: () => input.credentials, accountIdentity: () => connection.account }, undefined, async () => connection.account).readSnapshot(input.observedAt),
      async () => (await new KeychainLongbridgeOAuth(this.sdk).revalidate({ credentials: this.sdk.credentialReference(), observedAt: input.observedAt })).snapshot);
    return { credentials: input.credentials, permissions: ["account", "positions", "market-data"],
      account: { id: connection.accountId, label: label(connection.account) }, snapshot };
  }

  private async check(connection: LongbridgeConnection, transport: "cli" | "sdk", signal: AbortSignal) {
    signal.throwIfAborted();
    if (transport === "cli") sameAccount(connection.account, await cliIdentity(signal));
    else {
      if (connection.sdkReference !== this.sdk.credentialReference() || this.sdk.authorizationStatus().status !== "authorized") throw new Error("长桥 SDK 授权不可用");
      sameAccount(connection.account, this.sdk.accountIdentity());
    }
  }

  async sdkAuthorizationExpiry(): Promise<number | null> {
    const sources = (await this.store.listSources()).filter(source => source.kind === "longbridge" &&
      source.lifecycle !== "disconnected" && source.credentialReference &&
      (parseConnection(source.credentialReference)?.mode ?? "both") !== "cli");
    if (!sources.length) return null;
    for (const source of sources) await this.check(this.binding(source), "sdk", new AbortController().signal);
    return this.sdk.authorizationExpiry();
  }

  renewSdkAuthorization() { return this.sdk.renewAuthorization(); }

  private async read<T>(reference: string, connection: LongbridgeConnection, cli: () => Promise<T>, sdk: () => Promise<T>, signal = AbortSignal.timeout(60_000)): Promise<T> {
    const attempt = async (transport: "cli" | "sdk", operation: () => Promise<T>, fallback: boolean) => {
      try {
        await this.check(connection, transport, signal);
        const value = await abortable(operation, signal);
        await this.check(connection, transport, signal);
        this.store.recordLongbridgeTransport(reference, { transport, fallback, at: new Date().toISOString() });
        return value;
      } catch (error) { throw new AssetReadError(transport, error); }
    };
    if (connection.mode === "sdk") return attempt("sdk", sdk, false);
    try { return await attempt("cli", cli, false); }
    catch (error) {
      signal.throwIfAborted();
      if (connection.mode !== "both") throw error;
      try { return await attempt("sdk", sdk, true); }
      catch (fallbackError) {
        signal.throwIfAborted();
        throw new AggregateError([error, fallbackError], "长桥 CLI 与 SDK 均读取失败", { cause: error });
      }
    }
  }

  private sdkWithReference(reference: string) {
    return new Proxy(this.sdk, { get(target, key) {
      if (key === "credentialReference") return () => reference;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  }

  async refresh(input: Parameters<AssetSourceRefresher["refresh"]>[0]) {
    if (input.credentials !== input.source.credentialReference) throw new Error("长桥来源绑定已改变");
    const bound = this.binding(input.source);
    return this.read(input.credentials, bound,
      () => new ServeLongbridgeSourceRefresher({ credentialReference: () => input.credentials, accountIdentity: () => bound.account }, undefined, async () => bound.account).refresh(input),
      () => new KeychainLongbridgeSourceRefresher(this.sdkWithReference(input.credentials)).refresh(input), input.signal);
  }

  private async firstSource() {
    const source = (await this.store.listSources()).find(source => source.kind === "longbridge" && source.lifecycle !== "disconnected" && source.credentialReference);
    if (!source) throw new Error("请先连接长桥");
    return source;
  }

  private async market<T>(source: AssetSourceSummary, operation: (reader: LongbridgeServeMarketData | LongbridgeKeychainSdk) => Promise<T>) {
    const reference = source.credentialReference!;
    return this.read(reference, this.binding(source), () => operation(new LongbridgeServeMarketData()), () => operation(this.sdk));
  }

  readonly holdingCandlesticks: LongbridgeHoldingCandlestickReader = {
    readCandlesticks: input => this.market(input.source, reader => new ServeLongbridgeHoldingCandlestickReader({
      credentialReference: () => input.source.credentialReference!,
      readCandlesticks: reader.readCandlesticks.bind(reader), readFiveDayTrend: reader.readFiveDayTrend.bind(reader),
    }).readCandlesticks(input)),
    readFiveDayTrend: input => this.market(input.source, reader => new ServeLongbridgeHoldingCandlestickReader({
      credentialReference: () => input.source.credentialReference!,
      readCandlesticks: reader.readCandlesticks.bind(reader), readFiveDayTrend: reader.readFiveDayTrend.bind(reader),
    }).readFiveDayTrend(input)),
  };
  readonly settlementCandles: FormalSettlementCandleReader = {
    readDailyCandles: input => this.market(input.source, reader => new ServeLongbridgeFormalSettlementCandleReader({
      credentialReference: () => input.source.credentialReference!, readDailyCandles: reader.readDailyCandles.bind(reader),
    }).readDailyCandles(input)),
  };
  readonly benchmarkCandlesticks: LongbridgeBenchmarkCandlestickReader = {
    readDailyCandlesticks: async input => this.market(await this.firstSource(), reader => new ServeLongbridgeBenchmarkCandlestickReader(reader).readDailyCandlesticks(input)),
  };
  readonly tradingCalendar: FormalSettlementTradingCalendar = {
    readTradingDays: async input => {
      const source = await this.firstSource();
      return this.read(source.credentialReference!, this.binding(source),
        () => new LongbridgeTradingCalendar().readTradingDays(input),
        async () => {
          const days = await this.sdk.readTradingDays(input);
          return { tradingDays: days.trading_days, halfTradingDays: days.half_trading_days };
        });
    },
  };

  async readDailyAsset(source: AssetSourceSummary, account: LongbridgeAccountIdentity, day: string, signal: AbortSignal) {
    const bound = this.binding(source);
    sameAccount(account, bound.account);
    const query = dailyAssetQuery(day);
    return this.read(source.credentialReference!, bound, async () => {
      const client = new LongbridgeServeClient();
      const close = () => { void client.close(); };
      signal.addEventListener("abort", close, { once: true });
      try { signal.throwIfAborted(); return await client.call("api.get", { path: LONG_BRIDGE_DAILY_PATH, query }); }
      finally { signal.removeEventListener("abort", close); await client.close(); }
    }, () => this.sdk.readDailyAsset(query), signal);
  }

  /** CLI 推送；SDK 每 15 秒读取报价。只更新页面，不逐 tick 写历史。 */
  subscribeQuotes(source: AssetSourceSummary, symbols: string[], listener: (quote: LongbridgeServeQuote) => void, status: (value: LongbridgeServeStatus) => void) {
    const bound = this.binding(source);
    const controller = new AbortController();
    let closed = false;
    let subscription: { close(): void } | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let usingSdk = bound.mode === "sdk";
    let lastCliAttempt = 0;
    const close = () => {
      closed = true;
      controller.abort();
      subscription?.close();
      subscription = null;
      if (timer) clearTimeout(timer);
    };
    const current = async () => {
      const found = (await this.store.listSources()).find(item => item.id === source.id);
      if (!found || found.lifecycle === "disconnected" || found.credentialReference !== source.credentialReference) {
        close(); status({ state: "error", code: "authentication-required" });
        throw new Error("长桥连接已改变，请重新连接行情");
      }
    };
    const sdkQuotes = async () => {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
      await this.check(bound, "sdk", signal);
      const quotes = await abortable(() => this.sdk.readQuotes(symbols), signal);
      await this.check(bound, "sdk", signal);
      await current();
      if (closed) return;
      for (const quote of quotes) {
        if (closed) return;
        const selected = selectLongbridgeQuote(quote);
        if (!selected?.quotedAt) continue;
        const sessions = { regular: "intraday", "pre-market": "pre", "post-market": "post", overnight: "overnight", unknown: "unknown" };
        listener({ symbol: quote.symbol, last_done: selected.price, timestamp: selected.quotedAt,
          ...(selected.session === "regular" ? { prev_close: quote.prevClose } : {}),
          trade_session: sessions[selected.session], trade_status: quote.tradeStatus });
      }
      if (closed) return;
      this.store.recordLongbridgeTransport(source.credentialReference!, { transport: "sdk", fallback: bound.mode === "both", at: new Date().toISOString() });
      status({ state: "ready" });
    };
    const cliStart = async () => {
      lastCliAttempt = Date.now();
      await this.check(bound, "cli", AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));
      await current();
      if (closed) return;
      usingSdk = false;
      const created = new LongbridgeServeQuoteHub().subscribe(symbols, quote => { if (!closed && !usingSdk) listener(quote); }, value => {
        if (closed) return;
        if (value.state === "error") {
          subscription?.close();
          subscription = null;
          if (bound.mode === "both") { usingSdk = true; status({ state: "connecting" }); }
          else status(value);
        } else {
          if (value.state === "ready") this.store.recordLongbridgeTransport(source.credentialReference!, { transport: "cli", fallback: false, at: new Date().toISOString() });
          status(value);
        }
      });
      if (closed) created.close(); else subscription = created;
    };
    const cycle = async () => {
      try {
        await current();
        if (bound.mode !== "sdk" && !subscription && Date.now() - lastCliAttempt >= 60_000) {
          try { await cliStart(); }
          catch { if (closed) return; usingSdk = bound.mode === "both"; if (!usingSdk) status({ state: "error", code: "unavailable" }); }
        }
        if (usingSdk) await sdkQuotes();
        else if (subscription) await this.check(bound, "cli", AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));
      } catch {
        subscription?.close(); subscription = null;
        if (!closed) { usingSdk = bound.mode === "both" || bound.mode === "sdk"; status({ state: "error", code: "unavailable" }); }
      } finally { if (!closed) timer = setTimeout(() => { void cycle(); }, 15_000); }
    };
    status({ state: "connecting" });
    void cycle();
    return { close };
  }

  async status(sourceId?: string) {
    const source = sourceId ? (await this.store.listSources()).find(source => source.id === sourceId && source.kind === "longbridge") : undefined;
    if (sourceId && !source) throw new Error("长桥来源不存在");
    const bound = source ? this.binding(source) : null;
    const cli = await this.cliStatus();
    let sdk: { authorized: boolean; account?: string; matches?: boolean; error?: string };
    try {
      const authorized = this.sdk.authorizationStatus().status === "authorized";
      const identity = authorized ? this.sdk.accountIdentity() : null;
      sdk = { authorized, ...(identity ? { account: label(identity), matches: !bound || (identity.memberId === bound.account.memberId && identity.accountChannel === bound.account.accountChannel) } : {}) };
    } catch (error) { sdk = { authorized: false, error: error instanceof Error ? error.message : "SDK 不可用" }; }
    return { mode: bound?.mode ?? "cli", account: bound ? label(bound.account) : null,
      lastUsed: source ? this.store.longbridgeTransport(source.id) : null,
      cli: { installed: cli.installed, version: cli.version, authorized: cli.account !== null,
        account: cli.account ? label(cli.account) : null,
        matches: !bound || !cli.account || (bound.account.memberId === cli.account.memberId && bound.account.accountChannel === cli.account.accountChannel), error: cli.error }, sdk };
  }

  private async cliStatus() {
    const command = process.env.LONGBRIDGE_SERVE_BIN ?? "longbridge";
    let version: string;
    try { version = (await runFile(command, ["--version"], { timeout: 5000, maxBuffer: 65536 })).stdout.trim().slice(0, 100); }
    catch { return { installed: false, version: null, account: null, error: "未检测到 Longbridge CLI，请在运行 KanBan 的机器上安装" }; }
    try { return { installed: true, version, account: await cliIdentity(AbortSignal.timeout(15_000)), error: null }; }
    catch { return { installed: true, version, account: null, error: "CLI 未登录或授权检查失败，请登录后重新检测" }; }
  }

  async loginCli(code: string) {
    if (this.login) throw new Error("CLI 正在登录，请稍后重新检测");
    if (!code.trim() || code.length > 4096 || /\s/.test(code)) throw new Error("请输入长桥一次性授权码");
    const status = await this.cliStatus();
    if (!status.installed) throw new Error(status.error!);
    if (status.account) throw new Error("CLI 已登录，请直接连接此账户");
    this.login = runFile(process.env.LONGBRIDGE_SERVE_BIN ?? "longbridge", ["auth", "login", "--auth-code", code, "--format", "json"],
      { timeout: 60_000, maxBuffer: 1_048_576 }).then(() => undefined).catch(() => { throw new Error("CLI 登录失败，请重新获取授权码"); });
    try { await this.login; } finally { this.login = null; }
  }
}
