"use client";

import { useEffect, useState } from "react";

import {
  ASSET_SOURCE_PROVIDERS,
  assetSourceAuthorizationBody,
  assetSourceProvider,
  initialAssetSourceFields,
  type AssetSourceFieldId,
  type AssetSourceProviderId,
} from "@/domain/asset-source-providers";
import { decimalToFixed } from "@/domain/decimal";
import type {
  AssetMoney,
  AssetPermission,
  BitgetAccountMode,
} from "@/server/ports";
import { VibeButton } from "@/ui/vibe/vibe-button";
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

function formatAmount(amount: string, fixed = false): string {
  const [integer, fraction] = (fixed ? decimalToFixed(amount, 2) : amount).split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export function AssetSourceFlow() {
  const [choosing, setChoosing] = useState(false);
  const [step, setStep] = useState<"choose" | "configure">("choose");
  const [providerId, setProviderId] = useState<AssetSourceProviderId | "">("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState(initialAssetSourceFields);
  const provider = providerId ? assetSourceProvider(providerId) : null;

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
        setPreview(body);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "授权预览失败");
        setChoosing(true);
      });
  }, []);

  function clearCallbackQuery() {
    window.history.replaceState(null, "", window.location.pathname);
  }

  function updateField(id: AssetSourceFieldId, value: string) {
    setFields((current) => ({ ...current, [id]: value }));
  }

  function chooseProvider(id: AssetSourceProviderId) {
    setProviderId(id);
    setError("");
    window.requestAnimationFrame(() => setStep("configure"));
  }

  function cancelChoosing() {
    setFields(initialAssetSourceFields());
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
    setPreview(body);
  }

  async function confirm() {
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

  async function cancelPreview() {
    if (preview) {
      const description = assetSourceProvider(preview.provider);
      await fetch(
        `/api/asset-sources/${description.route}/preview?id=${encodeURIComponent(preview.id)}&provider=${preview.provider}`,
        { method: "DELETE" },
      );
    }
    setPreview(null);
    setChoosing(false);
    clearCallbackQuery();
  }

  const ready =
    provider !== null &&
    provider.fields.every((field) => fields[field.id].trim().length > 0);
  const previewDescription = preview
    ? assetSourceProvider(preview.provider)
    : null;

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
      {error && !choosing && !preview ? (
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
                  type="button"
                  disabled={pending || !ready}
                  onClick={() => void start()}
                  variant="primary"
                >
                  {provider?.startLabel ?? "开始 OAuth 授权"}
                </VibeButton>
              ) : null}
            </>
          }
          aria-label="添加资产来源"
          className="source-dialog"
          description={
            step === "choose"
              ? "先选择只读账户或观察钱包，再填写对应的连接信息。"
              : "连接成功前不会保存凭证或来源。"
          }
          eyebrow="ASSET SOURCE / READ ONLY"
          title={step === "choose" ? "选择来源类型" : provider?.label ?? "配置来源"}
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
              {ASSET_SOURCE_PROVIDERS.map((description) => (
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
                      chooseProvider(event.target.value as AssetSourceProviderId)
                    }
                  />
                  <span>{description.label}</span>
                </label>
              ))}
            </div>
          ) : null}
          {step === "configure" && provider?.fields.length ? (
            <div className="source-credential-fields">
              {provider.fields.map((field) =>
                field.control === "select" ? (
                  <VibeSelectField
                    fieldId={`asset-source-${field.id}`}
                    key={field.id}
                    label={field.label}
                    value={fields[field.id]}
                    onChange={(event) => updateField(field.id, event.target.value)}
                  >
                    {field.options?.map((option) => (
                      <option value={option.value} key={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </VibeSelectField>
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
              {provider.fieldHelp ? (
                <p className="vibe-dialog__copy source-field-help">{provider.fieldHelp}</p>
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
                disabled={pending}
                onClick={() => void confirm()}
                variant="primary"
              >
                确认并保存
              </VibeButton>
            </>
          }
          aria-label={previewDescription.dialogLabel}
          description={`确认后才会把${previewDescription.savedMaterial}写入服务端存储。`}
          eyebrow={previewDescription.previewTitle}
          title={preview.account.label}
          titleId="asset-source-preview-title"
        >
          <dl className="source-preview-list vibe-preview-list">
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
