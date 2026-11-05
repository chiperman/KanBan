import { AsyncLocalStorage } from "node:async_hooks";
import type { AssetSyncAttempt, AssetSyncDiagnostic, AssetSourceSyncState } from "@/domain/asset-sync";

export const ASSET_SYNC_ATTEMPT_LIMIT = 10;

/** Adapter 内已有的重试在统一预算内关闭，避免 3×3 放大请求。 */
const managedRetry = new AsyncLocalStorage<boolean>();
export const hasManagedAssetRetry = () => managedRetry.getStore() === true;
export function withManagedAssetRetry<T>(run: () => Promise<T>): Promise<T> {
  return managedRetry.run(true, run);
}

const NETWORK_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "EPIPE", "EAI_AGAIN", "ENETUNREACH",
  "EHOSTUNREACH", "ENOTFOUND", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET",
]);
const RETRYABLE_NETWORK_CODES = new Set([...NETWORK_CODES].filter((code) => code !== "ENOTFOUND"));
const RETRYABLE_HTTP = new Set([429, 500, 502, 503, 504]);
const DIAGNOSTIC_STAGES = new Set<AssetSyncDiagnostic["stage"]>(["credentials", "request", "response", "refresh", "persist"]);
const DIAGNOSTIC_CATEGORIES = new Set<AssetSyncDiagnostic["category"]>(["network", "timeout", "rate-limit", "server", "authentication", "permission", "restricted", "cancelled", "invalid-response", "plugin-unavailable", "unknown"]);
const READ_OPERATIONS: Record<string, string> = {
  initialize: "连接初始化", "trade.account_balance": "账户余额", "trade.stock_positions": "证券持仓",
  "trade.fund_positions": "基金持仓", "api.get": "账户数据", "quote.quote": "持仓行情",
};

/** 原始异常只在内存中传递；持久化时只取白名单字段。 */
export class AssetReadError extends Error {
  constructor(readonly transport: "cli" | "sdk", cause: unknown, readonly operation?: string) {
    super(cause instanceof Error ? cause.message : "资产读取失败", { cause });
  }
}

export class AssetRequestError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly code: unknown,
    readonly retryAfterMs: number | null,
    readonly stage: AssetSyncDiagnostic["stage"] = "response",
  ) { super(message); }
}

export class AssetSourcePluginExecutionError extends Error {
  constructor(readonly diagnostic: AssetSyncDiagnostic) { super(assetSyncErrorMessage(diagnostic)); }
}

/** 由主程序产生的固定错误，不接受插件或供应商原始文本。 */
export class AssetSourcePluginUnavailableError extends Error {
  constructor() { super("来源插件不可用，请安装或启用对应插件"); }
}

