"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LongbridgeConnectionMode } from "@/server/asset-sources/longbridge-connection";
import type { LongbridgeConnections } from "@/server/asset-sources/longbridge-connections";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import { VibeField, VibeSelectField } from "@/ui/vibe/vibe-field";
import { VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { lockOnUnauthorizedResponse, OWNER_SESSION_EXPIRED_MESSAGE, readJsonResult } from "@/ui/owner-request-lock";

type ConnectionStatus = Awaited<ReturnType<LongbridgeConnections["status"]>>;
const modeLabel: Record<LongbridgeConnectionMode, string> = { cli: "CLI", sdk: "SDK", both: "CLI 优先，SDK 备用" };

function useConnectionStatus(sourceId?: string) {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkingCli, setCheckingCli] = useState(false);
  const [cliError, setCliError] = useState("");
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const current = ++generation.current;
    setChecking(true);
    setCheckingCli(false);
    setError("");
    setCliError("");
    try {
      const query = sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : "";
      const response = await fetch(`/api/asset-sources/longbridge/connection${query}`, { cache: "no-store" });
      const body = await readJsonResult<ConnectionStatus & { error?: string }>(response);
      if (lockOnUnauthorizedResponse(response)) throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
      if (!response.ok || !body) throw new Error(body?.error ?? "检测长桥连接失败");
      if (current === generation.current) setStatus(body);
      return body;
    } catch (caught) {
      if (current === generation.current) { setStatus(null); setError(caught instanceof Error ? caught.message : "检测长桥连接失败"); }
      return null;
    } finally { if (current === generation.current) setChecking(false); }
  }, [sourceId]);
  const reloadCli = useCallback(async () => {
    const current = ++generation.current;
    setCheckingCli(true);
    setCliError("");
    try {
      const query = new URLSearchParams({ transport: "cli" });
      if (sourceId) query.set("sourceId", sourceId);
      const response = await fetch(`/api/asset-sources/longbridge/connection?${query}`, { cache: "no-store" });
      const body = await readJsonResult<{ cli: ConnectionStatus["cli"]; error?: string }>(response);
      if (lockOnUnauthorizedResponse(response)) throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
      if (!response.ok || !body?.cli) throw new Error(body?.error ?? "检测 CLI 失败");
      if (current === generation.current) setStatus(previous => previous ? { ...previous, cli: body.cli } : previous);
    } catch (caught) {
      if (current === generation.current) setCliError(caught instanceof Error ? caught.message : "检测 CLI 失败");
    } finally { if (current === generation.current) setCheckingCli(false); }
  }, [sourceId]);
  useEffect(() => { void reload(); return () => { generation.current++; }; }, [reload]);
  return { status, error, checking, reload, checkingCli, cliError, reloadCli };
}

