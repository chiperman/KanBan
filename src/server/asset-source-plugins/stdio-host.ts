import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { ExternalServiceConfiguration, Prices } from "@/server/ports";
import { AssetSourcePluginUnavailableError, AssetSourcePluginExecutionError, normalizeAssetSyncDiagnostic } from "@/server/asset-sync-diagnostics";
import type { AssetSourcePlugin, AssetSourcePluginContext } from "./protocol";
import type { InstalledPluginManifest } from "./manifest";

export interface PluginPackage { directory: string; manifest: InstalledPluginManifest; available(): boolean }
type Invocation = { resolve(value: unknown): void; reject(error: unknown): void; context: AssetSourcePluginContext; method: string; callbacks: number; cleanup(): void; event?: (event: unknown) => void };
function pluginEnvironment(pkg: PluginPackage): NodeJS.ProcessEnv {
  const names = ["LANG", "TZ", "NODE_USE_ENV_PROXY", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"];
  // CLI login and macOS Keychain are Longbridge-specific permissions, never inherited by other plugins.
  if (pkg.manifest.id === "longbridge") names.push("PATH", "HOME", "LONGBRIDGE_SERVE_BIN", "LONGBRIDGE_OAUTH_CLIENT_ID", "LONGBRIDGE_OAUTH_CALLBACK_PORT");
  return { NODE_ENV: "production", ...Object.fromEntries(names.flatMap(name => process.env[name] === undefined ? [] : [[name, process.env[name]]])) };
}

/** A session preserves native OAuth PKCE state and quote streams in the plugin process. */
export class PluginSession {
  private child: ChildProcessWithoutNullStreams | null = null;
  private initializing: Promise<unknown> | null = null;
  private sequence = 0;
  private readonly pending = new Map<number, Invocation>();
  private readonly cancelled = new Set<number>();
  private idle: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly pkg: PluginPackage, private readonly prices?: Prices, private readonly services?: ExternalServiceConfiguration,
    private readonly callback?: (method: string, input: unknown) => Promise<unknown>) {}

  close(error: unknown = new Error("来源插件进程已关闭")) {
    clearTimeout(this.idle);
    const child = this.child; this.child = null; this.initializing = null;
    for (const pending of this.pending.values()) { pending.cleanup(); pending.reject(error); }
    this.pending.clear(); this.cancelled.clear();
    if (!child) return;
    child.stdin.end();
    const kill = (signal: NodeJS.Signals) => {
      try { if (process.platform === "win32") child.kill(signal); else process.kill(-child.pid!, signal); } catch { /* already exited */ }
    };
    kill("SIGTERM");
    const timer = setTimeout(() => kill("SIGKILL"), 1000); timer.unref();
  }

  private start(context: AssetSourcePluginContext, timeoutMs: number): Promise<unknown> {
    if (this.initializing) return this.initializing;
    if (!this.pkg.available()) throw new AssetSourcePluginUnavailableError();
    const child = spawn(process.execPath, [path.join(this.pkg.directory, this.pkg.manifest.entry)], {
      cwd: this.pkg.directory, env: pluginEnvironment(this.pkg), detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stderr.resume();
    let buffer = "";
    child.once("error", () => { if (this.child === child) this.close(new AssetSourcePluginUnavailableError()); });
    child.once("exit", () => { if (this.child === child) this.close(new Error("来源插件进程提前退出")); });
    child.stdin.on("error", () => { if (this.child === child) this.close(new Error("来源插件通信中断")); });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (this.child !== child) return;
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 8 * 1024 * 1024) { this.close(new SyntaxError("来源插件响应过大")); return; }
      let end: number;
      while ((end = buffer.indexOf("\n")) !== -1 && this.child === child) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        try { this.receive(JSON.parse(line)); } catch { this.close(new SyntaxError("来源插件协议响应无效")); }
      }
    });
    this.initializing = this.request("initialize", { protocolVersion: 1 }, { signal: AbortSignal.any([context.signal, AbortSignal.timeout(timeoutMs)]), persistCredentials: async () => { throw new Error(); } }).then(value => {
      if (!isDeepStrictEqual(value, this.pkg.manifest)) { this.close(); throw new SyntaxError("插件握手清单不匹配"); }
      return value;
    });
    return this.initializing;
  }

  private send(value: unknown) { this.child?.stdin.write(JSON.stringify(value) + "\n"); }
  private receive(value: Record<string, unknown>) {
    if (!value || value.jsonrpc !== "2.0") throw new Error();
    if (typeof value.method === "string") {
      const operationId = typeof value.operationId === "number" ? value.operationId : [...this.pending.keys()][0];
      if (this.cancelled.has(operationId)) return;
      const p = this.pending.get(operationId);
      if (!p || p.method === "initialize") throw new Error();
      if (value.method === "event" && p.event) {
        if (!this.pkg.available()) { this.close(new AssetSourcePluginUnavailableError()); return; }
        p.event(value.params); return;
      }
      if (typeof value.id !== "string" || !/^host:\d+$/.test(value.id) || (!p.event && ++p.callbacks > 16)) throw new Error();
      const id = value.id, child = this.child;
      const reply = (message: unknown) => { if (this.child === child) this.send(message); };
      void this.host(value.method, value.params, p).then(result => reply({ jsonrpc: "2.0", id, result }), () => reply({ jsonrpc: "2.0", id, error: { code: -32000, message: "核心能力调用失败" } }));
      return;
    }
    if (typeof value.id !== "number" || Object.hasOwn(value, "result") === Object.hasOwn(value, "error")) throw new Error();
    if (this.cancelled.delete(value.id)) { this.releaseIdle(); return; }
    const p = this.pending.get(value.id); if (!p) throw new Error();
    this.pending.delete(value.id); p.cleanup();
    if (value.error) {
      const diagnostic = normalizeAssetSyncDiagnostic((value.error as { data?: unknown }).data);
      p.reject(diagnostic ? new AssetSourcePluginExecutionError(diagnostic) : new Error("插件读取或只读授权校验失败"));
    } else if (!this.pkg.available()) p.reject(new AssetSourcePluginUnavailableError());
    else p.resolve(value.result);
    this.releaseIdle();
  }

  private releaseIdle() {
    if (this.pending.size || !this.child) return;
    clearTimeout(this.idle);
    // OAuth state lasts ten minutes; an idle worker must not keep CLI jobs alive.
    this.child.unref();
    for (const stream of [this.child.stdin, this.child.stdout, this.child.stderr]) (stream as unknown as { unref?(): void }).unref?.();
    this.idle = setTimeout(() => this.close(), 11 * 60_000); this.idle.unref();
  }

  private async host(method: string, input: unknown, p: Invocation) {
    p.context.signal.throwIfAborted();
    if (!this.pkg.available()) throw new AssetSourcePluginUnavailableError();
    const request = input as Record<string, unknown>;
    if (method === "prices.quote" && this.prices && ["USDT", "BTC"].includes(String(request?.symbol))) return this.prices.quote(String(request.symbol));
    if (method === "credentials.persist" && p.method === "assets.read" && typeof request?.credentials === "string" && request.credentials.length < 128_000) {
      await p.context.persistCredentials(request.credentials); return null;
    }
    if (method === "configuration.read" && this.services && this.pkg.manifest.configuration?.includes(request?.key as never)) {
      if (request.key === "coingecko.apiKey") return this.services.coinGeckoDemoApiKey();
      if (request.key === "rpc.ethereum" || request.key === "rpc.bsc") return this.services.rpcUrl(request.key === "rpc.ethereum" ? "ethereum" : "bsc");
    }
    if (this.callback && this.pkg.manifest.id === "longbridge") return this.callback(method, input);
    throw new Error("不支持插件请求的核心能力");
  }

  private request(method: string, params: unknown, context: AssetSourcePluginContext, timeoutMs = 60_000, event?: (event: unknown) => void): Promise<unknown> {
    context.signal.throwIfAborted();
    clearTimeout(this.idle);
    this.child?.ref();
    if (this.child) for (const stream of [this.child.stdin, this.child.stdout, this.child.stderr]) (stream as unknown as { ref?(): void }).ref?.();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const abort = () => {
        if (!event) { this.close(context.signal.reason ?? new DOMException("已取消", "AbortError")); return; }
        this.send({ jsonrpc: "2.0", method: "cancel", params: { id } });
        this.pending.delete(id); this.cancelled.add(id); cleanup(); reject(context.signal.reason ?? new DOMException("已取消", "AbortError")); this.releaseIdle();
      };
      const timer = event ? setInterval(() => { if (!this.pkg.available()) this.close(new AssetSourcePluginUnavailableError()); }, 1000)
        : setTimeout(() => this.close(new DOMException("插件执行超时", "TimeoutError")), timeoutMs);
      const cleanup = () => { clearTimeout(timer); context.signal.removeEventListener("abort", abort); };
      this.pending.set(id, { resolve, reject, context, method, callbacks: 0, cleanup, event });
      context.signal.addEventListener("abort", abort, { once: true });
      this.send({ jsonrpc: "2.0", id, method, params });
      if (context.signal.aborted) abort();
    });
  }

  async invoke(method: string, params: unknown, context: AssetSourcePluginContext, timeoutMs = 60_000, event?: (event: unknown) => void): Promise<unknown> {
    context.signal.throwIfAborted();
    if (!this.pkg.available()) { this.close(); throw new AssetSourcePluginUnavailableError(); }
    const initialized = await this.start(context, timeoutMs);
    if (method === "initialize") return initialized;
    return this.request(method, params, context, timeoutMs, event);
  }
}

