import { isPersistedAssetSourceKind } from "@/domain/asset-source-kinds";
import type { AssetSourceProviderId } from "@/domain/asset-source-providers";
export function externalPluginProvider(id: string): AssetSourceProviderId | null {
 return sourceAuthorizationProvider(id);
}
export function sourceAuthorizationProvider(kind: string): AssetSourceProviderId | null {
 if (kind === "evm-watch-ethereum") return "ethereum";
 if (kind === "evm-watch-bsc") return "bsc";
 return isPersistedAssetSourceKind(kind) && kind !== "manual" ? kind as AssetSourceProviderId : null;
}
