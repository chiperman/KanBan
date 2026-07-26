import type {
  AssetSourceRefresher,
  AssetSourceRefreshResult,
} from "@/server/ports";

/** 按已保存来源类型分派，未知类型 fail closed。 */
export class RoutedAssetSourceRefresher implements AssetSourceRefresher {
  constructor(
    private readonly refreshers: Record<string, AssetSourceRefresher>,
  ) {}

  refresh(
    input: Parameters<AssetSourceRefresher["refresh"]>[0],
  ): Promise<AssetSourceRefreshResult> {
    const refresher = this.refreshers[input.source.kind];
    if (!refresher) {
      throw new Error(`暂不支持刷新来源类型：${input.source.kind}`);
    }
    return refresher.refresh(input);
  }
}
