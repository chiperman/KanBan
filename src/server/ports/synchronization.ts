import type { AssetSnapshot } from "./assets";
import type { AssetSourceSummary } from "./sources";
import type {
  AssetRefreshMode,
  AssetRefreshReport,
  AssetRefreshRequest,
} from "./source-sync-state";

export type {
  AssetRefreshIntent,
  AssetRefreshMode,
  AssetRefreshReport,
  AssetRefreshRequest,
  AssetRefreshScope,
  AssetSourceSyncState,
  AssetSyncAttempt,
  AssetSyncDiagnostic,
} from "./source-sync-state";

export interface AssetSynchronization {
  /** 统一刷新入口；自动意图由服务端再次判断周期并防重复。 */
  request(input: AssetRefreshRequest): Promise<AssetRefreshReport>;
}

/** 统一全量刷新周期；仅记录最近一次尝试与异常中断诊断。 */
export interface AssetFullRefreshState {
  read(): Promise<{
    attemptedAt: string | null;
    inProgressAt: string | null;
  }>;
  /**
   * 首个自动来源连接成功时仅在周期尚不存在时建立锚点，不表示存在全量批次。
   * 返回值表示本次是否实际建立了锚点，且不得清除已有中断诊断。
   */
  initialize(attemptedAt: string): Promise<boolean>;
  /**
   * 在来源读取前原子判断统一周期并预占完整批次。手动全量可绕过周期，
   * 但不得绕过仍未失效的在途批次；异常中断诊断失效后可重新建立批次。
   */
  claim(input: {
    attemptedAt: string;
    intervalMs: number;
    staleAfterMs: number;
    force: boolean;
  }): Promise<"claimed" | "not-due" | "in-progress">;
  start(attemptedAt: string): Promise<void>;
  /** 仅清除本批次自己的进行中标记，避免旧批次覆盖后续预占。 */
  finish(attemptedAt?: string): Promise<void>;
  /** 最后一个可刷新自动来源消失后清除已无业务含义的周期。 */
  clear(): Promise<void>;
}

export interface AssetSourceRefreshResult {
  snapshot: AssetSnapshot;
}

/** 外部来源读取的可替换 seam；凭证持久化只能由协调器的回调完成。 */
export interface AssetSourceRefresher {
  refresh(input: {
    source: AssetSourceSummary;
    credentials: string;
    mode: AssetRefreshMode;
    attemptedAt: string;
    signal: AbortSignal;
    persistCredentials(credentials: string): Promise<void>;
  }): Promise<AssetSourceRefreshResult>;
}
