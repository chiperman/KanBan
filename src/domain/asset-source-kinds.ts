/** 保留既有来源身份；新来源使用稳定的 plugin: 命名空间。 */
export type BuiltinAssetSourceKind =
  | "longbridge"
  | "binance"
  | "okx"
  | "bitget"
  | "bit"
  | "evm-watch-ethereum"
  | "evm-watch-bsc"
  | "manual";

export type AssetSourceKind = BuiltinAssetSourceKind | `plugin:${string}`;

export interface AssetSourceKindMetadata {
  code: string;
  isManual: boolean;
  supportsEvmTokenPreferences: boolean;
  supportsProductCoverage: boolean;
  supportsSmallHoldingFilter: boolean;
  title: string;
}

const SOURCE_KIND_METADATA: Record<BuiltinAssetSourceKind, AssetSourceKindMetadata> = {
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

export function isAssetSourceKind(kind: unknown): kind is BuiltinAssetSourceKind {
  return typeof kind === "string" && Object.hasOwn(SOURCE_KIND_METADATA, kind);
}

/** 数据身份校验不依赖插件是否安装；不接受路径、原型属性或任意未知平台名。 */
export function isPersistedAssetSourceKind(kind: unknown): kind is AssetSourceKind {
  return isAssetSourceKind(kind) || (typeof kind === "string" && kind.length <= 128 &&
    /^plugin:[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(kind));
}

export function isEvmWatchSourceKind(kind: string): boolean {
  return kind === "evm-watch-ethereum" || kind === "evm-watch-bsc";
}
