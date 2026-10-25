import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { AssetReadError } from "@/server/asset-sync-diagnostics";

import { longbridgeQuoteTime, longbridgeQuotePeriod, type LongbridgeRealtimeQuote } from "@/domain/longbridge-realtime";

export type LongbridgeServeQuote = LongbridgeRealtimeQuote;

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: string | number;
  result?: unknown;
  error?: { code?: number; message?: string };
}

interface JsonRpcNotification {
  jsonrpc?: string;
  method?: string;
  params?: unknown;
}

type QuoteListener = (quote: LongbridgeServeQuote) => void;

export type LongbridgeServeErrorCode =
  | "authentication-required"
  | "cli-unavailable"
  | "unavailable";

export type LongbridgeServeStatus =
  | { state: "connecting" }
  | { state: "ready" }
  | { state: "error"; code: LongbridgeServeErrorCode };

export class LongbridgeServeError extends Error {
  readonly code: LongbridgeServeErrorCode;

  constructor(code: LongbridgeServeErrorCode, cause?: unknown) {
    super(code === "authentication-required"
      ? "未检测到长桥 CLI 登录状态"
      : code === "cli-unavailable"
        ? "未找到长桥 CLI"
        : "长桥实时行情暂时不可用");
    this.name = "LongbridgeServeError";
    this.code = code;
    this.cause = cause;
  }
}

function rawErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

