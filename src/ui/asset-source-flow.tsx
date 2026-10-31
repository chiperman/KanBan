"use client";

import {
  useEvmServiceConfiguration,
  useLongbridgePreviewCallback,
  useSourceProviderCatalog,
} from "./asset-source/connection-effects";

import type { LongbridgeConnectionMode } from "@/server/asset-sources/longbridge-connection";
import { WorkbenchPageHeader } from "@/ui/workbench-page-header";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  assetSourceProvider,
  initialAssetSourceFields,
  type AssetSourceFieldId,
  type AssetSourceProviderDescription,
  type AssetSourceProviderId,
} from "@/domain/asset-source-providers";
import type { ExternalServiceConfigurationStatus } from "@/server/ports";
import {
  lockOnUnauthorizedResponse,
  OWNER_SESSION_EXPIRED_MESSAGE,
  readJsonResult,
} from "@/ui/owner-request-lock";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeNotice } from "@/ui/vibe/vibe-notice";

import {
  EVM_CHAINS,
  isEvmProvider,
  type EvmChain,
  type Preview,
  type ProviderSelectionId,
  type Reauthorization,
} from "./asset-source/shared";

import { SourceChooseStep } from "./asset-source/choose-step";
import { SourceConfigureStep } from "./asset-source/configure-step";
import {
  previewDeleteUrl,
  requestEvmPreviews,
  requestSinglePreview,
} from "./asset-source/preview-requests";
import { SourcePreviewStep } from "./asset-source/preview-step";
import {
  EVM_WATCH_WALLET,
  MANUAL_ASSET_SOURCE,
  stepLabel,
  type FlowStep,
} from "./asset-source/shared";

