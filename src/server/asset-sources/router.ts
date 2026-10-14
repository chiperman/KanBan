import type { AssetSourceKind } from "@/domain/asset-source-kinds";
import type {
  AssetSourceRefresher,
  AssetSourceRefreshResult,
} from "@/server/ports";

/** 可刷新的来源类型；手工来源没有外部读取器。 */
export type RefreshableAssetSourceKind = Exclude<AssetSourceKind, "manual">;

function isRefreshableKind(kind: string): kind is RefreshableAssetSourceKind {
  return kind !== "manual";
}

/** 按已保存来源类型分派，未知类型 fail closed。 */
export class RoutedAssetSourceRefresher implements AssetSourceRefresher {
  constructor(
    private readonly refreshers: Record<
      RefreshableAssetSourceKind,
      AssetSourceRefresher
    >,
  ) {}

  refresh(
    input: Parameters<AssetSourceRefresher["refresh"]>[0],
  ): Promise<AssetSourceRefreshResult> {
    const { kind } = input.source;
    if (!isRefreshableKind(kind)) {
      throw new Error(`暂不支持刷新来源类型：${kind}`);
    }
    // 持久化数据可能含未知来源类型，运行时仍需 fail closed。
    const refresher = this.refreshers[kind] as AssetSourceRefresher | undefined;
    if (!refresher) {
      throw new Error(`暂不支持刷新来源类型：${kind}`);
    }
    return refresher.refresh(input);
  }
}
