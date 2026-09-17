import {
  abortableSyncDelay,
  abortableSyncOperation,
  AssetRequestError,
  assetSyncErrorMessage,
  diagnoseAssetSyncError,
  withManagedAssetRetry,
  ASSET_SYNC_ATTEMPT_LIMIT,
} from "@/server/asset-sync-diagnostics";
import type {
  AssetFullRefreshState,
  AssetRefreshIntent,
  AssetRefreshMode,
  AssetRefreshReport,
  AssetRefreshRequest,
  AssetRefreshScope,
  AssetSourceRefresher,
  AssetSourceRefreshResult,
  AssetSyncAttempt,
  AssetSyncDiagnostic,
  AssetSourceSummary,
  AssetSources,
  AssetSynchronization,
  Clock,
  DailyAssetSnapshots,
  SecretStore,
} from "@/server/ports";
import { buildDailyAssetSnapshot } from "@/domain/daily-asset-snapshots";
import { isMacOSKeychainCredentialReference } from "@/server/asset-sources/longbridge-keychain-sdk";

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

  constructor(
    private readonly sources: AssetSources,
    private readonly secrets: SecretStore,
    private readonly clock: Clock,
    private readonly refresher: AssetSourceRefresher,
    private readonly sourceTimeoutMs = 60_000,
    private readonly dailySnapshots: DailyAssetSnapshots,
    private readonly fullRefreshState: AssetFullRefreshState,
  ) {}

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
        staleAfterMs: Math.max(this.sourceTimeoutMs + 5_000, 60_000),
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
    const controller = new AbortController();
    const startedAt = performance.now();
    const timeout = setTimeout(() => {
      controller.abort(new DOMException("Source refresh budget exhausted", "TimeoutError"));
    }, this.sourceTimeoutMs);
    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const attemptController = new AbortController();
        const signal = AbortSignal.any([controller.signal, attemptController.signal]);
        const attemptStartedAt = performance.now();
        const attemptAt = this.clock.now().toISOString();
        let stage: AssetSyncDiagnostic["stage"] = "credentials";
        let result: AssetSourceRefreshResult | undefined;
        let failure: unknown;
        try {
          result = await abortableSyncOperation(signal, async () => {
            signal.throwIfAborted();
            const credentialReference = source.credentialReference;
            if (credentialReference === null) throw new Error("只读凭证不可用");
            const usesKeychainReference = source.kind === "longbridge" &&
              isMacOSKeychainCredentialReference(credentialReference);
            // 重试重新读取可能已轮换的凭证，Adapter 每次重新生成签名和时间戳。
            const credentials = usesKeychainReference
              ? credentialReference : await this.secrets.get(credentialReference);
            signal.throwIfAborted();
            if (credentials === null) throw new Error("只读凭证不可用");
            stage = "refresh";
            return withManagedAssetRetry(() => this.refresher.refresh({
              source, credentials, mode, attemptedAt, signal,
              persistCredentials: async (value) => {
                signal.throwIfAborted();
                if (usesKeychainReference) return;
                if (await this.currentVersion(source) === null) {
                  throw new DOMException("Source was replaced", "AbortError");
                }
                signal.throwIfAborted();
                try { await this.secrets.replace(credentialReference, value); }
                catch (error) { stage = "persist"; throw error; }
              },
            }));
          });
        } catch (error) {
          failure = error;
        } finally {
          // 终止本次失败留下的并行请求，再进入下一次尝试；总预算不重置。
          attemptController.abort();
        }
        const durationMs = Math.max(0, Math.round(performance.now() - attemptStartedAt));
        const current = await this.currentVersion(source);
        if (current === null) return "superseded";
        const diagnostic = result === undefined
          ? diagnoseAssetSyncError(failure, stage, durationMs) : null;
        const record: AssetSyncAttempt = {
          attemptedAt: attemptAt, mode, attempt,
          outcome: result === undefined ? "failure" : "success",
          durationMs, diagnostic,
        };
        const recentAttempts = [...(current.sync.recentAttempts ?? []), record].slice(-ASSET_SYNC_ATTEMPT_LIMIT);
        if (result !== undefined) {
          await this.sources.update({
            ...current, snapshot: result.snapshot,
            sync: {
              status: "current", lastSuccessfulAt: result.snapshot.syncedAt,
              lastAttemptAt: attemptedAt, error: null, failedMode: null,
              diagnostic: null, recentAttempts,
            },
          });
          return "success";
        }
        await this.sources.update({
          ...current,
          sync: {
            ...current.sync, status: "expired", lastAttemptAt: attemptedAt,
            error: assetSyncErrorMessage(diagnostic!), failedMode: mode,
            diagnostic, recentAttempts,
          },
        });
        if (!diagnostic!.retryable || attempt === 3 || controller.signal.aborted) return "failure";
        const delay = Math.max(500 * 2 ** (attempt - 1),
          failure instanceof AssetRequestError ? failure.retryAfterMs ?? 0 : 0);
        const remaining = this.sourceTimeoutMs - (performance.now() - startedAt);
        if (delay >= remaining) return "failure";
        try { await abortableSyncDelay(delay, controller.signal); }
        catch { return "failure"; }
        if (await this.currentVersion(source) === null) return "superseded";
      }
      return "failure";
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  }

  private async recordFullBatchObservation(
    sources: AssetSourceSummary[],
    outcomes: SourceOutcome[],
    attemptedAt: string,
  ): Promise<void> {
    // 组合历史只接受同一批次全部来源成功；部分成功仅保留来源当前值。
    if (outcomes.length === 0 || outcomes.some((outcome) => outcome !== "success")) return;
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

  private async currentVersion(
    source: AssetSourceSummary,
  ): Promise<AssetSourceSummary | null> {
    const current = (await this.sources.list()).find(
      (candidate) => candidate.id === source.id,
    );
    if (
      current === undefined ||
      !this.isRefreshable(current) ||
      current.credentialReference !== source.credentialReference
    ) return null;
    return current;
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
