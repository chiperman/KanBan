import type { LongbridgeConnectionMode } from "@/server/asset-sources/longbridge-connection";

import {
  assetSourceAuthorizationBody,
  assetSourceProvider,
  type AssetSourceProviderDescription,
} from "@/domain/asset-source-providers";
import {
  lockOnUnauthorizedResponse,
  OWNER_SESSION_EXPIRED_MESSAGE,
  readJsonResult,
} from "@/ui/owner-request-lock";

import { type EvmChain, type Preview, type ProviderSelectionId, type SourceFields } from "./shared";

export async function requestSinglePreview({
  endpoint,
  provider,
  providerId,
  longbridgeMode,
  fields,
}: {
  endpoint: string;
  provider: AssetSourceProviderDescription;
  providerId: ProviderSelectionId | "";
  longbridgeMode: LongbridgeConnectionMode;
  fields: SourceFields;
}) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      providerId === "longbridge"
        ? { mode: longbridgeMode }
        : assetSourceAuthorizationBody(provider, fields),
    ),
  });
  const body = await readJsonResult<Preview & { error?: string }>(response);
  if (lockOnUnauthorizedResponse(response)) throw new Error(OWNER_SESSION_EXPIRED_MESSAGE);
  if (!response.ok || !body?.id) throw new Error(body?.error ?? provider.validationError);
  return body;
}

export function requestEvmPreviews(
  chains: EvmChain[],
  addresses: string[],
  previewUrl: string | null,
) {
  return Promise.allSettled(
    chains.map(async (chain) => {
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
    }),
  );
}

export function previewDeleteUrl(current: Preview, previewUrl: string | null): string {
  const description = assetSourceProvider(current.provider);
  return previewUrl === null
    ? `/api/asset-sources/${description.route}/preview?id=${encodeURIComponent(current.id)}&provider=${current.provider}`
    : `${previewUrl}?id=${encodeURIComponent(current.id)}`;
}
