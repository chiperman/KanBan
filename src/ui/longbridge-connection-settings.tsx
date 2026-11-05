"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LongbridgeConnectionMode } from "@/server/asset-sources/longbridge-connection";
import {
  ConnectionStatusReadError,
  requestLongbridgeCliLogin,
  requestLongbridgeCliStatus,
  requestLongbridgeConnectionStatus,
  type CliLoginResult,
  type ConnectionStatus,
} from "@/ui/longbridge-connection-requests";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import { VibeField, VibeSelectField } from "@/ui/vibe/vibe-field";
import { VibeStatusTag } from "@/ui/vibe/vibe-data-instrument";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { formatShanghaiDateTime } from "@/ui/shanghai-date-time";

const modeLabel: Record<LongbridgeConnectionMode, string> = { cli: "CLI", sdk: "SDK", both: "CLI 优先，SDK 备用" };

function useConnectionStatus(sourceId?: string) {
  const [snapshot, setSnapshot] = useState<{ sourceId?: string; status: ConnectionStatus; checkedAt: string } | null>(null);
  const status = snapshot?.sourceId === sourceId ? snapshot?.status ?? null : null;
  const checkedAt = status ? snapshot?.checkedAt ?? null : null;
  const [readState, setReadState] = useState<{
    sourceId?: string;
    pending: "all" | "cli" | null;
    error: string;
    cliError: string;
  }>({ sourceId, pending: "all", error: "", cliError: "" });
  const activeScope = useRef<{ sourceId?: string } | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const load = useCallback(async (transport: "all" | "cli") => {
    if (!activeScope.current || activeScope.current.sourceId !== sourceId) return null;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const isCurrent = () => activeRequest.current === controller && !controller.signal.aborted;
    setReadState(previous => ({
      sourceId,
      pending: transport,
      error: transport === "cli" && previous.sourceId === sourceId ? previous.error : "",
      cliError: "",
    }));
    try {
      if (transport === "all") {
        const nextStatus = await requestLongbridgeConnectionStatus(sourceId, controller.signal);
        if (!isCurrent()) return null;
        setSnapshot({ sourceId, status: nextStatus, checkedAt: new Date().toISOString() });
        return nextStatus.cli;
      } else {
        const cli = await requestLongbridgeCliStatus(sourceId, controller.signal);
        if (!isCurrent()) return null;
        setSnapshot(previous => previous && previous.sourceId === sourceId
          ? { ...previous, status: { ...previous.status, cli } }
          : previous);
        return cli;
      }
    } catch (caught) {
      if (!isCurrent()) return null;
      const clearSnapshot = caught instanceof ConnectionStatusReadError && caught.clearSnapshot;
      if (clearSnapshot) setSnapshot(null);
      const message = caught instanceof Error ? caught.message : "检测长桥连接失败，请重新检测。";
      setReadState(previous => ({
        ...previous,
        [transport === "all" || clearSnapshot ? "error" : "cliError"]: message,
      }));
    } finally {
      if (isCurrent()) {
        activeRequest.current = null;
        setReadState(previous => ({ ...previous, pending: null }));
      }
    }
    return null;
  }, [sourceId]);
  const reload = useCallback(() => load("all"), [load]);
  const reloadCli = useCallback(() => load("cli"), [load]);
  useEffect(() => {
    activeScope.current = { sourceId };
    void reload();
    return () => {
      activeScope.current = null;
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [reload, sourceId]);
  const currentScope = readState.sourceId === sourceId;
  return {
    status,
    checkedAt,
    error: currentScope ? readState.error : "",
    cliError: currentScope ? readState.cliError : "",
    checking: !currentScope || readState.pending === "all",
    checkingCli: currentScope && readState.pending === "cli",
    reload,
    reloadCli,
  };
}

interface CliLoginState {
  sourceId?: string;
  code: string;
  phase: "idle" | "login" | "check";
  needsCheck: boolean;
  error: string;
}

function initialCliLoginState(sourceId?: string): CliLoginState {
  return { sourceId, code: "", phase: "idle", needsCheck: false, error: "" };
}

function useCliLogin({ sourceId, pending, canLogin, readAll, readCli }: {
  sourceId?: string;
  pending: boolean;
  canLogin: boolean;
  readAll(): Promise<ConnectionStatus["cli"] | null>;
  readCli(): Promise<ConnectionStatus["cli"] | null>;
}) {
  const [state, setState] = useState(() => initialCliLoginState(sourceId));
  const scope = useRef<{ sourceId?: string; request: AbortController | null } | null>(null);
  useEffect(() => {
    const current = { sourceId, request: null as AbortController | null };
    scope.current = current;
    setState(previous => previous.sourceId === sourceId ? previous : initialCliLoginState(sourceId));
    return () => {
      if (scope.current === current) scope.current = null;
      current.request?.abort();
    };
  }, [sourceId]);
  const currentState = state.sourceId === sourceId ? state : initialCliLoginState(sourceId);

  async function run(action: "login" | "all" | "cli") {
    const current = scope.current;
    if (!current || current.sourceId !== sourceId || current.request || pending) return;
    const code = currentState.code.trim();
    if (action === "login") {
      if (!canLogin || currentState.needsCheck || !code) return;
      if (code.length > 4096 || /\s/.test(code)) {
        setState(previous => ({ ...previous, error: "请输入有效的长桥一次性授权码，授权码中不能包含空格。" }));
        return;
      }
    }
    const controller = new AbortController();
    current.request = controller;
    const isCurrent = () => scope.current === current && current.request === controller && !controller.signal.aborted;
    setState(previous => ({
      ...previous,
      code: action === "login" ? "" : previous.code,
      phase: action === "login" ? "login" : "check",
      error: "",
    }));
    try {
      let result: CliLoginResult | undefined;
      if (action === "login") {
        const response = await requestLongbridgeCliLogin(code, controller.signal);
        result = response;
        if (!isCurrent()) return;
        if (response.outcome === "rejected") {
          setState(previous => ({ ...previous, phase: "idle", error: response.message }));
          return;
        }
        setState(previous => ({ ...previous, phase: "check", needsCheck: true }));
      }
      const cli = await (action === "all" ? readAll() : readCli());
      if (!isCurrent()) return;
      let message = "";
      if (result && !cli?.authorized) {
        message = !cli
          ? `${result.outcome === "accepted" ? "CLI 登录请求已完成。" : result.message} 请重新检测 CLI，核对当前授权状态。`
          : "尚未检测到 CLI 授权，请稍后重新检测；再次登录请获取新授权码。";
      }
      setState(previous => ({ ...previous, phase: "idle", needsCheck: !cli, error: message }));
    } catch {
      if (isCurrent()) setState(previous => ({
        ...previous, phase: "idle", needsCheck: true, error: "尚未核对 CLI 授权状态，请重新检测后继续。",
      }));
    } finally {
      if (isCurrent()) current.request = null;
    }
  }

  return {
    ...currentState,
    busy: currentState.phase !== "idle",
    setCode: (code: string) => setState(previous => ({ ...previous, code, error: "" })),
    login: () => run("login"),
    reload: () => run("all"),
    reloadCli: () => run("cli"),
  };
}

export function LongbridgeConnectionSummary({ sourceId, permissions, lastAttemptLabel }: {
  sourceId: string;
  permissions: string;
  lastAttemptLabel: string;
}) {
  const { status, checkedAt, error, checking, reload } = useConnectionStatus(sourceId);
  const stale = Boolean(status && error);
  const cliIssue = status && status.mode !== "sdk"
    ? status.cli.matches === false ? "CLI 与此来源账户不一致" : !status.cli.authorized ? status.cli.error ?? "CLI 未授权" : null
    : null;
  const sdkIssue = status && status.mode !== "cli"
    ? status.sdk.matches === false ? "SDK 与此来源账户不一致" : !status.sdk.authorized ? status.sdk.error ?? "SDK 未授权" : null
    : null;
  const issues = [cliIssue, sdkIssue].filter((issue): issue is string => issue !== null);

  return <div className="asset-source-detail__connection" aria-busy={checking}>
    {error ? <VibeNotice tone="error" role="alert">{error}{stale && checkedAt ? ` 以下为 ${formatShanghaiDateTime(checkedAt)} 的上次完整检测结果。` : ""}</VibeNotice> : null}
    {issues.length && !stale && !checking ? <VibeNotice tone="error"><ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul></VibeNotice> : null}
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
          <div><dt>CLI 授权</dt><dd><VibeStatusTag tone={stale ? "warning" : checking ? "muted" : cliIssue ? "error" : "success"}>{checking ? "正在验证…" : `${stale ? "上次：" : ""}${cliIssue ?? "已授权，账户一致"}`}</VibeStatusTag></dd></div>
        </> : null}
        {status.mode !== "cli" ? <div><dt>SDK 授权</dt><dd><VibeStatusTag tone={stale ? "warning" : checking ? "muted" : sdkIssue ? "error" : "success"}>{checking ? "正在验证…" : `${stale ? "上次：" : ""}${sdkIssue ?? "已授权，账户一致"}`}</VibeStatusTag></dd></div> : null}
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
  const { status, checkedAt, error, checking, reload: readAll, checkingCli, cliError, reloadCli: readCli } = useConnectionStatus(sourceId);
  const initialized = useRef<string | null>(null);
  const canLogin = Boolean(!pending && !checking && !checkingCli && !error && status?.cli.installed && !status.cli.authorized);
  const { code, setCode, busy: loginPending, phase, needsCheck, error: loginError, login, reload, reloadCli } =
    useCliLogin({ sourceId, pending, canLogin, readAll, readCli });
  useEffect(() => {
    if (sourceId && status && initialized.current !== sourceId) { initialized.current = sourceId; onMode(status.mode); }
  }, [sourceId, status, onMode]);
  const cliReady = Boolean(!error && !cliError && status?.cli.authorized && status.cli.matches !== false);
  const sdkReady = Boolean(!error && status?.sdk.authorized && status.sdk.matches !== false);
  const visibleError = error || (mode !== "sdk" ? loginError : "");
  useEffect(() => {
    onReady(!checking && !checkingCli && !loginPending && (mode === "sdk" || !needsCheck) && (mode === "cli" ? cliReady : mode === "sdk" ? sdkReady : cliReady && sdkReady));
  }, [mode, cliReady, sdkReady, checking, checkingCli, loginPending, needsCheck, onReady]);

  const cliChecking = checking || checkingCli;
  const cliStatusText = (() => {
    if (phase === "login") return "正在登录 CLI…";
    if (cliChecking) return "正在检测 CLI…";
    if (cliError) return cliError;
    if (error && !status) return "暂时无法检测 CLI";
    const label = status?.cli.matches === false
      ? "CLI 账户与此来源不一致，请连接原账户。"
      : status?.cli.authorized ? status.cli.account ?? "已授权" : status?.cli.error ?? "尚未检测到 CLI";
    return `${error && status ? "上次：" : ""}${label}`;
  })();
  const sdkStatusText = (() => {
    if (checking) return "正在检测 SDK…";
    if (error && !status) return "暂时无法检测 SDK";
    const label = status?.sdk.matches === false
      ? "SDK 账户与此来源不一致，请重新授权原账户。"
      : status?.sdk.authorized ? status.sdk.account ?? "已授权" : status?.sdk.error ?? "SDK 尚未授权";
    return `${error && status ? "上次：" : ""}${label}`;
  })();

  return <div className="source-credential-fields longbridge-connection-settings">
    <VibeSelectField fieldId="longbridge-connection-mode" label="连接方式" disabled={pending || checking || checkingCli || loginPending} value={mode} onValueChange={value => onMode(value as LongbridgeConnectionMode)} options={[
      { value: "cli", label: "CLI（推荐）" }, { value: "sdk", label: "SDK" }, { value: "both", label: "CLI 优先，SDK 备用" },
    ]} />
    {visibleError ? <VibeNotice tone="error" role="alert">
      {visibleError}
      {error && status && checkedAt ? ` 以下为 ${formatShanghaiDateTime(checkedAt)} 的上次完整检测结果；请重新检测通过后继续。` : null}
      {error ? <VibeButton type="button" variant="text" disabled={checking || pending || loginPending} onClick={() => void reload()}>重新检测连接</VibeButton> : null}
    </VibeNotice> : null}
    {mode !== "sdk" ? <section className="longbridge-connection-settings__transport" aria-labelledby="longbridge-cli-heading" aria-busy={cliChecking || loginPending}>
      <div className="longbridge-connection-settings__copy">
        <h3 id="longbridge-cli-heading">CLI</h3>
        <VibeStatusTag role="status" tone={cliChecking || phase === "login" ? "muted" : error && status ? "warning" : cliReady ? "success" : cliError || error || (status && (sourceId || status.cli.installed)) ? "error" : "muted"}>{cliStatusText}</VibeStatusTag>
        <p className="source-field-help">{status?.cli.version ? `${status.cli.version}，KanBan 所在机器` : "检测 KanBan 所在机器的 CLI，无需手动启动服务。"}</p>
      </div>
      <VibeButton type="button" variant="outline" disabled={cliChecking || pending || loginPending || !status || Boolean(error)} onClick={() => void reloadCli()}>{cliChecking ? "检测中…" : "重新检测 CLI"}</VibeButton>
      {status && !status.cli.installed ? <VibeLink href="https://open.longbridge.com/docs/cli" target="_blank" rel="noreferrer" variant="text">查看 CLI 安装说明</VibeLink> : null}
      {status?.cli.installed && !status.cli.authorized ? <form
        aria-label="CLI 登录"
        className="source-credential-fields longbridge-connection-settings__login"
        onSubmit={event => { event.preventDefault(); void login(); }}
      >
        <VibeLink href="https://open.longbridge.com/connect" target="_blank" rel="noreferrer" variant="outline">获取长桥一次性授权码</VibeLink>
        <VibeField fieldId="longbridge-cli-code" label="一次性授权码" type="password" autoComplete="off" maxLength={4096} value={code} disabled={cliChecking || loginPending || pending || Boolean(error) || needsCheck} onChange={event => setCode(event.currentTarget.value)} />
        <VibeButton type="submit" variant="outline" disabled={!canLogin || loginPending || needsCheck || !code.trim()}>{phase === "login" ? "登录中…" : "登录 CLI"}</VibeButton>
      </form> : null}
    </section> : null}
    {mode !== "cli" ? <section className="longbridge-connection-settings__transport" aria-labelledby="longbridge-sdk-heading" aria-busy={checking}>
      <div className="longbridge-connection-settings__copy">
        <h3 id="longbridge-sdk-heading">SDK</h3>
        <VibeStatusTag role="status" tone={checking ? "muted" : error && status ? "warning" : sdkReady ? "success" : error || status?.sdk.error || (status && sourceId) ? "error" : "muted"}>{sdkStatusText}</VibeStatusTag>
        {sdkReady && !checking ? <p className="source-field-help">已授权</p> : null}
      </div>
      <VibeButton type="button" variant="outline" disabled={pending || checking || loginPending} onClick={onAuthorizeSdk}>{status?.sdk.authorized ? "重新授权 SDK" : "授权 SDK"}</VibeButton>
    </section> : null}
    {mode === "both" ? <p className="source-field-help">两种方式须连接同一账户。CLI 读取失败时使用 SDK。</p> : null}
  </div>;
}
