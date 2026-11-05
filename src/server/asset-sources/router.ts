import type { BuiltinAssetSourceKind } from "@/domain/asset-source-kinds";
import type { AssetSourceRefresher } from "@/server/ports";
import { builtinAssetSourcePlugins } from "@/server/asset-source-plugins/builtin";
import { AssetSourcePluginManager } from "@/server/asset-source-plugins/manager";

/** 可刷新的来源类型；手工来源没有外部读取器。 */
export type RefreshableAssetSourceKind = Exclude<BuiltinAssetSourceKind, "manual">;

/** 旧装配入口兼容；运行校验与分派统一交给插件管理器。 */
export class RoutedAssetSourceRefresher extends AssetSourcePluginManager {
  constructor(refreshers: Record<RefreshableAssetSourceKind, AssetSourceRefresher>) {
    super(builtinAssetSourcePlugins(refreshers));
  }
}
