"use client";
import type {
  PluginCatalogStatus,
  PluginManagementStatus,
} from "@/domain/plugin-management";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { PluginCatalogBrowser } from "./plugin-marketplace/catalog-browser";
import { PluginCommandFeedback } from "./plugin-marketplace/command-feedback";
import { PluginConfirmationDialog } from "./plugin-marketplace/confirmation-dialog";
import { GitHubPluginInstallDialog } from "./plugin-marketplace/github-install-dialog";
import {
  inspectImportedPlugin,
  requestPluginCatalog,
  requestPluginCommand,
  type Confirmation,
  type PluginCommand,
  type PluginCommandFailure,
} from "./plugin-marketplace/requests";

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
  const [checking, setChecking] = useState(!demoMode && initialCatalog === null),
    [pending, setPending] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [githubOpen, setGithubOpen] = useState(false);
  const [failure, setFailure] = useState<PluginCommandFailure | null>(null);
  const failureRef = useRef<PluginCommandFailure | null>(null);
  const upload = useRef<HTMLInputElement>(null),
    busy = useRef(false),
    router = useRouter();
  const catalogRequest = useRef<AbortController | null>(null),
    importRequest = useRef<AbortController | null>(null),
    commandRequest = useRef<AbortController | null>(null);
  const needsCheck = failure?.outcome === "unconfirmed";
  const blocked = pending || needsCheck;
  const checkCatalog = useCallback(
    async (refresh = false) => {
      if (demoMode) return;
      catalogRequest.current?.abort();
      const controller = new AbortController();
      catalogRequest.current = controller;
      setChecking(true);
      setCatalogError("");
      try {
        const next = await requestPluginCatalog(refresh, controller.signal);
        if (!controller.signal.aborted) setCatalog(next);
      } catch (e) {
        if (!controller.signal.aborted)
          setCatalogError(e instanceof Error ? e.message : "无法读取插件目录");
      } finally {
        if (catalogRequest.current === controller) {
          catalogRequest.current = null;
          setChecking(false);
        }
      }
    },
    [demoMode],
  );
  useEffect(() => {
    void checkCatalog();
    return () => {
      catalogRequest.current?.abort();
      catalogRequest.current = null;
    };
  }, [checkCatalog]);
  useEffect(
    () => () => {
      importRequest.current?.abort();
      importRequest.current = null;
      commandRequest.current?.abort();
      commandRequest.current = null;
    },
    [],
  );
  async function inspect(file: File) {
    if (demoMode || busy.current || failureRef.current?.outcome === "unconfirmed") return;
    const controller = new AbortController();
    importRequest.current = controller;
    busy.current = true;
    setPending(true);
    updateFailure(null);
    setError("");
    setMessage("");
    try {
      if (file.size > 16 * 1024 * 1024) throw new Error("插件包不能超过 16 MiB");
      const info = await inspectImportedPlugin(file, controller.signal);
      if (controller.signal.aborted) return;
      setConfirmation({ action: "import", file, info });
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "无法读取插件包");
    } finally {
      if (importRequest.current === controller) {
        importRequest.current = null;
        busy.current = false;
        setPending(false);
        if (upload.current) upload.current.value = "";
      }
    }
  }
  function updateFailure(value: PluginCommandFailure | null) {
    failureRef.current = value;
    setFailure(value);
  }
  function continueAfterCheck() {
    if (!busy.current) updateFailure(null);
  }
  function clearRejectedFailure() {
    if (failureRef.current?.outcome === "rejected") updateFailure(null);
  }
  function changeConfirmation(value: Confirmation | null) {
    if (busy.current || (value && failureRef.current?.outcome === "unconfirmed")) return;
    if (value) {
      updateFailure(null);
      setError("");
      setMessage("");
    }
    setConfirmation(value);
  }
  async function perform(operation: PluginCommand) {
    if (demoMode || busy.current || failureRef.current?.outcome === "unconfirmed") return;
    const controller = new AbortController();
    commandRequest.current = controller;
    busy.current = true;
    setPending(true);
    updateFailure(null);
    setError("");
    setMessage("");
    try {
      const result = await requestPluginCommand(operation, controller.signal);
      if (commandRequest.current !== controller) return;
      if (result.outcome !== "confirmed") {
        updateFailure(result);
        return;
      }
      setStatus(result.status);
      setConfirmation(null);
      setGithubOpen(false);
      setMessage({
        install: "插件已安装。",
        import: "插件已安装。",
        "github-install": "插件已安装。",
        update: "插件已更新。",
        enable: "插件已启用。",
        disable: "插件已停用。",
        uninstall: "插件已卸载。",
        rollback: "插件已回滚。",
      }[operation.action]);
      router.refresh();
      if (operation.action === "github-install") void checkCatalog();
    } finally {
      if (commandRequest.current === controller) {
        controller.abort();
        commandRequest.current = null;
        busy.current = false;
        setPending(false);
      }
    }
  }
  const feedback = (
    <PluginCommandFeedback
      failure={failure}
      onContinue={continueAfterCheck}
      focusRecoveryOnMount={!githubOpen && !confirmation}
    />
  );
  return (
    <section className="plugin-marketplace" aria-labelledby="plugin-marketplace-title">
      <header className="plugin-marketplace__heading">
        <div className="plugin-marketplace__intro">
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
          <VibeButton
            disabled={demoMode || blocked}
            onClick={() => {
              updateFailure(null);
              setError("");
              setMessage("");
              setGithubOpen(true);
            }}
          >
            从 GitHub 安装
          </VibeButton>
          <VibeButton disabled={demoMode || blocked} onClick={() => upload.current?.click()}>
            导入插件包
          </VibeButton>
          <input
            ref={upload}
            type="file"
            accept=".tar.gz,application/gzip"
            hidden
            disabled={demoMode || blocked}
            aria-label="选择插件包"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (file) void inspect(file);
            }}
          />
        </div>
      </header>
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
      {!githubOpen && !confirmation ? feedback : null}
      <PluginCatalogBrowser
        status={status}
        catalog={catalog}
        catalogError={catalogError}
        checking={checking}
        pending={pending}
        blocked={blocked}
        demoMode={demoMode}
        retry={() => void checkCatalog(true)}
        setConfirmation={changeConfirmation}
        perform={perform}
      />
      <footer className="plugin-marketplace__heading plugin-marketplace__footer">
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
          pending={pending}
          blocked={needsCheck}
          feedback={feedback}
          onClose={() => {
            if (!busy.current) setGithubOpen(false);
          }}
          onInstall={perform}
          onPreviewChange={clearRejectedFailure}
        />
      ) : null}
      {confirmation ? (
        <PluginConfirmationDialog
          confirmation={confirmation}
          pending={pending}
          blocked={needsCheck}
          feedback={feedback}
          setConfirmation={changeConfirmation}
          perform={perform}
        />
      ) : null}
    </section>
  );
}
