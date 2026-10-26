import type { DailyAssetSourceSnapshot, ImportedAssetSourceHistoryObservation, AssetTrendClass, DailyAssetClassTotal, DailyAssetBaseline, DailyAssetTrendObservation, DailyAssetSnapshot } from "@/domain/asset-history";
export type { DailyAssetSourceSnapshot, ImportedAssetSourceHistoryObservation, AssetTrendClass, DailyAssetClassTotal, DailyAssetBaseline, DailyAssetTrendObservation, DailyAssetSnapshot } from "@/domain/asset-history";

export interface DailyAssetSnapshots {
  /** 日初基准，保留用于历史兼容。 */
  list(): Promise<DailyAssetBaseline[]>;
  /** 每日趋势观测，仅用于历史趋势。 */
  listTrendObservations(): Promise<DailyAssetTrendObservation[]>;
  /**
   * 外部补录的单一来源历史，仅用于来源详情和收益分析的「来源历史」。
   * 它不能作为组合或分类趋势的完整观测。
   */
  listImportedSourceHistoryObservations(): Promise<
    ImportedAssetSourceHistoryObservation[]
  >;
  createIfAbsent(snapshot: DailyAssetSnapshot): Promise<boolean>;
  /**
   * 全量批次有可用数据时调用：完整观测可建立日初基准；
   * 非完整状态的观测仅更新当天趋势兜底。
   */
  record(
    snapshot: DailyAssetTrendObservation,
    createBaseline: boolean,
  ): Promise<void>;
}
