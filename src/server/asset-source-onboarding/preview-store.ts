import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";

import {
  AssetSourceOnboardingError,
  type AssetSourceAuthorization,
  type AssetSourceOnboardingPreview,
  type AssetSourceProvider,
  type AssetSourceReauthorization,
} from "@/server/asset-source-onboarding/types";

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
  reauthorization?: AssetSourceReauthorization;
}

/** 统一管理临时凭证密文、公共投影和确认占用，不决定接入业务规则。 */
export class AssetSourcePreviewStore {
  private readonly previews = new Map<string, StoredPreview>();
  private readonly claimed = new Set<string>();
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();
  private readonly transientKey = randomBytes(32);

  constructor(
    private readonly now: () => number = Date.now,
    private readonly previewTtlMs = 10 * 60_000,
  ) {}

  remember(
    authorization: AssetSourceAuthorization,
    reauthorization?: AssetSourceReauthorization,
  ): string {
    const id = randomUUID();
    const { credentials, ...safeAuthorization } = authorization;
    this.previews.set(id, {
      id,
      expiresAt: this.now() + this.previewTtlMs,
      authorization: safeAuthorization,
      credentials: this.seal(credentials),
      ...(reauthorization === undefined ? {} : { reauthorization }),
    });
    const timer = setTimeout(() => this.clear(id), this.previewTtlMs);
    timer.unref();
    this.expiryTimers.set(id, timer);
    return id;
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
      account: { id: authorization.account.id, label: authorization.account.label },
      permissions: authorization.permissions,
      total: { amount: authorization.snapshot.total.amount, currency: authorization.snapshot.total.currency },
      ...(authorization.accountMode
        ? { accountMode: authorization.accountMode }
        : {}),
    };
  }

  cancel(provider: AssetSourceProvider, id: string): void {
    const stored = this.previews.get(id);
    if (stored?.authorization.provider === provider) this.clear(id);
  }

  async consume(
    provider: AssetSourceProvider,
    id: string,
    confirm: (
      authorization: AssetSourceAuthorization,
      reauthorization?: AssetSourceReauthorization,
    ) => Promise<void>,
  ): Promise<void> {
    const stored = this.claim(provider, id);
    if (!stored) {
      throw new AssetSourceOnboardingError(
        "preview-unavailable",
        "资产来源预览已失效，请重新验证",
      );
    }
    const original = this.open(stored);
    try {
      await confirm(original, stored.reauthorization);
      this.clear(id);
    } catch (error) {
      // 失败只释放占用，不延长 TTL，也不恢复已取消或到期清理的预览。
      this.claimed.delete(id);
      throw error;
    }
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
    if (this.previews.get(id)?.authorization.provider === provider && this.claimed.has(id)) {
      throw new AssetSourceOnboardingError("preview-busy", "资产来源正在确认，请先核对来源状态");
    }
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
