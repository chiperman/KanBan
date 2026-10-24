"use client";

import { useState, type FormEvent } from "react";

import type {
  ExternalServiceConfigurationStatus,
} from "@/server/ports";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { lockOnUnauthorizedResponse, OWNER_SESSION_EXPIRED_MESSAGE, readJsonResult } from "@/ui/owner-request-lock";

const FIELD_LABELS = {
  coinGecko: "CoinGecko Demo API Key",
  ethereumRpc: "Ethereum RPC URL",
  bscRpc: "BNB Smart Chain RPC URL",
} as const;

/* 服务名只在此处声明一次：状态与输入框共用同一行组，
   不再让三个服务名在上方摘要和下方表单里各出现一次。 */
const SERVICE_FIELDS = [
  {
    fieldId: "coingecko-demo-api-key",
    id: "coinGecko",
    name: "coinGeckoDemoApiKey",
    placeholderEmpty: "粘贴 Demo API Key",
  },
  {
    fieldId: "ethereum-rpc-url",
    id: "ethereumRpc",
    name: "ethereumRpcUrl",
    placeholderEmpty: "https://…",
  },
  {
    fieldId: "bsc-rpc-url",
    id: "bscRpc",
    name: "bscRpcUrl",
    placeholderEmpty: "https://…",
  },
] as const;

function stateText(configured: boolean, verifiedAt: string | null): string {
  if (!configured) return "未配置";
  return verifiedAt ? `已验证，${verifiedAt.slice(0, 16).replace("T", " ")}` : "已配置";
}

export function ExternalServiceSettings({
  initialStatus,
}: {
  initialStatus: ExternalServiceConfigurationStatus;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const body = Object.fromEntries(
      [
        ["coinGeckoDemoApiKey", data.get("coinGeckoDemoApiKey")],
        ["ethereumRpcUrl", data.get("ethereumRpcUrl")],
        ["bscRpcUrl", data.get("bscRpcUrl")],
      ].flatMap(([key, value]) =>
        typeof value === "string" && value.trim() ? [[key, value]] : [],
      ),
    );
    setPending(true);
    setError("");
    setSaved(false);
    const response = await fetch("/api/external-services", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await readJsonResult<
      | (ExternalServiceConfigurationStatus & { error?: never })
      | { error?: string }
    >(response);
    if (lockOnUnauthorizedResponse(response)) {
      setError(OWNER_SESSION_EXPIRED_MESSAGE);
      setPending(false);
      return;
    }
    if (!response.ok || !result || "error" in result) {
      setError(result && "error" in result ? result.error ?? "外部服务保存失败" : "外部服务保存失败");
      setPending(false);
      return;
    }
    setStatus(result as ExternalServiceConfigurationStatus);
    setSaved(true);
    setPending(false);
    form.reset();
  }

  return (
    <section
      className="data-maintenance-section"
      id="external-services"
      aria-labelledby="external-service-settings-title"
    >
      <h2 id="external-service-settings-title">行情与链上服务</h2>
      <div className="data-maintenance-section__content">
        <form className="external-service-form" onSubmit={save}>
          <dl className="external-service-statuses" data-testid="external-service-statuses">
            {SERVICE_FIELDS.map((field) => {
              const service = status[field.id];
              return (
                <div className="external-service-statuses__row" key={field.id}>
                  <dt className="external-service-statuses__term">
                    <label className="vibe-field__label" htmlFor={field.fieldId}>
                      {FIELD_LABELS[field.id]}
                    </label>
                  </dt>
                  {/* 状态与字段同处一行，读作「这个字段现在是什么状态」 */}
                  <dd
                    className="external-service-statuses__state"
                    data-vibe-tone={service.configured ? "success" : "muted"}
                  >
                    {stateText(service.configured, service.verifiedAt)}
                  </dd>
                  <dd className="external-service-statuses__input">
                    <input
                      autoComplete="off"
                      className="vibe-field__input"
                      id={field.fieldId}
                      name={field.name}
                      placeholder={
                        service.configured
                          ? "输入新值可替换"
                          : field.placeholderEmpty
                      }
                      required={!service.configured}
                      type="password"
                    />
                  </dd>
                </div>
              );
            })}
          </dl>
          <div className="external-service-form__actions">
            <VibeButton disabled={pending} type="submit" variant="primary">
              {pending ? "正在保存…" : "保存并验证"}
            </VibeButton>
            <span>留空保持原值。</span>
          </div>
        </form>
        {saved ? (
          <VibeNotice role="status" tone="success">
            已保存并验证。
          </VibeNotice>
        ) : null}
        {error ? (
          <VibeNotice role="alert" tone="error">
            {error}
          </VibeNotice>
        ) : null}
      </div>
    </section>
  );
}
