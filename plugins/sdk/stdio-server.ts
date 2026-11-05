import { AsyncLocalStorage } from "node:async_hooks";
import { assetSyncErrorMessage, diagnoseAssetSyncError, withManagedAssetRetry } from "./asset-sync-diagnostics";
import type { ExternalServiceConfigurationReader, Prices, PriceQuote } from "./host-capabilities";
import type { AssetSourcePlugin, AssetSourcePluginContext } from "./protocol";

export interface PluginRuntime { host(method: string, input: unknown): Promise<unknown> }
/** Only declared configuration is exposed by the host; storage remains in core. */
export function pluginExternalServices(runtime: PluginRuntime): ExternalServiceConfigurationReader {
  return {
    coinGeckoDemoApiKey: async () => await runtime.host("configuration.read", { key: "coingecko.apiKey" }) as string | null,
    rpcUrl: async chain => await runtime.host("configuration.read", { key: `rpc.${chain}` }) as string | null,
  };
}

/** JSON-RPC only on stdout. Request context keeps concurrent streams and OAuth isolated. */
export function serveAssetSourcePlugin(create: (prices: Prices, runtime: PluginRuntime) => AssetSourcePlugin): void {
  let sequence = 0, initialized = false, buffer = "";
  const scope = new AsyncLocalStorage<{ id: number; controller: AbortController }>();
  const active = new Map<number, AbortController>();
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: unknown): void }>();
  function send(value: unknown) { process.stdout.write(JSON.stringify(value) + "\n"); }
  const runtime: PluginRuntime = { host(method, input) {
    const operation = scope.getStore();
    if (!operation || operation.controller.signal.aborted) return Promise.reject(new Error("插件请求已结束"));
    const id = `host:${++sequence}`;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      send({ jsonrpc: "2.0", id, method, params: input, operationId: operation.id });
    });
  } };
  const plugin = create({ quote: async symbol => {
    const quote = await runtime.host("prices.quote", { symbol }) as (Omit<PriceQuote, "quotedAt"> & { quotedAt: string }) | null;
    return quote === null ? null : { ...quote, quotedAt: new Date(quote.quotedAt) };
  } }, runtime);
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > 8 * 1024 * 1024) process.exit(1);
    let end: number;
    while ((end = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      let value;
      try { value = JSON.parse(line); if (!value || value.jsonrpc !== "2.0") throw new Error(); }
      catch { process.exit(1); }
      if (typeof value.id === "string" && pending.has(value.id)) {
        const callback = pending.get(value.id)!; pending.delete(value.id);
        if (value.error) callback.reject(new Error("核心能力调用失败")); else callback.resolve(value.result);
        continue;
      }
      if (value.method === "cancel" && !Object.hasOwn(value, "id")) { active.get(value.params?.id)?.abort(); continue; }
      if (!Number.isSafeInteger(value.id) || active.has(value.id) || active.size >= 32) process.exit(1);
      const request = value, controller = new AbortController();
      active.set(request.id, controller);
      void scope.run({ id: request.id, controller }, () => withManagedAssetRetry(async () => {
        const p = request.params;
        if (request.method === "initialize" && !initialized && p?.protocolVersion === 1) { initialized = true; return plugin.manifest; }
        if (!initialized) throw new Error();
        const context: AssetSourcePluginContext & { notify(event: unknown): void } = {
          signal: controller.signal,
          persistCredentials: async credentials => { await runtime.host("credentials.persist", { credentials }); },
          notify: event => { if (!controller.signal.aborted) send({ jsonrpc: "2.0", method: "event", params: event, operationId: request.id }); },
        };
        if (request.method === "assets.read") return plugin.read(p, context);
        if (request.method === "authorization.preview" && plugin.authorize) return plugin.authorize(p.input, p.observedAt, context);
        if (request.method === "authorization.revalidate" && plugin.revalidate) return plugin.revalidate(p.authorization, p.observedAt, context);
        if (request.method === "extension.call" && plugin.call) return plugin.call(p.method, p.input, context);
        throw new Error("不支持的插件方法");
      })).then(result => send({ jsonrpc: "2.0", id: request.id, result }), error => {
        const diagnostic = diagnoseAssetSyncError(error, "refresh", 0);
        send({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: assetSyncErrorMessage(diagnostic), data: diagnostic } });
      }).finally(() => { active.delete(request.id); });
    }
  });
  process.stdin.on("end", () => process.exit(0));
}
