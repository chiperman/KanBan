import type {
  AvailablePluginStatus,
  GitHubPluginCatalog,
  PluginCatalogStatus,
  PluginManagementAction,
  PluginManagementStatus,
} from "@/domain/plugin-management";
import {
  lockOnUnauthorizedResponse,
  OWNER_SESSION_EXPIRED_MESSAGE,
  readJsonResult,
} from "@/ui/owner-request-lock";

export type ImportInfo = {
  id: string;
  label: string;
  version: string;
  publisher: string;
  summary: string;
  sha256: string;
};
export type Confirmation =
  | {
      action: PluginManagementAction;
      id: string;
      label: string;
      version?: string;
      repository?: string;
      sha256?: string;
    }
  | { action: "import"; file: File; info: ImportInfo };
export type GitHubPluginCommand = {
  action: "github-install";
  source: string;
  id: string;
  version: string;
  repository: string;
  sha256: string;
};
export type PluginCommand = Confirmation | GitHubPluginCommand;
export type PluginCommandFailure = {
  outcome: "rejected" | "unconfirmed";
  message: string;
};
type PluginCommandResult =
  | { outcome: "confirmed"; status: PluginManagementStatus }
  | PluginCommandFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPluginVersion(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(value);
}

function isAvailablePlugin(value: unknown): value is AvailablePluginStatus {
  return (
    isRecord(value) &&
    ["id", "label", "summary", "publisher"].every((key) => typeof value[key] === "string") &&
    (value.version === null || isPluginVersion(value.version)) &&
    typeof value.assetSource === "boolean" &&
    ["homepage", "repository", "sha256"].every(
      (key) => value[key] === undefined || typeof value[key] === "string",
    )
  );
}

function isManagementStatus(value: unknown): value is PluginManagementStatus {
  return (
    isRecord(value) &&
    !("error" in value) &&
    typeof value.repository === "string" &&
    Array.isArray(value.installed) &&
    value.installed.every(
      (plugin: unknown) =>
        isAvailablePlugin(plugin) &&
        isRecord(plugin) &&
        typeof plugin.version === "string" &&
        typeof plugin.enabled === "boolean" &&
        typeof plugin.healthy === "boolean" &&
        (plugin.source === undefined || plugin.source === "github") &&
        Array.isArray(plugin.retainedVersions) &&
        plugin.retainedVersions.every(isPluginVersion),
    )
  );
}

function reflectsCommand(status: PluginManagementStatus, command: PluginCommand): boolean {
  const id = command.action === "import" ? command.info.id : command.id;
  const installed = status.installed.find((plugin) => plugin.id === id);
  if (command.action === "uninstall") return installed === undefined;
  if (!installed) return false;
  if (command.action === "enable") return installed.enabled;
  if (command.action === "disable") return !installed.enabled;
  const version = command.action === "import" ? command.info.version : command.version;
  return version === undefined || installed.version === version;
}

export async function requestPluginCommand(
  command: PluginCommand,
  cancellation: AbortSignal,
): Promise<PluginCommandResult> {
  const signal = AbortSignal.any([cancellation, AbortSignal.timeout(120_000)]);
  const unconfirmed = {
    outcome: "unconfirmed",
    message: "尚未确认插件操作是否完成，服务端可能仍在处理。请先在新标签页核对插件版本与启用状态；确认未执行且处理已结束后，再重新操作。",
  } as const;
  try {
    let url = "/api/plugins";
    let init: RequestInit;
    if (command.action === "import") {
      url += "/import";
      const body = new FormData();
      body.set("file", command.file);
      body.set("action", "install");
      body.set("trusted", "true");
      body.set("sha256", command.info.sha256);
      init = { body };
    } else {
      const { action, ...details } = command;
      if (action === "github-install") url += "/github";
      init = {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...details, action: action === "github-install" ? "install" : action }),
      };
    }
    const response = await fetch(url, { ...init, method: "POST", signal });
    if (lockOnUnauthorizedResponse(response)) {
      return { outcome: "rejected", message: OWNER_SESSION_EXPIRED_MESSAGE };
    }
    if (response.status >= 500) return unconfirmed;
    const body = await readJsonResult<unknown>(response);
    signal.throwIfAborted();
    if (response.status >= 400 && response.status < 500) {
      const error = isRecord(body) && typeof body.error === "string" ? body.error.trim() : "";
      return { outcome: "rejected", message: error || "插件操作被拒绝，请核对后重试。" };
    }
    if (!response.ok || !isManagementStatus(body) || !reflectsCommand(body, command)) {
      return unconfirmed;
    }
    return { outcome: "confirmed", status: body };
  } catch {
    return unconfirmed;
  }
}

