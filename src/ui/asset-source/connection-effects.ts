import { useEffect } from "react";

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
    void fetch("/api/asset-sources/plugins")
      .then(async (response) => {
        if (lockOnUnauthorizedResponse(response)) throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
        if (!response.ok) throw new Error("读取来源插件失败");
        return response.json() as Promise<{
          providers: { id: AssetSourceProviderId; description: AssetSourcePluginDescription }[];
        }>;
      })
      .then(({ providers: installed }) => {
        if (!active) return;
        const descriptions = installed.map((p) => pluginProviderDescription(p.id, p.description));
        setProviders(descriptions);
        const reauthorizingPlugin = descriptions.find((p) => p.id === reauthorization?.provider);
        if (reauthorizingPlugin) setFields(initialAssetSourceFields(reauthorizingPlugin));
        if (reauthorization && !installed.some((p) => p.id === reauthorization.provider))
          setError("来源插件不可用，请安装或启用后重启服务");
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "读取来源插件失败");
      });
    return () => {
      active = false;
    };
  }, [reauthorization, setProviders, setFields, setError]);
}

export function useLongbridgePreviewCallback({
  previewUrl,
  providerId,
  setProviderId,
  setError,
  setStep,
  setPreviews,
}: {
  previewUrl: string | null;
  providerId: ProviderSelectionId | "";
  setProviderId(provider: ProviderSelectionId | ""): void;
  setError(error: string): void;
  setStep(step: FlowStep): void;
  setPreviews(previews: Preview[]): void;
}) {
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
  }, [previewUrl, providerId, setProviderId, setError, setStep, setPreviews]);
}

export function useEvmServiceConfiguration(
  isEvm: boolean,
  step: FlowStep,
  setEvmServiceStatus: (status: ExternalServiceConfigurationStatus | null) => void,
) {
  useEffect(() => {
    if (!isEvm || step !== "configure") return;
    let active = true;
    void fetch("/api/external-services")
      .then(async (response) =>
        response.ok ? (response.json() as Promise<ExternalServiceConfigurationStatus>) : null,
      )
      .then((result) => {
        if (active) setEvmServiceStatus(result);
      })
      .catch(() => {
        if (active) setEvmServiceStatus(null);
      });
    return () => {
      active = false;
    };
  }, [isEvm, step, setEvmServiceStatus]);
}
