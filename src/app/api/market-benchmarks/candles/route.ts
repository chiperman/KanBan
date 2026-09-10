import { getServices } from "@/server/composition";
import type { LongbridgeBenchmarkSymbol } from "@/server/ports";

export const dynamic = "force-dynamic";

const SYMBOLS: LongbridgeBenchmarkSymbol[] = [".SPX.US", ".NDX.US"];
const CANDLE_COUNT = 1_000;

export async function GET() {
  const services = getServices();
  if ((await services.auth.currentSession()) === null) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }
  const connectedLongbridge = (await services.assetSources.list()).some((source) =>
    source.kind === "longbridge" &&
    source.lifecycle !== "disconnected" &&
    source.credentialReference !== null
  );
  if (!connectedLongbridge) {
    return Response.json({ error: "未连接可用的长桥证券来源" }, { status: 409 });
  }

  try {
    const entries = await Promise.all(SYMBOLS.map(async (symbol) => [
      symbol,
      await services.longbridgeBenchmarkCandlesticks.readDailyCandlesticks({
        count: CANDLE_COUNT,
        symbol,
      }),
    ] as const));
    return Response.json(
      { candles: Object.fromEntries(entries) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "长桥指数日 K 读取失败" },
      { status: 500 },
    );
  }
}
