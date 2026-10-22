import { randomUUID } from "node:crypto";
import { shanghaiDay } from "@/domain/daily-asset-snapshots";
import { fullRefreshLeaseMs } from "@/server/asset-refresh-state";
import type { AssetFullRefreshState, AssetRefreshReport, AssetSources, AssetSynchronization, Clock, DailyAssetSnapshots, FormalDailySettlementRunner } from "@/server/ports";

export const COLLECTION_INTERVAL_MS = 60 * 60_000;
const RETRY_OFFSETS = [5 * 60_000, 15 * 60_000];

export interface CollectionState {
  checkedAt: string;
  completedAt: string | null;
  report: AssetRefreshReport | null;
  reportAt: string | null;
  lastFullSuccessAt: string | null;
  error: "collection-failed" | null;
  cycleAt: string | null;
  retryRound: number;
  retryPrepared: boolean;
  retrySourceIds: string[];
  nextRetryAt: string | null;
  formalCheckedAt: string | null;
}

export interface BackgroundCollectionStore {
  readCollectionState(): Promise<CollectionState | null>;
  saveCollectionState(state: CollectionState): Promise<void>;
  claimCollection(token: string, now: string): Promise<boolean>;
  releaseCollection(token: string): Promise<void>;
}

export interface CollectionStatus {
  state: CollectionState | null;
  health: "running" | "stopped" | "unknown";
  nextCollectionAt: string | null;
  day: string;
  firstCompleteAt: string | null;
  sources: { id: string; label: string; observedAt: string | null; lastSuccessfulAt: string; error: string | null; }[];
}

/** 独立于网页会话的定时入口；检查不等于采集，状态查询不触发任何读取。 */
export class BackgroundAssetCollection {
  constructor(
    private readonly store: BackgroundCollectionStore,
    private readonly sources: AssetSources,
    private readonly observations: DailyAssetSnapshots,
    private readonly refreshState: AssetFullRefreshState,
    private readonly synchronization: AssetSynchronization,
    private readonly settlement: FormalDailySettlementRunner,
    private readonly clock: Clock,
    private readonly dailyAssetHistory?: { run(): Promise<void> },
  ) {}

  async read(): Promise<CollectionStatus> {
    const now = this.clock.now();
    const day = shanghaiDay(now);
    const [state, sources, trends, baselines, cycle] = await Promise.all([
      this.store.readCollectionState(), this.sources.list(), this.observations.listTrendObservations(),
      this.observations.list(), this.refreshState.read(),
    ]);
    const today = trends.find(row => row.day === day);
    const targets = sources.filter(source => source.kind !== "manual" && source.lifecycle !== "disconnected");
    const nextFull = cycle.attemptedAt ? Date.parse(cycle.attemptedAt) + COLLECTION_INTERVAL_MS : now.getTime();
    const retry = state?.cycleAt === cycle.attemptedAt && state?.nextRetryAt ? Date.parse(state.nextRetryAt) : Infinity;
    return {
      state,
      health: !state ? "unknown" : now.getTime() - Date.parse(state.checkedAt) < 3 * 60_000 ? "running" : "stopped",
      day,
      nextCollectionAt: targets.length ? new Date(Math.min(nextFull, retry)).toISOString() : null,
      firstCompleteAt: baselines.find(row => row.day === day && row.complete && (row.status ?? "complete") === "complete")?.capturedAt ?? null,
      sources: targets.map(source => {
        const observation = today?.sources.find(row => row.sourceId === source.id && row.complete &&
          (row.status ?? "complete") === "complete" && shanghaiDay(row.capturedAt) === day);
        return { id: source.id, label: source.displayName || source.label, observedAt: observation?.capturedAt ?? null,
          lastSuccessfulAt: source.sync.lastSuccessfulAt,
          error: source.sync.status === "expired" ? source.sync.error ?? "采集失败，请检查来源授权" : null };
      }),
    };
  }

