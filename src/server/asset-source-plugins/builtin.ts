import type { BuiltinAssetSourceKind } from "@/domain/asset-source-kinds";
import type { AssetSourceRefresher } from "@/server/ports";
import { ASSET_SOURCE_PLUGIN_PROTOCOL_VERSION, type AssetSourcePlugin } from "./protocol";

/** 旧路由及测试替身使用的兼容桥；生产装配仅加载安装包。 */
export function builtinAssetSourcePlugins(
  refreshers: Partial<Record<Exclude<BuiltinAssetSourceKind, "manual">, AssetSourceRefresher>>,
): AssetSourcePlugin[] {
  return Object.entries(refreshers).map(([id, refresher]) => ({
    manifest: {
      id: id as Exclude<BuiltinAssetSourceKind, "manual">,
      version: "1.0.0",
      protocolVersion: ASSET_SOURCE_PLUGIN_PROTOCOL_VERSION,
      capabilities: ["assets.read"],
    },
    read: (request, context) => refresher.refresh({ ...request, ...context }),
  }));
}
