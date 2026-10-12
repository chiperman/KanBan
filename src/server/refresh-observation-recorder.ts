import { buildDailyAssetSnapshot } from "@/domain/daily-asset-snapshots";
import type {
  AssetSourceSummary,
  AssetSources,
  DailyAssetSnapshots,
} from "@/server/ports";
import type { SourceRefreshOutcome } from "@/server/source-refresh-executor";

/** 记录全量刷新后的组合观测，并阻止来源集合变化时伪造历史端点。 */
export class RefreshObservationRecorder {
  constructor(
    private readonly sources: AssetSources,
    private readonly dailySnapshots: DailyAssetSnapshots,
    private readonly isRefreshable: (source: AssetSourceSummary) => boolean,
  ) {}

  async record(
    sources: AssetSourceSummary[],
    outcomes: SourceRefreshOutcome[],
    attemptedAt: string,
  ): Promise<void> {
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
}
