import type { LongbridgeConnections } from "@/server/asset-sources/longbridge-connections";
import type { AssetSourceSummary, AssetSourceRefresher, LongbridgeOAuth } from "@/server/ports";
import type { LongbridgeAccountIdentity } from "@/server/asset-sources/longbridge-keychain-sdk";
import type { LongbridgeTransportStatus } from "@/server/asset-sources/longbridge-connection";
import type { AssetSourcePlugin, AssetSourcePluginAuthorization } from "./protocol";
import { PluginSession, type PluginPackage } from "./stdio-host";
import { AssetSourcePluginUnavailableError } from "@/server/asset-sync-diagnostics";

interface ConnectionStore {
 listSources(): Promise<AssetSourceSummary[]>;
 longbridgeAccount(id: string): LongbridgeAccountIdentity | null;
 longbridgeTransport(id: string): LongbridgeTransportStatus | null;
 pinLongbridgeAccount(id: string, account: LongbridgeAccountIdentity): void;
 recordLongbridgeTransport(reference: string, status: LongbridgeTransportStatus): void;
}
const context = (signal = AbortSignal.timeout(60_000)) => ({ signal, persistCredentials: async () => { throw new Error("插件不能改写外部授权引用"); } });
/** Only transport and explicitly allowed binding effects live in core; supplier code lives in the package. */
export function longbridgePluginClient(packageInput: PluginPackage | undefined | (() => PluginPackage | undefined), store: ConnectionStore) {
 let worker: PluginSession | undefined, active: PluginPackage | undefined;
 const current = () => {
   const pkg = typeof packageInput === "function" ? packageInput() : packageInput;
   if (pkg !== active || !pkg?.available()) { worker?.close(); worker = undefined; active = pkg; }
   return pkg;
 };
 const createWorker = (pkg: PluginPackage) => new PluginSession(pkg, undefined, undefined, async (method, raw) => {
   const sources = (await store.listSources()).filter(s => s.kind === "longbridge");
   if (method === "connection.state") return { sources,
     accounts: Object.fromEntries(sources.flatMap(s => { const a = store.longbridgeAccount(s.id); return a ? [[s.id, a]] : []; })),
     transports: Object.fromEntries(sources.flatMap(s => { const t = store.longbridgeTransport(s.id); return t ? [[s.id, t]] : []; })),
   };
   const p = raw as { id?: string; account?: LongbridgeAccountIdentity; reference?: string; status?: LongbridgeTransportStatus };
   if (method === "connection.pin" && sources.some(s => s.id === p.id) && p.account && /^\d+$/.test(p.account.memberId) && /^[\w-]+$/.test(p.account.accountChannel)) {
     const prior = store.longbridgeAccount(p.id!);
     if (prior && (prior.memberId !== p.account.memberId || prior.accountChannel !== p.account.accountChannel)) throw new Error("账户绑定已改变");
     store.pinLongbridgeAccount(p.id!, p.account); return null;
   }
   if (method === "connection.transport" && typeof p.reference === "string" && p.status && ["cli", "sdk"].includes(p.status.transport) && typeof p.status.fallback === "boolean" && Number.isFinite(Date.parse(p.status.at))) {
     // During preview a reference need not exist yet. The store only updates matching sources.
     store.recordLongbridgeTransport(p.reference, p.status); return null;
   }
   throw new Error("不支持插件请求的账户能力");
 });
 const invoke = async (method: string, params: unknown, signal?: AbortSignal, event?: (event: unknown) => void) => {
   const pkg = current();
   if (!pkg?.available()) throw new AssetSourcePluginUnavailableError();
   worker ??= createWorker(pkg);
   return worker.invoke(method, params, context(signal), 60_000, event);
 };
 const call = async <T>(method: string, args: unknown[], signal?: AbortSignal): Promise<T> => await invoke("extension.call", { method, input: { args } }, signal) as T;
 const plugin = (): AssetSourcePlugin | undefined => {
   const pkg = current();
   if (!pkg) return undefined;
   const invokeBound = (...args: Parameters<typeof invoke>) => {
     if (!pkg.available()) throw new AssetSourcePluginUnavailableError();
     return invoke(...args);
   };
   return {
   manifest: pkg.manifest, available: pkg.available,
   read: async (request, ctx) => await invokeBound("assets.read", request, ctx.signal) as Awaited<ReturnType<AssetSourceRefresher["refresh"]>>,
   authorize: async (input, observedAt, ctx) => await invokeBound("authorization.preview", { input, observedAt }, ctx.signal) as AssetSourcePluginAuthorization,
   revalidate: async (authorization, observedAt, ctx) => await invokeBound("authorization.revalidate", { authorization, observedAt }, ctx.signal) as AssetSourcePluginAuthorization,
 };
 };
 const client: Pick<LongbridgeConnections, "status" | "checkCli" | "sdkAuthorizationExpiry" | "renewSdkAuthorization" | "loginCli" | "subscribeQuotes" | "readDailyAsset" | "holdingCandlesticks" | "benchmarkCandlesticks" | "settlementCandles" | "tradingCalendar" | "finishConnection" | "previewConnection"> & LongbridgeOAuth = {
   start: redirectUri => call("start", [redirectUri]),
   finish: input => call("finish", [input]),
   revalidate: async input => await invoke("authorization.revalidate", { authorization: { credentials: input.credentials }, observedAt: input.observedAt }) as Awaited<ReturnType<LongbridgeOAuth["revalidate"]>>,
   previewConnection: async (connectionMode, observedAt, sourceId) => await invoke("authorization.preview", { input: { connectionMode, sourceId }, observedAt }) as Awaited<ReturnType<LongbridgeConnections["previewConnection"]>>,
   finishConnection: async (input, observedAt) => await invoke("authorization.preview", { input, observedAt }) as Awaited<ReturnType<LongbridgeConnections["finishConnection"]>>,
   status: sourceId => call("status", [sourceId]), loginCli: code => call("loginCli", [code]),
   checkCli: sourceId => call("checkCli", [sourceId]),
   sdkAuthorizationExpiry: () => call("sdkAuthorizationExpiry", []),
   renewSdkAuthorization: () => call("renewSdkAuthorization", []),
   readDailyAsset: (source, account, day, signal) => call("dailyAsset", [source, account, day], signal),
   holdingCandlesticks: { readCandlesticks: input => call("holdingCandlesticks", [input]), readFiveDayTrend: input => call("holdingTrend", [input]) },
   benchmarkCandlesticks: { readDailyCandlesticks: input => call("benchmarkCandlesticks", [input]) },
   settlementCandles: { readDailyCandles: input => call("settlementCandles", [input]) },
   tradingCalendar: { readTradingDays: input => call("tradingCalendar", [input]) },
   subscribeQuotes(source, symbols, listener, status) {
     const controller = new AbortController();
     void invoke("extension.call", { method: "subscribeQuotes", input: { args: [source, symbols] } }, controller.signal, event => {
       const e = event as { type: string; value: unknown };
       if (e.type === "quote") listener(e.value as Parameters<typeof listener>[0]);
       if (e.type === "status") status(e.value as Parameters<typeof status>[0]);
     }).catch(() => { if (!controller.signal.aborted) status({ state: "error", code: "unavailable" }); });
     return { close: () => controller.abort() };
   },
 };
 return { client, get plugin() { return plugin(); }, close: () => worker?.close() };
}
