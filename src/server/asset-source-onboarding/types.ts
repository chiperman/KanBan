import type { AssetSourceProviderId } from "@/domain/asset-source-providers";
import type {
  AssetMoney,
  AssetPermission,
  AssetSnapshot,
  BitgetAccountMode,
} from "@/server/ports";

export type AssetSourceProvider = AssetSourceProviderId;

export interface AssetSourceAuthorization {
  provider: AssetSourceProvider;
  credentials: string;
  permissions: AssetPermission[];
  account: { id: string; label: string };
  snapshot: AssetSnapshot;
  accountMode?: BitgetAccountMode;
  scopeFingerprint?: string;
}

export interface AssetSourceOnboardingPreview {
  id: string;
  provider: AssetSourceProvider;
  account: { id: string; label: string };
  permissions: AssetPermission[];
  total: AssetMoney;
  accountMode?: BitgetAccountMode;
}

export interface AssetSourceProviderAdapter<Input = unknown> {
  readonly provider: AssetSourceProvider;
  readonly scopeChangedMessage?: string;
  authorize(input: Input, observedAt: string): Promise<AssetSourceAuthorization>;
  revalidate(
    authorization: AssetSourceAuthorization,
    observedAt: string,
  ): Promise<AssetSourceAuthorization>;
  connect(
    authorization: AssetSourceAuthorization,
    reconnectSourceId?: string,
  ): Promise<void>;
}

export interface AssetSourceReauthorization {
  sourceId: string;
  expectedAccountId: string;
}

export class AssetSourceOnboardingError extends Error {
  constructor(
    readonly code: "unsupported-provider" | "preview-unavailable" | "preview-busy" | "scope-changed",
    message: string,
  ) {
    super(message);
  }
}
