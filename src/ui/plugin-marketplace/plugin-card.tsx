import type { InstalledPluginStatus } from "@/domain/plugin-management";
import { VibeLink } from "@/ui/vibe/vibe-button";
import { VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";

export function PluginCard({
  p,
}: {
  p: InstalledPluginStatus;
}) {
  return (
    <article className="plugin-marketplace__card" aria-labelledby={`plugin-${p.id}`}>
      <header>
        <h3 id={`plugin-${p.id}`}>{p.label}</h3>
        <VibeStatusTag tone={p.healthy ? "muted" : "error"}>
          {p.healthy ? "已提供" : "不可用"}
        </VibeStatusTag>
      </header>
      <p>{p.summary}</p>
      <div className="plugin-marketplace__meta">
        <span>版本 {p.version === "未构建" ? p.version : `v${p.version}`}</span>
        <span>{p.publisher}</span>
      </div>
      <div className="plugin-marketplace__actions">
        {p.assetSource && p.healthy ? (
          <VibeLink href="/asset-sources/new" variant="text">
            添加账户
          </VibeLink>
        ) : null}
        {p.homepage ? (
          <VibeLink href={p.homepage} target="_blank" rel="noreferrer" variant="text">
            查看仓库
          </VibeLink>
        ) : null}
      </div>
    </article>
  );
}
