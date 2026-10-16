"use client";

import { useState, type FormEvent } from "react";

import type {
  ExternalServiceConfigurationStatus,
} from "@/server/ports";
import { VibeButton } from "@/ui/vibe/vibe-button";
import { VibeField } from "@/ui/vibe/vibe-field";
import { VibeNotice } from "@/ui/vibe/vibe-notice";
import { lockOnUnauthorizedResponse, OWNER_SESSION_EXPIRED_MESSAGE, readJsonResult } from "@/ui/owner-request-lock";

const FIELD_LABELS = {
  coinGecko: "CoinGecko Demo API Key",
  ethereumRpc: "Ethereum RPC URL",
  bscRpc: "BNB Smart Chain RPC URL",
} as const;

function stateText(configured: boolean, verifiedAt: string | null): string {
  if (!configured) return "未配置";
  return verifiedAt ? `已验证 · ${verifiedAt.slice(0, 16).replace("T", " ")}` : "已配置";
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
      className="external-service-settings"
      aria-labelledby="external-service-settings-title"
    >
      <div className="external-service-settings__head">
        <div>
          <h2 id="external-service-settings-title">外部服务连接</h2>
        </div>
        <span className="external-service-settings__scope">GLOBAL / EVM</span>
      </div>
      <dl className="external-service-statuses" data-testid="external-service-statuses">
        {([
          ["coinGecko", status.coinGecko],
          ["ethereumRpc", status.ethereumRpc],
          ["bscRpc", status.bscRpc],
        ] as const).map(([id, service]) => (
          <div key={id}>
            <dt>{FIELD_LABELS[id]}</dt>
            <dd data-vibe-tone={service.configured ? "success" : "warning"}>
              {stateText(service.configured, service.verifiedAt)}
            </dd>
          </div>
        ))}
      </dl>
      <form className="external-service-form" onSubmit={save}>
        <VibeField
          autoComplete="off"
          fieldId="coingecko-demo-api-key"
          label={FIELD_LABELS.coinGecko}
          name="coinGeckoDemoApiKey"
          placeholder={status.coinGecko.configured ? "已配置；留空则保持不变" : "粘贴 Demo API Key"}
          required={!status.coinGecko.configured}
          type="password"
        />
        <VibeField
          autoComplete="off"
          fieldId="ethereum-rpc-url"
          label={FIELD_LABELS.ethereumRpc}
          name="ethereumRpcUrl"
          placeholder={status.ethereumRpc.configured ? "已配置；留空则保持不变" : "https://…"}
          required={!status.ethereumRpc.configured}
          type="password"
        />
        <VibeField
          autoComplete="off"
          fieldId="bsc-rpc-url"
          label={FIELD_LABELS.bscRpc}
          name="bscRpcUrl"
          placeholder={status.bscRpc.configured ? "已配置；留空则保持不变" : "https://…"}
          required={!status.bscRpc.configured}
          type="password"
        />
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
    </section>
  );
}
