export const ASSET_SOURCE_DISPLAY_NAME_MAX_LENGTH = 40;

export interface AssetSourceDisplayIdentity {
  kind: string;
  label: string;
  displayName?: string;
}

export class InvalidAssetSourceDisplayNameError extends Error {}

export function assetSourceDefaultDisplayName(
  source: Pick<AssetSourceDisplayIdentity, "kind" | "label">,
): string {
  if (source.kind === "longbridge") return "长桥账户";
  return source.label.replace(/\s+[·・]\s+/g, "，");
}

export function assetSourceDisplayName(
  source: AssetSourceDisplayIdentity,
): string {
  return source.displayName ?? assetSourceDefaultDisplayName(source);
}

export function normalizeAssetSourceDisplayName(value: string): string | null {
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  if ([...normalized].length > ASSET_SOURCE_DISPLAY_NAME_MAX_LENGTH) {
    throw new InvalidAssetSourceDisplayNameError(
      `自定义名称不能超过 ${ASSET_SOURCE_DISPLAY_NAME_MAX_LENGTH} 个字符`,
    );
  }
  if (/[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new InvalidAssetSourceDisplayNameError("自定义名称不能包含控制字符");
  }
  return normalized;
}
import { assetSourceKindMetadata } from "./asset-source-kinds";
