import type { AssetRefreshReport, AssetRefreshRequest, AssetSynchronization } from "@/server/ports";

export interface UnifiedRefreshPlan {
  kind: "unified";
  full: boolean;
  automatic: boolean;
  sourceIds: Set<string>;
}

export type RefreshPlan = UnifiedRefreshPlan;

interface UnifiedJob extends UnifiedRefreshPlan {
  promise: Promise<AssetRefreshReport>;
  resolve: (report: AssetRefreshReport) => void;
  reject: (error: unknown) => void;
}

type RefreshJob = UnifiedJob;

/** 合并同进程的刷新请求，并在当前批次结束后串行执行下一批。 */
export class RefreshScheduler implements AssetSynchronization {
  private active: RefreshJob | null = null;
  private readonly pending: RefreshJob[] = [];
  private drainScheduled = false;

  constructor(private readonly executeJob: (plan: RefreshPlan) => Promise<AssetRefreshReport>) {}

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

  private scheduleFull(automatic: boolean): Promise<AssetRefreshReport> {
    if (this.active?.kind === "unified" && this.active.full) {
      return automatic
        ? this.active.promise
        : this.joinFull(this.active, () => this.scheduleFull(false));
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
    if (pendingSources !== undefined && !automatic) {
      pendingSources.full = true;
      pendingSources.sourceIds.clear();
      pendingSources.automatic = false;
      return pendingSources.promise;
    }

    return this.enqueueUnified(true, automatic, []);
  }

  private scheduleSources(sourceIds: string[]): Promise<AssetRefreshReport> {
    const requested = new Set(sourceIds);
    if (this.active?.kind === "unified") {
      if (this.active.full) {
        return this.joinFull(this.active, () => this.scheduleSources([...requested]));
      }
      if (this.containsAll(this.active.sourceIds, requested)) {
        return this.active.promise;
      }
    }

    const pendingSources = this.pending.find(
      (job): job is UnifiedJob => job.kind === "unified" && !job.full,
    );
    if (pendingSources !== undefined) {
      requested.forEach((sourceId) => pendingSources.sourceIds.add(sourceId));
      return pendingSources.promise;
    }

    const pendingFull = this.pending.find(
      (job): job is UnifiedJob => job.kind === "unified" && job.full,
    );
    if (pendingFull !== undefined) {
      return this.joinFull(pendingFull, () => this.scheduleSources([...requested]));
    }

    return this.enqueueUnified(false, false, requested);
  }

  private joinFull(
    job: UnifiedJob,
    retry: () => Promise<AssetRefreshReport>,
  ): Promise<AssetRefreshReport> {
    if (!job.automatic) return job.promise;
    // An automatic cycle check can skip without satisfying the manual request.
    return job.promise.then((report) => report.skipped === "not-due" ? retry() : report);
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

  private containsAll(haystack: Set<string>, needles: Set<string>): boolean {
    return [...needles].every((sourceId) => haystack.has(sourceId));
  }
}
