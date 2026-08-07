import { assetSourceDisplayName } from "@/domain/asset-source-display-name";
import type { AssetSourceSummary, Card } from "@/server/ports";
import { VibeLink } from "@/ui/vibe/vibe-button";

function sourceType(source: AssetSourceSummary): string {
  if (source.kind === "manual") return "手工资产记录";
  if (source.kind.startsWith("evm-watch-")) return "观察钱包";
  return "自动账户";
}

function sourceStatus(source: AssetSourceSummary, card?: Card): string {
  const visibility = card?.hidden ? " · 已隐藏" : "";
  if (source.kind === "manual") return `无凭证${visibility}`;
  if (source.lifecycle === "disconnected") return `已断开${visibility}`;
  if (source.sync.error) return `同步异常${visibility}`;
  if (source.sync.status === "expired") return `数据过期${visibility}`;
  return `已连接${visibility}`;
}

export function AssetSourceDirectory({
  cards,
  sources,
}: {
  cards: Card[];
  sources: AssetSourceSummary[];
}) {
  const cardsBySourceId = new Map(
    cards.flatMap((card) => card.sourceId ? [[card.sourceId, card] as const] : []),
  );

  return (
    <section aria-label="资产来源列表" className="asset-source-directory">
      <p className="asset-source-directory__intro">
        自动账户、观察钱包与手工资产记录统一在此查看；详情才提供单来源数据与生命周期操作。
      </p>
      <VibeLink
        aria-label="新增来源"
        className="asset-source-directory__create"
        href="/asset-sources/new"
        variant="outline"
      >
        新增来源
      </VibeLink>
      {sources.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">暂无资产来源</p>
          <p className="empty-hint">尚未接入自动账户、观察钱包或手工资产记录。</p>
        </div>
      ) : (
        <ol className="asset-source-directory__list">
          {sources.map((source) => {
            const name = assetSourceDisplayName(source);
            const type = sourceType(source);
            const status = sourceStatus(source, cardsBySourceId.get(source.id));
            return (
              <li key={source.id}>
                <VibeLink
                  aria-label={`${name} · ${type} · ${status}`}
                  className="asset-source-directory__link"
                  href={`/asset-sources/${encodeURIComponent(source.id)}`}
                  variant="text"
                >
                  <span className="asset-source-directory__identity">
                    <strong>{name}</strong>
                    <span>{source.label}</span>
                  </span>
                  <span className="asset-source-directory__meta">
                    <span>{type}</span>
                    <span>{status}</span>
                  </span>
                </VibeLink>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
