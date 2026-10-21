import { buildDailyAssetSnapshot, mergeDailyTrendObservation } from "@/domain/daily-asset-snapshots";
import type {
  AssetSourceSummary,
  AssetSources,
  DailyAssetSnapshots,
} from "@/server/ports";
import type { SourceRefreshOutcome } from "@/server/source-refresh-executor";

/** 无原子持久化能力的适配器，在刷新后累计成功来源。 */
export class RefreshObservationRecorder {
  constructor(
    private readonly sources: AssetSources,
    private readonly dailySnapshots: DailyAssetSnapshots,
  ) {}

  async record(
    sources: AssetSourceSummary[],
    outcomes: SourceRefreshOutcome[],
    attemptedAt: string,
  ): Promise<void> {
    if (!outcomes.some((outcome) => outcome === "success")) return;

    const connectedSources = (await this.sources.list()).filter(
      (source) => source.lifecycle !== "disconnected",
    );
    const successfulIds = new Set(sources.filter((_, index) => outcomes[index] === "success").map(source => source.id));
    const next = buildDailyAssetSnapshot(connectedSources, attemptedAt, successfulIds);
    const previous = (await this.dailySnapshots.listTrendObservations()).find(row => row.day === next.day);
    const dailySnapshot = mergeDailyTrendObservation(previous, next);
    await this.dailySnapshots.record(
      dailySnapshot,
      dailySnapshot.complete && dailySnapshot.status === "complete",
    );
  }
}
