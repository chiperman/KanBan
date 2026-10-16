"use client";

import { WorkbenchPageHeader } from "@/ui/workbench-page-header";

import { useEffect, useState } from "react";
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
  const [pending, setPending] = useState(false);
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

  function updateField(id: AssetSourceFieldId, value: string) {
    setFields((current) => ({ ...current, [id]: value }));
  }

  function chooseProvider(id: ProviderSelectionId) {
    setProviderId(id);
    setError("");
    setStep("configure");
  }

  function backToDirectory() {
    router.push("/asset-sources");
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
    const endpoint = reauthorization === undefined
      ? "/api/asset-sources/longbridge/oauth/start"
      : `/api/asset-sources/${encodeURIComponent(reauthorization.sourceId)}/reauthorize/oauth/start`;
    const response = await fetch(endpoint, { method: "POST" });
    const body = await readJsonResult<{ authorizationUrl?: string; error?: string }>(response);
    if (lockOnUnauthorizedResponse(response)) {
      setError(OWNER_SESSION_EXPIRED_MESSAGE);
      setPending(false);
      return;
    }
    if (!response.ok || !body?.authorizationUrl) {
      setError(body?.error ?? "无法开始长桥授权");
      setPending(false);
      return;
    }
    window.location.assign(body.authorizationUrl);
  }

  async function startSinglePreview() {
    if (!provider) return;
    setPending(true);
    setError("");
    if (provider.authorization === "oauth") {
      await startOAuth();
      return;
    }
    const endpoint = previewUrl ?? `/api/asset-sources/${provider.route}/preview`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sourceAuthorizationBody()),
    });
    const body = await readJsonResult<Preview & { error?: string }>(response);
    setPending(false);
    if (lockOnUnauthorizedResponse(response)) {
      setError(OWNER_SESSION_EXPIRED_MESSAGE);
      return;
    }
    if (!response.ok || body === null) {
      setError(body?.error ?? provider.validationError);
      return;
    }
    setFields(initialAssetSourceFields());
    setPreviews([body]);
    setStep("preview");
  }

  async function startEvmPreview() {
    const chains = isReauthorizing
      ? [reauthorization.provider as EvmChain]
      : evmChains;
    if (chains.length === 0) {
      setError("请至少选择一条 EVM 链");
      return;
    }
    setPending(true);
    setError("");
    const addresses = fields.addresses
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
    const results = await Promise.all(
      chains.map(async (chain) => {
        const endpoint = previewUrl ?? "/api/asset-sources/evm/preview";
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chain, addresses }),
        });
        const body = await readJsonResult<Preview & { error?: string }>(response);
        return { chain, body, expired: lockOnUnauthorizedResponse(response), ok: response.ok && body !== null };
      }),
    );
    if (results.some((result) => result.expired)) {
      setPending(false);
      setError(OWNER_SESSION_EXPIRED_MESSAGE);
      return;
    }
    const failed = results.find((result) => !result.ok);
    if (failed) {
      await Promise.all(
        results
          .filter(
            (result): result is { chain: EvmChain; body: Preview; expired: boolean; ok: true } =>
              result.ok && result.body !== null,
          )
          .map(({ chain, body }) =>
            fetch(
              previewUrl === null
                ? `/api/asset-sources/evm/preview?id=${encodeURIComponent(body.id)}&provider=${chain}`
                : `${previewUrl}?id=${encodeURIComponent(body.id)}`,
              { method: "DELETE" },
            ),
          ),
      );
      setPending(false);
      setError(failed.body?.error ?? "EVM 公开地址验证失败");
      return;
    }
    setPending(false);
    setFields(initialAssetSourceFields());
    setPreviews(results.map(({ body }) => body!));
    setStep("preview");
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

  async function confirmManualAsset() {
    setPending(true);
    setError("");
    const response = await fetch("/api/asset-sources/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: manualLabel }),
    });
    const body = await readJsonResult<{ error?: string }>(response);
    if (lockOnUnauthorizedResponse(response)) {
      setPending(false);
      setError(OWNER_SESSION_EXPIRED_MESSAGE);
      return;
    }
    if (!response.ok) {
      setPending(false);
      setError(body?.error ?? "手工资产记录保存失败");
      return;
    }
    router.push("/asset-sources");
    router.refresh();
  }

  async function confirmSingle() {
    if (!preview || !provider) return;
    setPending(true);
    setError("");
    const endpoint = confirmUrl ?? `/api/asset-sources/${provider.route}/confirm`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: preview.id, provider: preview.provider }),
    });
    const body = await readJsonResult<{ error?: string }>(response);
    if (lockOnUnauthorizedResponse(response)) {
      setPending(false);
      setError(OWNER_SESSION_EXPIRED_MESSAGE);
      return;
    }
    if (!response.ok) {
      setPending(false);
      setError(body?.error ?? `保存 ${provider.label} 来源失败`);
      return;
    }
    router.push(
      reauthorization === undefined
        ? "/asset-sources"
        : `/asset-sources/${encodeURIComponent(reauthorization.sourceId)}`,
    );
    router.refresh();
  }

  async function confirmEvm() {
    setPending(true);
    setError("");
    const remaining = [...previews];
    for (const current of previews) {
      const endpoint = confirmUrl ?? "/api/asset-sources/evm/confirm";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: current.id, provider: current.provider }),
      });
      const body = await readJsonResult<{ error?: string }>(response);
      if (lockOnUnauthorizedResponse(response)) {
        setPending(false);
        setPreviews(remaining);
        setError(OWNER_SESSION_EXPIRED_MESSAGE);
        return;
      }
      if (!response.ok) {
        setPending(false);
        setPreviews(remaining);
        setError(body?.error ?? "保存 EVM 观察钱包失败");
        return;
      }
      remaining.shift();
    }
    router.push(
      reauthorization === undefined
        ? "/asset-sources"
        : `/asset-sources/${encodeURIComponent(reauthorization.sourceId)}`,
    );
    router.refresh();
  }

  async function confirm() {
    if (providerId === "manual") {
      await confirmManualAsset();
    } else if (isEvm) {
      await confirmEvm();
    } else {
      await confirmSingle();
    }
  }

  async function cancelPreview() {
    await Promise.all(
      previews.map((current) => {
        const description = assetSourceProvider(current.provider);
        const endpoint = previewUrl === null
          ? `/api/asset-sources/${description.route}/preview?id=${encodeURIComponent(current.id)}&provider=${current.provider}`
          : `${previewUrl}?id=${encodeURIComponent(current.id)}`;
        return fetch(endpoint, { method: "DELETE" });
      }),
    );
    backToDirectory();
  }

  const ready =
    providerId === "manual"
      ? manualLabel.trim() !== ""
      : selectedProvider !== null &&
        selectedProvider.fields.every(
          (field) => fields[field.id].trim().length > 0,
        ) &&
        (isReauthorizing || providerId !== "evm" || evmChains.length > 0);
  const flowTitle = isReauthorizing
    ? `重新授权 ${reauthorization.sourceLabel}`
    : "新增资产来源";
  const configurationTitle = providerId === "manual"
    ? "填写来源名称"
    : isEvm
      ? "填写公开地址"
      : "填写只读授权";
  const startLabel = pending
    ? "正在校验…"
    : providerId === "manual"
      ? "查看确认"
      : providerId === "evm"
        ? EVM_WATCH_WALLET.startLabel
        : provider?.startLabel ?? "验证只读授权";

  return (
    <section className="asset-source-flow" aria-label={flowTitle}>
      <WorkbenchPageHeader
        eyebrow={isReauthorizing ? "SOURCE / REAUTHORIZE" : "SOURCE / ONBOARDING"}
        title={flowTitle}
      />

      <ol aria-label="来源接入步骤" className="asset-source-flow__steps">
        {!isReauthorizing ? (
          <li data-current={step === "choose" ? "true" : undefined}>
            {stepLabel("choose", step, "1 选来源")}
          </li>
        ) : null}
        <li data-current={step === "configure" ? "true" : undefined}>
          {stepLabel("configure", step, isReauthorizing ? "1 填授权" : "2 填授权")}
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
          <fieldset aria-label="来源类型" className="source-provider-list">
            {PROVIDER_OPTIONS.map((description) => (
              <label
                className="source-option vibe-choice"
                data-vibe-component="choice"
                key={description.id}
              >
                <input
                  type="radio"
                  name="asset-provider"
                  value={description.id}
                  checked={providerId === description.id}
                  onChange={() => chooseProvider(description.id)}
                />
                <span>{description.label}</span>
              </label>
            ))}
          </fieldset>
          <VibeButton onClick={backToDirectory} type="button" variant="text">
            取消返回
          </VibeButton>
        </section>
      ) : null}

      {step === "configure" && selectedProvider !== null ? (
        <section aria-labelledby="source-flow-configure-title" className="asset-source-flow__panel">
          <h2 id="source-flow-configure-title">{configurationTitle}</h2>
          <p>
            {providerId === "manual"
              ? "无凭证；确认后创建。"
              : isReauthorizing && isEvm
                ? "仅接受公开地址。"
                : isEvm
                  ? "仅接受公开地址。"
                  : "仅接受只读权限。"}
          </p>
          {providerId === "manual" ? (
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
                  <VibeLink href="/settings" variant="text">前往本机设置</VibeLink>
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
                <fieldset className="source-evm-chains">
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
              <VibeButton disabled={pending} onClick={backToDirectory} type="button" variant="text">
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
            {providerId === "manual" ? "确认手工来源" : "校验与范围预览"}
          </h2>
          {providerId === "manual" ? (
            <>
              <dl className="source-preview-list vibe-preview-list">
                <div className="vibe-data-row">
                  <dt>来源能力</dt>
                  <dd>无凭证来源</dd>
                </div>
                <div className="vibe-data-row">
                  <dt>数据边界</dt>
                  <dd>仅记录总额</dd>
                </div>
              </dl>
            </>
          ) : (
            <>
              <p>已验证；确认后保存。</p>
              <dl className="source-preview-list vibe-preview-list">
                {previews.map((current) => {
                  const description = assetSourceProvider(current.provider);
                  return (
                    <div className="vibe-data-row" key={current.id}>
                      <dt>{description.label}</dt>
                      <dd>
                        {description.previewScope(current.accountMode)} ·{" "}
                        {formatAmount(
                          current.total.amount,
                          current.provider !== "longbridge",
                        )} {current.total.currency}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </>
          )}
          <div className="asset-source-flow__actions">
            <VibeButton
              disabled={pending}
              onClick={() => void cancelPreview()}
              type="button"
              variant="text"
            >
              取消
            </VibeButton>
            <VibeButton
              aria-busy={pending}
              disabled={pending}
              onClick={() => void confirm()}
              type="button"
              variant="primary"
            >
              {pending
                ? "正在保存…"
                : providerId === "manual"
                  ? "确认创建来源"
                  : isReauthorizing
                    ? "确认更新授权"
                    : "确认并保存"}
            </VibeButton>
          </div>
        </section>
      ) : null}
    </section>
  );
}
