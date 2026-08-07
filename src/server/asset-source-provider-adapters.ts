import type {
  AssetSourceConnections,
  BitAuthorizationResult,
  BitReadOnly,
  BinanceReadOnly,
  BitgetAccountMode,
  BitgetReadOnly,
  EvmWatchWalletReadOnly,
  LongbridgeOAuth,
  OkxReadOnly,
  OkxRegion,
} from "@/server/ports";
import type {
  AssetSourceAuthorization,
  AssetSourceProvider,
  AssetSourceProviderAdapter,
} from "@/server/asset-source-onboarding";

export type AssetSourceAuthorizationInput =
  | {
      provider: "longbridge";
      code: string;
      codeVerifier: string;
      redirectUri: string;
    }
  | { provider: "binance"; apiKey: string; apiSecret: string }
  | {
      provider: "okx";
      apiKey: string;
      apiSecret: string;
      passphrase: string;
      region: OkxRegion;
    }
  | {
      provider: "bitget";
      apiKey: string;
      apiSecret: string;
      passphrase: string;
      accountMode: BitgetAccountMode;
    }
  | {
      provider: "bit";
      apiKey: string;
      apiSecret: string;
      userId: string;
    }
  | { provider: "ethereum" | "bsc"; addresses: string[] };

interface ProviderDependencies {
  longbridge: LongbridgeOAuth;
  binance: BinanceReadOnly;
  okx: OkxReadOnly;
  bitget: BitgetReadOnly;
  bit: BitReadOnly;
  evm: EvmWatchWalletReadOnly;
  connections: AssetSourceConnections;
}

const LONG_BRIDGE_REQUIRED = ["account", "positions"] as const;
const LONG_BRIDGE_FORBIDDEN = ["trade", "transfer", "withdraw"] as const;

function longbridgePermissions(result: AssetSourceAuthorization): void {
  if (
    result.permissions.some((permission) =>
      LONG_BRIDGE_FORBIDDEN.includes(
        permission as (typeof LONG_BRIDGE_FORBIDDEN)[number],
      ),
    )
  ) {
    throw new Error(
      "检测到交易权限，已拒绝连接；请仅授权账户和持仓读取权限",
    );
  }
  if (
    !LONG_BRIDGE_REQUIRED.every((permission) =>
      result.permissions.includes(permission),
    )
  ) {
    throw new Error("授权范围不足，需要账户和持仓读取权限");
  }
}

function inputFor<P extends AssetSourceProvider>(
  input: unknown,
  provider: P,
): Extract<AssetSourceAuthorizationInput, { provider: P }> {
  const value = input as AssetSourceAuthorizationInput;
  if (value.provider !== provider) {
    throw new Error(`资产来源输入与 adapter 不匹配：${provider}`);
  }
  return value as Extract<AssetSourceAuthorizationInput, { provider: P }>;
}

export function createAssetSourceProviderAdapters({
  longbridge,
  binance,
  okx,
  bitget,
  bit,
  evm,
  connections,
}: ProviderDependencies): AssetSourceProviderAdapter[] {
  return [
    {
      provider: "longbridge",
      async authorize(raw) {
        const input = inputFor(raw, "longbridge");
        const result = await longbridge.finish(input);
        const authorization = { provider: "longbridge" as const, ...result };
        longbridgePermissions(authorization);
        return authorization;
      },
      async revalidate(authorization, observedAt) {
        const result = await longbridge.revalidate({
          credentials: authorization.credentials,
          observedAt,
        });
        const revalidated = { provider: "longbridge" as const, ...result };
        longbridgePermissions(revalidated);
        return revalidated;
      },
      async connect(authorization) {
        await connections.connectLongbridge(authorization);
      },
    },
    {
      provider: "binance",
      async authorize(raw, observedAt) {
        const input = inputFor(raw, "binance");
        return {
          provider: "binance" as const,
          ...(await binance.preview({ ...input, observedAt })),
        };
      },
      async revalidate(authorization, observedAt) {
        return {
          provider: "binance" as const,
          ...(await binance.revalidate({
            credentials: authorization.credentials,
            observedAt,
          })),
        };
      },
      async connect(authorization) {
        await connections.connectBinance(authorization);
      },
    },
    {
      provider: "okx",
      scopeChangedMessage: "OKX 账户范围已变化，请重新预览",
      async authorize(raw, observedAt) {
        const input = inputFor(raw, "okx");
        return {
          provider: "okx" as const,
          ...(await okx.preview({ ...input, observedAt })),
        };
      },
      async revalidate(authorization, observedAt) {
        return {
          provider: "okx" as const,
          ...(await okx.revalidate({
            credentials: authorization.credentials,
            observedAt,
          })),
        };
      },
      async connect(authorization) {
        if (!authorization.scopeFingerprint) {
          throw new Error("OKX 账户范围证明缺失");
        }
        await connections.connectOkx({
          ...authorization,
          scopeFingerprint: authorization.scopeFingerprint,
        });
      },
    },
    {
      provider: "bitget",
      scopeChangedMessage: "Bitget 账户范围已变化，请重新预览",
      async authorize(raw, observedAt) {
        const input = inputFor(raw, "bitget");
        return {
          provider: "bitget" as const,
          ...(await bitget.preview({ ...input, observedAt })),
        };
      },
      async revalidate(authorization, observedAt) {
        return {
          provider: "bitget" as const,
          ...(await bitget.revalidate({
            credentials: authorization.credentials,
            observedAt,
          })),
        };
      },
      async connect(authorization) {
        if (!authorization.accountMode || !authorization.scopeFingerprint) {
          throw new Error("Bitget 账户范围证明缺失");
        }
        await connections.connectBitget({
          ...authorization,
          accountMode: authorization.accountMode,
          scopeFingerprint: authorization.scopeFingerprint,
        });
      },
    },
    {
      provider: "bit",
      async authorize(raw, observedAt) {
        const input = inputFor(raw, "bit");
        return {
          provider: "bit" as const,
          ...(await bit.preview({ ...input, observedAt })),
        };
      },
      async revalidate(authorization, observedAt) {
        return {
          provider: "bit" as const,
          ...(await bit.revalidate({
            credentials: authorization.credentials,
            observedAt,
          })),
        };
      },
      async connect(authorization) {
        await connections.connectBit(authorization as BitAuthorizationResult);
      },
    },
    ...(["ethereum", "bsc"] as const).map(
      (provider): AssetSourceProviderAdapter => ({
        provider,
        async authorize(raw, observedAt) {
          const input = inputFor(raw, provider);
          return {
            provider,
            ...(await evm.preview({
              chain: provider,
              addresses: input.addresses,
              observedAt,
            })),
          };
        },
        async revalidate(authorization, observedAt) {
          return {
            provider,
            ...(await evm.revalidate({
              credentials: authorization.credentials,
              observedAt,
            })),
          };
        },
        async connect(authorization, reconnectSourceId) {
          const result = {
            ...authorization,
            chain: provider,
          };
          if (reconnectSourceId) {
            await connections.reconnectEvm(reconnectSourceId, result);
            return;
          }
          await connections.connectEvm(result);
        },
      }),
    ),
  ];
}