export async function invokePlugin(pkg: PluginPackage, method: string, params: unknown, context: AssetSourcePluginContext, prices?: Prices, timeoutMs = 60_000, services?: ExternalServiceConfiguration): Promise<unknown> {
  const worker = new PluginSession(pkg, prices, services);
  try { return await worker.invoke(method, params, context, timeoutMs); } finally { worker.close(); }
}
export function stdioAssetSourcePlugin(pkg: PluginPackage, prices: Prices, services?: ExternalServiceConfiguration): AssetSourcePlugin {
  return { manifest: pkg.manifest, available: pkg.available,
    read: async (request, context) => await invokePlugin(pkg, "assets.read", request, context, prices, 60_000, services) as Awaited<ReturnType<AssetSourcePlugin["read"]>>,
    authorize: async (input, observedAt, context) => await invokePlugin(pkg, "authorization.preview", { input, observedAt }, context, prices, 60_000, services) as Awaited<ReturnType<NonNullable<AssetSourcePlugin["authorize"]>>>,
    revalidate: async (authorization, observedAt, context) => await invokePlugin(pkg, "authorization.revalidate", { authorization, observedAt }, context, prices, 60_000, services) as Awaited<ReturnType<NonNullable<AssetSourcePlugin["revalidate"]>>>,
  };
}
