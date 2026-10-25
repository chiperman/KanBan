import type {
  AssetSourceRefreshResult,
  AssetSourceRefresher,
  BitgetAuthorizationResult,
  BitgetAccountMode,
  BitgetReadOnly,
  Prices,
} from "@/server/ports";
import { preserveNewerPrices, usdtUsdValuation } from "@/server/asset-sources/valuation-policy";
import {
  BITGET_DEFAULT_RUNTIME,
  BitgetClient,
  parseCredentials,
  type BitgetFetch,
  type StoredBitgetCredentials,
  type BitgetRuntime,
} from "@/server/asset-sources/bitget-client";

export { BITGET_DEFAULT_RUNTIME, BitgetClient } from "@/server/asset-sources/bitget-client";
export type { BitgetFetch, BitgetRuntime, StoredBitgetCredentials } from "@/server/asset-sources/bitget-client";
import {
  validateClassicAccountInfo,
  validateUtaAccountInfo,
} from "@/server/asset-sources/bitget-identity";
import {
  extractClassicPositions,
  extractUtaPositions,
} from "@/server/asset-sources/bitget-positions";
import {
  bitgetCoverage,
  classicAccountCoverage,
  nativeUsdtUsdQuote,
  valuePositions,
} from "@/server/asset-sources/bitget-valuation";
import { readFullSnapshot } from "@/server/asset-sources/bitget-snapshot";

export {
  validateBitgetReadOnlyPermission,
  validateBitgetUtaReadOnlyPermission,
} from "@/server/asset-sources/bitget-identity";

const DEFAULT_RUNTIME = BITGET_DEFAULT_RUNTIME;
export class ProductionBitgetReadOnly implements BitgetReadOnly {
  constructor(
    private readonly prices: Prices,
    private readonly request: BitgetFetch = globalThis.fetch,
    private readonly runtime: BitgetRuntime = DEFAULT_RUNTIME,
  ) {}

  preview(input: {
    apiKey: string;
    apiSecret: string;
    passphrase: string;
    accountMode: BitgetAccountMode;
    observedAt: string;
  }): Promise<BitgetAuthorizationResult> {
    if (
      input.apiKey.trim().length < 8 ||
      input.apiSecret.trim().length < 8 ||
      input.passphrase.trim().length < 4
    ) {
      return Promise.reject(new Error("Bitget API Key、Secret 或 Passphrase 格式无效"));
    }
    return this.authorize({
      apiKey: input.apiKey.trim(),
      apiSecret: input.apiSecret.trim(),
      passphrase: input.passphrase.trim(),
      accountMode: input.accountMode,
    }, input.observedAt);
  }

  revalidate(input: {
    credentials: string;
    observedAt: string;
  }): Promise<BitgetAuthorizationResult> {
    return this.authorize(parseCredentials(input.credentials), input.observedAt);
  }

  private async authorize(
    credentials: StoredBitgetCredentials,
    observedAt: string,
  ): Promise<BitgetAuthorizationResult> {
    const result = await readFullSnapshot({
      client: new BitgetClient(credentials, this.request, undefined, this.runtime),
      prices: this.prices,
      observedAt,
      accountMode: credentials.accountMode,
    });
    return {
      credentials: JSON.stringify(credentials),
      accountMode: result.identity.accountMode,
      permissions: result.identity.permissions,
      account: {
        id: `bitget:${result.identity.userId}`,
        label: `Bitget 账户 · UID ${result.identity.userId}`,
      },
      scopeFingerprint: [
        result.identity.userId,
        result.identity.parentId,
        result.identity.accountMode,
        ...result.identity.scope,
      ].join(":"),
      snapshot: result.snapshot,
    };
  }
}

export class ProductionBitgetSourceRefresher implements AssetSourceRefresher {
  constructor(
    private readonly prices: Prices,
    private readonly request: BitgetFetch = globalThis.fetch,
    private readonly runtime: BitgetRuntime = DEFAULT_RUNTIME,
  ) {}

  async refresh({
    source,
    credentials,
    mode,
    attemptedAt,
    signal,
  }: Parameters<AssetSourceRefresher["refresh"]>[0]): Promise<AssetSourceRefreshResult> {
    if (source.kind !== "bitget") {
      throw new Error(`Bitget 刷新器不支持来源类型：${source.kind}`);
    }
    const stored = parseCredentials(credentials);
    const client = new BitgetClient(stored, this.request, signal, this.runtime);
    if (mode === "prices") {
      const [instruments, tickers] = await Promise.all([
        client.instruments(),
        client.tickers(),
      ]);
      const usdtUsd = await usdtUsdValuation({
        native: nativeUsdtUsdQuote(instruments, tickers, attemptedAt),
        nativeSource: "Bitget 现货 USDTUSD",
        observedAt: attemptedAt,
        prices: this.prices,
      });
      const candidate = valuePositions({
          positions: source.snapshot.holdings.map((holding) => {
            if (!holding.sourceAsset || !holding.sourceAccount) {
              throw new Error("Bitget 旧快照缺少来源资产分区");
            }
            return {
              asset: holding.sourceAsset,
              account: holding.sourceAccount,
              quantity: holding.quantity,
              sourceProduct: holding.sourceProduct ?? "legacy",
              ...(holding.providerPositionId
                ? { providerPositionId: holding.providerPositionId }
                : {}),
            };
          }),
          instruments,
          tickers,
          observedAt: attemptedAt,
          usdtUsdQuote: usdtUsd.quote,
          usdtUsdSource: usdtUsd.source,
          targetCurrency: source.snapshot.total.currency === "USD" ? "USD" : "USDT",
          coverage: source.snapshot.coverage,
          ...(source.snapshot.coverage?.status === "complete"
            ? { authoritativeTotal: source.snapshot.total }
            : {}),
        });
      return {
        snapshot: preserveNewerPrices(source.snapshot, candidate, {
          holding: (source_) => source_.currency,
          total: candidate.total.currency,
        }),
      };
    }
    const candidate = (await readFullSnapshot({
        client,
        prices: this.prices,
        observedAt: attemptedAt,
        accountMode: stored.accountMode,
      })).snapshot;
    return {
      snapshot: preserveNewerPrices(source.snapshot, candidate, {
        holding: (source_) => source_.currency,
        total: candidate.total.currency,
      }),
    };
  }
}
