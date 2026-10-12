/** 生产环境支持的资产来源类型。测试夹具可以继续使用未知 kind。 */
export type AssetSourceKind =
  | "longbridge"
  | "binance"
  | "okx"
  | "bitget"
  | "bit"
  | "evm-watch-ethereum"
  | "evm-watch-bsc"
  | "manual";

export interface AssetSourceKindMetadata {
  code: string;
  isManual: boolean;
  supportsEvmTokenPreferences: boolean;
  supportsProductCoverage: boolean;
  supportsSmallHoldingFilter: boolean;
  title: string;
}

const SOURCE_KIND_METADATA: Record<AssetSourceKind, AssetSourceKindMetadata> = {
  longbridge: {
    code: "LB",
    isManual: false,
    supportsEvmTokenPreferences: false,
    supportsProductCoverage: false,
    supportsSmallHoldingFilter: false,
    title: "长桥资产",
  },
  binance: {
    code: "BN",
    isManual: false,
    supportsEvmTokenPreferences: false,
    supportsProductCoverage: true,
    supportsSmallHoldingFilter: true,
    title: "Binance 资产",
  },
  okx: {
    code: "OKX",
    isManual: false,
    supportsEvmTokenPreferences: false,
    supportsProductCoverage: true,
    supportsSmallHoldingFilter: true,
    title: "OKX 资产",
  },
  bitget: {
    code: "BG",
    isManual: false,
    supportsEvmTokenPreferences: false,
    supportsProductCoverage: true,
    supportsSmallHoldingFilter: true,
    title: "Bitget 资产",
  },
  bit: {
    code: "BIT",
    isManual: false,
    supportsEvmTokenPreferences: false,
    supportsProductCoverage: true,
    supportsSmallHoldingFilter: true,
    title: "BIT / Matrixport 资产",
  },
  "evm-watch-ethereum": {
    code: "ETH",
    isManual: false,
    supportsEvmTokenPreferences: true,
    supportsProductCoverage: true,
    supportsSmallHoldingFilter: true,
    title: "Ethereum 观察钱包",
  },
  "evm-watch-bsc": {
    code: "BSC",
    isManual: false,
    supportsEvmTokenPreferences: true,
    supportsProductCoverage: true,
    supportsSmallHoldingFilter: true,
    title: "BNB Smart Chain 观察钱包",
  },
  manual: {
    code: "MANUAL",
    isManual: true,
    supportsEvmTokenPreferences: false,
    supportsProductCoverage: false,
    supportsSmallHoldingFilter: false,
    title: "手工资产记录",
  },
};

export function assetSourceKindMetadata(
  kind: string,
): AssetSourceKindMetadata | null {
  return isAssetSourceKind(kind) ? SOURCE_KIND_METADATA[kind] : null;
}

export function isAssetSourceKind(kind: string): kind is AssetSourceKind {
  return Object.hasOwn(SOURCE_KIND_METADATA, kind);
}

export function isEvmWatchSourceKind(kind: string): boolean {
  return kind === "evm-watch-ethereum" || kind === "evm-watch-bsc";
}
