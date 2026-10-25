import type {
  AssetPermission,
  AssetSourceSummary,
  LongbridgeBenchmarkCandlestick,
  LongbridgeBenchmarkCandlestickReader,
  LongbridgeBenchmarkSymbol,
  LongbridgeHoldingCandlestick,
  LongbridgeHoldingCandlestickPeriod,
  LongbridgeHoldingCandlestickReader,
  LongbridgeHoldingTrendPoint,
  LongbridgeOAuth,
} from "@/server/ports";
import { mapLongbridgeSnapshot } from "@/server/asset-sources/longbridge";

export interface FakeLongbridgeConfig {
  credentials: { accessToken: string; refreshToken: string };
  permissions: AssetPermission[];
  account: { id: string; label: string };
  accountPages: unknown[];
  positionPages: unknown[];
  quotes?: Array<{
    symbol: string;
    lastDone: string;
    prevClose: string;
    timestamp: number;
  }>;
  previewError?: string;
  commitError?: string;
}

export class FakeLongbridgeOAuth implements LongbridgeOAuth {
  private config: FakeLongbridgeConfig | null = null;
  fetchedPositionPages = 0;

  configure(config: FakeLongbridgeConfig): void {
    this.config = config;
    this.fetchedPositionPages = 0;
  }

  async start(redirectUri: string) {
    if (!this.config) throw new Error("长桥测试替身尚未配置");
    const state = "fake-longbridge-state";
    const url = new URL("/test-doubles/longbridge/authorize", redirectUri);
    url.searchParams.set("state", state);
    return {
      authorizationUrl: url.toString(),
      state,
      codeVerifier: "fake-code-verifier",
    };
  }

  async finish() {
    const config = this.config;
    if (!config) throw new Error("长桥测试替身尚未配置");
    if (config.previewError) throw new Error(config.previewError);
    const positionPages = config.positionPages;
    this.fetchedPositionPages = positionPages.length;
    return {
      credentials: JSON.stringify(config.credentials),
      permissions: config.permissions,
      account: config.account,
      snapshot: mapLongbridgeSnapshot({
        accountPages: config.accountPages,
        positionPages,
        quotes: config.quotes,
        syncedAt: "2026-01-01T00:00:00.000Z",
      }),
    };
  }

  async revalidate() {
    return this.finish();
  }
}

export class FakeLongbridgeHoldingCandlestickReader
  implements LongbridgeHoldingCandlestickReader
{
  readonly reads: Array<{
    sourceId: string;
    symbol: string;
    period: LongbridgeHoldingCandlestickPeriod;
  }> = [];
  readonly trendReads: Array<{ sourceId: string; symbol: string }> = [];

  async readCandlesticks(input: {
    source: AssetSourceSummary;
    symbol: string;
    period: LongbridgeHoldingCandlestickPeriod;
  }): Promise<LongbridgeHoldingCandlestick[]> {
    this.reads.push({
      sourceId: input.source.id,
      symbol: input.symbol,
      period: input.period,
    });
    const count = 12;
    const minuteStep = input.period === "min-1" ? 60_000 : 86_400_000;
    const start = Date.parse("2026-08-10T13:30:00.000Z");
    return Array.from({ length: count }, (_, index) => {
      const open = 200 + index * 1.25;
      const close = open + (index % 2 === 0 ? 0.75 : -0.5);
      return {
        time: new Date(start + index * minuteStep).toISOString(),
        open: open.toFixed(2),
        high: (Math.max(open, close) + 0.8).toFixed(2),
        low: (Math.min(open, close) - 0.7).toFixed(2),
        close: close.toFixed(2),
        volume: String(1_000_000 + index * 45_000),
        turnover: String(200_000_000 + index * 9_000_000),
      };
    });
  }

  async readFiveDayTrend(input: {
    source: AssetSourceSummary;
    symbol: string;
  }): Promise<LongbridgeHoldingTrendPoint[]> {
    this.trendReads.push({ sourceId: input.source.id, symbol: input.symbol });
    const dates = [
      "2026-08-21",
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
    ];
    return dates.flatMap((date, dayIndex) =>
      Array.from({ length: 78 }, (_, minuteIndex) => {
        const price = 200 + dayIndex * 1.5 + minuteIndex * 0.08;
        return {
          time: new Date(
            Date.parse(`${date}T13:30:00.000Z`) + minuteIndex * 300_000,
          ).toISOString(),
          price: price.toFixed(2),
        };
      }),
    );
  }
}

export class FakeLongbridgeBenchmarkCandlestickReader
  implements LongbridgeBenchmarkCandlestickReader
{
  readonly reads: Array<{ count: number; symbol: LongbridgeBenchmarkSymbol }> = [];

  async readDailyCandlesticks(input: {
    count: number;
    symbol: LongbridgeBenchmarkSymbol;
  }): Promise<LongbridgeBenchmarkCandlestick[]> {
    this.reads.push(input);
    const start = Date.parse("2026-03-01T20:00:00.000Z");
    const base = input.symbol === ".SPX.US" ? 5_800 : 20_000;
    const step = input.symbol === ".SPX.US" ? 2.75 : 11.5;
    return Array.from({ length: 180 }, (_, index) => ({
      close: (base + index * step).toFixed(2),
      time: new Date(start + index * 86_400_000).toISOString(),
    })).slice(-input.count);
  }
}