export function LongbridgeConnectionSummary({ sourceId, permissions, lastAttemptLabel }: {
  sourceId: string;
  permissions: string;
  lastAttemptLabel: string;
}) {
  const { status, error, checking, reload } = useConnectionStatus(sourceId);
  const cliIssue = status && status.mode !== "sdk"
    ? status.cli.matches === false ? "CLI 与此来源账户不一致" : !status.cli.authorized ? status.cli.error ?? "CLI 未授权" : null
    : null;
  const sdkIssue = status && status.mode !== "cli"
    ? status.sdk.matches === false ? "SDK 与此来源账户不一致" : !status.sdk.authorized ? status.sdk.error ?? "SDK 未授权" : null
    : null;
  const issues = [cliIssue, sdkIssue].filter((issue): issue is string => issue !== null);

  return <div className="asset-source-detail__connection" aria-busy={checking}>
    {error ? <VibeNotice tone="error" role="alert">{error}</VibeNotice> : null}
    {issues.length ? <VibeNotice tone="error"><ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul></VibeNotice> : null}
    <dl>
      <div><dt>账户</dt><dd>{status?.account ?? (error ? "暂时无法检测" : "正在检测…")}</dd></div>
      <div><dt>连接方式</dt><dd>{status ? modeLabel[status.mode] : "—"}</dd></div>
      <div><dt>只读权限</dt><dd>{permissions}</dd></div>
      <div><dt>最近同步尝试</dt><dd>{lastAttemptLabel}</dd></div>
    </dl>
    <div className="asset-source-detail__metadata-actions">
      <VibeLink href={`/asset-sources/${encodeURIComponent(sourceId)}/reauthorize`} variant="outline">管理连接方式</VibeLink>
      <VibeButton type="button" variant="text" disabled={checking} aria-live="polite" onClick={() => void reload()}>{checking ? "检测中…" : "重新检测"}</VibeButton>
    </div>
    {status ? <details className="asset-source-detail__disclosure">
      <summary>连接详情</summary>
      <dl>
        <div><dt>最近读取方式</dt><dd>{status.lastUsed ? `${status.lastUsed.transport.toUpperCase()}${status.lastUsed.fallback ? "（备用）" : ""}` : "尚无读取记录"}</dd></div>
        {status.mode !== "sdk" ? <>
          <div><dt>CLI 版本</dt><dd>{status.cli.version ?? "未检测到"}</dd></div>
          <div><dt>CLI 授权</dt><dd><VibeStatusTag tone={cliIssue ? "error" : "success"}>{cliIssue ?? "已授权，账户一致"}</VibeStatusTag></dd></div>
        </> : null}
        {status.mode !== "cli" ? <div><dt>SDK 授权</dt><dd><VibeStatusTag tone={sdkIssue ? "error" : "success"}>{sdkIssue ?? "已授权，账户一致"}</VibeStatusTag></dd></div> : null}
      </dl>
    </details> : null}
  </div>;
}

