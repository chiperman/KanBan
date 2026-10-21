import type { AssetSourceKind } from "../../domain/asset-source-kinds";
import type {
  AssetPermission,
  AssetSnapshot,
  ManualAssetClass,
} from "./assets";
import type { AssetSourceSyncState } from "./source-sync-state";

export type { AssetSourceKind } from "../../domain/asset-source-kinds";

/** 外部资产来源的持久化摘要；凭证正文永不进入这个接口。 */
export interface AssetSourceSummary {
  id: string;
  kind: AssetSourceKind;
  label: string;
  /** 所有者设置的可选展示名；缺省时使用平台默认名称。 */
  displayName?: string;
  accountId: string;
  permissions: AssetPermission[];
  /** 断开来源可不再持有任何凭证引用；连接来源必须为非空引用。 */
  credentialReference: string | null;
  snapshot: AssetSnapshot;
  sync: AssetSourceSyncState;
  /** 所有者按 EVM chain ID + 原生币或合约资产标识明确忽略的来源资产。 */
  ignoredAssetKeys?: string[];
  /** 所有者确认属于投资资产、即使暂时缺价也应正常展示的 EVM 资产标识。 */
  includedAssetKeys?: string[];
  /** 手工来源创建后尚未添加首条数据时为 false；不得将占位快照计入资产。 */
  hasManualRecord?: boolean;
  /** 手工来源在资产类别分布中的归类；旧数据缺省为待分类。 */
  manualAssetClass?: ManualAssetClass;
  /** 旧数据缺省为 connected；断开后仅保留历史身份与快照。 */
  lifecycle?: "connected" | "disconnected";
}

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

export type EvmChain = "ethereum" | "bsc";

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
export interface ExternalServiceConfiguration {
  status(): Promise<ExternalServiceConfigurationStatus>;
  saveAndVerify(
    input: ExternalServiceConfigurationInput,
  ): Promise<ExternalServiceConfigurationStatus>;
  coinGeckoDemoApiKey(): Promise<string | null>;
  rpcUrl(chain: EvmChain): Promise<string | null>;
}

export interface EvmWatchAuthorizationResult {
  credentials: string;
  chain: EvmChain;
  permissions: AssetPermission[];
  account: { id: string; label: string };
  snapshot: AssetSnapshot;
}

export type BitgetAccountMode = "classic" | "uta";

export type OkxRegion = "global" | "us" | "eea";

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

export interface ManualAssetRecordInput {
  /** 按 Asia/Shanghai 解释的自然日，格式 YYYY-MM-DD。 */
  day: string;
  amount: string;
  currency: "USD" | "CNY" | "HKD";
}

export interface ManualAssetRecord extends ManualAssetRecordInput {
  sourceId: string;
  /** 本次新增或编辑的实际保存时间。 */
  recordedAt: string;
}

export interface CreateManualAssetSourceInput {
  label: string;
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
