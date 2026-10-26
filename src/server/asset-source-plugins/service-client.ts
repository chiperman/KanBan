import type { ExternalServiceConfiguration, Prices, PriceQuote } from "@/server/ports";
import type { ExternalServiceVerifier } from "@/server/credentials/external-service-store";
import { AssetSourcePluginUnavailableError } from "@/server/asset-sync-diagnostics";
import { invokePlugin, type PluginPackage } from "./stdio-host";
type Packages = PluginPackage[] | (() => PluginPackage[]);
const current = (p: Packages) => typeof p === "function" ? p() : p;
const context = () => ({ signal: AbortSignal.timeout(60_000), persistCredentials: async () => { throw new Error("服务插件不能保存来源凭证"); } });
export function pluginReferencePrices(packages: Packages, services: ExternalServiceConfiguration): Prices {
 return { async quote(symbol) {
   const pkg = current(packages).find(p => p.manifest.id === "plugin:coingecko");
   if (!["USDT", "BTC"].includes(symbol.toUpperCase()) || !pkg?.available()) return null;
   // Requests for different symbols remain independent; the plugin owns vendor batching.
   return invokePlugin(pkg, "extension.call", { method: "quote", input: { symbol } }, context(), undefined, 60_000, services).then(raw => {
     if (raw === null) return null;
     const q = raw as PriceQuote;
     const date = new Date(q.quotedAt);
     if (q.symbol !== symbol.toUpperCase() || q.currency !== "USD" || !/^\d+(\.\d+)?$/.test(q.price) || Number(q.price) <= 0 || !Number.isFinite(date.getTime())) throw new SyntaxError("参考行情插件返回无效报价");
     return { symbol: q.symbol, currency: q.currency, price: q.price, quotedAt: date };
   });
 } };
}
export function pluginConfigurationVerifier(packages: Packages): ExternalServiceVerifier {
 return async input => {
   for (const [id, params] of [
     ["plugin:coingecko", { key: input.coinGeckoDemoApiKey }],
     ["evm-watch-ethereum", { url: input.ethereumRpcUrl }],
     ["evm-watch-bsc", { url: input.bscRpcUrl }],
   ] as const) {
     const pkg = current(packages).find(p => p.manifest.id === id);
     if (!pkg?.available()) throw new AssetSourcePluginUnavailableError();
     await invokePlugin(pkg, "extension.call", { method: "verify", input: params }, context());
   }
 };
}