function isErrno(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

export function classifyLongbridgeServeError(
  error: unknown,
): LongbridgeServeError {
  if (error instanceof LongbridgeServeError) return error;
  const message = rawErrorMessage(error).toLowerCase();
  if (isErrno(error, "ENOENT")) {
    return new LongbridgeServeError("cli-unavailable", error);
  }
  if (
    /auth|unauthor|credential|login|logged in|token|permission|认证|授权|登录|凭证/.test(
      message,
    )
  ) {
    return new LongbridgeServeError("authentication-required", error);
  }
  return new LongbridgeServeError("unavailable", error);
}

const WRITE_METHODS = new Set([
  "trade.submit_order",
  "trade.cancel_order",
  "trade.replace_order",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function quoteFrom(value: unknown): LongbridgeServeQuote | null {
  if (!isRecord(value)) return null;
  if (typeof value.symbol !== "string" || typeof value.last_done !== "string") {
    return null;
  }
  return value as unknown as LongbridgeServeQuote;
}

function snapshotQuote(value: unknown): LongbridgeServeQuote | null {
  const regular = quoteFrom(value);
  if (!regular || !isRecord(value)) return null;
  let latest = { ...regular, trade_session: regular.trade_session ?? "Intraday" };
  for (const [field, session] of [["pre_market_quote", "Pre"], ["post_market_quote", "Post"], ["overnight_quote", "Overnight"]]) {
    const extended = value[field];
    if (!isRecord(extended)) continue;
    const candidate = quoteFrom({ ...extended, symbol: regular.symbol, trade_session: session, trade_status: regular.trade_status });
    if (!candidate) continue;
    const time = longbridgeQuoteTime(candidate.timestamp);
    if (time !== null && time > (longbridgeQuoteTime(latest.timestamp) ?? 0)) latest = { ...candidate, trade_session: session };
  }
  return latest;
}

function quoteList(value: unknown): LongbridgeServeQuote[] {
  if (Array.isArray(value)) return value.flatMap((item) => {
    const quote = snapshotQuote(item);
    return quote ? [quote] : [];
  });
  if (!isRecord(value)) return [];
  const quotes = value.quotes;
  return Array.isArray(quotes) ? quoteList(quotes) : [];
}

export interface LongbridgeServeClientOptions {
  command?: string;
  requestTimeoutMs?: number;
  spawnProcess?: (command: string) => ChildProcessWithoutNullStreams;
}

/** 长桥 serve 的最小 JSON-RPC 客户端，只允许只读接口和行情订阅。 */
export class LongbridgeServeClient {
  private process: ChildProcessWithoutNullStreams | null = null;
  private lineReader: ReturnType<typeof createInterface> | null = null;
  private nextId = 1;
  private readonly pending = new Map<string | number, {
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
    method: string;
  }>();
  private readonly listeners = new Set<QuoteListener>();
  private readonly disconnectListeners = new Set<(error: unknown) => void>();
  private startPromise: Promise<void> | null = null;
  private readonly command: string;
  private readonly requestTimeoutMs: number;
  private readonly spawnProcess: (command: string) => ChildProcessWithoutNullStreams;

  constructor(options: LongbridgeServeClientOptions = {}) {
    this.command = options.command ?? process.env.LONGBRIDGE_SERVE_BIN ?? "longbridge";
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
    this.spawnProcess = options.spawnProcess ?? ((command) => spawn(
      command,
      ["serve", "--format", "json"],
      { stdio: ["pipe", "pipe", "pipe"] },
    ));
  }

  onQuote(listener: QuoteListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onDisconnect(listener: (error: unknown) => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (WRITE_METHODS.has(method)) {
      throw new Error("长桥 serve 只读客户端禁止调用：" + method);
    }
    await this.start();
    if (!this.process) throw new Error("长桥 serve 进程已关闭");
    const id = this.nextId++;
    const request = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AssetReadError("cli", new DOMException("长桥 serve 请求超时", "TimeoutError"), method));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.process?.stdin.write(request + "\n");
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async subscribe(symbols: string[]): Promise<LongbridgeServeQuote[]> {
    const uniqueSymbols = [...new Set(symbols.map((symbol) => symbol.trim()).filter(Boolean))];
    if (uniqueSymbols.length === 0) return [];
    const result = await this.call("quote.subscribe", { symbols: uniqueSymbols });
    if (isRecord(result) && !Array.isArray(result.quotes)) return this.quotes(uniqueSymbols);
    return quoteList(result);
  }

  async quotes(symbols: string[]): Promise<LongbridgeServeQuote[]> {
    return quoteList(await this.call("quote.quote", { symbols }));
  }

  async close(): Promise<void> {
    const process = this.process;
    this.process = null;
    this.lineReader?.close();
    this.lineReader = null;
    this.startPromise = null;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("长桥 serve 进程已关闭"));
      this.pending.delete(id);
    }
    if (process && !process.killed) process.kill();
  }

  private async start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    if (this.process) return;
    const starting = this.initialize();
    this.startPromise = starting;
    try { await starting; }
    finally { if (this.startPromise === starting) this.startPromise = null; }
  }

  private initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = this.spawnProcess(this.command);
      } catch (error) {
        reject(error);
        return;
      }
      this.process = child;
      const reader = createInterface({ input: child.stdout });
      this.lineReader = reader;
      reader.on("line", (line) => {
        if (this.process === child) this.handleLine(line);
      });
      const disconnected = (error: unknown) => {
        // Old child events may arrive after an intentional close/restart.
        if (this.process !== child) return;
        this.process = null;
        reader.close();
        if (this.lineReader === reader) this.lineReader = null;
        this.failPending(error);
        reject(error);
        if (!child.killed) child.kill();
        for (const listener of this.disconnectListeners) listener(error);
      };
      child.once("error", disconnected);
      child.stdin.on("error", disconnected);
      child.once("exit", (code, signal) => {
        disconnected(Object.assign(new Error("长桥 serve 进程退出（" + (signal ?? code ?? "unknown") + "）"), { code: "EPIPE" }));
      });
      void this.callInternal("initialize", {}).then(
        () => {
          if (this.process === child) resolve();
          else reject(new Error("长桥 serve 进程已关闭"));
        },
        (error) => {
          disconnected(error);
          reject(error);
        },
      );
    });
  }

  private callInternal(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = randomUUID();
    const request = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AssetReadError("cli", new DOMException("长桥 serve 请求超时", "TimeoutError"), method));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.process?.stdin.write(request + "\n");
    });
  }

  private handleLine(line: string): void {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(value)) return;
    const notification = value as JsonRpcNotification;
    if (notification.method === "quote.updated") {
      const quote = quoteFrom(notification.params);
      if (quote) for (const listener of this.listeners) listener(quote);
      return;
    }
    const response = value as JsonRpcResponse;
    if (response.id === undefined) return;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    clearTimeout(pending.timer);
    if (response.error) {
      pending.reject(new AssetReadError("cli", Object.assign(new Error(response.error.message ?? "长桥 serve 请求失败"), {
        code: response.error.code,
      }), pending.method));
    } else {
      pending.resolve(response.result);
    }
  }

  private failPending(error: unknown): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new AssetReadError("cli", error, pending.method));
      this.pending.delete(id);
    }
  }
}

