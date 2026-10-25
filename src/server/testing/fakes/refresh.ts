import type {
  AssetRefreshReport,
  AssetSourceRefresher,
  AssetSynchronization,
} from "@/server/ports";

export type FakeRefreshScenario =
  | "passthrough"
  | "schedule"
  | "partial-failure"
  | "timeout-isolation"
  | "all-failure"
  | "longbridge-refresh-failure"
  | "binance-refresh-failure"
  | "okx-refresh-failure"
  | "bitget-refresh-failure"
  | "bit-refresh-failure"
  | "evm-ethereum-refresh-failure"
  | "evm-ethereum-price-refresh-failure"
  | "evm-unknown-valued"
  | "release-partial-failure";

export class FakeAssetSourceRefresher implements AssetSourceRefresher {
  private scenario: FakeRefreshScenario = "passthrough";
  private recovered = false;
  private readonly sourceCalls = new Map<string, number>();

  configure(scenario: FakeRefreshScenario): void {
    this.scenario = scenario;
    this.recovered = false;
    this.sourceCalls.clear();
  }

  recover(): void {
    this.recovered = true;
  }

  async refresh({
    source,
    mode,
    attemptedAt,
    signal,
  }: Parameters<AssetSourceRefresher["refresh"]>[0]) {
    const count = (this.sourceCalls.get(source.id) ?? 0) + 1;
    this.sourceCalls.set(source.id, count);
    if (this.scenario === "passthrough") {
      return { snapshot: source.snapshot };
    }
    if (this.scenario === "all-failure") {
      throw new Error("全部来源暂时不可用");
    }
    if (this.scenario === "release-partial-failure") {
      if (source.kind === "longbridge" || source.kind === "evm-watch-ethereum") {
        throw new Error(`${source.label} 发布验收模拟失败`);
      }
      return {
        snapshot: { ...source.snapshot, syncedAt: attemptedAt },
      };
    }
    if (
      this.scenario === "longbridge-refresh-failure" &&
      source.kind === "longbridge"
    ) {
      throw new Error("长桥同步失败");
    }
    if (
      this.scenario === "binance-refresh-failure" &&
      source.kind === "binance"
    ) {
      throw new Error("Binance 同步失败");
    }
    if (
      this.scenario === "okx-refresh-failure" &&
      source.kind === "okx"
    ) {
      throw new Error("OKX 同步失败");
    }
    if (
      this.scenario === "bitget-refresh-failure" &&
      source.kind === "bitget"
    ) {
      throw new Error("Bitget 同步失败");
    }
    if (
      this.scenario === "bit-refresh-failure" &&
      source.kind === "bit"
    ) {
      throw new Error("BIT 同步失败");
    }
    if (
      this.scenario === "evm-ethereum-refresh-failure" &&
      source.kind === "evm-watch-ethereum" &&
      mode !== "prices"
    ) {
      throw new Error("Ethereum 同步失败");
    }
    if (
      this.scenario === "evm-ethereum-price-refresh-failure" &&
      source.kind === "evm-watch-ethereum" &&
      mode === "prices"
    ) {
      throw new Error("Ethereum 定价失败");
    }
    if (
      this.scenario === "evm-unknown-valued" &&
      source.kind === "evm-watch-ethereum"
    ) {
      const holdings = source.snapshot.holdings.map((holding) =>
        holding.sourceAsset ===
            "evm:1:0xcccccccccccccccccccccccccccccccccccccccc"
          ? {
              ...holding,
              currentPrice: { amount: "1", currency: "USD" },
              marketValue: holding.quantity,
              sourceMarketValue: {
                amount: holding.quantity,
                currency: "USD",
              },
              valuation: {
                status: "valued" as const,
                priceSource: "CoinGecko Ethereum token/USD 参考价格",
                pricedAt: attemptedAt,
              },
            }
          : holding
      );
      return {
        snapshot: {
          ...source.snapshot,
          total: {
            amount: decimalAdd(source.snapshot.total.amount, "7"),
            currency: "USD",
          },
          holdings,
          syncedAt: attemptedAt,
        },
      };
    }
    if (source.id === "source-unvalued") {
      return {
        snapshot: { ...source.snapshot, syncedAt: attemptedAt },
      };
    }
    if (
      this.scenario === "timeout-isolation" &&
      source.id === "source-beta"
    ) {
      await new Promise<never>((_, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new Error("来源请求已取消")),
          { once: true },
        );
      });
    }
    if (
      this.scenario === "partial-failure" &&
      source.id === "source-beta" &&
      !this.recovered
    ) {
      throw new Error("来源暂时不可用");
    }
    const amount = this.scenario === "schedule"
      ? String((source.id === "source-alpha" ? 100 : 200) + count)
      : this.scenario === "timeout-isolation"
        ? "110"
      : source.id === "source-alpha"
        ? this.recovered ? "120" : "110"
        : "210";
    const holdings = source.snapshot.holdings.map((holding, index) =>
      index === 0
        ? {
            ...holding,
            currentPrice: { amount, currency: "USD" },
            marketValue: amount,
            sourceMarketValue: { amount, currency: "USD" },
            valuation: {
              status: "valued" as const,
              priceSource: `${source.label} 确定性行情`,
              pricedAt: attemptedAt,
            },
          }
        : holding,
    );
    return {
      snapshot: {
        ...source.snapshot,
        total: { amount, currency: "USD" },
        holdings,
        syncedAt: attemptedAt,
      },
    };
  }

  calls(): number {
    return [...this.sourceCalls.values()].reduce((total, count) => total + count, 0);
  }
}
import { decimalAdd } from "@/domain/decimal";
import { SourceIsolatedAssetSynchronization } from "@/server/refresh/asset-synchronization";

export class FakeAssetSynchronization implements AssetSynchronization {
  readonly sourceIds: Array<string | null> = [];
  active = 0;
  private holdNext = false;
  private releasePending: (() => void) | null = null;

  constructor(
    private readonly delegate: SourceIsolatedAssetSynchronization,
    readonly refresher: FakeAssetSourceRefresher,
  ) {}

  reset(scenario: FakeRefreshScenario): void {
    this.sourceIds.length = 0;
    this.active = 0;
    this.holdNext = false;
    this.releasePending = null;
    this.refresher.configure(scenario);
  }

  prepareRecovery(hold: boolean): void {
    this.refresher.recover();
    this.holdNext = hold;
  }

  release(): void {
    this.releasePending?.();
    this.releasePending = null;
  }

  async request(
    input: import("@/server/ports").AssetRefreshRequest,
  ): Promise<AssetRefreshReport> {
    const { intent } = input;
    const sourceIds = input.sourceIds ?? (
      intent.reason === "manual-source" ? [intent.sourceId] : undefined
    );
    this.sourceIds.push(sourceIds?.[0] ?? null);
    this.active += 1;
    try {
      if (this.holdNext) {
        this.holdNext = false;
        await new Promise<void>((resolve) => {
          this.releasePending = resolve;
        });
      }
      return await this.delegate.request(input);
    } finally {
      this.active -= 1;
    }
  }

}
