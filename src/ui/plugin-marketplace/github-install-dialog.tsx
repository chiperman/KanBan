import type { GitHubPluginCatalog } from "@/domain/plugin-management";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import { VibeDialog } from "@/ui/vibe/vibe-dialog";
import { VibeField, VibeSelect } from "@/ui/vibe/vibe-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { inspectGitHubPlugins, type GitHubPluginCommand } from "./requests";

export function GitHubPluginInstallDialog({
  onClose,
  onInstall,
  onPreviewChange,
  pending: installing,
  blocked,
  feedback,
}: {
  onClose: () => void;
  onInstall: (command: GitHubPluginCommand) => Promise<void>;
  onPreviewChange: () => void;
  pending: boolean;
  blocked: boolean;
  feedback: ReactNode;
}) {
  const [source, setSource] = useState(""),
    [catalog, setCatalog] = useState<GitHubPluginCatalog | null>(null);
  const [selectedId, setSelectedId] = useState(""),
    [error, setError] = useState("");
  const [checking, setChecking] = useState(false),
    busy = useRef(false);
  const pending = checking || installing;
  const inspection = useRef<AbortController | null>(null);
  const selected = catalog?.plugins.find((p) => p.id === selectedId);
  useEffect(
    () => () => {
      inspection.current?.abort();
      inspection.current = null;
    },
    [],
  );
  function close() {
    if (installing) return;
    inspection.current?.abort();
    onClose();
  }
  async function inspect() {
    if (busy.current || installing || blocked || !source.trim()) return;
    const controller = new AbortController();
    inspection.current = controller;
    busy.current = true;
    setChecking(true);
    setError("");
    onPreviewChange();
    try {
      const next = await inspectGitHubPlugins(source, controller.signal);
      if (controller.signal.aborted) return;
      setCatalog(next);
      setSelectedId(next.plugins[0]?.id ?? "");
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "无法查看插件，请检查仓库地址后重试");
    } finally {
      if (inspection.current === controller) {
        inspection.current = null;
        busy.current = false;
        setChecking(false);
      }
    }
  }
  async function install() {
    if (busy.current || installing || blocked || !catalog || !selected) return;
    setError("");
    await onInstall({
      action: "github-install",
      source: `https://github.com/${catalog.repository}/releases/tag/${catalog.release}`,
      id: selected.id,
      version: selected.version,
      repository: catalog.repository,
      sha256: selected.sha256,
    });
  }
  return (
    <VibeDialog
      titleId="github-plugin-install-title"
      title="从 GitHub 安装"
      onClose={close}
      className="plugin-marketplace__dialog"
      pending={installing}
      description="填写开发者提供的公开仓库或 Release 地址，无需先上架插件目录。"
      onSubmit={(event) => {
        event.preventDefault();
        void (catalog ? install() : inspect());
      }}
      actions={
        <>
          <VibeButton type="button" disabled={installing} variant="text" onClick={close}>
            取消
          </VibeButton>
          {catalog ? (
            <VibeButton disabled={pending || blocked || !selected} type="submit">
              {installing ? "正在安装…" : "确认安装"}
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
          disabled={pending || blocked}
          placeholder="owner/repo 或 https://github.com/owner/repo"
          autoCapitalize="none"
          spellCheck={false}
          onChange={(event) => {
            onPreviewChange();
            setSource(event.currentTarget.value);
            setCatalog(null);
            setSelectedId("");
            setError("");
          }}
        />
        <div className="plugin-marketplace__actions">
          <VibeButton
            type="button"
            disabled={pending || blocked || !source.trim()}
            onClick={() => void inspect()}
          >
            {checking ? "正在查看…" : catalog ? "重新查看" : "查看插件"}
          </VibeButton>
        </div>
        {error ? (
          <VibeNotice tone="error" role="alert">
            {error}
          </VibeNotice>
        ) : null}
        {feedback}
        {catalog ? (
          <>
            {catalog.plugins.length > 1 ? (
              <VibeSelect
                fieldId="github-plugin-selection"
                label="选择插件"
                value={selectedId}
                disabled={pending || blocked}
                onValueChange={(id) => {
                  onPreviewChange();
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
                  wrap
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
