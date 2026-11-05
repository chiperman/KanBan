"use client";

import type { PluginManagementStatus } from "@/domain/plugin-management";
import { VibeLink } from "@/ui/vibe/vibe-button";
import { PluginCard } from "./plugin-marketplace/plugin-card";

/** Read-only list of integrations shipped with the current KanBan build. */
export function OfficialIntegrations({
  initialStatus,
}: {
  initialStatus: PluginManagementStatus;
}) {
  return (
    <section className="plugin-marketplace" aria-labelledby="plugin-marketplace-title">
      <header className="plugin-marketplace__heading">
        <div className="plugin-marketplace__intro">
          <h2 id="plugin-marketplace-title">官方集成</h2>
          <p>账户接入、行情与链上读取随当前 KanBan 版本提供。</p>
        </div>
      </header>
      <p className="plugin-marketplace__policy" role="note">
        官方版本不从商城、GitHub 或本地插件包安装代码。每个集成的版本与源码入口都随应用一起构建和验证。
      </p>
      {initialStatus.installed.length > 0 ? (
        <div className="plugin-marketplace__grid">
          {initialStatus.installed.map((plugin) => (
            <PluginCard key={plugin.id} p={plugin} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <p>当前版本没有可用的官方集成。</p>
        </div>
      )}
      <footer className="plugin-marketplace__heading plugin-marketplace__footer">
        <span>来源仓库：{initialStatus.repository}</span>
        <div className="plugin-marketplace__actions">
          <VibeLink
            href={`https://github.com/${initialStatus.repository}`}
            target="_blank"
            rel="noreferrer"
            variant="text"
          >
            查看源码仓库
          </VibeLink>
          <VibeLink
            href={`https://github.com/${initialStatus.repository}/issues`}
            target="_blank"
            rel="noreferrer"
            variant="text"
          >
            问题反馈
          </VibeLink>
        </div>
      </footer>
    </section>
  );
}
