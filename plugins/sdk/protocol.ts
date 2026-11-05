import type { AssetSourceKind } from "@/domain/asset-source-kinds";
import type { InvestmentBookId } from "@/domain/investment-books";
import type { AssetPermission, AssetSnapshot } from "@/domain/assets";
import type { AssetSourceSummary } from "@/domain/asset-sources";
import type { AssetRefreshMode } from "@/domain/asset-sync";

import type { AssetSourcePluginDescription } from "@/domain/asset-source-plugin-description";

export const ASSET_SOURCE_PLUGIN_PROTOCOL_VERSION = 1;
export type AssetSourcePluginId = Exclude<AssetSourceKind, "manual">;
export type AssetSourcePluginCapability = "assets.read" | "authorization.preview" | "authorization.revalidate" | "extension.call";

export interface AssetSourcePluginManifest {
  /** 直接用作来源 kind；内置平台保留原 ID，外部插件使用 plugin: ID。 */
  id: AssetSourcePluginId;
  version: string;
  protocolVersion: typeof ASSET_SOURCE_PLUGIN_PROTOCOL_VERSION;
  capabilities: readonly AssetSourcePluginCapability[];
  description?: AssetSourcePluginDescription;
  metadata?: { summary: string; publisher: string; homepage?: string; license?: string };
  configuration?: readonly ("coingecko.apiKey" | "rpc.ethereum" | "rpc.bsc")[];
}

/** 可以序列化的读取参数，不授予业务数据库、租约或账本写入能力。 */
export interface AssetSourcePluginReadRequest {
  source: AssetSourceSummary;
  credentials: string;
  mode: AssetRefreshMode;
  attemptedAt: string;
}

export interface AssetSourcePluginAuthorization {
  credentials: string;
  account: { id: string; label: string };
  permissions: AssetPermission[];
  snapshot: AssetSnapshot;
  scopeFingerprint?: string;
  accountMode?: "classic" | "uta";
  /** 由主程序确认并保存，后续读取不得改变既有账本归属。 */
  investmentBookId: InvestmentBookId | null;
}

/** 本机运行上下文；不属于传输报文。凭证更新仍经过核心租约检查。 */
export interface AssetSourcePluginContext {
  signal: AbortSignal;
  persistCredentials(credentials: string): Promise<void>;
}

export interface AssetSourcePlugin {
  manifest: AssetSourcePluginManifest;
  call?(method: string, params: unknown, context: AssetSourcePluginContext & { notify(event: unknown): void }): Promise<unknown>;
  available?(): boolean;
  read(request: AssetSourcePluginReadRequest, context: AssetSourcePluginContext): Promise<{ snapshot: AssetSnapshot }>;
  authorize?(input: Record<string, unknown>, observedAt: string, context: AssetSourcePluginContext): Promise<AssetSourcePluginAuthorization>;
  revalidate?(authorization: AssetSourcePluginAuthorization, observedAt: string, context: AssetSourcePluginContext): Promise<AssetSourcePluginAuthorization>;
}
