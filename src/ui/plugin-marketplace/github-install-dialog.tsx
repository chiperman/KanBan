import type { GitHubPluginCatalog, PluginManagementStatus } from "@/domain/plugin-management";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import { VibeDialog } from "@/ui/vibe/vibe-dialog";
import { VibeField, VibeSelect } from "@/ui/vibe/vibe-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { useRef, useState } from "react";

import { result } from "./requests";

export function GitHubPluginInstallDialog({
  onClose,
  onInstalled,
}: {
  onClose: () => void;
  onInstalled: (status: PluginManagementStatus) => void;
}) {
  const [source, setSource] = useState(""),
    [catalog, setCatalog] = useState<GitHubPluginCatalog | null>(null);
  const [selectedId, setSelectedId] = useState(""),
    [error, setError] = useState("");
  const [pending, setPending] = useState<"inspect" | "install" | null>(null),
    busy = useRef(false);
  const selected = catalog?.plugins.find((p) => p.id === selectedId);
  async function inspect() {
    if (busy.current || !source.trim()) return;
    busy.current = true;
    setPending("inspect");
    setError("");
    try {
      const next = await result<GitHubPluginCatalog>(
        await fetch("/api/plugins/github", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "inspect", source }),
        }),
      );
      setCatalog(next);
      setSelectedId(next.plugins[0]?.id ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法查看插件，请检查仓库地址后重试");
    } finally {
      busy.current = false;
      setPending(null);
    }
  }
  async function install() {
    if (busy.current || !catalog || !selected) return;
    busy.current = true;
    setPending("install");
    setError("");
    try {
      const updated = await result<PluginManagementStatus>(
        await fetch("/api/plugins/github", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "install",
            source: `https://github.com/${catalog.repository}/releases/tag/${catalog.release}`,
            id: selected.id,
            version: selected.version,
            repository: catalog.repository,
            sha256: selected.sha256,
          }),
        }),
      );
      onInstalled(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "安装未完成，请重试；已有插件保持不变");
    } finally {
      busy.current = false;
      setPending(null);
    }
  }
  return (
    <VibeDialog
      titleId="github-plugin-install-title"
      title="从 GitHub 安装"
      onClose={() => {
        if (!busy.current) onClose();
      }}
      description="填写开发者提供的公开仓库或 Release 地址，无需先上架插件目录。"
      onSubmit={(event) => {
        event.preventDefault();
        void (catalog ? install() : inspect());
      }}
      actions={
        <>
          <VibeButton type="button" disabled={!!pending} variant="text" onClick={onClose}>
            取消
          </VibeButton>
          {catalog ? (
            <VibeButton disabled={!!pending || !selected} type="submit">
              {pending === "install" ? "正在安装…" : "确认安装"}
            </VibeButton>
          ) : null}
        </>
      }
    >
      <div className="plugin-marketplace__install" aria-busy={!!pending}>
        <VibeField
          fieldId="github-plugin-source"
          label="GitHub 仓库或 Release 地址"
          value={source}
          maxLength={500}
          disabled={!!pending}
          placeholder="owner/repo 或 https://github.com/owner/repo"
          autoCapitalize="none"
          spellCheck={false}
          onChange={(event) => {
            setSource(event.currentTarget.value);
            setCatalog(null);
            setSelectedId("");
            setError("");
          }}
        />
        <div className="plugin-marketplace__actions">
          <VibeButton
            type="button"
            disabled={!!pending || !source.trim()}
            onClick={() => void inspect()}
          >
            {pending === "inspect" ? "正在查看…" : catalog ? "重新查看" : "查看插件"}
          </VibeButton>
        </div>
        {error ? (
          <VibeNotice tone="error" role="alert">
            {error}
          </VibeNotice>
        ) : null}
        {catalog ? (
          <>
            {catalog.plugins.length > 1 ? (
              <VibeSelect
                fieldId="github-plugin-selection"
                label="选择插件"
                value={selectedId}
                disabled={!!pending}
                onValueChange={(id) => {
                  setSelectedId(id);
                  setError("");
                }}
                options={catalog.plugins.map((p) => ({
                  value: p.id,
                  label: `${p.label} · v${p.version}`,
                }))}
              />
            ) : null}
            {selected ? (
              <div className="plugin-marketplace__install">
                <h3>
                  {selected.label} · v{selected.version}
                </h3>
                <p>{selected.summary}</p>
                <p>
                  {selected.publisher} · {selected.id}
                </p>
                <VibeLink
                  href={`https://github.com/${catalog.repository}/releases/tag/${catalog.release}`}
                  target="_blank"
                  rel="noreferrer"
                  variant="text"
                >
                  {catalog.repository} · {catalog.release}
                </VibeLink>
                <p className="plugin-marketplace__checksum">SHA-256：{selected.sha256}</p>
                <p>插件会在运行 KanBan 的电脑上执行代码。请确认信任其开发者和发布来源后安装。</p>
              </div>
            ) : null}
            <VibeLink
              href={`https://github.com/${catalog.repository}/issues`}
              target="_blank"
              rel="noreferrer"
              variant="text"
            >
              向开发者反馈问题
            </VibeLink>
          </>
        ) : null}
      </div>
    </VibeDialog>
  );
}
