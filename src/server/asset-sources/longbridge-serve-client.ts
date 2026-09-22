import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";

export interface LongbridgeServeQuote {
  symbol: string;
  last_done: string;
  prev_close?: string;
  timestamp?: number | string;
  trade_status?: string;
  trade_session?: string;
}

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

function quoteList(value: unknown): LongbridgeServeQuote[] {
  if (Array.isArray(value)) return value.flatMap((item) => {
    const quote = quoteFrom(item);
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
  }>();
  private readonly listeners = new Set<QuoteListener>();
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

  async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (WRITE_METHODS.has(method)) {
      throw new Error("长桥 serve 只读客户端禁止调用：" + method);
    }
    await this.start();
    const id = this.nextId++;
    const request = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("长桥 serve 请求超时：" + method));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
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
    return quoteList(result);
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
    if (this.process) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = new Promise((resolve, reject) => {
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
      reader.on("line", (line) => this.handleLine(line));
      child.once("error", (error) => {
        this.failPending(error);
        if (this.process === child) this.process = null;
        if (this.startPromise) {
          this.startPromise = null;
          reject(error);
        }
      });
      child.once("exit", (code, signal) => {
        const error = new Error("长桥 serve 进程退出（" + (signal ?? code ?? "unknown") + "）");
        this.failPending(error);
        if (this.process === child) this.process = null;
        this.lineReader?.close();
        this.lineReader = null;
      });
      void this.callInternal("initialize", {}).then(
        () => {
          this.startPromise = null;
          resolve();
        },
        (error) => {
          this.startPromise = null;
          void this.close();
          reject(error);
        },
      );
    });
    return this.startPromise;
  }

  private callInternal(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = randomUUID();
    const request = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("长桥 serve 请求超时：" + method));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
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
      pending.reject(new Error(response.error.message ?? "长桥 serve 请求失败"));
    } else {
      pending.resolve(response.result);
    }
  }

  private failPending(error: unknown): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

export interface LongbridgeServeQuoteSubscription {
  close(): void;
}

class LongbridgeServeQuoteHub {
  private readonly client = new LongbridgeServeClient();
  private readonly subscribers = new Map<string, {
    symbols: Set<string>;
    listener: QuoteListener;
  }>();
  private subscribedSymbols = new Set<string>();
  private subscribePromise: Promise<void> | null = null;

  constructor() {
    this.client.onQuote((quote) => {
      for (const subscriber of this.subscribers.values()) {
        if (subscriber.symbols.has(quote.symbol)) subscriber.listener(quote);
      }
    });
  }

  subscribe(symbols: string[], listener: QuoteListener): LongbridgeServeQuoteSubscription {
    const id = randomUUID();
    const normalizedSymbols = new Set(
      symbols.map((symbol) => symbol.trim()).filter(Boolean),
    );
    this.subscribers.set(id, {
      symbols: normalizedSymbols,
      listener,
    });
    void this.sync([...normalizedSymbols]).catch(() => {
      // 后续订阅会再次尝试；SSE 客户端不应收到未处理 Promise rejection。
    });
    return {
      close: () => this.subscribers.delete(id),
    };
  }

  private async sync(symbols: string[]): Promise<void> {
    for (const symbol of symbols) this.subscribedSymbols.add(symbol);
    if (this.subscribePromise) return this.subscribePromise;
    this.subscribePromise = (async () => {
      while (this.subscribedSymbols.size > 0) {
        const pending = [...this.subscribedSymbols];
        const quotes = await this.client.subscribe(pending);
        for (const quote of quotes) {
          for (const subscriber of this.subscribers.values()) {
            if (subscriber.symbols.has(quote.symbol)) subscriber.listener(quote);
          }
        }
        const stillPending = pending.some((symbol) => !this.subscribedSymbols.has(symbol));
        if (!stillPending && pending.length === this.subscribedSymbols.size) break;
      }
    })().finally(() => {
      this.subscribePromise = null;
    });
    return this.subscribePromise;
  }
}

const HUB_KEY = "__kanban_longbridge_serve_quote_hub__";

export function getLongbridgeServeQuoteHub(): LongbridgeServeQuoteHub {
  const globalScope = globalThis as unknown as Record<string, LongbridgeServeQuoteHub | undefined>;
  globalScope[HUB_KEY] ??= new LongbridgeServeQuoteHub();
  return globalScope[HUB_KEY];
}
