import type {
  AssetRefreshMode,
  AssetRefreshReport,
  DailyAssetSnapshots,
  AssetSourceRefresher,
  AssetSources,
  AssetSynchronization,
  Clock,
  SecretStore,
} from "@/server/ports";
import { buildDailyAssetSnapshot } from "@/domain/daily-asset-snapshots";

/** 每个来源独立读取；失败只更新该来源的过期状态，不覆盖最后成功快照。 */
export class SourceIsolatedAssetSynchronization
  implements AssetSynchronization
{
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly sources: AssetSources,
    private readonly secrets: SecretStore,
    private readonly clock: Clock,
    private readonly refresher: AssetSourceRefresher,
    private readonly sourceTimeoutMs = 15_000,
    private readonly dailySnapshots: DailyAssetSnapshots,
  ) {}

  refresh(mode: AssetRefreshMode): Promise<AssetRefreshReport> {
    const run = this.queue.then(() => this.execute(mode));
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async execute(mode: AssetRefreshMode): Promise<AssetRefreshReport> {
    const sources = (await this.sources.list()).filter(
      (source) =>
        source.lifecycle !== "disconnected" &&
        source.credentialReference !== null,
    );
    const attemptedAt = this.clock.now().toISOString();
    const outcomes = await Promise.all(
      sources.map(async (source) => {
        const controller = new AbortController();
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          const credentialReference = source.credentialReference;
          if (credentialReference === null) throw new Error("只读凭证不可用");
          const credentials = await this.secrets.get(credentialReference);
          if (credentials === null) throw new Error("只读凭证不可用");
          const result = await Promise.race([
            this.refresher.refresh({
              source,
              credentials,
              mode,
              attemptedAt,
              signal: controller.signal,
              persistCredentials: (value) =>
                this.secrets.replace(credentialReference, value),
            }),
            new Promise<never>((_, reject) => {
              timeout = setTimeout(() => {
                controller.abort();
                reject(new Error(`同步超时（${this.sourceTimeoutMs}ms）`));
              }, this.sourceTimeoutMs);
            }),
          ]);
          const preservesBalanceFailure =
            mode === "prices" &&
            source.sync.status === "expired" &&
            source.sync.failedMode !== "prices";
          const updated = {
            ...source,
            snapshot: result.snapshot,
            sync: preservesBalanceFailure
              ? {
                  ...source.sync,
                  lastAttemptAt: attemptedAt,
                }
              : {
                  status: "current" as const,
                  lastSuccessfulAt: result.snapshot.syncedAt,
                  lastAttemptAt: attemptedAt,
                  error: null,
                  failedMode: null,
                },
          };
          await this.sources.update(updated);
          return true;
        } catch (error) {
          const preservesBalanceFailure =
            mode === "prices" &&
            source.sync.status === "expired" &&
            source.sync.failedMode !== "prices";
          const updated = {
            ...source,
            snapshot: source.snapshot.coverage === undefined
              ? source.snapshot
              : {
                  ...source.snapshot,
                  coverage: {
                    ...source.snapshot.coverage,
                    products: source.snapshot.coverage.products.map((product) => ({
                      ...product,
                      freshness: "expired" as const,
                    })),
                  },
                },
            sync: preservesBalanceFailure
              ? {
                  ...source.sync,
                  lastAttemptAt: attemptedAt,
                }
              : {
                  ...source.sync,
                  status: "expired" as const,
                  lastAttemptAt: attemptedAt,
                  error:
                    error instanceof Error ? error.message : "资产来源同步失败",
                  failedMode: mode,
                },
          };
          await this.sources.update(updated);
          return false;
        } finally {
          if (timeout !== undefined) clearTimeout(timeout);
          controller.abort();
        }
      }),
    );
    const successCount = outcomes.filter(Boolean).length;
    if (successCount > 0) {
      const connectedSources = (await this.sources.list()).filter(
        (source) => source.lifecycle !== "disconnected",
      );
      await this.dailySnapshots.createIfAbsent(
        buildDailyAssetSnapshot(connectedSources, attemptedAt),
      );
    }
    return {
      successCount,
      failureCount: outcomes.length - successCount,
    };
  }
}