function isCatalog(value: unknown): value is PluginCatalogStatus {
  return (
    isRecord(value) &&
    (value.release === null || typeof value.release === "string") &&
    (value.notice === undefined || typeof value.notice === "string") &&
    Array.isArray(value.plugins) &&
    value.plugins.every(isAvailablePlugin)
  );
}

function isGitHubCatalog(value: unknown): value is GitHubPluginCatalog {
  return (
    isRecord(value) &&
    typeof value.repository === "string" &&
    typeof value.release === "string" &&
    Array.isArray(value.plugins) &&
    value.plugins.length > 0 &&
    value.plugins.every(
      (plugin) =>
        isAvailablePlugin(plugin) &&
        typeof plugin.version === "string" &&
        typeof plugin.sha256 === "string" &&
        /^[a-f0-9]{64}$/.test(plugin.sha256),
    )
  );
}

function isImportInfo(value: unknown): value is ImportInfo {
  return (
    isRecord(value) &&
    ["id", "label", "version", "publisher", "summary", "sha256"].every(
      (key) => typeof value[key] === "string",
    ) &&
    isPluginVersion(value.version) &&
    typeof value.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(value.sha256)
  );
}

async function readPluginData<T>(
  url: string,
  {
    accepts,
    failureMessage,
    timeoutMs = 30_000,
    signal: cancellation,
    ...init
  }: RequestInit & {
    accepts(value: unknown): value is T;
    failureMessage: string;
    timeoutMs?: number;
    signal: AbortSignal;
  },
): Promise<T> {
  const signal = AbortSignal.any([cancellation, AbortSignal.timeout(timeoutMs)]);
  try {
    const response = await fetch(url, { ...init, cache: "no-store", signal });
    if (lockOnUnauthorizedResponse(response)) throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
    const body = await readJsonResult<unknown>(response);
    signal.throwIfAborted();
    const serverError =
      isRecord(body) && typeof body.error === "string" ? body.error.trim() : "";
    if (!response.ok || serverError || !accepts(body))
      throw new Error(serverError || failureMessage);
    return body;
  } catch (caught) {
    if (cancellation.aborted) throw cancellation.reason;
    if (signal.aborted) throw new Error("读取插件信息超时，请重试");
    if (caught instanceof TypeError) throw new Error("网络连接异常，请检查网络后重试");
    throw caught;
  }
}

export function requestPluginCatalog(refresh: boolean, signal: AbortSignal) {
  return readPluginData(`/api/plugins?catalog=1${refresh ? "&refresh=1" : ""}`, {
    signal,
    timeoutMs: 45_000,
    accepts: isCatalog,
    failureMessage: "无法读取插件目录，请重试",
  });
}

export function inspectGitHubPlugins(source: string, signal: AbortSignal) {
  return readPluginData("/api/plugins/github", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "inspect", source }),
    signal,
    accepts: isGitHubCatalog,
    failureMessage: "无法查看插件，请检查仓库地址后重试",
  });
}

export function inspectImportedPlugin(file: File, signal: AbortSignal) {
  const body = new FormData();
  body.set("file", file);
  body.set("action", "inspect");
  return readPluginData("/api/plugins/import", {
    method: "POST",
    body,
    signal,
    accepts: isImportInfo,
    failureMessage: "无法读取插件包，请检查文件后重试",
  });
}
