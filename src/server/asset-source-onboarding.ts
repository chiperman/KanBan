import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";

import type {
  AssetMoney,
  AssetPermission,
  AssetSnapshot,
  BitgetAccountMode,
} from "@/server/ports";
import type { AssetSourceProviderId } from "@/domain/asset-source-providers";

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
  connect(authorization: AssetSourceAuthorization): Promise<void>;
}

interface SealedCredentials {
  iv: string;
  tag: string;
  value: string;
}

interface StoredPreview {
  id: string;
  expiresAt: number;
  authorization: Omit<AssetSourceAuthorization, "credentials">;
  credentials: SealedCredentials;
}

export class AssetSourceOnboardingError extends Error {
  constructor(
    readonly code: "unsupported-provider" | "preview-unavailable" | "scope-changed",
    message: string,
  ) {
    super(message);
  }
}

/**
 * 资产来源接入的完整事务边界。
 *
 * 授权材料只在服务端 adapter、进程临时密文和最终 SecretStore 之间流转；
 * 路由与公共预览永远拿不到凭证正文或持仓明细。
 */
export class AssetSourceOnboarding {
  private readonly adapters = new Map<
    AssetSourceProvider,
    AssetSourceProviderAdapter
  >();
  private readonly previews = new Map<string, StoredPreview>();
  private readonly claimed = new Set<string>();
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();
  private readonly transientKey = randomBytes(32);

  constructor(
    adapters: AssetSourceProviderAdapter[],
    private readonly now: () => number = Date.now,
    private readonly previewTtlMs = 10 * 60_000,
  ) {
    for (const adapter of adapters) this.adapters.set(adapter.provider, adapter);
  }

  async preview<Input>(
    provider: AssetSourceProvider,
    input: Input,
    observedAt: string,
  ): Promise<AssetSourceOnboardingPreview> {
    const adapter = this.adapter(provider) as AssetSourceProviderAdapter<Input>;
    const authorization = await adapter.authorize(input, observedAt);
    if (authorization.provider !== provider) {
      throw new Error(`资产来源 adapter 返回了错误的平台：${authorization.provider}`);
    }
    const id = this.remember(authorization);
    return this.publicPreview(provider, id)!;
  }

  publicPreview(
    provider: AssetSourceProvider,
    id: string,
  ): AssetSourceOnboardingPreview | null {
    const stored = this.available(id);
    if (!stored || stored.authorization.provider !== provider) return null;
    const { authorization } = stored;
    return {
      id,
      provider: authorization.provider,
      account: authorization.account,
      permissions: authorization.permissions,
      total: authorization.snapshot.total,
      ...(authorization.accountMode
        ? { accountMode: authorization.accountMode }
        : {}),
    };
  }

  cancel(provider: AssetSourceProvider, id: string): void {
    const stored = this.previews.get(id);
    if (stored?.authorization.provider === provider) this.clear(id);
  }

  async confirm(
    provider: AssetSourceProvider,
    id: string,
    observedAt: string,
  ): Promise<void> {
    const stored = this.claim(provider, id);
    if (!stored) {
      throw new AssetSourceOnboardingError(
        "preview-unavailable",
        "资产来源预览已失效或正在确认",
      );
    }
    const original = this.open(stored);
    const adapter = this.adapter(original.provider);
    try {
      const revalidated = await adapter.revalidate(original, observedAt);
      this.assertStable(
        original,
        revalidated,
        adapter.scopeChangedMessage,
      );
      await adapter.connect(revalidated);
      this.clear(id);
    } catch (error) {
      this.claimed.delete(id);
      throw error;
    }
  }

  private adapter(provider: AssetSourceProvider): AssetSourceProviderAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new AssetSourceOnboardingError(
        "unsupported-provider",
        `暂不支持资产来源：${provider}`,
      );
    }
    return adapter;
  }

  private remember(authorization: AssetSourceAuthorization): string {
    const id = randomUUID();
    const { credentials, ...safeAuthorization } = authorization;
    this.previews.set(id, {
      id,
      expiresAt: this.now() + this.previewTtlMs,
      authorization: safeAuthorization,
      credentials: this.seal(credentials),
    });
    const timer = setTimeout(() => this.clear(id), this.previewTtlMs);
    timer.unref();
    this.expiryTimers.set(id, timer);
    return id;
  }

  private available(id: string): StoredPreview | null {
    if (this.claimed.has(id)) return null;
    const stored = this.previews.get(id) ?? null;
    if (stored && stored.expiresAt < this.now()) {
      this.clear(id);
      return null;
    }
    return stored;
  }

  private claim(
    provider: AssetSourceProvider,
    id: string,
  ): StoredPreview | null {
    const stored = this.available(id);
    if (!stored || stored.authorization.provider !== provider) return null;
    this.claimed.add(id);
    return stored;
  }

  private clear(id: string): void {
    this.previews.delete(id);
    this.claimed.delete(id);
    const timer = this.expiryTimers.get(id);
    if (timer) clearTimeout(timer);
    this.expiryTimers.delete(id);
  }

  private assertStable(
    original: AssetSourceAuthorization,
    revalidated: AssetSourceAuthorization,
    scopeChangedMessage = "资产来源账户范围已变化，请重新预览",
  ): void {
    const originalScope =
      original.scopeFingerprint ?? [...original.permissions].sort().join(",");
    const revalidatedScope =
      revalidated.scopeFingerprint ?? [...revalidated.permissions].sort().join(",");
    if (
      revalidated.provider !== original.provider ||
      revalidated.account.id !== original.account.id ||
      revalidated.accountMode !== original.accountMode ||
      revalidatedScope !== originalScope
    ) {
      throw new AssetSourceOnboardingError(
        "scope-changed",
        scopeChangedMessage,
      );
    }
  }

  private seal(value: string): SealedCredentials {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.transientKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return {
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      value: encrypted.toString("base64"),
    };
  }

  private open(stored: StoredPreview): AssetSourceAuthorization {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.transientKey,
      Buffer.from(stored.credentials.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(stored.credentials.tag, "base64"));
    const credentials = Buffer.concat([
      decipher.update(Buffer.from(stored.credentials.value, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return { ...stored.authorization, credentials };
  }
}
