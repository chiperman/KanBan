import type {
  AssetRefreshIntent,
  AssetRefreshReport,
} from "@/server/ports";

const FULL_REFRESH_INTERVAL_MS = 60 * 60 * 1_000;

export interface RefreshableAssetSource {
  id: string;
  kind: string;
  lifecycle?: "connected" | "disconnected";
  credentialAvailable?: boolean;
  credentialReference?: string | null;
}

export interface AssetRefreshPlanInput {
  now: Date;
  attemptedAt: string | null;
  canRefresh: boolean;
  visible: boolean;
  focused: boolean;
  intent: AssetRefreshIntent;
}

export interface AssetRefreshPlan {
  shouldRequest: boolean;
  nextAt: string | null;
}

/**
 * 客户端仅据此减少无效请求；一小时周期和批次互斥由服务端最终裁决。
 */
export function planAssetRefresh(input: AssetRefreshPlanInput): AssetRefreshPlan {
  const automatic = input.intent.reason !== "manual-global" &&
    input.intent.reason !== "manual-source";
  if (!input.canRefresh) return { shouldRequest: false, nextAt: null };
  if (!automatic) return { shouldRequest: true, nextAt: null };

  const previous = input.attemptedAt === null
    ? Number.NaN
    : Date.parse(input.attemptedAt);
  const nextAt = Number.isFinite(previous)
    ? new Date(previous + FULL_REFRESH_INTERVAL_MS).toISOString()
    : null;
  const due = !Number.isFinite(previous) || input.now.getTime() >= previous + FULL_REFRESH_INTERVAL_MS;
  return {
    shouldRequest: input.visible && input.focused && due,
    nextAt,
  };
}

export type AssetRefreshCoordinatorState =
  | "idle"
  | "planning"
  | "refreshing"
  | "success"
  | "partial"
  | "error";

export interface AssetRefreshStatus {
  state: AssetRefreshCoordinatorState;
  message: string;
  feedback: "manual" | "silent";
  intent: AssetRefreshIntent | null;
}

function idleStatus(): AssetRefreshStatus {
  return {
    state: "idle",
    message: "",
    feedback: "silent",
    intent: null,
  };
}

export interface AssetRefreshCoordinatorOptions {
  now: () => Date;
  request: (intent: AssetRefreshIntent) => Promise<AssetRefreshReport>;
  schedule: (callback: () => void, delayMs: number) => unknown;
  cancel: (handle: unknown) => void;
  readState?: () => Promise<{ attemptedAt: string | null; inProgressAt: string | null }>;
  onRecovered?: () => void;
  onReport?: (input: {
    intent: AssetRefreshIntent;
    report: AssetRefreshReport;
  }) => void;
}

export interface AssetRefreshRegistration {
  attemptedAt: string | null;
  inProgressAt?: string | null;
  sources: RefreshableAssetSource[];
  visible: boolean;
  focused: boolean;
  pageEntry: boolean;
}

/** UI 无关的单例刷新计划器；Ticket 03 负责把它挂到页面生命周期。 */
export class AssetRefreshCoordinator {
  private readonly sources = new Map<string, RefreshableAssetSource>();
  private attemptedAt: string | null = null;
  private visible = false;
  private focused = false;
  private timer: unknown = null;
  private recoveryTimer: unknown = null;
  private recovering = false;
  private fullRequest: Promise<void> | null = null;
  private readonly sourceRequests = new Map<string, Promise<void>>();
  private fullActivity = idleStatus();
  private readonly sourceActivities = new Map<string, AssetRefreshStatus>();
  private latestTerminal: AssetRefreshStatus | null = null;
  private readonly listeners = new Set<() => void>();
  private generation = 0;

  state: AssetRefreshCoordinatorState = "idle";
  message = "";
  feedback: "manual" | "silent" = "silent";
  lastIntent: AssetRefreshIntent | null = null;

  constructor(private readonly options: AssetRefreshCoordinatorOptions) {}

  get canRefresh(): boolean {
    return [...this.sources.values()].some((source) =>
      source.kind !== "manual" &&
      source.lifecycle !== "disconnected" &&
      (source.credentialAvailable === true ||
        (source.credentialAvailable === undefined &&
          source.credentialReference !== null &&
          source.credentialReference !== undefined)),
    );
  }

  globalStatus(): AssetRefreshStatus {
    return this.fullActivity;
  }