  async run(): Promise<void> {
    const token = randomUUID();
    const now = this.clock.now().toISOString();
    if (!await this.store.claimCollection(token, now)) return;
    let state: CollectionState = {
      checkedAt: now, completedAt: null, report: null, reportAt: null, lastFullSuccessAt: null, error: null,
      cycleAt: null, retryRound: 0, retryPrepared: false, retrySourceIds: [], nextRetryAt: null, formalCheckedAt: null,
    };
    try {
      const previous = await this.store.readCollectionState();
      state = { ...state, ...previous, checkedAt: now, error: null };
      await this.store.saveCollectionState(state);
      const report = await this.synchronization.request({ intent: { reason: "interval" } });
      const cycle = await this.refreshState.read();
      if (state.cycleAt !== cycle.attemptedAt) {
        state = { ...state, cycleAt: cycle.attemptedAt, retryRound: 0, retryPrepared: false, retrySourceIds: [], nextRetryAt: null };
      }
      const batchActive = cycle.inProgressAt !== null &&
        Date.parse(now) - Date.parse(cycle.inProgressAt) < fullRefreshLeaseMs();
      // 网页批次完成后再建立补试计划；过期的在途标记也不能永久阻止补试。
      if (cycle.attemptedAt && !batchActive && !state.retryPrepared) {
        state.retryPrepared = true;
        state.retrySourceIds = (await this.sources.list()).filter(source => source.kind !== "manual" &&
          source.lifecycle !== "disconnected" && source.credentialReference !== null &&
          (source.sync.status === "expired" || source.sync.lastAttemptAt < cycle.attemptedAt!)).map(source => source.id);
        if (state.retrySourceIds.length) state.nextRetryAt = new Date(Date.parse(cycle.attemptedAt) + RETRY_OFFSETS[0]).toISOString();
      }
      if (!report.skipped) {
        state.report = report;
        state.reportAt = this.clock.now().toISOString();
        if (report.successCount > 0 && report.failureCount === 0 && !report.supersededCount) state.lastFullSuccessAt = this.clock.now().toISOString();
      } else if (report.skipped === "not-due" && state.nextRetryAt && state.nextRetryAt <= now && state.retrySourceIds.length) {
        const available = new Set((await this.sources.list()).filter(source => source.kind !== "manual" &&
          source.lifecycle !== "disconnected" && source.credentialReference !== null).map(source => source.id));
        const retryIds = state.retrySourceIds.filter(id => available.has(id));
        const retryAt = this.clock.now().toISOString();
        if (retryIds.length) {
          state.report = await this.synchronization.request({
            intent: { reason: "manual-source", sourceId: retryIds[0] }, sourceIds: retryIds,
          });
          state.reportAt = this.clock.now().toISOString();
        }
        state.retryRound++;
        state.retrySourceIds = (await this.sources.list()).filter(source => retryIds.includes(source.id) &&
          (source.sync.status === "expired" || source.sync.lastAttemptAt < retryAt)).map(source => source.id);
        state.nextRetryAt = state.retrySourceIds.length && state.retryRound < RETRY_OFFSETS.length && state.cycleAt
          ? new Date(Date.parse(state.cycleAt) + RETRY_OFFSETS[state.retryRound]).toISOString() : null;
      }
      await this.store.saveCollectionState(state);
      if (!state.formalCheckedAt || Date.parse(now) - Date.parse(state.formalCheckedAt) >= 15 * 60_000) {
        await this.settlement.run();
        state.formalCheckedAt = now;
      }
      await this.dailyAssetHistory?.run();
      state.completedAt = this.clock.now().toISOString();
      state.checkedAt = state.completedAt;
      await this.store.saveCollectionState(state);
    } catch {
      await this.store.saveCollectionState({ ...state, checkedAt: this.clock.now().toISOString(), error: "collection-failed" });
      throw new Error("后台采集执行失败，请查看设置中的来源状态");
    } finally {
      await this.store.releaseCollection(token);
    }
  }
}
