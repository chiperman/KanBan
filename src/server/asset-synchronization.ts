
import type {
  AssetFullRefreshState,
  AssetRefreshIntent,
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
import { buildDailyAssetSnapshot } from "@/domain/daily-asset-snapshots";
import { SourceRefreshExecutor } from "@/server/source-refresh-executor";
import { ASSET_SOURCE_TIMEOUT_MS, fullRefreshLeaseMs } from "@/server/asset-refresh-state";

const FULL_REFRESH_INTERVAL_MS = 60 * 60 * 1_000;

type SourceOutcome = "success" | "failure" | "superseded";

interface UnifiedJob {
  kind: "unified";
  full: boolean;
  automatic: boolean;
  sourceIds: Set<string>;
  promise: Promise<AssetRefreshReport>;
  resolve: (report: AssetRefreshReport) => void;
  reject: (error: unknown) => void;
}

interface LegacyJob {
  kind: "legacy";
  mode: AssetRefreshMode;
  scope: AssetRefreshScope;
  sourceId: string | undefined;
  promise: Promise<AssetRefreshReport>;
  resolve: (report: AssetRefreshReport) => void;
  reject: (error: unknown) => void;
}

type RefreshJob = UnifiedJob | LegacyJob;

/**
 * 资产刷新服务端批次入口。客户端的判断只减少无效请求；本类以持久化周期
 * 和单例队列作为最终资格判断，避免同一服务进程中的多个页面重复读取来源。
 */
export class SourceIsolatedAssetSynchronization
  implements AssetSynchronization
{
  private active: RefreshJob | null = null;
  private readonly pending: RefreshJob[] = [];
  private drainScheduled = false;
  private readonly sourceRefreshExecutor: SourceRefreshExecutor;

  constructor(
    private readonly sources: AssetSources,
    private readonly secrets: SecretStore,
    private readonly clock: Clock,
    private readonly refresher: AssetSourceRefresher,
    private readonly sourceTimeoutMs = ASSET_SOURCE_TIMEOUT_MS,
    private readonly dailySnapshots: DailyAssetSnapshots,
    private readonly fullRefreshState: AssetFullRefreshState,
  ) {
    this.sourceRefreshExecutor = new SourceRefreshExecutor(
      sources,
      secrets,
      clock,
      refresher,
      sourceTimeoutMs,
    );
  }

  request(input: AssetRefreshRequest): Promise<AssetRefreshReport> {
    const { intent } = input;
    if (intent.reason === "manual-global") return this.scheduleFull(false);
    if (intent.reason === "manual-source") {
      const sourceIds = input.sourceIds ?? [intent.sourceId];
      if (
        sourceIds.length === 0 ||
        sourceIds.some((sourceId) => sourceId.trim() === "")
      ) {
        return Promise.reject(new Error("资产来源无效"));
      }
      return this.scheduleSources(sourceIds);
    }
    return this.scheduleFull(true);
  }

  refresh(
    mode: AssetRefreshMode,
    scope: AssetRefreshScope = "all",
    sourceId?: string,
  ): Promise<AssetRefreshReport> {
    if (mode === "all" && scope === "all") {
      return sourceId === undefined
        ? this.request({ intent: { reason: "manual-global" } })
        : this.request({
          intent: { reason: "manual-source", sourceId },
        });
    }
    return this.enqueueLegacy(mode, scope, sourceId);
  }

  private scheduleFull(automatic: boolean): Promise<AssetRefreshReport> {
    if (this.active?.kind === "unified" && this.active.full) {
      if (!automatic) this.active.automatic = false;
      return this.active.promise;
    }

    const pendingFull = this.pending.find(
      (job): job is UnifiedJob => job.kind === "unified" && job.full,
    );
    if (pendingFull !== undefined) {
      if (!automatic) pendingFull.automatic = false;
      return pendingFull.promise;
    }

    const pendingSources = this.pending.find(
      (job): job is UnifiedJob => job.kind === "unified" && !job.full,
    );
    if (pendingSources !== undefined) {
      pendingSources.full = true;
      pendingSources.sourceIds.clear();
      if (!automatic) pendingSources.automatic = false;
      return pendingSources.promise;
    }

    return this.enqueueUnified(true, automatic, []);
  }

  private scheduleSources(sourceIds: string[]): Promise<AssetRefreshReport> {
    const requested = new Set(sourceIds);
    if (this.active?.kind === "unified") {
      if (this.active.full || this.containsAll(this.active.sourceIds, requested)) {
        return this.active.promise;
      }
    }

    const pendingFull = this.pending.find(
      (job): job is UnifiedJob => job.kind === "unified" && job.full,
    );
    if (pendingFull !== undefined) return pendingFull.promise;

    const pendingSources = this.pending.find(
      (job): job is UnifiedJob => job.kind === "unified" && !job.full,
    );
    if (pendingSources !== undefined) {
      requested.forEach((sourceId) => pendingSources.sourceIds.add(sourceId));
      return pendingSources.promise;
    }

    return this.enqueueUnified(false, false, requested);
  }

  private enqueueUnified(
    full: boolean,
    automatic: boolean,
    sourceIds: Iterable<string>,
  ): Promise<AssetRefreshReport> {
    let resolve!: (report: AssetRefreshReport) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<AssetRefreshReport>((nextResolve, nextReject) => {
      resolve = nextResolve;
      reject = nextReject;
    });
    this.pending.push({
      kind: "unified",
      full,
      automatic,
      sourceIds: new Set(sourceIds),
      promise,
      resolve,
      reject,
    });
    this.scheduleDrain();
    return promise;
  }

  private enqueueLegacy(
    mode: AssetRefreshMode,
    scope: AssetRefreshScope,
    sourceId: string | undefined,
  ): Promise<AssetRefreshReport> {
    let resolve!: (report: AssetRefreshReport) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<AssetRefreshReport>((nextResolve, nextReject) => {
      resolve = nextResolve;
      reject = nextReject;
    });
    this.pending.push({
      kind: "legacy",
      mode,
      scope,
      sourceId,
      promise,
      resolve,
      reject,
    });
    this.scheduleDrain();
    return promise;
  }

  private scheduleDrain(): void {
    if (this.drainScheduled || this.active !== null) return;
    this.drainScheduled = true;
    queueMicrotask(() => {
      this.drainScheduled = false;
      this.startNext();
    });
  }

  private startNext(): void {
    if (this.active !== null) return;
    const job = this.pending.shift();
    if (job === undefined) return;
    this.active = job;
    void this.executeJob(job).then(
      (report) => {
        this.active = null;
        this.scheduleDrain();
        job.resolve(report);
      },
      (error) => {
        this.active = null;
        this.scheduleDrain();
        job.reject(error);
      },
    );
  }

  private async executeJob(job: RefreshJob): Promise<AssetRefreshReport> {
    if (job.kind === "legacy") {
      return this.executeBatch({
        mode: job.mode,
        scope: job.scope,
        sourceId: job.sourceId,
        isFullBatch: false,
      });
    }
    return this.executeUnified(job);
  }

  private async executeUnified(job: UnifiedJob): Promise<AssetRefreshReport> {
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

  private async executeBatch(input: {
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

    if (input.isFullBatch && sources.length > 0) {
      await this.recordFullBatchObservation(sources, outcomes, attemptedAt);
      await this.fullRefreshState.finish(attemptedAt);
    }
    await this.clearCycleWhenNoRefreshableSources();

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
  ): Promise<SourceOutcome> {
    return this.sourceRefreshExecutor.execute(source, mode, attemptedAt);
  }

  private async recordFullBatchObservation(
    sources: AssetSourceSummary[],
    outcomes: SourceOutcome[],
    attemptedAt: string,
  ): Promise<void> {
    // 趋势允许部分成功的过期观测；只有完整且新鲜的观测才能建立日初基准。
    if (
      !outcomes.some((outcome) => outcome === "success") ||
      outcomes.some((outcome) => outcome === "superseded")
    ) return;
    const connectedSources = (await this.sources.list()).filter(
      (source) => source.lifecycle !== "disconnected",
    );
    const currentTargetIds = connectedSources
      .filter((source) => this.isRefreshable(source))
      .map((source) => source.id)
      .toSorted();
    const targetIds = sources.map((source) => source.id).toSorted();
    if (
      currentTargetIds.length !== targetIds.length ||
      !currentTargetIds.every((id, index) => id === targetIds[index])
    ) return;

    const dailySnapshot = buildDailyAssetSnapshot(connectedSources, attemptedAt);
    await this.dailySnapshots.record(
      dailySnapshot,
      dailySnapshot.complete && dailySnapshot.status === "complete",
    );
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

  private containsAll(haystack: Set<string>, needles: Set<string>): boolean {
    return [...needles].every((sourceId) => haystack.has(sourceId));
  }
}

export function isAutomaticAssetRefreshIntent(intent: AssetRefreshIntent): boolean {
  return intent.reason !== "manual-global" && intent.reason !== "manual-source";
}
