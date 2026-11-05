"use client";

import { useRef, useState, type FormEvent } from "react";

import type {
  ExternalServiceConfigurationInput,
  ExternalServiceConfigurationStatus,
} from "@/server/ports";
import {
  requestExternalServiceSave,
  requestExternalServiceStatus,
} from "@/ui/external-service-requests";
import { formatShanghaiDateTime } from "@/ui/shanghai-date-time";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeNotice } from "@/ui/vibe/vibe-notice";

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
] as const satisfies readonly {
  fieldId: string;
  id: keyof ExternalServiceConfigurationStatus;
  name: keyof ExternalServiceConfigurationInput;
  placeholderEmpty: string;
}[];

function stateText(configured: boolean, verifiedAt: string | null): string {
  if (!configured) return "未配置";
  return verifiedAt ? `已验证，${formatShanghaiDateTime(verifiedAt)}` : "已配置";
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
  const requestLock = useRef(false);
  const [needsCheck, setNeedsCheck] = useState(false);
  const [checked, setChecked] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestLock.current || needsCheck) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const body: ExternalServiceConfigurationInput = {};
    for (const { name } of SERVICE_FIELDS) {
      const value = data.get(name);
      if (typeof value === "string" && value.trim()) body[name] = value;
    }
    requestLock.current = true;
    setPending(true);
    setError("");
    setSaved(false);
    setChecked(false);
    try {
      const result = await requestExternalServiceSave(body);
      if (result.outcome !== "confirmed") {
        setNeedsCheck(result.outcome === "unconfirmed");
        setError(result.message);
        return;
      }
      setStatus(result.status);
      setSaved(true);
      form.reset();
    } finally {
      requestLock.current = false;
      setPending(false);
    }
  }

  async function checkStatus() {
    if (requestLock.current) return;
    requestLock.current = true;
    setPending(true);
    setError("");
    try {
      const result = await requestExternalServiceStatus();
      setStatus(result);
      setNeedsCheck(false);
      setChecked(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未能读取服务状态，请重试核对。输入已保留。");
    } finally {
      requestLock.current = false;
      setPending(false);
    }
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
                      disabled={pending}
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
            {needsCheck ? (
              <VibeButton disabled={pending} onClick={() => void checkStatus()} type="button" variant="primary">
                {pending ? "正在核对…" : "核对服务状态"}
              </VibeButton>
            ) : (
              <VibeButton disabled={pending} type="submit" variant="primary">
                {pending ? "正在保存…" : "保存并验证"}
              </VibeButton>
            )}
            <span>留空保持原值。</span>
          </div>
        </form>
        <div role="status">
          {checked ? <p>已重新读取服务状态。请核对验证时间；状态不显示密钥内容，如仍需替换，可重新保存。</p> : null}
        </div>
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