/** 仅暂存数值元数据，不携带 headers、正文、URL 或请求对象。 */
export function assetResponseError(
  message: string,
  response: Response,
  code?: unknown,
  stage: AssetSyncDiagnostic["stage"] = "response",
): AssetRequestError {
  return new AssetRequestError(message, response.status, safeCode(code),
    parseRetryAfter(response.headers.get("retry-after")), stage);
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (value === null || value.trim() === "") return null;
  if (/^\d+$/.test(value.trim())) {
    const delay = Number(value.trim()) * 1_000;
    return Number.isFinite(delay) ? delay : Number.MAX_SAFE_INTEGER;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function safeCode(value: unknown): string | null {
  const code = typeof value === "number" && Number.isSafeInteger(value)
    ? String(value) : typeof value === "string" ? value : "";
  return NETWORK_CODES.has(code) || /^-?\d{1,8}$/.test(code) ? code : null;
}

export function diagnoseAssetSyncError(
  error: unknown,
  stage: AssetSyncDiagnostic["stage"],
  durationMs: number,
): AssetSyncDiagnostic {
  if (error instanceof AssetSourcePluginExecutionError) return { ...error.diagnostic, durationMs: Math.max(0, Math.round(durationMs)) };
  if (error instanceof AggregateError && error.errors.length === 2 && error.errors.every(item => item instanceof AssetReadError)) {
    const primary = diagnoseAssetSyncError(error.errors[0], stage, durationMs);
    const fallback = diagnoseAssetSyncError(error.errors[1], stage, durationMs);
    return { ...primary, retryable: primary.retryable || fallback.retryable, fallback: failureDetail(fallback) };
  }
  let code: string | null = null;
  let httpStatus: number | null = null;
  let transport: AssetSyncDiagnostic["transport"];
  let operation: string | undefined;
  let name: unknown;
  let node: unknown = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 5 && node && typeof node === "object" && !seen.has(node); depth++) {
    seen.add(node);
    if (node instanceof AssetReadError) {
      transport ??= node.transport;
      if (node.operation && Object.hasOwn(READ_OPERATIONS, node.operation)) operation ??= node.operation;
    }
    const item = node as { code?: unknown; status?: unknown; statusCode?: unknown; name?: unknown; cause?: unknown };
    code ??= safeCode(item.code);
    const status = node instanceof AssetRequestError ? node.httpStatus : item.status ?? item.statusCode;
    if (httpStatus === null && typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) httpStatus = status;
    if (item.name === "AbortError" || item.name === "TimeoutError") name = item.name;
    node = item.cause;
  }
  if (error instanceof AssetRequestError) stage = error.stage;
  let category: AssetSyncDiagnostic["category"] = "unknown";
  let retryable = false;
  if (error instanceof AssetSourcePluginUnavailableError) category = "plugin-unavailable";
  else if (name === "AbortError") category = "cancelled";
  else if (httpStatus === 451) category = "restricted";
  else if (["-2014", "-2015", "-1022", "50103", "50104", "50105", "50111", "50113", "50114", "40006", "40009", "40012"].includes(code ?? "") || httpStatus === 401) category = "authentication";
  else if (httpStatus === 403) category = "permission";
  else if (httpStatus !== null && httpStatus >= 400) {
    category = httpStatus === 429 ? "rate-limit" : httpStatus >= 500 ? "server" : "invalid-response";
    retryable = RETRYABLE_HTTP.has(httpStatus);
  } else if (name === "TimeoutError") { category = "timeout"; retryable = true; }
  else if (code && NETWORK_CODES.has(code)) {
    if (stage === "refresh") stage = "request";
    category = code.includes("TIMEOUT") || code === "ETIMEDOUT" ? "timeout" : "network";
    retryable = RETRYABLE_NETWORK_CODES.has(code);
  } else if (stage === "credentials") category = "authentication";
  else if (transport === "cli" && code === "-32000") { category = "server"; retryable = true; }
  else if (transport === "cli" && ["-32700", "-32600", "-32601", "-32602"].includes(code ?? "")) category = "invalid-response";
  else if (isFetchNetworkTypeError(error)) { category = "network"; retryable = true; }
  else if (error instanceof SyntaxError || error instanceof AssetRequestError) category = "invalid-response";
  // OAuth/本地凭证或持久化操作不得通过重新执行整个来源盲重试。
  if (stage === "credentials" || stage === "persist") retryable = false;
  return { stage, category, httpStatus, code, durationMs: Math.max(0, Math.round(durationMs)), retryable,
    ...(transport ? { transport } : {}), ...(operation ? { operation } : {}) };
}

function failureDetail({ category, httpStatus, code, retryable, transport, operation }: AssetSyncDiagnostic): NonNullable<AssetSyncDiagnostic["fallback"]> {
  return { category, httpStatus, code, retryable, ...(transport ? { transport } : {}), ...(operation ? { operation } : {}) };
}

function isFetchNetworkTypeError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let node: unknown = error;
  for (let depth = 0; depth < 5 && node && typeof node === "object" && !seen.has(node); depth++) {
    seen.add(node);
    if (node instanceof TypeError && /fetch failed|failed to fetch|networkerror/i.test(node.message)) return true;
    node = (node as { cause?: unknown }).cause;
  }
  return false;
}

const MESSAGES: Record<AssetSyncDiagnostic["category"], string> = {
  network: "网络连接失败", timeout: "同步超时", "rate-limit": "来源请求被限流",
  server: "来源服务暂时不可用", authentication: "只读凭证不可用或认证失败",
  permission: "来源访问权限不足", restricted: "来源服务受地区或法律限制",
  cancelled: "同步已取消", "invalid-response": "来源响应无效", "plugin-unavailable": "来源插件不可用，请安装或启用对应插件", unknown: "资产来源同步失败",
};
export function assetSyncErrorMessage(diagnostic: AssetSyncDiagnostic): string {
  const detail = [diagnostic.httpStatus === null ? null : 'HTTP ' + diagnostic.httpStatus, diagnostic.code].filter(Boolean);
  const context = [diagnostic.transport?.toUpperCase(), diagnostic.operation ? READ_OPERATIONS[diagnostic.operation] : null].filter(Boolean);
  const message = (context.length ? context.join(" · ") + "：" : "") + MESSAGES[diagnostic.category] + (detail.length ? '（' + detail.join(' / ') + '）' : '');
  return message + (diagnostic.fallback ? "；" + assetSyncErrorMessage({ ...diagnostic.fallback, stage: "refresh", durationMs: 0 }) : "");
}

