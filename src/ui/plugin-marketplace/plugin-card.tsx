import type { AvailablePluginStatus, PluginManagementStatus } from "@/domain/plugin-management";
import { comparePluginVersions } from "@/domain/plugin-version";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import { VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";

import type { Confirmation } from "./requests";

export function PluginCard({
  p,
  installed,
  published,
  demoMode,
  pending,
  setConfirmation,
  perform,
}: {
  p: AvailablePluginStatus;
  installed: PluginManagementStatus["installed"][number] | undefined;
  published: AvailablePluginStatus | undefined;
  demoMode: boolean;
  pending: boolean;
  setConfirmation(confirmation: Confirmation): void;
  perform(confirmation: Confirmation): Promise<void>;
}) {
  const update =
    installed &&
    published?.version &&
    comparePluginVersions(published.version, installed.version) > 0;
  return (
    <article className="plugin-marketplace__card" key={p.id} aria-labelledby={`plugin-${p.id}`}>
      <header>
        <h3 id={`plugin-${p.id}`}>{p.label}</h3>
        <VibeStatusTag tone={installed && !installed.healthy ? "error" : "muted"}>
          {installed
            ? !installed.healthy
              ? "文件损坏"
              : installed.enabled
                ? "已启用"
                : "已停用"
            : "未安装"}
        </VibeStatusTag>
      </header>
      <p>{p.summary}</p>
      <div className="plugin-marketplace__meta">
        <span>{p.publisher}</span>
        {installed?.version || p.version ? <span>v{installed?.version ?? p.version}</span> : null}
      </div>
      <div className="plugin-marketplace__actions">
        {!installed ? (
          <VibeButton
            disabled={demoMode || pending || !p.version}
            onClick={() =>
              setConfirmation({
                action: "install",
                id: p.id,
                label: p.label,
                version: p.version ?? undefined,
                repository: p.repository,
                sha256: p.sha256,
              })
            }
          >
            {p.version ? "安装" : "待发布"}
          </VibeButton>
        ) : (
          <>
            {update ? (
              <VibeButton
                disabled={demoMode || pending}
                onClick={() =>
                  setConfirmation({
                    action: "update",
                    id: p.id,
                    label: p.label,
                    version: published.version ?? undefined,
                    repository: published.repository,
                    sha256: published.sha256,
                  })
                }
              >
                更新至 {published.version}
              </VibeButton>
            ) : null}
            <VibeButton
              disabled={demoMode || pending}
              onClick={() =>
                void perform({
                  action: installed.enabled ? "disable" : "enable",
                  id: p.id,
                  label: p.label,
                })
              }
            >
              {installed.enabled ? "停用" : "启用"}
            </VibeButton>
            <VibeButton
              disabled={demoMode || pending}
              variant="text"
              onClick={() => setConfirmation({ action: "uninstall", id: p.id, label: p.label })}
            >
              卸载
            </VibeButton>
            {installed.healthy && installed.enabled && installed.assetSource ? (
              demoMode ? (
                <VibeButton disabled variant="text">
                  添加账户
                </VibeButton>
              ) : (
                <VibeLink href="/asset-sources/new" variant="text">
                  添加账户
                </VibeLink>
              )
            ) : null}
          </>
        )}
        {p.homepage ? (
          <VibeLink href={p.homepage} target="_blank" rel="noreferrer" variant="text">
            项目主页
          </VibeLink>
        ) : null}
      </div>
      {installed?.retainedVersions.length ? (
        <details>
          <summary>历史版本</summary>
          <div className="plugin-marketplace__versions">
            {installed.retainedVersions.map((v) => (
              <VibeButton
                key={v}
                disabled={demoMode || pending}
                size="compact"
                variant="text"
                onClick={() =>
                  setConfirmation({ action: "rollback", id: p.id, label: p.label, version: v })
                }
              >
                回滚至 {v}
              </VibeButton>
            ))}
          </div>
        </details>
      ) : null}
    </article>
  );
}
