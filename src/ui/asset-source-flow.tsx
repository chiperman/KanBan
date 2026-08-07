"use client";

import { useEffect, useState } from "react";

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
import { VibeDialog } from "@/ui/vibe/vibe-dialog";
import {
  VibeField,
  VibeSelectField,
  VibeTextAreaField,
} from "@/ui/vibe/vibe-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";

interface Preview {
  id: string;
  provider: AssetSourceProviderId;
  account: { id: string; label: string };
  permissions: AssetPermission[];
  total: AssetMoney;
  accountMode?: BitgetAccountMode;
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
  fieldHelp: "默认同步 Ethereum 与 BNB Smart Chain；相同地址会按两条链分别读取。",
};

const MANUAL_ASSET_SOURCE = {
  id: "manual" as const,
  label: "手工记录资产",
};

type ProviderSelectionId =
  | AssetSourceProviderId
  | typeof EVM_WATCH_WALLET.id
  | typeof MANUAL_ASSET_SOURCE.id;

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

export function AssetSourceFlow() {
  const [choosing, setChoosing] = useState(false);
  const [step, setStep] = useState<"choose" | "configure">("choose");
  const [providerId, setProviderId] = useState<ProviderSelectionId | "">("");
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [previewMode, setPreviewMode] = useState<"single" | "evm" | null>(null);
  const [evmChains, setEvmChains] = useState<EvmChain[]>(
    [...EVM_CHAINS],
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
    provider ?? (providerId === "evm" ? EVM_WATCH_WALLET : null);
  const preview = previews[0] ?? null;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const callbackError = params.get("longbridge_error");
    const previewId = params.get("longbridge_preview");
    if (callbackError) {
      setError(callbackError);
      setChoosing(true);
      return;
    }
    if (!previewId) return;
    void fetch(
      `/api/asset-sources/longbridge/preview?id=${encodeURIComponent(previewId)}`,
    )
      .then(async (response) => {
        const body = (await response.json()) as Preview & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "授权预览失败");
        setPreviews([body]);
        setPreviewMode("single");
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "授权预览失败");
        setChoosing(true);
      });
  }, []);

  useEffect(() => {
    if (providerId !== "evm" || step !== "configure") return;
    let active = true;
    void fetch("/api/external-services")
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<ExternalServiceConfigurationStatus>;
      })
      .then((result) => {
        if (active) setEvmServiceStatus(result);
      })
      .catch(() => {
        if (active) setEvmServiceStatus(null);
      });
    return () => {
      active = false;
    };
  }, [providerId, step]);

  function clearCallbackQuery() {
    window.history.replaceState(null, "", window.location.pathname);
  }

  function updateField(id: AssetSourceFieldId, value: string) {
    setFields((current) => ({ ...current, [id]: value }));
  }

  function chooseProvider(id: ProviderSelectionId) {
    setProviderId(id);
    setError("");
    window.requestAnimationFrame(() => setStep("configure"));
  }

  function cancelChoosing() {
    setFields(initialAssetSourceFields());
    setEvmChains([...EVM_CHAINS]);
    setManualLabel("");
    setProviderId("");
    setStep("choose");
    setChoosing(false);
    clearCallbackQuery();
  }

  async function startOAuth() {
    const response = await fetch("/api/asset-sources/longbridge/oauth/start", {
      method: "POST",
    });
    const body = (await response.json()) as {
      authorizationUrl?: string;
      state?: string;
      authorizationMode?: "browser-redirect" | "local-loopback";
      error?: string;
    };
    if (
      !response.ok ||
      !body.state ||
      (!body.authorizationUrl && body.authorizationMode !== "local-loopback")
    ) {
      setPending(false);
      setError(body.error ?? "无法开始长桥授权");
      return;
    }
    if (body.authorizationMode !== "local-loopback") {
      window.location.assign(body.authorizationUrl!);
      return;
    }
    if (body.authorizationUrl) {
      window.open(
        body.authorizationUrl,
        "longbridge-oauth",
        "popup,width=560,height=720",
      );
    }
    const deadline = Date.now() + 10 * 60_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      const status = await fetch(
        `/api/asset-sources/longbridge/oauth/status?state=${encodeURIComponent(body.state)}`,
      );
      const result = (await status.json().catch(() => null)) as
        | { status?: string; previewId?: string; error?: string }
        | null;
      if (status.ok && result?.status === "authorized" && result.previewId) {
        window.location.assign(
          `/?longbridge_preview=${encodeURIComponent(result.previewId)}`,
        );
        return;
      }
      if (!status.ok || result?.error) {
        setPending(false);
        setError(result?.error ?? "长桥授权状态读取失败");
        return;
      }
    }
    setPending(false);
    setError("等待长桥授权超时，请重新开始");
  }

  async function start() {
    if (providerId === "manual") {
      await saveManualAsset();
      return;
    }
    if (providerId === "evm") {
      await startEvm();
      return;
    }
    if (!provider) return;
    setPending(true);
    setError("");
    if (provider.authorization === "oauth") {
      await startOAuth();
      return;
    }
    const response = await fetch(
      `/api/asset-sources/${provider.route}/preview`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assetSourceAuthorizationBody(provider, fields)),
      },
    );
    const body = (await response.json().catch(() => null)) as
      | (Preview & { error?: string })
      | null;
    setPending(false);
    if (!response.ok || !body) {
      setError(body?.error ?? provider.validationError);
      return;
    }
    setFields(initialAssetSourceFields());
    setChoosing(false);
    setPreviews([body]);
    setPreviewMode("single");
  }

  async function saveManualAsset() {
    setPending(true);
    setError("");
    const response = await fetch("/api/asset-sources/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: manualLabel,
      }),
    });
    const body = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    if (!response.ok) {
      setPending(false);
      setError(body?.error ?? "手工资产记录保存失败");
      return;
    }
    window.location.reload();
  }

  async function startEvm() {
    if (evmChains.length === 0) {
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
      evmChains.map(async (chain) => {
        const response = await fetch("/api/asset-sources/evm/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chain, addresses }),
        });
        const body = (await response.json().catch(() => null)) as
          | (Preview & { error?: string })
          | null;
        return { chain, body, ok: response.ok && body !== null };
      }),
    );
    const failed = results.find((result) => !result.ok);
    if (failed) {
      await Promise.all(
        results
          .filter(
            (result): result is { chain: EvmChain; body: Preview; ok: true } =>
              result.ok && result.body !== null,
          )
          .map(({ chain, body }) =>
            fetch(
              `/api/asset-sources/evm/preview?id=${encodeURIComponent(body.id)}&provider=${chain}`,
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
    setChoosing(false);
    setPreviews(results.map(({ body }) => body!));
    setPreviewMode("evm");
  }

  async function confirm() {
    if (previewMode === "evm") {
      await confirmEvm();
      return;
    }
    if (!preview) return;
    const description = assetSourceProvider(preview.provider);
    setPending(true);
    const response = await fetch(
      `/api/asset-sources/${description.route}/confirm`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: preview.id, provider: preview.provider }),
      },
    );
    const body = (await response.json()) as { error?: string };
    if (!response.ok) {
      setPending(false);
      setError(body.error ?? `保存 ${description.label} 来源失败`);
      return;
    }
    clearCallbackQuery();
    window.location.reload();
  }

  async function confirmEvm() {
    setPending(true);
    setError("");
    const remaining = [...previews];
    for (const current of previews) {
      const description = assetSourceProvider(current.provider);
      const response = await fetch("/api/asset-sources/evm/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: current.id, provider: current.provider }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setPending(false);
        setPreviews(remaining);
        setError(
          remaining.length === previews.length
            ? body?.error ?? "保存 EVM 观察钱包失败"
            : `已保存部分链；${description.label} 保存失败：${body?.error ?? "请重试"}`,
        );
        return;
      }
      remaining.shift();
    }
    clearCallbackQuery();
    window.location.reload();
  }

  async function cancelPreview() {
    await Promise.all(
      previews.map((current) => {
        const description = assetSourceProvider(current.provider);
        return fetch(
          `/api/asset-sources/${description.route}/preview?id=${encodeURIComponent(current.id)}&provider=${current.provider}`,
          { method: "DELETE" },
        );
      }),
    );
    setPreviews([]);
    setPreviewMode(null);
    setEvmChains([...EVM_CHAINS]);
    setChoosing(false);
    clearCallbackQuery();
  }

  const ready =
    providerId === "manual"
      ? manualLabel.trim() !== ""
      : selectedProvider !== null &&
        selectedProvider.fields.every(
          (field) => fields[field.id].trim().length > 0,
        ) &&
        (providerId !== "evm" || evmChains.length > 0);
  const previewDescription = preview
    ? assetSourceProvider(preview.provider)
    : null;
  const startActionLabel = pending
    ? providerId === "manual"
      ? "正在保存…"
      : providerId === "evm"
        ? "正在验证公开地址…"
        : provider?.authorization === "oauth"
          ? "正在准备授权…"
          : "正在验证只读凭证…"
    : providerId === "manual"
      ? "添加资产来源"
      : selectedProvider?.startLabel ?? "开始 OAuth 授权";

  return (
    <>
      <VibeButton
        type="button"
        onClick={() => {
          setError("");
          setProviderId("");
          setStep("choose");
          setChoosing(true);
        }}
        variant="outline"
      >
        添加资产来源
      </VibeButton>
      {error && !choosing && previews.length === 0 ? (
        <VibeNotice className="content-error" role="alert" tone="error">
          {error}
        </VibeNotice>
      ) : null}
      {choosing ? (
        <VibeDialog
          actions={
            <>
              <VibeButton
                type="button"
                disabled={pending}
                onClick={cancelChoosing}
                variant="text"
              >
                取消
              </VibeButton>
              {step === "configure" ? (
                <VibeButton
                  type={providerId === "manual" ? "submit" : "button"}
                  aria-busy={pending}
                  className={pending ? "source-dialog-action--pending" : undefined}
                  disabled={pending || !ready}
                  onClick={
                    providerId === "manual" ? undefined : () => void start()
                  }
                  variant="primary"
                >
                  {pending ? (
                    <span
                      aria-hidden="true"
                      className="source-dialog-pending-indicator"
                    />
                  ) : null}
                  {startActionLabel}
                </VibeButton>
              ) : null}
            </>
          }
          aria-label="添加资产来源"
          className="source-dialog"
          description={
            step === "choose"
              ? "选择可连接的账户、观察钱包，或手工记录的资产总额。"
              : providerId === "manual"
                ? "先创建独立资产来源；之后在对应卡片内添加或编辑每日总额。"
                : "连接成功前不会保存凭证或来源。"
          }
          eyebrow={
            providerId === "manual"
              ? "MANUAL ASSET / DAILY TOTAL"
              : "ASSET SOURCE / READ ONLY"
          }
          onClose={cancelChoosing}
          onSubmit={
            providerId === "manual"
              ? (event) => {
                  event.preventDefault();
                  void saveManualAsset();
                }
              : undefined
          }
          title={
            step === "choose"
              ? "选择来源类型"
              : providerId === "manual"
                ? "创建手工资产来源"
                : selectedProvider?.label ?? "配置来源"
          }
          titleId="asset-source-dialog-title"
        >
          {step === "configure" ? (
            <VibeButton
              type="button"
              className="source-dialog-back"
              disabled={pending}
              onClick={() => {
                setError("");
                setStep("choose");
              }}
              variant="text"
            >
              返回来源列表
            </VibeButton>
          ) : null}
          {error ? (
            <VibeNotice className="login-error" role="alert" tone="error">
              {error}
            </VibeNotice>
          ) : null}
          {step === "choose" ? (
            <div className="source-provider-list">
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
                    onClick={() => {
                      if (providerId === description.id) chooseProvider(description.id);
                    }}
                    onChange={(event) =>
                      chooseProvider(event.target.value as ProviderSelectionId)
                    }
                  />
                  <span>{description.label}</span>
                </label>
              ))}
            </div>
          ) : null}
          {step === "configure" && providerId === "manual" ? (
            <div className="source-credential-fields">
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
            </div>
          ) : step === "configure" && selectedProvider?.fields.length ? (
            <div className="source-credential-fields">
              {providerId === "evm" &&
              evmServiceStatus !== null &&
              (!evmServiceStatus.coinGecko.configured ||
                !evmServiceStatus.ethereumRpc.configured ||
                !evmServiceStatus.bscRpc.configured) ? (
                <VibeNotice
                  className="source-evm-service-notice"
                  role="status"
                  tone="info"
                >
                  EVM 钱包依赖全局 CoinGecko、Ethereum RPC 与 BSC RPC 配置。
                  <VibeLink href="/settings" variant="text">
                    前往本机设置
                  </VibeLink>
                </VibeNotice>
              ) : null}
              {selectedProvider.fields.map((field) =>
                field.control === "select" ? (
                  <VibeSelectField
                    fieldId={`asset-source-${field.id}`}
                    key={field.id}
                    label={field.label}
                    options={field.options ?? []}
                    value={fields[field.id]}
                    onValueChange={(value) => updateField(field.id, value)}
                  />
                ) : field.control === "textarea" ? (
                  <VibeTextAreaField
                    autoComplete="off"
                    fieldId={`asset-source-${field.id}`}
                    key={field.id}
                    label={field.label}
                    rows={4}
                    value={fields[field.id]}
                    onChange={(event) => updateField(field.id, event.target.value)}
                  />
                ) : (
                  <VibeField
                    autoComplete={field.control === "password" ? "new-password" : "off"}
                    fieldId={`asset-source-${field.id}`}
                    key={field.id}
                    label={field.label}
                    type={field.control}
                    value={fields[field.id]}
                    onChange={(event) => updateField(field.id, event.target.value)}
                  />
                ),
              )}
              {providerId === "evm" ? (
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
                <p className="vibe-dialog__copy source-field-help">
                  {selectedProvider.fieldHelp}
                </p>
              ) : null}
            </div>
          ) : null}
        </VibeDialog>
      ) : null}
      {preview && previewDescription ? (
        <VibeDialog
          actions={
            <>
              <VibeButton
                type="button"
                disabled={pending}
                onClick={() => void cancelPreview()}
                variant="text"
              >
                取消
              </VibeButton>
              <VibeButton
                type="button"
                aria-busy={pending}
                className={pending ? "source-dialog-action--pending" : undefined}
                disabled={pending}
                onClick={() => void confirm()}
                variant="primary"
              >
                {pending ? (
                  <span
                    aria-hidden="true"
                    className="source-dialog-pending-indicator"
                  />
                ) : null}
                {pending ? "正在保存…" : "确认并保存"}
              </VibeButton>
            </>
          }
          aria-label={
            previewMode === "evm"
              ? "确认 EVM 观察钱包"
              : previewDescription.dialogLabel
          }
          description={
            previewMode === "evm"
              ? "确认后会分别保存所选链的公开地址配置。"
              : `确认后才会把${previewDescription.savedMaterial}写入服务端存储。`
          }
          eyebrow={
            previewMode === "evm"
              ? "EVM 观察钱包公开地址预览"
              : previewDescription.previewTitle
          }
          onClose={() => void cancelPreview()}
          title={
            previewMode === "evm"
              ? `EVM 观察钱包 · ${previews.length} 条链`
              : preview.account.label
          }
          titleId="asset-source-preview-title"
        >
          <dl className="source-preview-list vibe-preview-list">
            {previewMode === "evm"
              ? previews.map((current) => {
                  const description = assetSourceProvider(current.provider);
                  return (
                    <div className="vibe-data-row" key={current.provider}>
                      <dt>{description.label}</dt>
                      <dd>
                        {description.previewScope()} ·{" "}
                        {formatAmount(current.total.amount, true)} {current.total.currency}
                      </dd>
                    </div>
                  );
                })
              : (
                <>
                  <div className="vibe-data-row">
                    <dt>可读取范围</dt>
                    <dd>{previewDescription.previewScope(preview.accountMode)}</dd>
                  </div>
                  <div className="vibe-data-row">
                    <dt>账户总额</dt>
                    <dd>
                      {formatAmount(preview.total.amount, preview.provider !== "longbridge")} {preview.total.currency}
                    </dd>
                  </div>
                </>
              )}
          </dl>
          {error ? (
            <VibeNotice className="login-error" role="alert" tone="error">
              {error}
            </VibeNotice>
          ) : null}
        </VibeDialog>
      ) : null}
    </>
  );
}
