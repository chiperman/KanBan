"use client";

import { LongbridgeConnectionSettings } from "@/ui/longbridge-connection-settings";
import type { LongbridgeConnectionMode } from "@/server/asset-sources/longbridge-connection";
import { WorkbenchPageHeader } from "@/ui/workbench-page-header";
import { AssetFinancialValue } from "@/ui/asset-financial-value";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  ASSET_SOURCE_PROVIDERS,
  assetSourceAuthorizationBody,
  assetSourceProvider,
  initialAssetSourceFields,
  type AssetSourceFieldDescription,
  type AssetSourceFieldId,
  type AssetSourceProviderId,
} from "@/domain/asset-source-providers";
import { decimalToFixed } from "@/domain/decimal";
import type {
  AssetMoney,
  AssetPermission,
  BitgetAccountMode,
  ExternalServiceConfigurationStatus,
} from "@/server/ports";
import { VibeButton, VibeLink } from "@/ui/vibe/vibe-button";
import {
  VibeField,
  VibeSelectField,
  VibeTextAreaField,
} from "@/ui/vibe/vibe-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { lockOnUnauthorizedResponse, OWNER_SESSION_EXPIRED_MESSAGE, readJsonResult } from "@/ui/owner-request-lock";

interface Preview {
  id: string;
  provider: AssetSourceProviderId;
  account: { id: string; label: string };
  permissions: AssetPermission[];
  total: AssetMoney;
  accountMode?: BitgetAccountMode;
}

interface Reauthorization {
  sourceId: string;
  sourceLabel: string;
  provider: AssetSourceProviderId;
}

const EVM_CHAINS = ["ethereum", "bsc"] as const;
type EvmChain = (typeof EVM_CHAINS)[number];

const EVM_WATCH_WALLET = {
  id: "evm" as const,
  label: "EVM 观察钱包",
  fields: [
    {
      id: "addresses" as AssetSourceFieldId,
      label: "EVM 公开地址（每行一个）",
      control: "textarea" as const,
      required: true,
    },
  ] satisfies AssetSourceFieldDescription[],
  startLabel: "验证公开地址",
  fieldHelp: "仅查公开地址，无需私钥或签名。",
};

const MANUAL_ASSET_SOURCE = {
  id: "manual" as const,
  label: "手工记录资产",
  fields: [] satisfies AssetSourceFieldDescription[],
  fieldHelp: undefined,
};

type ProviderSelectionId =
  | AssetSourceProviderId
  | typeof EVM_WATCH_WALLET.id
  | typeof MANUAL_ASSET_SOURCE.id;
type FlowStep = "choose" | "configure" | "preview";

const PROVIDER_OPTIONS = [
  ...ASSET_SOURCE_PROVIDERS.filter(
    ({ id }) => id !== "ethereum" && id !== "bsc",
  ),
  EVM_WATCH_WALLET,
  MANUAL_ASSET_SOURCE,
];