export function AssetSourceFlow({ reauthorization }: { reauthorization?: Reauthorization }) {
  const router = useRouter();
  const [providers, setProviders] = useState<AssetSourceProviderDescription[]>([]);
  const providerOptions = [
    ...providers.filter((p) => p.id !== "ethereum" && p.id !== "bsc"),
    ...(providers.some((p) => p.id === "ethereum" || p.id === "bsc") ? [EVM_WATCH_WALLET] : []),
    MANUAL_ASSET_SOURCE,
  ];
  const descriptionFor = (id: AssetSourceProviderId) =>
    providers.find((p) => p.id === id) ?? assetSourceProvider(id);

  const isReauthorizing = reauthorization !== undefined;
  const [step, setStep] = useState<FlowStep>(isReauthorizing ? "configure" : "choose");
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
      ? (providers.find((p) => p.id === providerId) ?? null)
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
  const previewUrl =
    reauthorization === undefined
      ? null
      : `/api/asset-sources/${encodeURIComponent(reauthorization.sourceId)}/reauthorize/preview`;
  const confirmUrl =
    reauthorization === undefined
      ? null
      : `/api/asset-sources/${encodeURIComponent(reauthorization.sourceId)}/reauthorize/confirm`;

  useSourceProviderCatalog({ reauthorization, setProviders, setFields, setError });

  const callbackPending = useLongbridgePreviewCallback({
    previewUrl,
    providerId,
    step,
    setProviderId,
    setError,
    setStep,
    setPreviews,
  });
  const pending = operation !== null || callbackPending;

  useEvmServiceConfiguration(isEvm, step, setEvmServiceStatus);

  useEffect(() => {
    if (step === "configure" && focusConfiguration.current) {
      focusConfiguration.current = false;
      configureTitle.current?.focus();
    }
  }, [step]);

  function beginOperation(next: NonNullable<typeof operation>): boolean {
    if (operationLock.current || callbackPending) return false;
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
    setFields(initialAssetSourceFields(providers.find((p) => p.id === id)));
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

  async function startOAuth() {
    if (!beginOperation("verify")) return;
    const endpoint =
      reauthorization === undefined
        ? "/api/asset-sources/longbridge/oauth/start"
        : `/api/asset-sources/${encodeURIComponent(reauthorization.sourceId)}/reauthorize/oauth/start`;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: longbridgeMode }),
      });
      const body = await readJsonResult<{ authorizationUrl?: string; error?: string }>(response);
      if (lockOnUnauthorizedResponse(response)) throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
      if (!response.ok || !body?.authorizationUrl)
        throw new Error(body?.error ?? "无法开始长桥授权");
      window.location.assign(body.authorizationUrl);
    } catch (caught) {
      setError(
        caught instanceof TypeError
          ? "网络连接异常，请重试授权。"
          : caught instanceof Error
            ? caught.message
            : "无法开始长桥授权",
      );
    } finally {
      endOperation();
    }
  }

  async function startSinglePreview() {
    if (!provider) return;
    if (!beginOperation("verify")) return;
    try {
      const endpoint = previewUrl ?? `/api/asset-sources/${provider.route}/preview`;
      const body = await requestSinglePreview({
        endpoint,
        provider,
        providerId,
        longbridgeMode,
        fields,
      });
      setFields(initialAssetSourceFields(provider));
      setPreviews([body]);
      setStep("preview");
    } catch (caught) {
      setError(
        caught instanceof TypeError
          ? "网络连接异常，请重试验证。"
          : caught instanceof Error
            ? caught.message
            : provider.validationError,
      );
    } finally {
      endOperation();
    }
  }

  async function startEvmPreview() {
    const chains = isReauthorizing
      ? [reauthorization.provider as EvmChain]
      : evmChains.filter((chain) => providers.some((p) => p.id === chain));
    if (chains.length === 0) {
      setError("请至少选择一条 EVM 链");
      return;
    }
    if (!beginOperation("verify")) return;
    try {
      const addresses = fields.addresses
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean);
      // 等待每条链结束，失败时也能清理另一条链已经生成的临时预览。
      const results = await requestEvmPreviews(chains, addresses, previewUrl);
      const successful = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length > 0) {
        const cleanup = await Promise.allSettled(
          successful.map(async (current) => {
            const response = await fetch(previewDeleteUrl(current, previewUrl), {
              method: "DELETE",
            });
            if (lockOnUnauthorizedResponse(response))
              throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
            if (!response.ok) throw new Error("临时预览清理失败");
          }),
        );
        const expired = [...failures, ...cleanup].some(
          (result) =>
            result.status === "rejected" &&
            result.reason instanceof Error &&
            result.reason.message === OWNER_SESSION_EXPIRED_MESSAGE,
        );
        const reason = failures[0].reason;
        setError(
          expired
            ? OWNER_SESSION_EXPIRED_MESSAGE
            : reason instanceof TypeError
              ? "网络连接异常，请重试验证。"
              : reason instanceof Error
                ? reason.message
                : "EVM 公开地址验证失败",
        );
        if (!expired && cleanup.some((result) => result.status === "rejected")) {
          setError(
            "验证未完成，部分临时预览未能清理，将在 10 分钟内失效；尚未保存来源，可重新验证。",
          );
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

  function confirmationFailed(
    body: { error?: string; code?: string } | null,
    fallback: string,
    current?: Preview,
  ) {
    if (body?.code === "preview-unavailable" || body?.code === "scope-changed") {
      setRecovery("revalidate");
    } else if (body?.code === "preview-busy") {
      setRecovery("check");
      setUncertainId(current?.id ?? null);
    }
    setError(body?.error ?? fallback);
  }

  function confirmationUnknown(current?: Preview) {
    setRecovery("check");
    setUncertainId(current?.id ?? null);
    setError("尚未确认来源是否保存。请先核对来源，避免重复保存。");
  }

  async function confirmManualAsset() {
    const signal = AbortSignal.timeout(30_000);
    const response = await fetch("/api/asset-sources/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: manualLabel }),
      signal,
    });
    if (lockOnUnauthorizedResponse(response)) {
      setError(OWNER_SESSION_EXPIRED_MESSAGE);
      return;
    }
    const body = await readJsonResult<{ error?: string; ok?: boolean }>(response);
    signal.throwIfAborted();
    if (response.status >= 500 || (response.ok && body?.ok !== true)) {
      confirmationUnknown();
      return;
    }
    if (!response.ok) {
      setError(body?.error ?? "手工资产记录保存失败");
      return;
    }
    leaveFlow();
    router.refresh();
  }

  async function confirmPreviews() {
    const remaining = [...previews];
    for (const current of previews) {
      const description = assetSourceProvider(current.provider);
      const signal = AbortSignal.timeout(30_000);
      const response = await fetch(
        confirmUrl ?? `/api/asset-sources/${description.route}/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: current.id, provider: current.provider }),
          signal,
        },
      );
      if (lockOnUnauthorizedResponse(response)) {
        setError(OWNER_SESSION_EXPIRED_MESSAGE);
        return;
      }
      const body = await readJsonResult<{ error?: string; code?: string; ok?: boolean }>(response);
      signal.throwIfAborted();
      if (response.status >= 500 || (response.ok && body?.ok !== true)) {
        confirmationUnknown(current);
        return;
      }
      if (!response.ok) {
        confirmationFailed(body, `保存 ${description.label} 来源失败`, current);
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
      // 已收到成功响应的链已从 previews 移除；中断的请求不能当作未保存。
      confirmationUnknown();
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
        const response = await fetch(previewDeleteUrl(current, previewUrl), { method: "DELETE" });
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
        setFields(initialAssetSourceFields(provider ?? undefined));
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
          selectedProvider.fields.every((field) => (fields[field.id] ?? "").trim().length > 0) &&
          (isReauthorizing || providerId !== "evm" || evmChains.length > 0);
  const flowTitle = isReauthorizing
    ? providerId === "longbridge"
      ? `管理 ${reauthorization.sourceLabel} 连接`
      : `重新授权 ${reauthorization.sourceLabel}`
    : "新增资产来源";
  const configurationTitle =
    providerId === "longbridge"
      ? "连接长桥"
      : providerId === "manual"
        ? "填写来源名称"
        : isEvm
          ? "填写公开地址"
          : "填写只读授权";
  const startLabel = pending
    ? "正在校验…"
    : providerId === "longbridge"
      ? "连接并预览"
      : providerId === "manual"
        ? "查看确认"
        : providerId === "evm"
          ? EVM_WATCH_WALLET.startLabel
          : (provider?.startLabel ?? "验证只读授权");

  return (
    <section className="asset-source-flow" aria-label={flowTitle}>
      <WorkbenchPageHeader title={flowTitle} />

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
        <SourceChooseStep
          providerOptions={providerOptions}
          chooseProvider={chooseProvider}
          leaveFlow={leaveFlow}
        />
      ) : null}

      {step === "configure" && selectedProvider === null ? (
        <VibeButton onClick={leaveFlow} type="button" variant="text">
          返回资产
        </VibeButton>
      ) : null}

      {step === "configure" && selectedProvider !== null ? (
        <SourceConfigureStep
          configureTitle={configureTitle}
          configurationTitle={configurationTitle}
          providerId={providerId}
          isEvm={isEvm}
          pending={pending}
          reauthorization={reauthorization}
          longbridgeMode={longbridgeMode}
          setLongbridgeMode={setLongbridgeMode}
          setLongbridgeReady={setLongbridgeReady}
          startOAuth={startOAuth}
          manualLabel={manualLabel}
          setManualLabel={setManualLabel}
          evmServiceStatus={evmServiceStatus}
          selectedProvider={selectedProvider}
          updateField={updateField}
          fields={fields}
          isReauthorizing={isReauthorizing}
          providers={providers}
          descriptionFor={descriptionFor}
          evmChains={evmChains}
          setEvmChains={setEvmChains}
          backToChoice={backToChoice}
          leaveFlow={leaveFlow}
          ready={ready}
          start={start}
          startLabel={startLabel}
        />
      ) : null}

      {step === "preview" ? (
        <SourcePreviewStep
          providerId={providerId}
          savedProviders={savedProviders}
          manualLabel={manualLabel}
          previews={previews}
          descriptionFor={descriptionFor}
          recovery={recovery}
          uncertainId={uncertainId}
          pending={pending}
          cancelPreview={cancelPreview}
          operation={operation}
          reauthorization={reauthorization}
          confirm={confirm}
          isReauthorizing={isReauthorizing}
        />
      ) : null}
    </section>
  );
}
