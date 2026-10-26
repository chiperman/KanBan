"use client";
import type {
  AvailablePluginStatus,
  PluginCatalogStatus,
  PluginManagementStatus,
} from "@/domain/plugin-management";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { PluginConfirmationDialog } from "./plugin-marketplace/confirmation-dialog";
import { GitHubPluginInstallDialog } from "./plugin-marketplace/github-install-dialog";
import { PluginCard } from "./plugin-marketplace/plugin-card";
import { result, type Confirmation, type ImportInfo } from "./plugin-marketplace/requests";

export function PluginMarketplace({
  initialStatus,
  initialCatalog = null,
  demoMode = false,
}: {
  initialStatus: PluginManagementStatus;
  initialCatalog?: PluginCatalogStatus | null;
  demoMode?: boolean;
}) {
  const [status, setStatus] = useState(initialStatus),
    [catalog, setCatalog] = useState<PluginCatalogStatus | null>(initialCatalog);
  const [catalogError, setCatalogError] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [checking, setChecking] = useState(false),
    [pending, setPending] = useState(false);
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [githubOpen, setGithubOpen] = useState(false);
  const upload = useRef<HTMLInputElement>(null),
    busy = useRef(false),
    router = useRouter();
  const checkCatalog = useCallback(
    async (refresh = false) => {
      if (demoMode) return;
      setChecking(true);
      setCatalogError("");
      try {
        setCatalog(
          await result<PluginCatalogStatus>(
            await fetch(`/api/plugins?catalog=1${refresh ? "&refresh=1" : ""}`, {
              cache: "no-store",
            }),
          ),
        );
      } catch (e) {
        setCatalogError(e instanceof Error ? e.message : "无法读取插件目录");
      } finally {
        setChecking(false);
      }
    },
    [demoMode],
  );
  useEffect(() => {
    void checkCatalog();
  }, [checkCatalog]);
  async function inspect(file: File) {
    if (demoMode || busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    setMessage("");
    try {
      if (file.size > 16 * 1024 * 1024) throw new Error("插件包不能超过 16 MiB");
      const body = new FormData();
      body.set("file", file);
      body.set("action", "inspect");
      const info = await result<ImportInfo>(
        await fetch("/api/plugins/import", { method: "POST", body }),
      );
      setConfirmation({ action: "import", file, info });
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法读取插件包");
    } finally {
      busy.current = false;
      setPending(false);
      if (upload.current) upload.current.value = "";
    }
  }
  async function change(operation: Exclude<Confirmation, { action: "import" }>) {
    return result<PluginManagementStatus>(
      await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(operation),
      }),
    );
  }
  async function perform(operation: Confirmation) {
    if (demoMode || busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    setMessage("");
    try {
      let updated: PluginManagementStatus;
      if (operation.action === "import") {
        const body = new FormData();
        body.set("file", operation.file);
        body.set("action", "install");
        body.set("trusted", "true");
        body.set("sha256", operation.info.sha256);
        updated = await result<PluginManagementStatus>(
          await fetch("/api/plugins/import", { method: "POST", body }),
        );
      } else updated = await change(operation);
      setStatus(updated);
      setConfirmation(null);
      setMessage("插件已更新。");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "插件操作失败");
      setConfirmation(null);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  const entries = new Map<string, AvailablePluginStatus>();
  for (const p of catalog?.plugins ?? []) entries.set(p.id, p);
  for (const p of status.installed) if (!entries.has(p.id)) entries.set(p.id, p);
  const visible = [...entries.values()].filter(
    (p) =>
      (filter !== "installed" || status.installed.some((i) => i.id === p.id)) &&
      `${p.label} ${p.id} ${p.summary} ${p.publisher}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  return (
    <section className="plugin-marketplace" aria-labelledby="plugin-marketplace-title">
      <header className="plugin-marketplace__heading">
        <div>
          <h2 id="plugin-marketplace-title">集成插件</h2>
          <p>按需添加账户接入、行情与链上服务。</p>
        </div>
        <div className="plugin-marketplace__actions">
          <VibeButton
            disabled={demoMode || checking || pending}
            onClick={() => void checkCatalog(true)}
          >
            {checking ? "正在检查…" : "检查更新"}
          </VibeButton>
          <VibeButton disabled={demoMode || pending} onClick={() => setGithubOpen(true)}>
            从 GitHub 安装
          </VibeButton>
          <VibeButton disabled={demoMode || pending} onClick={() => upload.current?.click()}>
            导入插件包
          </VibeButton>
          <input
            ref={upload}
            type="file"
            accept=".tar.gz,application/gzip"
            hidden
            disabled={demoMode}
            aria-label="选择插件包"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (file) void inspect(file);
            }}
          />
        </div>
      </header>
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
        <label className="vibe-field">
          <span className="vibe-field__label">搜索插件</span>
          <input
            className="vibe-field__input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="名称、用途或开发者"
          />
        </label>
      </div>
      {catalogError ? (
        <VibeNotice tone="info" role="status">
          {catalogError} 已安装插件仍可管理，也可从 GitHub 安装或导入插件包。
        </VibeNotice>
      ) : null}
      {catalog?.notice ? (
        <VibeNotice tone="info" role="status">
          {catalog.notice}
        </VibeNotice>
      ) : null}
      {error ? (
        <VibeNotice tone="error" role="alert">
          {error}
        </VibeNotice>
      ) : null}
      {message ? (
        <VibeNotice tone="success" role="status">
          {message}
        </VibeNotice>
      ) : null}
      <div className="plugin-marketplace__grid" aria-busy={pending || checking}>
        {visible.map((p) => (
          <PluginCard
            key={p.id}
            p={p}
            installed={status.installed.find((i) => i.id === p.id)}
            published={catalog?.plugins.find((i) => i.id === p.id)}
            demoMode={demoMode}
            pending={pending}
            setConfirmation={setConfirmation}
            perform={perform}
          />
        ))}
      </div>
      {!visible.length ? (
        <p role="status">
          {checking
            ? "正在获取插件目录…"
            : query
              ? "没有匹配的插件。"
              : filter === "installed"
                ? "尚未安装插件。"
                : "插件目录暂不可用。"}
        </p>
      ) : null}
      <footer className="plugin-marketplace__heading">
        <span>
          目录：{status.repository}
          {catalog?.release ? ` · ${catalog.release}` : ""}
        </span>
        <div className="plugin-marketplace__actions">
          <VibeLink
            href={`https://github.com/${status.repository}/blob/main/docs/operations/plugin-development.md`}
            target="_blank"
            rel="noreferrer"
            variant="text"
          >
            开发与上架插件
          </VibeLink>
          <VibeLink
            href={`https://github.com/${status.repository}/issues`}
            target="_blank"
            rel="noreferrer"
            variant="text"
          >
            问题反馈
          </VibeLink>
        </div>
      </footer>
      {githubOpen ? (
        <GitHubPluginInstallDialog
          onClose={() => setGithubOpen(false)}
          onInstalled={(updated) => {
            setStatus(updated);
            setGithubOpen(false);
            setError("");
            setMessage("插件已安装。");
            router.refresh();
            void checkCatalog();
          }}
        />
      ) : null}
      {confirmation ? (
        <PluginConfirmationDialog
          confirmation={confirmation}
          pending={pending}
          setConfirmation={setConfirmation}
          perform={perform}
        />
      ) : null}
    </section>
  );
}
