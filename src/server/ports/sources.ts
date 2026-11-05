import type { EvmChain, BitgetAccountMode, OkxRegion } from "@/domain/asset-source-providers";
import type { ExternalServiceConfigurationReader } from "../../../plugins/sdk/host-capabilities";
export type { EvmChain, BitgetAccountMode, OkxRegion } from "@/domain/asset-source-providers";
import type { AssetSourceSummary } from "@/domain/asset-sources";
export type { AssetSourceSummary } from "@/domain/asset-sources";
import type { ManualAssetRecord, ManualAssetRecordInput, CreateManualAssetSourceInput } from "@/domain/manual-asset-records";
export type { ManualAssetRecord, ManualAssetRecordInput, CreateManualAssetSourceInput } from "@/domain/manual-asset-records";
import type { AssetSourceKind } from "../../domain/asset-source-kinds";
import type {
  AssetPermission,
  AssetSnapshot,
  ManualAssetClass,
} from "./assets";
import type { AssetSourceSyncState } from "./source-sync-state";

export type { AssetSourceKind } from "../../domain/asset-source-kinds";

export interface LongbridgeAuthorizationResult {
  credentials: string;
  permissions: AssetPermission[];
  account: { id: string; label: string };
  snapshot: AssetSnapshot;
}

export interface BinanceAuthorizationResult {
  credentials: string;
  permissions: AssetPermission[];
  account: { id: string; label: string };
  snapshot: AssetSnapshot;
}

export interface OkxAuthorizationResult {
  credentials: string;
  permissions: AssetPermission[];
  account: { id: string; label: string };
  scopeFingerprint: string;
  snapshot: AssetSnapshot;
}

export interface BitgetAuthorizationResult {
  credentials: string;
  accountMode: BitgetAccountMode;
  permissions: AssetPermission[];
  account: { id: string; label: string };
  scopeFingerprint: string;
  snapshot: AssetSnapshot;
}

export interface BitAuthorizationResult {
  credentials: string;
  permissions: AssetPermission[];
  account: { id: string; label: string };
  snapshot: AssetSnapshot;
}


export interface ExternalServiceConnectionStatus {
  configured: boolean;
  verifiedAt: string | null;
}

/** 仅返回配置状态；密钥与 RPC URL 本文永不返回浏览器。 */
export interface ExternalServiceConfigurationStatus {
  coinGecko: ExternalServiceConnectionStatus;
  ethereumRpc: ExternalServiceConnectionStatus;
  bscRpc: ExternalServiceConnectionStatus;
}

export interface ExternalServiceConfigurationInput {
  coinGeckoDemoApiKey?: string;
  ethereumRpcUrl?: string;
  bscRpcUrl?: string;
}

/**
 * 全局行情与链节点配置。
 * 外部服务凭证只进入 SecretStore，资产来源仅关联使用结果。
 */
export interface ExternalServiceConfiguration extends ExternalServiceConfigurationReader {
  status(): Promise<ExternalServiceConfigurationStatus>;
  saveAndVerify(
    input: ExternalServiceConfigurationInput,
  ): Promise<ExternalServiceConfigurationStatus>;
}

export interface EvmWatchAuthorizationResult {
  credentials: string;
  chain: EvmChain;
  permissions: AssetPermission[];
  account: { id: string; label: string };
  snapshot: AssetSnapshot;
}



export interface BinanceReadOnly {
  preview(input: {
    apiKey: string;
    apiSecret: string;
    observedAt: string;
  }): Promise<BinanceAuthorizationResult>;
  revalidate(input: {
    credentials: string;
    observedAt: string;
  }): Promise<BinanceAuthorizationResult>;
}

export interface OkxReadOnly {
  preview(input: {
    apiKey: string;
    apiSecret: string;
    passphrase: string;
    region?: OkxRegion;
    observedAt: string;
  }): Promise<OkxAuthorizationResult>;
  revalidate(input: {
    credentials: string;
    observedAt: string;
  }): Promise<OkxAuthorizationResult>;
}

