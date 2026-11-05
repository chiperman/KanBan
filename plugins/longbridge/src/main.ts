import { AsyncLocalStorage } from "node:async_hooks";
import manifest from "../manifest.json";
import { LongbridgeConnections } from "./longbridge-connections";
import { serveAssetSourcePlugin } from "../../sdk/stdio-server";
import type { AssetSourcePluginManifest } from "../../sdk/protocol";
import type { AssetSourceSummary } from "@/server/ports";
import type { LongbridgeAccountIdentity } from "./longbridge-keychain-sdk";
import type { LongbridgeTransportStatus } from "../../sdk/longbridge-connection";

serveAssetSourcePlugin((_prices, runtime) => {
  let accounts: Record<string, LongbridgeAccountIdentity> = {}, transports: Record<string, LongbridgeTransportStatus> = {};
  const operation = new AsyncLocalStorage<Promise<unknown>[]>();
  const effect = (method: string, input: unknown) => {
    const pending = operation.getStore();
    if (!pending) throw new Error("长桥操作上下文已结束");
    const result = runtime.host(method, input); pending.push(result); void result.catch(() => undefined);
  };
  const flush = async () => { const pending = operation.getStore()!; await Promise.all(pending.splice(0)); };
  const scoped = <A extends unknown[], R>(run: (...args: A) => Promise<R>) =>
    (...args: A): Promise<R> => operation.run([], () => run(...args));
  const store = {
    async listSources() {
      const state = await runtime.host("connection.state", {}) as { sources: AssetSourceSummary[]; accounts: typeof accounts; transports: typeof transports };
      accounts = state.accounts; transports = state.transports;
      return state.sources;
    },
    longbridgeAccount: (id: string) => accounts[id] ?? null,
    longbridgeTransport: (id: string) => transports[id] ?? null,
    pinLongbridgeAccount(id: string, account: LongbridgeAccountIdentity) {
      accounts[id] = account; effect("connection.pin", { id, account });
    },
    recordLongbridgeTransport(reference: string, status: LongbridgeTransportStatus) {
      effect("connection.transport", { reference, status });
    },
  };
  const connection = new LongbridgeConnections(store);
  const authorization = async (input: Record<string, unknown>, at: string) => {
    await store.listSources();
    const value = "code" in input
      ? await connection.finishConnection(input as unknown as Parameters<typeof connection.finishConnection>[0], at)
      : await connection.previewConnection(input.connectionMode as "cli" | "sdk" | "both", at, input.sourceId as string | undefined);
    await flush(); return { ...value, investmentBookId: "us-stocks" as const };
  };
  return {
    manifest: manifest as AssetSourcePluginManifest,
    read: scoped(async (request, context) => { await store.listSources(); const value = await connection.refresh({ ...request, ...context }); await flush(); return value; }),
    authorize: scoped(authorization),
    revalidate: scoped(async (previous, observedAt) => {
      await store.listSources(); const result = await connection.revalidate({ credentials: previous.credentials, observedAt });
      await flush(); return { ...result, investmentBookId: "us-stocks" };
    }),
    call: scoped(async (method, raw, context) => {
      const p = raw as { args: unknown[] };
      await store.listSources();
      let result: unknown;
      switch (method) {
        case "start":
          await connection.prepareSdkAuthorization(); await flush();
          result = await connection.start(p.args[0] as string); break;
        case "finish": result = await connection.finish(p.args[0] as Parameters<typeof connection.finish>[0]); break;
        case "status": result = await connection.status(p.args[0] as string | undefined); break;
        case "checkCli": result = await connection.checkCli(p.args[0] as string | undefined); break;
        case "sdkAuthorizationExpiry": result = await connection.sdkAuthorizationExpiry(); break;
        case "renewSdkAuthorization": result = await connection.renewSdkAuthorization(); break;
        case "loginCli": result = await connection.loginCli(p.args[0] as string); break;
        case "holdingCandlesticks": result = await connection.holdingCandlesticks.readCandlesticks(p.args[0] as never); break;
        case "holdingTrend": result = await connection.holdingCandlesticks.readFiveDayTrend(p.args[0] as never); break;
        case "benchmarkCandlesticks": result = await connection.benchmarkCandlesticks.readDailyCandlesticks(p.args[0] as never); break;
        case "settlementCandles": result = await connection.settlementCandles.readDailyCandles(p.args[0] as never); break;
        case "tradingCalendar": result = await connection.tradingCalendar.readTradingDays(p.args[0] as never); break;
        case "dailyAsset": result = await connection.readDailyAsset(p.args[0] as AssetSourceSummary, p.args[1] as LongbridgeAccountIdentity, p.args[2] as string, context.signal); break;
        case "subscribeQuotes": {
          const sub = connection.subscribeQuotes(p.args[0] as AssetSourceSummary, p.args[1] as string[],
            quote => context.notify({ type: "quote", value: quote }),
            status => { context.notify({ type: "status", value: status }); void flush().catch(() => undefined); });
          try { await new Promise<void>(resolve => {
            if (context.signal.aborted) resolve(); else context.signal.addEventListener("abort", () => resolve(), { once: true });
          }); } finally { sub.close(); }
          break;
        }
        default: throw new Error("不支持的长桥插件能力");
      }
      await flush(); return result ?? null;
    }),
  };
});
