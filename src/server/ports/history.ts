import type { AssetExchangeRate } from "./assets";

export interface DailyAssetSourceSnapshot {
  sourceId: string;
  label: string;
  kind: string;
  capturedAt: string;
  complete: boolean;
  /** 旧记录可能缺省；读取时按 complete 安全回退。 */
  status?: "complete" | "incomplete" | "expired";
  /** 旧记录可缺少 HKD；新观测始终写入三种计价货币。 */
  total: Record<"USD" | "CNY", string | null> & {
    HKD?: string | null;
  };
  /**
   * 按资产来源类别分配的趋势金额；历史来源总额按同一规则回填，
   * 不代表其中每项持仓均有独立历史。
   */
  assetClassTotals?: Record<AssetTrendClass, DailyAssetClassTotal>;
}

/**
 * 从外部系统补录的单一来源历史金额。它只用于该来源自己的历史展示，
 * 不代表完整组合或分类观察，因此不会写入每日趋势观测。
 */
export interface ImportedAssetSourceHistoryObservation {
  day: string;
  sourceId: string;
  label: string;
  kind: string;
  capturedAt: string;
  complete: boolean;
  status?: "complete" | "incomplete" | "expired";
  total: Record<"USD" | "CNY", string | null> & {
    HKD?: string | null;
  };
}

export type AssetTrendClass = "securities" | "crypto";

export interface DailyAssetClassTotal {
  complete: boolean;
  status?: "complete" | "incomplete" | "expired";
  total: Record<"USD" | "CNY", string | null> & {
    HKD?: string | null;
  };
}

interface DailyAssetObservation {
  day: string;
  capturedAt: string;
  /** 用于本次三币种折算的原始汇率观察；旧记录可缺省。 */
  exchangeRates?: AssetExchangeRate[];
  /** 观测时应覆盖的来源；旧记录缺省时不能仅凭已出现的分量认定完整。 */
  sourceScope?: string[];
  complete: boolean;
  /** 旧记录可能缺省；读取时按 complete 安全回退。 */
  status?: "complete" | "incomplete" | "expired";
  /** 旧记录可缺少 HKD；新观测始终写入三种计价货币。 */
  total: Record<"USD" | "CNY", string | null> & {
    HKD?: string | null;
  };
  sources: DailyAssetSourceSnapshot[];
}

/** Asia/Shanghai 自然日内首次成功同步形成的不可改写基准。 */
export interface DailyAssetBaseline extends DailyAssetObservation {}

/** 每个上海自然日的最佳已有资产价值观测；同日成功刷新可以更新。 */
export interface DailyAssetTrendObservation extends DailyAssetObservation {}

/** 旧接口名称只指日初基准，避免调用方混用两类每日记录。 */
export type DailyAssetSnapshot = DailyAssetBaseline;

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
