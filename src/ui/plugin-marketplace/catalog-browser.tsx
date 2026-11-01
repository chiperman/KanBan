import type {
  PluginCatalogStatus,
  PluginManagementStatus,
} from "@/domain/plugin-management";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeField } from "@/ui/vibe/vibe-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { useRef, useState } from "react";

import { PluginCard } from "./plugin-card";
import type { Confirmation } from "./requests";

export function PluginCatalogBrowser({
  status,
  catalog,
  catalogError,
  checking,
  pending,
  blocked,
  demoMode,
  retry,
  setConfirmation,
  perform,
}: {
  status: PluginManagementStatus;
  catalog: PluginCatalogStatus | null;
  catalogError: string;
  checking: boolean;
  pending: boolean;
  blocked: boolean;
  demoMode: boolean;
  retry(): void;
  setConfirmation(confirmation: Confirmation): void;
  perform(confirmation: Confirmation): Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "installed">("all");
  const searchInput = useRef<HTMLInputElement>(null);
  const search = query.trim().toLowerCase();
  const hasFilters = Boolean(search) || filter !== "all";
  const installedById = new Map(status.installed.map((p) => [p.id, p]));
  const publishedById = new Map((catalog?.plugins ?? []).map((p) => [p.id, p]));
  const entries = new Map(publishedById);
  for (const p of status.installed) if (!entries.has(p.id)) entries.set(p.id, p);
  const visible = [...entries.values()].filter(
    (p) =>
      (filter !== "installed" || installedById.has(p.id)) &&
      `${p.label} ${p.id} ${p.summary} ${p.publisher}`.toLowerCase().includes(search),
  );
  const loading = checking || (!catalog && !catalogError);
  let emptyMessage: string | null;
  if (entries.size === 0) {
    emptyMessage = loading
      ? "正在获取插件目录…"
      : catalogError
        ? null
        : "目录中暂无插件。";
  } else if (filter === "installed") {
    emptyMessage = status.installed.length === 0
      ? "尚未安装插件。"
      : "已安装插件中没有匹配项。";
  } else {
    emptyMessage = "没有匹配的插件。";
  }

  function clearFilters() {
    setQuery("");
    setFilter("all");
    searchInput.current?.focus();
  }

  return (
    <>
      {catalogError ? (
        <VibeNotice tone="info" role="status">
          {catalogError}{" "}
          {catalog
            ? "当前保留上次目录，已安装插件仍可管理。"
            : "已安装插件仍可管理，也可从 GitHub 安装或导入插件包。"}
          <VibeButton disabled={checking || demoMode} variant="text" onClick={retry}>
            {checking ? "正在重试…" : "重试读取"}
          </VibeButton>
        </VibeNotice>
      ) : null}
      {catalog?.notice ? (
        <VibeNotice tone="info" role="status">
          {catalog.notice}
        </VibeNotice>
      ) : null}
      <div className="plugin-marketplace__filters">
        <div role="group" aria-label="插件范围" className="plugin-marketplace__actions">
          <VibeButton
            aria-pressed={filter === "all"}
            variant={filter === "all" ? "outline" : "text"}
            onClick={() => setFilter("all")}
          >
            全部插件
          </VibeButton>
          <VibeButton
            aria-pressed={filter === "installed"}
            variant={filter === "installed" ? "outline" : "text"}
            onClick={() => setFilter("installed")}
          >
            已安装（{status.installed.length}）
          </VibeButton>
        </div>
        <VibeField
          ref={searchInput}
          fieldId="plugin-marketplace-search"
          label="搜索插件"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="名称、用途或开发者"
        />
      </div>
      {visible.length > 0 ? (
        <>
          <p className="plugin-marketplace__result-count" role="status">
            {checking ? "正在检查更新，" : ""}
            {hasFilters ? `找到 ${visible.length} 个插件` : `共 ${visible.length} 个插件`}
          </p>
          <div className="plugin-marketplace__grid" aria-busy={pending || checking}>
            {visible.map((p) => (
              <PluginCard
                key={p.id}
                p={p}
                installed={installedById.get(p.id)}
                published={publishedById.get(p.id)}
                demoMode={demoMode}
                blocked={blocked}
                setConfirmation={setConfirmation}
                perform={perform}
              />
            ))}
          </div>
        </>
      ) : emptyMessage ? (
        <div className="empty-state">
          <p role="status">{emptyMessage}</p>
          {hasFilters && entries.size > 0 ? (
            <VibeButton onClick={clearFilters}>清除筛选</VibeButton>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