export function LongbridgeConnectionSettings({ sourceId, mode, onMode, onReady, onAuthorizeSdk, pending }: {
  sourceId?: string;
  mode: LongbridgeConnectionMode;
  onMode(mode: LongbridgeConnectionMode): void;
  onReady(ready: boolean): void;
  onAuthorizeSdk(): void;
  pending: boolean;
}) {
  const { status, error, checking, reload, checkingCli, cliError, reloadCli } = useConnectionStatus(sourceId);
  const initialized = useRef(false);
  const [code, setCode] = useState("");
  const [loginPending, setLoginPending] = useState(false);
  const [loginError, setLoginError] = useState("");
  useEffect(() => {
    if (sourceId && status && !initialized.current) { initialized.current = true; onMode(status.mode); }
  }, [sourceId, status, onMode]);
  const cliReady = Boolean(!cliError && status?.cli.authorized && status.cli.matches !== false);
  const sdkReady = Boolean(status?.sdk.authorized && status.sdk.matches !== false);
  useEffect(() => {
    onReady(!checking && !checkingCli && !loginPending && (mode === "cli" ? cliReady : mode === "sdk" ? sdkReady : cliReady && sdkReady));
  }, [mode, cliReady, sdkReady, checking, checkingCli, loginPending, onReady]);

  async function login() {
    setLoginPending(true);
    setLoginError("");
    try {
      const response = await fetch("/api/asset-sources/longbridge/connection", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: code.trim() }) });
      setCode("");
      const body = await readJsonResult<{ error?: string }>(response);
      if (lockOnUnauthorizedResponse(response)) throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
      if (!response.ok) throw new Error(body?.error ?? "CLI 登录失败");
      await reloadCli();
    } catch (caught) { setLoginError(caught instanceof Error ? caught.message : "CLI 登录失败"); }
    finally { setCode(""); setLoginPending(false); }
  }

  const cliChecking = checking || checkingCli;

  return <div className="source-credential-fields longbridge-connection-settings">
    <VibeSelectField fieldId="longbridge-connection-mode" label="连接方式" disabled={pending || checking || checkingCli || loginPending} value={mode} onValueChange={value => onMode(value as LongbridgeConnectionMode)} options={[
      { value: "cli", label: "CLI（推荐）" }, { value: "sdk", label: "SDK" }, { value: "both", label: "CLI 优先，SDK 备用" },
    ]} />
    {error || loginError ? <VibeNotice tone="error" role="alert">
      {loginError || error}
      {error ? <VibeButton type="button" variant="text" disabled={checking || pending || loginPending} onClick={() => void reload()}>重新检测连接</VibeButton> : null}
    </VibeNotice> : null}
    {mode !== "sdk" ? <section className="longbridge-connection-settings__transport" aria-labelledby="longbridge-cli-heading" aria-busy={cliChecking || loginPending}>
      <div className="longbridge-connection-settings__copy">
        <h3 id="longbridge-cli-heading">CLI</h3>
        <VibeStatusTag role="status" tone={cliChecking ? "muted" : cliReady ? "success" : cliError || error || (status && (sourceId || status.cli.installed)) ? "error" : "muted"}>{cliChecking ? "正在检测 CLI…" : cliError || (status?.cli.matches === false ? "CLI 账户与此来源不一致，请连接原账户。" : status?.cli.authorized ? status.cli.account : status?.cli.error ?? "尚未检测到 CLI")}</VibeStatusTag>
        <p className="source-field-help">{status?.cli.version ? `${status.cli.version} · KanBan 所在机器` : "检测 KanBan 所在机器的 CLI，无需手动启动服务。"}</p>
      </div>
      <VibeButton type="button" variant="outline" disabled={cliChecking || pending || loginPending || !status} onClick={() => void reloadCli()}>{cliChecking ? "检测中…" : "重新检测 CLI"}</VibeButton>
      {status && !status.cli.installed ? <VibeLink href="https://open.longbridge.com/docs/cli" target="_blank" rel="noreferrer" variant="text">查看 CLI 安装说明</VibeLink> : null}
      {status?.cli.installed && !status.cli.authorized ? <div className="source-credential-fields longbridge-connection-settings__login">
        <VibeLink href="https://open.longbridge.com/connect" target="_blank" rel="noreferrer" variant="outline">获取长桥一次性授权码</VibeLink>
        <VibeField fieldId="longbridge-cli-code" label="一次性授权码" type="password" autoComplete="off" value={code} disabled={cliChecking || loginPending || pending} onChange={event => setCode(event.currentTarget.value)} />
        <VibeButton type="button" variant="outline" disabled={cliChecking || loginPending || pending || !code.trim()} onClick={() => void login()}>{loginPending ? "登录中…" : "登录 CLI"}</VibeButton>
      </div> : null}
    </section> : null}
    {mode !== "cli" ? <section className="longbridge-connection-settings__transport" aria-labelledby="longbridge-sdk-heading" aria-busy={checking}>
      <div className="longbridge-connection-settings__copy">
        <h3 id="longbridge-sdk-heading">SDK</h3>
        <VibeStatusTag role="status" tone={checking ? "muted" : sdkReady ? "success" : error || status?.sdk.error || (status && sourceId) ? "error" : "muted"}>{checking ? "正在检测 SDK…" : status?.sdk.matches === false ? "SDK 账户与此来源不一致，请重新授权原账户。" : status?.sdk.authorized ? status.sdk.account : status?.sdk.error ?? "SDK 尚未授权"}</VibeStatusTag>
        {status?.sdk.authorized ? <p className="source-field-help">已授权</p> : null}
      </div>
      <VibeButton type="button" variant="outline" disabled={pending || checking || loginPending} onClick={onAuthorizeSdk}>{status?.sdk.authorized ? "重新授权 SDK" : "授权 SDK"}</VibeButton>
    </section> : null}
    {mode === "both" ? <p className="source-field-help">两种方式须连接同一账户。CLI 读取失败时使用 SDK。</p> : null}
  </div>;
}
