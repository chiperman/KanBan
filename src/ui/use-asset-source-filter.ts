"use client";

import { useMemo, useState } from "react";

import {
  assetSourceDisplayName,
  type AssetSourceDisplayIdentity,
} from "@/domain/asset-source-display-name";

type FilterSource = AssetSourceDisplayIdentity & { id: string };

export function useAssetSourceFilter<T extends FilterSource>(sources: readonly T[]) {
  const [selectedId, setSourceId] = useState("all");
  const selectedSource = sources.find((source) => source.id === selectedId) ?? null;
  const sourceId = selectedSource?.id ?? "all";

  // 清除失效选择，避免同一来源重新出现时恢复用户已看不到的筛选。
  if (selectedId !== sourceId) setSourceId(sourceId);

  const sourceOptions = useMemo(
    () => [
      { value: "all", label: "全部来源" },
      ...sources.map((source) => ({
        value: source.id,
        label: assetSourceDisplayName(source),
      })),
    ],
    [sources],
  );

  return { sourceId, setSourceId, selectedSource, sourceOptions };
}