export interface BitgetReadOnly {
  preview(input: {
    apiKey: string;
    apiSecret: string;
    passphrase: string;
    accountMode: BitgetAccountMode;
    observedAt: string;
  }): Promise<BitgetAuthorizationResult>;
  revalidate(input: {
    credentials: string;
    observedAt: string;
  }): Promise<BitgetAuthorizationResult>;
}

/** BIT / Matrixport 钱包与理财产品只读访问。 */
export interface BitReadOnly {
  preview(input: {
    apiKey: string;
    apiSecret: string;
    userId: string;
    observedAt: string;
  }): Promise<BitAuthorizationResult>;
  revalidate(input: {
    credentials: string;
    observedAt: string;
  }): Promise<BitAuthorizationResult>;
}

export interface EvmWatchWalletReadOnly {
  preview(input: {
    chain: EvmChain;
    addresses: string[];
    observedAt: string;
  }): Promise<EvmWatchAuthorizationResult>;
  revalidate(input: {
    credentials: string;
    observedAt: string;
  }): Promise<EvmWatchAuthorizationResult>;
}

export interface LongbridgeOAuth {
  start(redirectUri: string): Promise<{
    authorizationUrl: string;
    state: string;
    codeVerifier: string;
  }>;
  finish(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<LongbridgeAuthorizationResult>;
  revalidate(input: {
    credentials: string;
    observedAt: string;
  }): Promise<LongbridgeAuthorizationResult>;
}

export interface AssetSourceConnections {
  connectLongbridge(result: LongbridgeAuthorizationResult): Promise<void>;
  reconnectLongbridge(
    sourceId: string,
    result: LongbridgeAuthorizationResult,
  ): Promise<void>;
  connectBinance(result: BinanceAuthorizationResult): Promise<void>;
  connectOkx(result: OkxAuthorizationResult): Promise<void>;
  connectBitget(result: BitgetAuthorizationResult): Promise<void>;
  connectBit(result: BitAuthorizationResult): Promise<void>;
  connectEvm(result: EvmWatchAuthorizationResult): Promise<void>;
  reconnectEvm(
    sourceId: string,
    result: EvmWatchAuthorizationResult,
  ): Promise<void>;
}

/**
 * 所有者创建无法接入的资产来源，并维护各自的每日总额记录；
 * 每个来源在一个上海自然日只有一条记录。
 */
export interface ManualAssetRecords {
  create(input: CreateManualAssetSourceInput): Promise<void>;
  list(): Promise<ManualAssetRecord[]>;
  record(sourceId: string, input: ManualAssetRecordInput): Promise<void>;
  delete(sourceId: string, day: string): Promise<void>;
}

/** 外部资产来源仅保存服务端凭证引用；凭证正文只能进入 SecretStore。 */
export interface AssetSources {
  list(): Promise<AssetSourceSummary[]>;
  replaceAll(sources: AssetSourceSummary[]): Promise<void>;
  update(source: AssetSourceSummary): Promise<void>;
  /** 生产持久化提供跨进程租约及快照/每日观测的原子提交。 */
  refreshGuard?: AssetSourceRefreshGuard;
}

export interface SourceRefreshLease {
  sourceId: string;
  token: string;
  now: string;
}

export interface AssetSourceRefreshGuard {
  claim(input: SourceRefreshLease & { leaseMs: number }): Promise<boolean>;
  owns(input: SourceRefreshLease): Promise<boolean>;
  commit(input: SourceRefreshLease & {
    source: AssetSourceSummary;
    recordObservation: boolean;
  }): Promise<boolean>;
  release(input: SourceRefreshLease): Promise<void>;
}

export interface AssetSourceLifecycle {
  setHidden(sourceId: string, hidden: boolean): Promise<void>;
  setDisplayName(sourceId: string, displayName: string): Promise<void>;
  setManualAssetClass(
    sourceId: string,
    assetClass: ManualAssetClass | null,
  ): Promise<void>;
  setEvmTokenPreference(
    sourceId: string,
    assetKeys: string[],
    status: "included" | "ignored" | "unrecognized",
  ): Promise<void>;
  disconnect(sourceId: string): Promise<void>;
  restore(sourceId: string): Promise<void>;
  deleteData(sourceId: string): Promise<void>;
}
