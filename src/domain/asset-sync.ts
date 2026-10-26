/** 资产来源最近一次同步的可持久化状态。 */
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
    "permission" | "restricted" | "cancelled" | "invalid-response" | "plugin-unavailable" | "unknown";
  httpStatus: number | null;
  code: string | null;
  durationMs: number;
  retryable: boolean;
  transport?: "cli" | "sdk";
  operation?: string;
  /** 双通道均失败时保留备用通道的安全诊断。 */
  fallback?: Pick<AssetSyncDiagnostic, "category" | "httpStatus" | "code" | "retryable" | "transport" | "operation">;
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
  /** 本次实际执行的来源结果；不包含凭证、金额或持仓。旧调用可缺省。 */
  sourceResults?: {
    sourceId: string;
    outcome: "success" | "failure" | "superseded";
    sync?: Pick<AssetSourceSyncState, "status" | "lastSuccessfulAt" | "lastAttemptAt" | "error" | "diagnostic">;
  }[];
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
