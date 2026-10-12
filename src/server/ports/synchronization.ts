import type { AssetSnapshot } from "./assets";
import type { AssetSourceSummary } from "./sources";

export interface AssetSourceSyncState {
  status: "current" | "expired";
  lastSuccessfulAt: string;
  lastAttemptAt: string;
  error: string | null;
  /** 仅保存白名单字段；旧数据缺省，不持久化原始异常或请求 URL。 */
  diagnostic?: AssetSyncDiagnostic | null;
  /** 最近 10 次实际尝试（含批次内重试），按发生顺序排列。 */
  recentAttempts?: AssetSyncAttempt[];
  /** 可选以兼容旧快照；用于防止价格成功掩盖余额同步失败。 */
  failedMode?: AssetRefreshMode | null;
}

export interface AssetSyncDiagnostic {
  stage: "credentials" | "request" | "response" | "refresh" | "persist";
  category: "network" | "timeout" | "rate-limit" | "server" | "authentication" |
    "permission" | "restricted" | "cancelled" | "invalid-response" | "unknown";
  httpStatus: number | null;
  code: string | null;
  durationMs: number;
  retryable: boolean;
}

export interface AssetSyncAttempt {
  attemptedAt: string;
  mode: AssetRefreshMode;
  attempt: number;
  outcome: "success" | "failure";
  durationMs: number;
  diagnostic: AssetSyncDiagnostic | null;
}

export type AssetRefreshMode = "all" | "prices" | "holdings";

export type AssetRefreshScope = "all" | "evm" | "non-evm";

export interface AssetRefreshReport {
  successCount: number;
  failureCount: number;
  /** 因断开、删除或连接版本变化而安全丢弃的旧读取结果。 */
  supersededCount?: number;
  /** 自动意图因周期、在途批次或没有可刷新来源而未发起批次。 */
  skipped?: "not-due" | "in-progress" | "no-sources";
  /** 当前全量周期锚点；实际批次或 not-due/in-progress 跳过均可返回。 */
  attemptedAt?: string;
}

export type AssetRefreshIntent =
  | { reason: "manual-global" }
  | { reason: "manual-source"; sourceId: string }
  | { reason: "page-entry" | "foreground" | "interval" };

export interface AssetRefreshRequest {
  intent: AssetRefreshIntent;
  /** 协调器合并的单来源目标；只允许与 manual-source 意图搭配。 */
  sourceIds?: string[];
}

export interface AssetSynchronization {
  /** 统一刷新入口；自动意图由服务端再次判断周期并防重复。 */
  request(input: AssetRefreshRequest): Promise<AssetRefreshReport>;
  /** 兼容既有来源定向与 prices/holdings 调用；统一协调器不使用它。 */
  refresh(
    mode: AssetRefreshMode,
    scope?: AssetRefreshScope,
    sourceId?: string,
  ): Promise<AssetRefreshReport>;
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
