import { AssetSourcePreviewStore } from "@/server/asset-source-onboarding/preview-store";
import {
  AssetSourceOnboardingError,
  type AssetSourceAuthorization,
  type AssetSourceOnboardingPreview,
  type AssetSourceProvider,
  type AssetSourceProviderAdapter,
  type AssetSourceReauthorization,
} from "@/server/asset-source-onboarding/types";

export { AssetSourceOnboardingError } from "@/server/asset-source-onboarding/types";
export type {
  AssetSourceAuthorization,
  AssetSourceOnboardingPreview,
  AssetSourceProvider,
  AssetSourceProviderAdapter,
} from "@/server/asset-source-onboarding/types";

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
  private readonly previews: AssetSourcePreviewStore;

  constructor(
    adapters: AssetSourceProviderAdapter[],
    now: () => number = Date.now,
    previewTtlMs = 10 * 60_000,
  ) {
    this.previews = new AssetSourcePreviewStore(now, previewTtlMs);
    for (const adapter of adapters) this.adapters.set(adapter.provider, adapter);
  }

  async preview<Input>(
    provider: AssetSourceProvider,
    input: Input,
    observedAt: string,
    reauthorization?: AssetSourceReauthorization,
  ): Promise<AssetSourceOnboardingPreview> {
    const adapter = this.adapter(provider) as AssetSourceProviderAdapter<Input>;
    const authorization = await adapter.authorize(input, observedAt);
    if (authorization.provider !== provider) {
      throw new Error(`资产来源 adapter 返回了错误的平台：${authorization.provider}`);
    }
    if (
      reauthorization !== undefined &&
      authorization.account.id !== reauthorization.expectedAccountId
    ) {
      throw new Error("输入的公开地址或账户与此来源不一致；请新建资产来源。");
    }
    const id = this.previews.remember(authorization, reauthorization);
    return this.publicPreview(provider, id)!;
  }

  publicPreview(
    provider: AssetSourceProvider,
    id: string,
  ): AssetSourceOnboardingPreview | null {
    return this.previews.publicPreview(provider, id);
  }

  cancel(provider: AssetSourceProvider, id: string): void {
    this.previews.cancel(provider, id);
  }

  async confirm(
    provider: AssetSourceProvider,
    id: string,
    observedAt: string,
    expectedReauthorizationSourceId?: string,
  ): Promise<void> {
    await this.previews.consume(provider, id, async (original, reauthorization) => {
      const adapter = this.adapter(original.provider);
      if (
        expectedReauthorizationSourceId !== undefined &&
        reauthorization?.sourceId !== expectedReauthorizationSourceId
      ) {
        throw new AssetSourceOnboardingError(
          "preview-unavailable",
          "授权预览已失效或不属于当前来源",
        );
      }
      if (
        reauthorization !== undefined &&
        original.account.id !== reauthorization.expectedAccountId
      ) {
        throw new Error("输入的公开地址或账户与此来源不一致；请新建资产来源。");
      }
      const revalidated = await adapter.revalidate(original, observedAt);
      this.assertStable(
        original,
        revalidated,
        adapter.scopeChangedMessage,
      );
      if (
        reauthorization !== undefined &&
        revalidated.account.id !== reauthorization.expectedAccountId
      ) {
        throw new Error("输入的公开地址或账户与此来源不一致；请新建资产来源。");
      }
      await adapter.connect(revalidated, reauthorization?.sourceId);
    });
  }

  async reauthorize<Input>(
    provider: AssetSourceProvider,
    input: Input,
    sourceId: string,
    observedAt: string,
    expectedAccountId?: string,
  ): Promise<void> {
    const adapter = this.adapter(provider) as AssetSourceProviderAdapter<Input>;
    const original = await adapter.authorize(input, observedAt);
    if (original.provider !== provider) {
      throw new Error(`资产来源 adapter 返回了错误的平台：${provider}`);
    }
    if (
      expectedAccountId !== undefined &&
      original.account.id !== expectedAccountId
    ) {
      throw new Error(
        "输入的公开地址与此来源不一致；请新建资产来源。",
      );
    }
    const revalidated = await adapter.revalidate(original, observedAt);
    this.assertStable(
      original,
      revalidated,
      adapter.scopeChangedMessage,
    );
    await adapter.connect(revalidated, sourceId);
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
}
