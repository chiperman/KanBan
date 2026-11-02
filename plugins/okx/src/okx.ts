import type {
  AssetSourceRefresher,
  AssetSourceRefreshResult,
  OkxAuthorizationResult,
  OkxReadOnly,
  OkxRegion,
} from "@/server/ports";
import type { Prices } from "../../sdk/host-capabilities";
import { preserveNewerPrices, usdtUsdValuation } from "../../sdk/valuation-policy";
import {
  OkxClient,
  parseCredentials,
  type OkxFetch,
  type StoredOkxCredentials,
} from "./okx-client";
import { region } from "./okx-identity";
import { nativeUsdtUsdQuote, valuePositions } from "./okx-valuation";
import { readFullSnapshot } from "./okx-snapshot";

export { validateOkxReadOnlyPermission } from "./okx-identity";
export { OkxClient } from "./okx-client";
export type { OkxFetch } from "./okx-client";

const OKX_QUOTE_CURRENCIES = { holding: () => "USDT" } as const;

export class ProductionOkxReadOnly implements OkxReadOnly {
  constructor(
    private readonly prices: Prices,
    private readonly request: OkxFetch = globalThis.fetch,
  ) {}

  preview(input: {
    apiKey: string;
    apiSecret: string;
    passphrase: string;
    region?: OkxRegion;
    observedAt: string;
  }): Promise<OkxAuthorizationResult> {
    if (
      input.apiKey.trim().length < 8 ||
      input.apiSecret.trim().length < 8 ||
      input.passphrase.trim().length < 4
    ) {
      return Promise.reject(new Error("OKX API Key、Secret 或 Passphrase 格式无效"));
    }
    return this.authorize({
      apiKey: input.apiKey.trim(),
      apiSecret: input.apiSecret.trim(),
      passphrase: input.passphrase.trim(),
      region: region(input.region),
    }, input.observedAt);
  }

  revalidate(input: {
    credentials: string;
    observedAt: string;
  }): Promise<OkxAuthorizationResult> {
    return this.authorize(parseCredentials(input.credentials), input.observedAt);
  }

  private async authorize(
    credentials: StoredOkxCredentials,
    observedAt: string,
  ): Promise<OkxAuthorizationResult> {
    const result = await readFullSnapshot({
      client: new OkxClient(credentials, this.request),
      prices: this.prices,
      observedAt,
    });
    return {
      credentials: JSON.stringify(credentials),
      permissions: result.identity.permissions,
      account: {
        id: `okx:${result.identity.uid}`,
        label: `OKX 账户 · UID ${result.identity.uid}`,
      },
      scopeFingerprint: [
        result.identity.uid,
        result.identity.mainUid,
        result.identity.type,
      ].join(":"),
      snapshot: result.snapshot,
    };
  }
}

export class ProductionOkxSourceRefresher implements AssetSourceRefresher {
  constructor(
    private readonly prices: Prices,
    private readonly request: OkxFetch = globalThis.fetch,
  ) {}

  async refresh({
    source,
    credentials,
    mode,
    attemptedAt,
    signal,
  }: Parameters<AssetSourceRefresher["refresh"]>[0]): Promise<AssetSourceRefreshResult> {
    if (source.kind !== "okx") {
      throw new Error(`OKX 刷新器不支持来源类型：${source.kind}`);
    }
    const stored = parseCredentials(credentials);
    const client = new OkxClient(stored, this.request, signal);
    if (mode === "prices") {
      const [instruments, tickers] = await Promise.all([
        client.instruments(),
        client.tickers(),
      ]);
      const usdtUsd = await usdtUsdValuation({
        native: nativeUsdtUsdQuote(instruments, tickers, attemptedAt),
        nativeSource: "OKX 现货 USDT-USD",
        observedAt: attemptedAt,
        prices: this.prices,
      });
      const candidate = valuePositions({
          positions: source.snapshot.holdings.map((holding) => {
            if (!holding.sourceAsset || !holding.sourceAccount) {
              throw new Error("OKX 旧快照缺少来源资产分区");
            }
            return {
              asset: holding.sourceAsset,
              account: holding.sourceAccount,
              quantity: holding.quantity,
              ...(holding.sourceProduct
                ? { sourceProduct: holding.sourceProduct }
                : {}),
              ...(holding.providerPositionId
                ? { providerPositionId: holding.providerPositionId }
                : {}),
              ...(holding.providerPositionState
                ? { providerPositionState: holding.providerPositionState }
                : {}),
            };
          }),
          instruments,
          tickers,
          observedAt: attemptedAt,
          usdtUsdQuote: usdtUsd.quote,
          usdtUsdSource: usdtUsd.source,
          coverage: source.snapshot.coverage,
          authoritativeTotal: source.snapshot.total,
        });
      return {
        snapshot: preserveNewerPrices(source.snapshot, candidate, OKX_QUOTE_CURRENCIES),
      };
    }
    const candidate = (await readFullSnapshot({
        client,
        prices: this.prices,
        observedAt: attemptedAt,
      })).snapshot;
    return {
      snapshot: preserveNewerPrices(source.snapshot, candidate, OKX_QUOTE_CURRENCIES),
    };
  }
}
