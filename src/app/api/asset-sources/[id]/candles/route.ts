import { supportsLongbridgeCandlesticks } from "@/domain/longbridge-symbols";
import { getServices } from "@/server/composition";
import type { LongbridgeHoldingCandlePeriod } from "@/server/ports";

export const dynamic = "force-dynamic";

const CANDLE_PERIODS = new Set<LongbridgeHoldingCandlePeriod>([
  "five-day",
  "day",
  "week",
  "month",
  "year",
  "min-1",
]);

function candlePeriod(value: string | null): LongbridgeHoldingCandlePeriod | null {
  return value !== null && CANDLE_PERIODS.has(value as LongbridgeHoldingCandlePeriod)
    ? value as LongbridgeHoldingCandlePeriod
    : null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const services = getServices();
  if ((await services.auth.currentSession()) === null) {
    return Response.json({ error: "需要所有者身份" }, { status: 401 });
  }
  const { id } = await params;
  const source = (await services.assetSources.list()).find((item) => item.id === id);
  if (!source) return Response.json({ error: "资产来源不存在" }, { status: 404 });
  if (source.kind !== "longbridge") {
    return Response.json({ error: "只有长桥证券来源支持查看 K 线" }, { status: 400 });
  }
  if (source.credentialReference === null || source.lifecycle === "disconnected") {
    return Response.json({ error: "长桥来源已断开，无法读取 K 线" }, { status: 409 });
  }

  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol");
  const period = candlePeriod(url.searchParams.get("period"));
  if (symbol === null || !supportsLongbridgeCandlesticks(symbol)) {
    return Response.json({ error: "该标的不支持查看 K 线" }, { status: 400 });
  }
  if (period === null) {
    return Response.json({ error: "K 线周期无效" }, { status: 400 });
  }
  const holding = source.snapshot.holdings.find(
    (item) => item.symbol === symbol && item.assetClass === "securities",
  );
  if (!holding) {
    return Response.json({ error: "该标的不在当前长桥持仓中" }, { status: 404 });
  }

  try {
    if (period === "five-day") {
      const trend = await services.longbridgeHoldingCandlesticks.readFiveDayTrend({
        source,
        symbol,
      });
      return Response.json(
        { symbol, period, trend },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const candles = await services.longbridgeHoldingCandlesticks.readCandlesticks({
      source,
      symbol,
      period,
    });
    return Response.json(
      { symbol, period, candles },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "长桥 K 线读取失败" },
      { status: 500 },
    );
  }
}
