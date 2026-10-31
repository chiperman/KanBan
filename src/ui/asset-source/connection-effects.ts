import { useEffect, useState } from "react";

import {
  pluginProviderDescription,
  type AssetSourcePluginDescription,
} from "@/domain/asset-source-plugin-description";
import {
  initialAssetSourceFields,
  type AssetSourceProviderDescription,
  type AssetSourceProviderId,
} from "@/domain/asset-source-providers";
import type { ExternalServiceConfigurationStatus } from "@/server/ports";
import {
  lockOnUnauthorizedResponse,
  OWNER_SESSION_EXPIRED_MESSAGE,
  readJsonResult,
} from "@/ui/owner-request-lock";
import type {
  FlowStep,
  Preview,
  ProviderSelectionId,
  Reauthorization,
  SourceFields,
} from "./shared";

export function useSourceProviderCatalog({
  reauthorization,
  setProviders,
  setFields,
  setError,
}: {
  reauthorization?: Reauthorization;
  setProviders(providers: AssetSourceProviderDescription[]): void;
  setFields(fields: SourceFields): void;
  setError(error: string): void;
}) {
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
    void fetch("/api/asset-sources/plugins", { cache: "no-store", signal })
      .then(async (response) => {
        if (lockOnUnauthorizedResponse(response)) throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
        const body = await readJsonResult<{
          providers: { id: AssetSourceProviderId; description: AssetSourcePluginDescription }[];
        }>(response);
        signal.throwIfAborted();
        if (!response.ok || !Array.isArray(body?.providers)) throw new Error("读取来源插件失败");
        return body.providers;
      })
      .then((installed) => {
        if (!active) return;
        const descriptions = installed.map((p) => pluginProviderDescription(p.id, p.description));
        setProviders(descriptions);
        const reauthorizingPlugin = descriptions.find((p) => p.id === reauthorization?.provider);
        if (reauthorizingPlugin) setFields(initialAssetSourceFields(reauthorizingPlugin));
        if (reauthorization && !installed.some((p) => p.id === reauthorization.provider))
          setError("来源插件不可用，请安装或启用后重新打开接入页面。");
      })
      .catch((caught) => {
        if (active) setError(
          caught instanceof Error && caught.message === OWNER_SESSION_EXPIRED_MESSAGE
            ? OWNER_SESSION_EXPIRED_MESSAGE
            : "读取来源插件失败，请刷新页面重试。",
        );
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [reauthorization, setProviders, setFields, setError]);
}

export function useLongbridgePreviewCallback({
  previewUrl,
  providerId,
  step,
  setProviderId,
  setError,
  setStep,
  setPreviews,
}: {
  previewUrl: string | null;
  providerId: ProviderSelectionId | "";
  step: FlowStep;
  setProviderId(provider: ProviderSelectionId | ""): void;
  setError(error: string): void;
  setStep(step: FlowStep): void;
  setPreviews(previews: Preview[]): void;
}) {
  const [callbackPreviewId, setCallbackPreviewId] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("longbridge_error") && !url.searchParams.has("longbridge_preview"))
      return;
    const callbackError = url.searchParams.get("longbridge_error");
    const previewId = url.searchParams.get("longbridge_preview");
    url.searchParams.delete("longbridge_error");
    url.searchParams.delete("longbridge_preview");
    window.history.replaceState(window.history.state, "", url);
    if (!callbackError && !previewId) return;
    setProviderId("longbridge");
    setStep("configure");
    if (callbackError) {
      setError(callbackError);
      return;
    }
    setError("");
    setCallbackPreviewId(previewId);
  }, [setProviderId, setError, setStep]);

  const pending = callbackPreviewId !== null && providerId === "longbridge" && step === "configure";

  useEffect(() => {
    if (!pending || callbackPreviewId === null) return;
    let active = true;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
    const endpoint = previewUrl ?? "/api/asset-sources/longbridge/preview";
    void fetch(`${endpoint}?id=${encodeURIComponent(callbackPreviewId)}`, { cache: "no-store", signal })
      .then(async (response) => {
        if (lockOnUnauthorizedResponse(response)) throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
        const body = await readJsonResult<Preview & { error?: string }>(response);
        signal.throwIfAborted();
        if (!response.ok || !body?.id) throw new Error(body?.error ?? "授权预览失败，请重新授权。");
        if (!active) return;
        setCallbackPreviewId(null);
        setPreviews([body]);
        setStep("preview");
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setCallbackPreviewId(null);
        setError(
          caught instanceof Error && caught.name === "TimeoutError"
            ? "读取授权预览超时，请重新授权。"
            : caught instanceof TypeError
              ? "网络连接异常，请重新授权。"
              : caught instanceof Error
                ? caught.message
                : "授权预览失败，请重新授权。",
        );
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [previewUrl, pending, callbackPreviewId, setError, setStep, setPreviews]);

  return pending;
}

export function useEvmServiceConfiguration(
  isEvm: boolean,
  step: FlowStep,
  setEvmServiceStatus: (status: ExternalServiceConfigurationStatus | null) => void,
) {
  useEffect(() => {
    if (!isEvm || step !== "configure") return;
    let active = true;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
    void fetch("/api/external-services", { cache: "no-store", signal })
      .then(async (response) => {
        if (lockOnUnauthorizedResponse(response) || !response.ok) return null;
        const body = await readJsonResult<ExternalServiceConfigurationStatus>(response);
        signal.throwIfAborted();
        return body;
      })
      .then((result) => {
        if (active) setEvmServiceStatus(result);
      })
      .catch(() => {
        if (active) setEvmServiceStatus(null);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [isEvm, step, setEvmServiceStatus]);
}