function formatAmount(amount: string, fixed = false): string {
  const [integer, fraction] = (fixed ? decimalToFixed(amount, 2) : amount).split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

function isEvmProvider(value: ProviderSelectionId | ""): value is EvmChain | "evm" {
  return value === "evm" || value === "ethereum" || value === "bsc";
}

function stepLabel(
  step: FlowStep,
  current: FlowStep,
  label: string,
): string {
  return step === current ? `${label}（当前步骤）` : label;
}

export function AssetSourceFlow({
  reauthorization,
}: {
  reauthorization?: Reauthorization;
}) {
  const router = useRouter();
  const isReauthorizing = reauthorization !== undefined;
  const [step, setStep] = useState<FlowStep>(
    isReauthorizing ? "configure" : "choose",
  );
  const [providerId, setProviderId] = useState<ProviderSelectionId | "">(
    reauthorization?.provider ?? "",
  );
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [evmChains, setEvmChains] = useState<EvmChain[]>(
    isReauthorizing && isEvmProvider(reauthorization?.provider ?? "")
      ? [reauthorization!.provider as EvmChain]
      : [...EVM_CHAINS],
  );
  const [error, setError] = useState("");
  const operationLock = useRef(false);
  const leavingFlow = useRef(false);
  const configureTitle = useRef<HTMLHeadingElement>(null);
  const revalidationChains = useRef<EvmChain[] | null>(null);
  const focusConfiguration = useRef(false);
  const [operation, setOperation] = useState<"verify" | "save" | "cancel" | null>(null);
  const pending = operation !== null;
  const [recovery, setRecovery] = useState<"revalidate" | "check" | null>(null);
  const [savedProviders, setSavedProviders] = useState<AssetSourceProviderId[]>([]);
  const [uncertainId, setUncertainId] = useState<string | null>(null);
  const [longbridgeMode, setLongbridgeMode] = useState<LongbridgeConnectionMode>("cli");
  const [longbridgeReady, setLongbridgeReady] = useState(false);
  const [fields, setFields] = useState(initialAssetSourceFields);
  const [manualLabel, setManualLabel] = useState("");
  const [evmServiceStatus, setEvmServiceStatus] =
    useState<ExternalServiceConfigurationStatus | null>(null);

  const provider =
    providerId && providerId !== "evm" && providerId !== "manual"
      ? assetSourceProvider(providerId)
      : null;
  const selectedProvider =
    provider ??
    (providerId === "evm"
      ? EVM_WATCH_WALLET
      : providerId === "manual"
        ? MANUAL_ASSET_SOURCE
        : null);
  const preview = previews[0] ?? null;
  const isEvm = isEvmProvider(providerId);
  const previewUrl = reauthorization === undefined
    ? null
    : `/api/asset-sources/${encodeURIComponent(reauthorization.sourceId)}/reauthorize/preview`;
  const confirmUrl = reauthorization === undefined
    ? null
    : `/api/asset-sources/${encodeURIComponent(reauthorization.sourceId)}/reauthorize/confirm`;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const callbackError = params.get("longbridge_error");
    const previewId = params.get("longbridge_preview");
    if (callbackError) {
      setProviderId("longbridge");
      setError(callbackError);
      setStep("configure");
      return;
    }
    if (!previewId) return;
    if (providerId !== "longbridge") {
      setProviderId("longbridge");
      return;
    }
    const endpoint = previewUrl ?? "/api/asset-sources/longbridge/preview";
    void fetch(`${endpoint}?id=${encodeURIComponent(previewId)}`)
      .then(async (response) => {
        const expired = lockOnUnauthorizedResponse(response);
        const body = await readJsonResult<Preview & { error?: string }>(response);
        if (expired) throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
        if (!response.ok || body === null) throw new Error(body?.error ?? "授权预览失败");
        setPreviews([body]);
        setStep("preview");
        window.history.replaceState(null, "", window.location.pathname);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "授权预览失败");
        setStep("configure");
      });
  }, [previewUrl, providerId]);

  useEffect(() => {
    if (!isEvm || step !== "configure") return;
    let active = true;
    void fetch("/api/external-services")
      .then(async (response) => response.ok
        ? response.json() as Promise<ExternalServiceConfigurationStatus>
        : null)
      .then((result) => {
        if (active) setEvmServiceStatus(result);
      })
      .catch(() => {
        if (active) setEvmServiceStatus(null);
      });
    return () => {
      active = false;
    };
  }, [isEvm, step]);

  useEffect(() => {
    if (step === "configure" && focusConfiguration.current) {
      focusConfiguration.current = false;
      configureTitle.current?.focus();
    }
  }, [step]);

  function beginOperation(next: NonNullable<typeof operation>): boolean {
    if (operationLock.current) return false;
    operationLock.current = true;
    setOperation(next);
    setError("");
    return true;
  }

  function endOperation() {
    if (leavingFlow.current) return;
    operationLock.current = false;
    setOperation(null);
  }

  function updateField(id: AssetSourceFieldId, value: string) {
    setFields((current) => ({ ...current, [id]: value }));
  }

  function chooseProvider(id: ProviderSelectionId) {
    setProviderId(id);
    setError("");
    setStep("configure");
  }

  function leaveFlow() {
    leavingFlow.current = true;
    router.push(
      reauthorization === undefined
        ? "/settings?view=data#asset-sources"
        : `/asset-sources/${encodeURIComponent(reauthorization.sourceId)}?view=manage`,
    );
  }

  function backToChoice() {
    setProviderId("");
    setError("");
    setStep("choose");
  }

  function sourceAuthorizationBody() {
    if (!provider) return null;
    return assetSourceAuthorizationBody(provider, fields);
  }

  async function startOAuth() {
    if (!beginOperation("verify")) return;
    const endpoint = reauthorization === undefined
      ? "/api/asset-sources/longbridge/oauth/start"
      : `/api/asset-sources/${encodeURIComponent(reauthorization.sourceId)}/reauthorize/oauth/start`;
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: longbridgeMode }) });
      const body = await readJsonResult<{ authorizationUrl?: string; error?: string }>(response);
      if (lockOnUnauthorizedResponse(response)) throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
      if (!response.ok || !body?.authorizationUrl) throw new Error(body?.error ?? "无法开始长桥授权");
      window.location.assign(body.authorizationUrl);
    } catch (caught) {
      setError(caught instanceof TypeError ? "网络连接异常，请重试授权。" : caught instanceof Error ? caught.message : "无法开始长桥授权");
    } finally {
      endOperation();
    }
  }

  async function startSinglePreview() {
    if (!provider) return;
    if (!beginOperation("verify")) return;
    try {
      const endpoint = previewUrl ?? `/api/asset-sources/${provider.route}/preview`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(providerId === "longbridge" ? { mode: longbridgeMode } : sourceAuthorizationBody()),
      });
      const body = await readJsonResult<Preview & { error?: string }>(response);
      if (lockOnUnauthorizedResponse(response)) throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
      if (!response.ok || !body?.id) throw new Error(body?.error ?? provider.validationError);
      setFields(initialAssetSourceFields());
      setPreviews([body]);
      setStep("preview");
    } catch (caught) {
      setError(caught instanceof TypeError ? "网络连接异常，请重试验证。" : caught instanceof Error ? caught.message : provider.validationError);
    } finally { endOperation(); }
  }

  function previewDeleteUrl(current: Preview): string {
    const description = assetSourceProvider(current.provider);
    return previewUrl === null
      ? `/api/asset-sources/${description.route}/preview?id=${encodeURIComponent(current.id)}&provider=${current.provider}`
      : `${previewUrl}?id=${encodeURIComponent(current.id)}`;
  }

  async function startEvmPreview() {
    const chains = isReauthorizing ? [reauthorization.provider as EvmChain] : evmChains;
    if (chains.length === 0) {
      setError("请至少选择一条 EVM 链");
      return;
    }
    if (!beginOperation("verify")) return;
    try {
      const addresses = fields.addresses.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
      // 等待每条链结束，失败时也能清理另一条链已经生成的临时预览。
      const results = await Promise.allSettled(chains.map(async (chain) => {
        const response = await fetch(previewUrl ?? "/api/asset-sources/evm/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chain, addresses }),
        });
        const expired = lockOnUnauthorizedResponse(response);
        const body = await readJsonResult<Preview & { error?: string }>(response);
        if (expired) throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
        if (!response.ok || !body?.id) throw new Error(body?.error ?? "EVM 公开地址验证失败");
        return body;
      }));
      const successful = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length > 0) {
        const cleanup = await Promise.allSettled(successful.map(async (current) => {
          const response = await fetch(previewDeleteUrl(current), { method: "DELETE" });
          if (lockOnUnauthorizedResponse(response)) throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
          if (!response.ok) throw new Error("临时预览清理失败");
        }));
        const expired = [...failures, ...cleanup].some((result) => result.status === "rejected" && result.reason instanceof Error && result.reason.message === OWNER_SESSION_EXPIRED_MESSAGE);
        const reason = failures[0].reason;
        setError(expired ? OWNER_SESSION_EXPIRED_MESSAGE : reason instanceof TypeError
          ? "网络连接异常，请重试验证。"
          : reason instanceof Error ? reason.message : "EVM 公开地址验证失败");
        if (!expired && cleanup.some((result) => result.status === "rejected")) {
          setError("验证未完成，部分临时预览未能清理，将在 10 分钟内失效；尚未保存来源，可重新验证。");
        }
        return;
      }
      setFields(initialAssetSourceFields());
      setPreviews(successful);
      setStep("preview");
    } catch {
      setError("网络连接异常，请重试验证。");
    } finally {
      endOperation();
    }
  }

  async function start() {
    if (providerId === "manual") {
      setError("");
      setStep("preview");
      return;
    }
    if (isEvm) {
      await startEvmPreview();
      return;
    }
    await startSinglePreview();
  }

  function confirmationFailed(body: { error?: string; code?: string } | null, fallback: string, current?: Preview) {
    if (body?.code === "preview-unavailable" || body?.code === "scope-changed") {
      setRecovery("revalidate");
    } else if (body?.code === "preview-busy") {
      setRecovery("check");
      setUncertainId(current?.id ?? null);
    }
    setError(body?.error ?? fallback);
  }

  async function confirmManualAsset() {
    const response = await fetch("/api/asset-sources/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: manualLabel }),
    });
    if (lockOnUnauthorizedResponse(response)) {
      setError(OWNER_SESSION_EXPIRED_MESSAGE);
      return;
    }
    if (!response.ok) {
      const body = await readJsonResult<{ error?: string }>(response);
      setError(body?.error ?? "手工资产记录保存失败");
      return;
    }
    // 无效成功响应无法确认来源已创建，不能当作成功进入下一步。
    const body = await readJsonResult<{ error?: string; ok?: boolean }>(response);
    if (body?.ok !== true) {
      setError("尚未确认来源是否创建，请刷新页面核对后再重试。");
      return;
    }
    leaveFlow();
    router.refresh();
  }

  async function confirmPreviews() {
    const remaining = [...previews];
    for (const current of previews) {
      const description = assetSourceProvider(current.provider);
      const response = await fetch(confirmUrl ?? `/api/asset-sources/${description.route}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: current.id, provider: current.provider }),
      });
      if (lockOnUnauthorizedResponse(response)) {
        setError(OWNER_SESSION_EXPIRED_MESSAGE);
        return;
      }
      const body = await readJsonResult<{ error?: string; code?: string; ok?: boolean }>(response);
      if (!response.ok) {
        confirmationFailed(body, `保存 ${description.label} 来源失败`, current);
        return;
      }
      if (body?.ok !== true) {
        // 空 2xx 不是确定失败，不进恢复流，只保留预览让用户核对后重试。
        setError(`尚未确认 ${description.label} 来源是否保存，请刷新页面核对后再重试。`);
        return;
      }
      remaining.shift();
      setSavedProviders((saved) => [...saved, current.provider]);
      setPreviews([...remaining]);
    }
    leaveFlow();
    router.refresh();
  }

  async function confirm() {
    if (recovery !== null || !beginOperation("save")) return;
    try {
      if (providerId === "manual") await confirmManualAsset();
      else await confirmPreviews();
    } catch {
      setRecovery("check");
      // 已收到成功响应的链已从 previews 移除；中断的请求不能当作未保存。
      setUncertainId(null);
      setError("网络连接异常，保存结果尚不确定。请先核对来源，避免重复保存。");
    } finally {
      endOperation();
    }
  }

  async function cancelPreview(revalidate = false) {
    if (recovery === "check" || !beginOperation("cancel")) return;
    if (revalidate && isEvm && revalidationChains.current === null) {
      revalidationChains.current = previews.map(({ provider }) => provider as EvmChain);
    }
    try {
      // 成功取消的项立即移除，后续失败时不会再次确认已经取消的预览。
      for (const current of previews) {
        const response = await fetch(previewDeleteUrl(current), { method: "DELETE" });
        if (lockOnUnauthorizedResponse(response)) {
          setError(OWNER_SESSION_EXPIRED_MESSAGE);
          return;
        }
        if (!response.ok) {
          setError("未能取消临时预览，请重试取消。已保存的来源会保留。");
          return;
        }
        setPreviews((remaining) => remaining.filter(({ id }) => id !== current.id));
      }
      if (revalidate) {
        if (isEvm && !isReauthorizing) setEvmChains(revalidationChains.current ?? []);
        setFields(initialAssetSourceFields());
        revalidationChains.current = null;
        setRecovery(null);
        setUncertainId(null);
        focusConfiguration.current = true;
        setStep("configure");
      } else {
        leaveFlow();
        router.refresh();
      }
    } catch {
      setError("网络连接异常，取消尚未完成，请重试取消。已保存的来源会保留。");
    } finally {
      endOperation();
    }
  }

  const ready =
    providerId === "longbridge"
      ? longbridgeReady
      : providerId === "manual"
      ? manualLabel.trim() !== ""
      : selectedProvider !== null &&
        selectedProvider.fields.every(
          (field) => fields[field.id].trim().length > 0,
        ) &&
        (isReauthorizing || providerId !== "evm" || evmChains.length > 0);
  const flowTitle = isReauthorizing
    ? providerId === "longbridge" ? `管理 ${reauthorization.sourceLabel} 连接` : `重新授权 ${reauthorization.sourceLabel}`
    : "新增资产来源";
  const configurationTitle = providerId === "longbridge" ? "连接长桥" : providerId === "manual"
    ? "填写来源名称"
    : isEvm
      ? "填写公开地址"
      : "填写只读授权";
  const startLabel = pending
    ? "正在校验…"
    : providerId === "longbridge" ? "连接并预览" : providerId === "manual"
      ? "查看确认"
      : providerId === "evm"
        ? EVM_WATCH_WALLET.startLabel
        : provider?.startLabel ?? "验证只读授权";

  return (
    <section className="asset-source-flow" aria-label={flowTitle}>
      <WorkbenchPageHeader
        title={flowTitle}
      />

      <ol aria-label="来源接入步骤" className="asset-source-flow__steps">
        {!isReauthorizing ? (
          <li data-current={step === "choose" ? "true" : undefined}>
            {stepLabel("choose", step, "1 来源")}
          </li>
        ) : null}
        <li data-current={step === "configure" ? "true" : undefined}>
          {stepLabel("configure", step, isReauthorizing ? "1 配置" : "2 配置")}
        </li>
        <li data-current={step === "preview" ? "true" : undefined}>
          {stepLabel("preview", step, isReauthorizing ? "2 确认" : "3 确认")}
        </li>
      </ol>

      {error ? (
        <VibeNotice className="asset-source-flow__notice" role="alert" tone="error">
          {error}
        </VibeNotice>
      ) : null}

      {step === "choose" ? (
        <section aria-labelledby="source-flow-choose-title" className="asset-source-flow__panel">
          <h2 id="source-flow-choose-title">选择来源类型</h2>
          <div aria-label="来源类型" className="source-provider-list" role="group">
            {PROVIDER_OPTIONS.map((description) => (
              <VibeButton
                className="source-provider-button"
                key={description.id}
                onClick={() => chooseProvider(description.id)}
                type="button"
                variant="outline"
              >
                <span>{description.label}</span>
                <span aria-hidden="true">→</span>
              </VibeButton>
            ))}
          </div>
          <VibeButton onClick={leaveFlow} type="button" variant="text">
            取消返回
          </VibeButton>
        </section>
      ) : null}

      {step === "configure" && selectedProvider !== null ? (
        <section aria-labelledby="source-flow-configure-title" className="asset-source-flow__panel">
          <h2 id="source-flow-configure-title" ref={configureTitle} tabIndex={-1}>{configurationTitle}</h2>
          {providerId !== "manual" ? <p>{providerId === "longbridge" ? "仅连接只读账户权限。" : isEvm ? "仅使用公开地址，无需私钥。" : "仅使用具有读取权限的授权。"}</p> : null}
          {providerId === "longbridge" ? (
            <LongbridgeConnectionSettings sourceId={reauthorization?.sourceId} mode={longbridgeMode} onMode={setLongbridgeMode} onReady={setLongbridgeReady} onAuthorizeSdk={() => void startOAuth()} pending={pending} />
          ) : providerId === "manual" ? (
            <VibeField
              autoComplete="off"
              autoFocus
              disabled={pending}
              fieldId="manual-asset-label"
              label="资产名称"
              maxLength={40}
              onChange={(event) => setManualLabel(event.currentTarget.value)}
              placeholder="例如：A股"
              value={manualLabel}
            />
          ) : (
            <div className="source-credential-fields">
              {isEvm &&
              evmServiceStatus !== null &&
              (!evmServiceStatus.coinGecko.configured ||
                !evmServiceStatus.ethereumRpc.configured ||
                !evmServiceStatus.bscRpc.configured) ? (
                <VibeNotice role="status" tone="info">
                  EVM 钱包依赖全局 CoinGecko、Ethereum RPC 与 BSC RPC 配置。
                  <VibeLink href="/settings?view=data#external-services" variant="text">配置行情与链上服务</VibeLink>
                </VibeNotice>
              ) : null}
              {selectedProvider.fields.map((field) =>
                field.control === "select" ? (
                  <VibeSelectField
                    disabled={pending}
                    fieldId={`asset-source-${field.id}`}
                    key={field.id}
                    label={field.label}
                    onValueChange={(value) => updateField(field.id, value)}
                    options={field.options ?? []}
                    value={fields[field.id]}
                  />
                ) : field.control === "textarea" ? (
                  <VibeTextAreaField
                    autoComplete="off"
                    disabled={pending}
                    fieldId={`asset-source-${field.id}`}
                    key={field.id}
                    label={field.label}
                    onChange={(event) => updateField(field.id, event.target.value)}
                    rows={4}
                    value={fields[field.id]}
                  />
                ) : (
                  <VibeField
                    autoComplete={field.control === "password" ? "new-password" : "off"}
                    disabled={pending}
                    fieldId={`asset-source-${field.id}`}
                    key={field.id}
                    label={field.label}
                    onChange={(event) => updateField(field.id, event.target.value)}
                    type={field.control}
                    value={fields[field.id]}
                  />
                ),
              )}
              {providerId === "evm" && !isReauthorizing ? (
                <fieldset className="source-evm-chains" disabled={pending}>
                  <legend className="vibe-field__label">同步链</legend>
                  {EVM_CHAINS.map((chain) => {
                    const description = assetSourceProvider(chain);
                    return (
                      <label className="vibe-choice" key={chain}>
                        <input
                          type="checkbox"
                          checked={evmChains.includes(chain)}
                          onChange={(event) =>
                            setEvmChains((current) =>
                              event.target.checked
                                ? [...current, chain]
                                : current.filter((value) => value !== chain),
                            )
                          }
                        />
                        <span>{description.label}</span>
                      </label>
                    );
                  })}
                </fieldset>
              ) : null}
              {selectedProvider.fieldHelp ? (
                <p className="source-field-help">{selectedProvider.fieldHelp}</p>
              ) : null}
            </div>
          )}
          <div className="asset-source-flow__actions">
            {!isReauthorizing ? (
              <VibeButton disabled={pending} onClick={backToChoice} type="button" variant="text">
                上一步
              </VibeButton>
            ) : (
              <VibeButton disabled={pending} onClick={leaveFlow} type="button" variant="text">
                取消返回
              </VibeButton>
            )}
            <VibeButton
              aria-busy={pending}
              disabled={pending || !ready}
              onClick={() => void start()}
              type="button"
              variant="primary"
            >
              {startLabel}
            </VibeButton>
          </div>
        </section>
      ) : null}

      {step === "preview" ? (
        <section aria-labelledby="source-flow-preview-title" className="asset-source-flow__panel">
          <h2 id="source-flow-preview-title">
            {providerId === "manual" ? "确认手工来源" : "确认资产来源"}
          </h2>
          <div role="status">
            {savedProviders.length > 0 ? <p>已保存：{savedProviders.map((id) => assetSourceProvider(id).label).join("、")}。已保存来源会保留。</p> : null}
          </div>
          {providerId === "manual" ? (
            <>
              <dl className="source-preview-list vibe-preview-list">
                <div className="vibe-data-row">
                  <dt>资产名称</dt>
                  <dd>{manualLabel}</dd>
                </div>
                <div className="vibe-data-row">
                  <dt>记录方式</dt>
                  <dd>仅记录总额</dd>
                </div>
              </dl>
            </>
          ) : (
            <>
              <dl className="source-preview-list vibe-preview-list">
                {previews.map((current) => {
                  const description = assetSourceProvider(current.provider);
                  return (
                    <div className="vibe-data-row" key={current.id}>
                      <dt>{description.label}</dt>
                      <dd>
                        <div>{current.account.label}</div>
                        {isEvmProvider(current.provider) ? <div>来源标识：{current.account.id}</div> : null}
                        {recovery === "check" && (uncertainId === null ? current.id === previews[0]?.id : uncertainId === current.id)
                          ? <div>保存结果待核对</div>
                          : savedProviders.length > 0 ? <div>待完成</div> : null}
                        {description.previewScope(current.accountMode)}，{" "}
                        <AssetFinancialValue unit={current.total.currency}>
                          {formatAmount(
                            current.total.amount,
                            current.provider !== "longbridge",
                          )}
                        </AssetFinancialValue>
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </>
          )}
          <div className="asset-source-flow__actions">
            <VibeButton
              disabled={pending || recovery === "check"}
              onClick={() => void cancelPreview()}
              type="button"
              variant="text"
            >
              {operation === "cancel" ? "正在取消…" : savedProviders.length > 0 ? "取消剩余预览" : "取消"}
            </VibeButton>
            {recovery === "check" ? (
              <VibeLink href={reauthorization === undefined ? "/settings?view=data#asset-sources" : `/asset-sources/${encodeURIComponent(reauthorization.sourceId)}?view=manage`} variant="primary">核对来源</VibeLink>
            ) : recovery === "revalidate" ? (
              <VibeButton disabled={pending} onClick={() => void cancelPreview(true)} type="button" variant="primary">重新验证</VibeButton>
            ) : <VibeButton
              aria-busy={operation === "save"}
              disabled={pending || (providerId !== "manual" && previews.length === 0)}
              onClick={() => void confirm()}
              type="button"
              variant="primary"
            >
              {operation === "save"
                ? "正在保存…"
                : providerId === "manual"
                  ? "确认创建来源"
                  : isReauthorizing
                    ? "确认更新授权"
                    : savedProviders.length > 0 ? "重试剩余来源" : "确认并保存"}
            </VibeButton>}
          </div>
        </section>
      ) : null}
    </section>
  );
}