export interface LongbridgeServeQuoteSubscription {
  close(): void;
}

type StatusListener = (status: LongbridgeServeStatus) => void;

export class LongbridgeServeQuoteHub {
  private readonly subscribers = new Map<string, {
    symbols: Set<string>;
    listener: QuoteListener;
    statusListener?: StatusListener;
  }>();
  private subscribedSymbols = new Set<string>();
  private subscribePromise: Promise<void> | null = null;

  private readonly latest = new Map<string, LongbridgeServeQuote>();
  private readonly referenceAttempts = new Map<string, { period: string; at: number }>();
  private readonly referenceQueue = new Set<string>();
  private refreshingReferences = false;
  private referenceTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private generation = 0;

  constructor(private readonly client = new LongbridgeServeClient()) {
    this.client.onQuote((quote) => this.receive(quote, true));
    this.client.onDisconnect((error) => this.connectionFailed(error));
  }

  private activeSymbols(): Set<string> {
    return new Set([...this.subscribers.values()].flatMap(subscriber => [...subscriber.symbols]));
  }

  private broadcast(status: LongbridgeServeStatus): void {
    for (const subscriber of this.subscribers.values()) subscriber.statusListener?.(status);
  }

  private connectionFailed(error: unknown): void {
    if (this.subscribers.size === 0 || this.reconnectTimer !== null) return;
    this.generation++;
    this.subscribePromise = null;
    this.subscribedSymbols.clear();
    if (this.referenceTimer !== null) clearTimeout(this.referenceTimer);
    this.referenceTimer = null;
    this.refreshingReferences = false;
    this.referenceQueue.clear();
    this.referenceAttempts.clear();
    void this.client.close();
    const code = classifyLongbridgeServeError(error).code;
    this.broadcast({ state: "error", code });
    // Missing CLI / expired authorization need an explicit user retry.
    if (code !== "unavailable") return;
    const delay = Math.min(1_000 * 2 ** this.reconnectAttempt++, 30_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.subscribers.size > 0) void this.sync();
    }, delay);
    this.reconnectTimer.unref();
  }

  private stop(): void {
    this.generation++;
    this.subscribePromise = null;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    if (this.referenceTimer !== null) clearTimeout(this.referenceTimer);
    this.reconnectTimer = null;
    this.referenceTimer = null;
    this.reconnectAttempt = 0;
    this.refreshingReferences = false;
    this.subscribedSymbols.clear();
    this.referenceQueue.clear();
    this.referenceAttempts.clear();
    this.latest.clear();
    void this.client.close();
  }

  private receive(quote: LongbridgeServeQuote, pushed = false): void {
    if (![...this.subscribers.values()].some(s => s.symbols.has(quote.symbol))) return;
    const time = longbridgeQuoteTime(quote.timestamp);
    if (time === null) return;
    const previous = this.latest.get(quote.symbol);
    const samePeriod = previous && longbridgeQuotePeriod(previous) === longbridgeQuotePeriod(quote);
    if (previous && time < (longbridgeQuoteTime(previous.timestamp) ?? 0)) {
      // A slower snapshot can supply the reference price, but never roll back a newer tick.
      if (!pushed && samePeriod && quote.prev_close !== undefined) quote = { ...previous, prev_close: quote.prev_close };
      else return;
    } else if (samePeriod && quote.prev_close === undefined) {
      quote = { ...quote, prev_close: previous.prev_close };
    }
    this.latest.set(quote.symbol, quote);
    for (const subscriber of this.subscribers.values()) {
      if (subscriber.symbols.has(quote.symbol)) subscriber.listener(quote);
    }
    if (pushed && quote.prev_close === undefined) {
      const period = longbridgeQuotePeriod(quote);
      const attempt = this.referenceAttempts.get(quote.symbol);
      if (!attempt || attempt.period !== period || Date.now() - attempt.at >= 30_000) {
        this.referenceAttempts.set(quote.symbol, { period, at: Date.now() });
        this.referenceQueue.add(quote.symbol);
        if (!this.refreshingReferences) {
          this.refreshingReferences = true;
          this.referenceTimer = setTimeout(() => {
            this.referenceTimer = null;
            void this.refreshReferences();
          }, 100);
        }
      }
    }
  }

  private async refreshReferences(): Promise<void> {
    const generation = this.generation;
    try {
      // Batch and serialize session changes across symbols; never query on every tick.
      while (this.referenceQueue.size > 0 && generation === this.generation) {
        const active = this.activeSymbols();
        const symbols = [...this.referenceQueue].filter(symbol => active.has(symbol));
        this.referenceQueue.clear();
        if (symbols.length === 0) break;
        try {
          if (this.subscribePromise) await this.subscribePromise;
          if (generation !== this.generation) break;
          const quotes = await this.client.quotes(symbols);
          if (generation === this.generation) for (const quote of quotes) this.receive(quote);
        } catch {
          // Keep streaming prices; missing references remain unknown until a later tick retries.
        }
      }
    } finally { if (generation === this.generation) this.refreshingReferences = false; }
  }

  subscribe(
    symbols: string[],
    listener: QuoteListener,
    statusListener?: StatusListener,
  ): LongbridgeServeQuoteSubscription {
    const id = randomUUID();
    const normalizedSymbols = new Set(
      symbols.map((symbol) => symbol.trim()).filter(Boolean),
    );
    this.subscribers.set(id, {
      symbols: normalizedSymbols,
      listener,
      statusListener,
    });
    for (const symbol of normalizedSymbols) {
      const quote = this.latest.get(symbol);
      if (quote) listener(quote);
    }
    statusListener?.({ state: "connecting" });
    if (this.reconnectTimer === null) void this.sync();
    return {
      close: () => {
        if (!this.subscribers.delete(id)) return;
        if (this.subscribers.size === 0) this.stop();
      },
    };
  }

  private async sync(): Promise<void> {
    if (this.subscribePromise) return this.subscribePromise;
    const generation = this.generation;
    this.broadcast({ state: "connecting" });
    const syncing = (async () => {
      while (this.subscribers.size > 0 && generation === this.generation) {
        const pending = [...this.activeSymbols()].filter(symbol => !this.subscribedSymbols.has(symbol));
        if (pending.length === 0) break;
        const quotes = await this.client.subscribe(pending);
        if (generation !== this.generation) return;
        for (const symbol of pending) this.subscribedSymbols.add(symbol);
        for (const quote of quotes) this.receive(quote);
      }
      if (generation !== this.generation || this.subscribers.size === 0) return;
      this.reconnectAttempt = 0;
      this.broadcast({ state: "ready" });
    })().catch((error) => {
      if (generation === this.generation) this.connectionFailed(error);
    }).finally(() => {
      if (this.subscribePromise === syncing) this.subscribePromise = null;
    });
    this.subscribePromise = syncing;
    return syncing;
  }
}