/** 从旧文件/数据库读取时重新按白名单组装，丢弃任意附加字段。 */
export function normalizeAssetSyncDiagnostic(value: unknown, includeFallback = true): AssetSyncDiagnostic | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (!DIAGNOSTIC_STAGES.has(item.stage as AssetSyncDiagnostic["stage"]) ||
      !DIAGNOSTIC_CATEGORIES.has(item.category as AssetSyncDiagnostic["category"]) ||
      (item.httpStatus !== null && (typeof item.httpStatus !== "number" || !Number.isInteger(item.httpStatus) || item.httpStatus < 100 || item.httpStatus > 599)) ||
      (item.code !== null && typeof item.code !== "string") ||
      typeof item.durationMs !== "number" || !Number.isFinite(item.durationMs) || item.durationMs < 0 ||
      typeof item.retryable !== "boolean") return null;
  const fallback = includeFallback && item.fallback && typeof item.fallback === "object"
    ? normalizeAssetSyncDiagnostic({ ...item.fallback, stage: "refresh", durationMs: 0 }, false) : null;
  return {
    stage: item.stage as AssetSyncDiagnostic["stage"],
    category: item.category as AssetSyncDiagnostic["category"],
    httpStatus: item.httpStatus as number | null,
    code: safeCode(item.code),
    durationMs: Math.round(item.durationMs),
    retryable: item.retryable,
    ...(item.transport === "cli" || item.transport === "sdk" ? { transport: item.transport } : {}),
    ...(typeof item.operation === "string" && Object.hasOwn(READ_OPERATIONS, item.operation) ? { operation: item.operation } : {}),
    ...(fallback ? { fallback: failureDetail(fallback) } : {}),
  };
}

export function normalizeAssetSyncAttempts(value: unknown): AssetSyncAttempt[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const diagnostic = row.diagnostic === null ? null : normalizeAssetSyncDiagnostic(row.diagnostic);
    if (typeof row.attemptedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.attemptedAt) || !Number.isFinite(Date.parse(row.attemptedAt)) ||
        !["all", "prices", "holdings"].includes(row.mode as string) ||
        typeof row.attempt !== "number" || !Number.isInteger(row.attempt) || row.attempt < 1 || row.attempt > 3 ||
        !["success", "failure"].includes(row.outcome as string) ||
        typeof row.durationMs !== "number" || !Number.isFinite(row.durationMs) || row.durationMs < 0 ||
        (row.diagnostic !== null && diagnostic === null)) return [];
    return [{ attemptedAt: row.attemptedAt, mode: row.mode as AssetSyncAttempt["mode"], attempt: row.attempt, outcome: row.outcome as AssetSyncAttempt["outcome"], durationMs: Math.round(row.durationMs), diagnostic }];
  }).slice(-ASSET_SYNC_ATTEMPT_LIMIT);
}

export function normalizeAssetSyncState(sync: AssetSourceSyncState): AssetSourceSyncState {
  const { diagnostic, recentAttempts } = sync;
  const normalized: AssetSourceSyncState = {
    status: sync.status,
    lastSuccessfulAt: sync.lastSuccessfulAt,
    lastAttemptAt: sync.lastAttemptAt,
    error: sync.error,
  };
  if (sync.failedMode !== undefined) normalized.failedMode = sync.failedMode;
  return {
    ...normalized,
    ...(diagnostic === undefined ? {} : { diagnostic: normalizeAssetSyncDiagnostic(diagnostic) }),
    ...(recentAttempts === undefined ? {} : { recentAttempts: normalizeAssetSyncAttempts(recentAttempts) }),
  };
}

export function abortableSyncOperation<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(run).then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

export function abortableSyncDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}
