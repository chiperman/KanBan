import type {
  AssetFullRefreshState,
  AssetRefreshMode,
  AssetRefreshReport,
  AssetRefreshRequest,
  AssetRefreshScope,
  AssetSourceRefresher,
  AssetSourceSummary,
  AssetSources,
  AssetSynchronization,
  Clock,
  DailyAssetSnapshots,
  SecretStore,
} from "@/server/ports";
import { SourceRefreshExecutor, type SourceRefreshOutcome } from "@/server/refresh/source-refresh-executor";
import { RefreshObservationRecorder } from "@/server/refresh/refresh-observation-recorder";
import { RefreshScheduler, type RefreshPlan, type UnifiedRefreshPlan } from "@/server/refresh/refresh-scheduler";
import { ASSET_SOURCE_TIMEOUT_MS, fullRefreshLeaseMs } from "@/server/refresh/asset-refresh-state";

const FULL_REFRESH_INTERVAL_MS = 60 * 60 * 1_000;

/**
 * 资产刷新服务端批次入口。客户端的判断只减少无效请求；本类以持久化周期
 * 和单例队列作为最终资格判断，避免同一服务进程中的多个页面重复读取来源。
 */
export class SourceIsolatedAssetSynchronization
  implements AssetSynchronization
{
  private readonly scheduler: RefreshScheduler;
  private readonly sourceRefreshExecutor: SourceRefreshExecutor;
  private readonly observationRecorder: RefreshObservationRecorder;

  constructor(
    private readonly sources: AssetSources,
    secrets: SecretStore,
    private readonly clock: Clock,
    refresher: AssetSourceRefresher,
    private readonly sourceTimeoutMs = ASSET_SOURCE_TIMEOUT_MS,
    dailySnapshots: DailyAssetSnapshots,
    private readonly fullRefreshState: AssetFullRefreshState,
    private readonly dailyAssetHistory?: { run(): Promise<void> },
  ) {
    this.scheduler = new RefreshScheduler((plan) => this.executeJob(plan));
    this.sourceRefreshExecutor = new SourceRefreshExecutor(
      sources,
      secrets,
      clock,
      refresher,
      sourceTimeoutMs,
    );
    this.observationRecorder = new RefreshObservationRecorder(
      sources,
      dailySnapshots,
    );
  }

  request(input: AssetRefreshRequest): Promise<AssetRefreshReport> {
    return this.scheduler.request(input);
  }

  private async executeJob(job: RefreshPlan): Promise<AssetRefreshReport> {
    return this.executeUnified(job);
  }

  private async executeUnified(job: UnifiedRefreshPlan): Promise<AssetRefreshReport> {
    const allSources = await this.sources.list();
    const targets = job.full
      ? allSources.filter((source) => this.isRefreshable(source))
      : [...job.sourceIds].map((sourceId) => {
        const source = allSources.find((item) => item.id === sourceId);
        if (source === undefined || !this.isRefreshable(source)) {
          throw new Error("资产来源未连接或只读凭证不可用");
        }
        return source;
      });

    if (targets.length === 0) {
      if (job.full) await this.fullRefreshState.clear();
      return { successCount: 0, failureCount: 0, skipped: "no-sources" };
    }

    const attemptedAt = this.clock.now().toISOString();
    if (job.full) {
      const claim = await this.fullRefreshState.claim({
        attemptedAt,
        intervalMs: FULL_REFRESH_INTERVAL_MS,
        staleAfterMs: fullRefreshLeaseMs(this.sourceTimeoutMs),
        force: !job.automatic,
      });
      if (claim !== "claimed") {
        const state = await this.fullRefreshState.read();
        return {
          successCount: 0,
          failureCount: 0,
          skipped: claim,
          ...(state.attemptedAt === null
            ? {}
            : { attemptedAt: state.attemptedAt }),
        };
      }
    }

    return this.executeBatch({
      mode: "all",
      scope: "all",
      sources: targets,
      isFullBatch: job.full,
      attemptedAt,
    });
  }

  protected async executeBatch(input: {
    mode: AssetRefreshMode;
    scope: AssetRefreshScope;
    sourceId?: string;
    sources?: AssetSourceSummary[];
    isFullBatch: boolean;
    attemptedAt?: string;
  }): Promise<AssetRefreshReport> {
    const sources = input.sources ?? (await this.selectSources(
      input.scope,
      input.sourceId,
    ));
    const attemptedAt = input.attemptedAt ?? this.clock.now().toISOString();

    const outcomes = await Promise.all(
      sources.map((source) => this.refreshSource(source, input.mode, attemptedAt)),
    );
    const successCount = outcomes.filter((outcome) => outcome === "success").length;
    const failureCount = outcomes.filter((outcome) => outcome === "failure").length;
    const supersededCount = outcomes.filter(
      (outcome) => outcome === "superseded",
    ).length;

    if (!this.sources.refreshGuard && input.mode === "all" && sources.length > 0) {
      await this.observationRecorder.record(sources, outcomes, attemptedAt);
    }
    if (input.isFullBatch) await this.fullRefreshState.finish(attemptedAt);
    await this.clearCycleWhenNoRefreshableSources();
    if (input.mode === "all" && sources.some(source => source.kind === "longbridge")) await this.dailyAssetHistory?.run();

    return {
      successCount,
      failureCount,
      ...(input.isFullBatch ? { attemptedAt } : {}),
      ...(supersededCount === 0 ? {} : { supersededCount }),
    };
  }

  private async selectSources(
    scope: AssetRefreshScope,
    sourceId: string | undefined,
  ): Promise<AssetSourceSummary[]> {
    return (await this.sources.list()).filter(
      (source) =>
        this.isRefreshable(source) &&
        (sourceId !== undefined
          ? source.id === sourceId
          : scope === "all" ||
            (scope === "evm"
              ? source.kind.startsWith("evm-watch-")
              : !source.kind.startsWith("evm-watch-"))),
    );
  }

  private async refreshSource(
    source: AssetSourceSummary,
    mode: AssetRefreshMode,
    attemptedAt: string,
  ): Promise<SourceRefreshOutcome> {
    return this.sourceRefreshExecutor.execute(source, mode, attemptedAt);
  }

  private async clearCycleWhenNoRefreshableSources(): Promise<void> {
    if ((await this.sources.list()).some((source) => this.isRefreshable(source))) {
      return;
    }
    await this.fullRefreshState.clear();
  }

  private isRefreshable(source: AssetSourceSummary): boolean {
    return (
      source.kind !== "manual" &&
      source.lifecycle !== "disconnected" &&
      source.credentialReference !== null
    );
  }
}