  sourceStatus(sourceId: string): AssetRefreshStatus {
    return this.sourceActivities.get(sourceId) ?? idleStatus();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  register(registration: AssetRefreshRegistration): Promise<void> {
    this.setSources(registration.sources);
    this.hydrate(registration);
    this.setBrowserState({
      visible: registration.visible,
      focused: registration.focused,
    });
    return registration.pageEntry
      ? this.request({ reason: "page-entry" })
      : Promise.resolve();
  }

  hydrate(state: { attemptedAt: string | null; inProgressAt?: string | null }): void {
    const currentAttemptedAt = this.attemptedAt === null
      ? Number.NaN
      : Date.parse(this.attemptedAt);
    const hydratedAttemptedAt = state.attemptedAt === null
      ? Number.NaN
      : Date.parse(state.attemptedAt);
    if (!Number.isFinite(currentAttemptedAt) ||
        hydratedAttemptedAt > currentAttemptedAt) {
      this.attemptedAt = state.attemptedAt;
    }
    if (state.inProgressAt !== undefined && this.fullRequest === null) {
      const recovering = state.inProgressAt !== null && this.canRefresh;
      if (recovering) {
        this.fullActivity = {
          state: "refreshing",
          message: "",
          feedback: "silent",
          intent: null,
        };
        this.latestTerminal = null;
      } else if (this.recovering) {
        this.fullActivity = idleStatus();
      }
      this.recovering = recovering;
      this.updateAggregate();
      this.scheduleRecoveryCheck();
    }
    this.scheduleNext();
    this.notify();
  }

  setSources(sources: RefreshableAssetSource[]): void {
    this.sources.clear();
    sources.forEach((source) => this.sources.set(source.id, source));
    this.scheduleNext();
    this.notify();
  }

  setBrowserState(state: { visible: boolean; focused: boolean }): void {
    this.visible = state.visible;
    this.focused = state.focused;
    this.scheduleNext();
    this.notify();
  }

  reconsiderForeground(state: {
    visible: boolean;
    focused: boolean;
  }): Promise<void> {
    this.setBrowserState(state);
    return this.request({ reason: "foreground" });
  }

  /** 停止尚未开始的自动计划；已发出的服务端请求允许自行结束。 */
  clear(): void {
    this.generation += 1;
    this.sources.clear();
    this.attemptedAt = null;
    this.clearTimer();
    this.clearRecoveryTimer();
    this.recovering = false;
    this.fullRequest = null;
    this.sourceRequests.clear();
    this.fullActivity = idleStatus();
    this.sourceActivities.clear();
    this.latestTerminal = null;
    this.state = "idle";
    this.message = "";
    this.feedback = "silent";
    this.lastIntent = null;
    this.notify();
  }

  dismissFeedback(): void {
    if (this.state === "refreshing") return;
    this.fullActivity = idleStatus();
    this.sourceActivities.clear();
    this.latestTerminal = null;
    this.updateAggregate();
    this.notify();
  }

  request(intent: AssetRefreshIntent): Promise<void> {
    if (this.recovering) return Promise.resolve();
    const plan = planAssetRefresh({
      now: this.options.now(),
      attemptedAt: this.attemptedAt,
      canRefresh: this.canRefresh,
      visible: this.visible,
      focused: this.focused,
      intent,
    });
    if (!plan.shouldRequest) return Promise.resolve();

    if (intent.reason !== "manual-source" && this.fullRequest !== null) {
      return this.fullRequest;
    }
    if (intent.reason === "manual-source") {
      if (this.fullRequest !== null) return this.fullRequest;
      const running = this.sourceRequests.get(intent.sourceId);
      if (running !== undefined) return running;
    }

    const startedAt = this.options.now().toISOString();
    const generation = this.generation;
    const activity: AssetRefreshStatus = {
      state: "refreshing",
      message: "",
      feedback: intent.reason === "manual-global" ||
        intent.reason === "manual-source"
        ? "manual"
        : "silent",
      intent,
    };
    this.setActivity(intent, activity);
    this.lastIntent = intent;
    this.updateAggregate();
    this.notify();
    let promise!: Promise<void>;
    promise = this.options.request(intent).then(
      (report) => {
        if (generation !== this.generation) return;
        if (intent.reason !== "manual-source") {
          if (report.attemptedAt !== undefined) {
            this.attemptedAt = report.attemptedAt;
          } else if (report.skipped === undefined) {
            this.attemptedAt = startedAt;
          }
        }
        if (report.skipped !== undefined) {
          this.setActivity(intent, idleStatus());
          this.latestTerminal = null;
          if (report.skipped === "in-progress") {
            this.recovering = true;
            this.fullActivity = { ...activity, feedback: "silent" };
            this.scheduleRecoveryCheck();
          }
          this.updateAggregate();
          this.scheduleNext();
          this.notify();
          return;
        }
        const resultState = report.failureCount === 0
          ? "success"
          : intent.reason === "manual-source" || report.successCount === 0
            ? "error"
            : "partial";
        const terminal: AssetRefreshStatus = {
          state: resultState,
          message: report.failureCount === 0
            ? ""
            : resultState === "partial"
              ? "部分来源刷新失败"
              : "刷新失败",
          feedback: activity.feedback,
          intent,
        };
        this.setActivity(intent, terminal);
        this.latestTerminal = terminal;
        this.updateAggregate();
        this.scheduleNext();
        this.options.onReport?.({ intent, report });
        this.notify();
      },
      (error) => {
        if (generation !== this.generation) return;
        if (intent.reason !== "manual-source") {
          this.attemptedAt = startedAt;
        }
        const terminal: AssetRefreshStatus = {
          state: "error",
          message: error instanceof Error ? error.message : "资产刷新失败",
          feedback: activity.feedback,
          intent,
        };
        this.setActivity(intent, terminal);
        this.latestTerminal = terminal;
        this.updateAggregate();
        this.scheduleNext();
        this.notify();
      },
    ).finally(() => {
      if (intent.reason === "manual-source") {
        if (this.sourceRequests.get(intent.sourceId) === promise) {
          this.sourceRequests.delete(intent.sourceId);
        }
      } else if (this.fullRequest === promise) {
        this.fullRequest = null;
      }
    });

    if (intent.reason === "manual-source") this.sourceRequests.set(intent.sourceId, promise);
    else this.fullRequest = promise;
    return promise;
  }

  private setActivity(
    intent: AssetRefreshIntent,
    activity: AssetRefreshStatus,
  ): void {
    if (intent.reason === "manual-source") {
      this.sourceActivities.set(intent.sourceId, activity);
      return;
    }
    this.fullActivity = activity;
  }

  private updateAggregate(): void {
    const active = [
      this.fullActivity,
      ...this.sourceActivities.values(),
    ].filter((activity) => activity.state === "refreshing");
    if (active.length > 0) {
      this.state = "refreshing";
      this.message = "";
      this.feedback = active.some((activity) => activity.feedback === "manual")
        ? "manual"
        : "silent";
      return;
    }
    const terminal = this.latestTerminal;
    this.state = terminal?.state ?? "idle";
    this.message = terminal?.message ?? "";
    this.feedback = terminal?.feedback ?? "silent";
    this.lastIntent = terminal?.intent ?? null;
  }

  private scheduleNext(): void {
    this.clearTimer();
    const plan = planAssetRefresh({
      now: this.options.now(),
      attemptedAt: this.attemptedAt,
      canRefresh: this.canRefresh,
      visible: this.visible,
      focused: this.focused,
      intent: { reason: "interval" },
    });
    if (plan.nextAt === null || !this.visible || !this.focused) return;
    const delayMs = Date.parse(plan.nextAt) - this.options.now().getTime();
    if (delayMs <= 0) return;
    this.timer = this.options.schedule(() => {
      this.timer = null;
      void this.request({ reason: "interval" });
    }, delayMs);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    this.options.cancel(this.timer);
    this.timer = null;
  }

  private clearRecoveryTimer(): void {
    if (this.recoveryTimer === null) return;
    this.options.cancel(this.recoveryTimer);
    this.recoveryTimer = null;
  }

  private scheduleRecoveryCheck(): void {
    this.clearRecoveryTimer();
    const readState = this.options.readState;
    if (!this.recovering || !readState) return;
    const generation = this.generation;
    this.recoveryTimer = this.options.schedule(() => {
      this.recoveryTimer = null;
      void readState().then((state) => {
        if (generation !== this.generation) return;
        const recovering = this.recovering;
        this.hydrate(state);
        if (recovering && !this.recovering) this.options.onRecovered?.();
      }).catch(() => {
        if (generation === this.generation) this.scheduleRecoveryCheck();
      });
    }, 1_000);
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }
}
