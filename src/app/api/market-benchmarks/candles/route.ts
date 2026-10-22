import { getServices } from "@/server/composition";
import { shanghaiDay } from "@/domain/daily-asset-snapshots";
import type { LongbridgeBenchmarkCandlestick, LongbridgeBenchmarkSymbol } from "@/server/ports";

export const dynamic = "force-dynamic";

const SYMBOLS: LongbridgeBenchmarkSymbol[] = [".SPX.US", ".NDX.US"];
const CANDLE_COUNT = 1_000;
const dailyCandles = new WeakMap<ReturnType<typeof getServices>, {
  key: string;
  request: Promise<Record<string, LongbridgeBenchmarkCandlestick[]>>;
}>();

export async function GET() {
  const services = getServices();
  if ((await services.auth.currentSession()) === null) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }
  const connectedLongbridge = (await services.assetSources.list()).filter((source) =>
    source.kind === "longbridge" &&
    source.lifecycle !== "disconnected" &&
    source.credentialReference !== null
  );
  if (connectedLongbridge.length === 0) {
    dailyCandles.delete(services);
    return Response.json({ error: "未连接可用的长桥证券来源" }, { status: 409 });
  }

  try {
    const key = JSON.stringify([
      shanghaiDay(services.clock.now()),
      connectedLongbridge.toSorted((left, right) => left.id.localeCompare(right.id))
        .map(source => [source.id, source.accountId, source.credentialReference]),
    ]);
    let cached = dailyCandles.get(services);
    if (cached?.key !== key) {
      // 比较只使用上海当日零点前的已收盘日 K；同日共享读取，仍逐次校验会话和来源。
      const request = (async () => {
        const candles: Record<string, LongbridgeBenchmarkCandlestick[]> = {};
        // CLI 并发身份检查可能返回不完整账户信息；两个指数依次读取，保留前后身份校验。
        for (const symbol of SYMBOLS) {
          candles[symbol] = await services.longbridgeBenchmarkCandlesticks.readDailyCandlesticks({
            count: CANDLE_COUNT,
            symbol,
          });
        }
        return candles;
      })();
      cached = { key, request };
      dailyCandles.set(services, cached);
      const entry = cached;
      void request.then((candles) => {
        if (SYMBOLS.some(symbol => candles[symbol].length === 0) &&
            dailyCandles.get(services) === entry) dailyCandles.delete(services);
      }, () => {
        if (dailyCandles.get(services) === entry) dailyCandles.delete(services);
      });
    }
    return Response.json(
      { candles: await cached.request },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "长桥指数日 K 读取失败" },
      { status: 500 },
    );
  }
}
