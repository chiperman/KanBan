import type {
  BinanceAuthorizationResult,
  BinanceReadOnly,
  BitgetAccountMode,
  BitgetAuthorizationResult,
  BitgetReadOnly,
  BitAuthorizationResult,
  BitReadOnly,
  EvmChain,
  EvmWatchAuthorizationResult,
  EvmWatchWalletReadOnly,
  OkxAuthorizationResult,
  OkxReadOnly,
  OkxRegion,
  Prices,
} from "@/server/ports";

export class FakeBinanceReadOnly implements BinanceReadOnly {
  constructor(private readonly prices: Prices) {}

  async preview(input: {
    apiKey: string;
    apiSecret: string;
    observedAt: string;
  }): Promise<BinanceAuthorizationResult> {
    const permissions = validateBinanceReadOnlyPermissions(
      BINANCE_READ_ONLY_PERMISSIONS,
    );
    const fixture = binanceFixture();
    return {
      credentials: JSON.stringify({
        apiKey: input.apiKey,
        apiSecret: input.apiSecret,
      }),
      permissions,
      account: {
        id: "binance:900001",
        label: "Binance 账户 · UID 900001",
      },
      snapshot: mapBinanceSnapshot({
        ...fixture,
        observedAt: input.observedAt,
        usdtUsdQuote: await this.prices.quote("USDT"),
        spotCostPrices: new Map([["BTC", "50050"]]),
      }),
    };
  }

  revalidate(input: {
    credentials: string;
    observedAt: string;
  }): Promise<BinanceAuthorizationResult> {
    let credentials: { apiKey?: unknown; apiSecret?: unknown };
    try {
      credentials = JSON.parse(input.credentials) as typeof credentials;
    } catch {
      return Promise.reject(new Error("Binance 只读凭证格式无效"));
    }
    if (
      typeof credentials.apiKey !== "string" ||
      typeof credentials.apiSecret !== "string"
    ) {
      return Promise.reject(new Error("Binance 只读凭证格式无效"));
    }
    return this.preview({
      apiKey: credentials.apiKey,
      apiSecret: credentials.apiSecret,
      observedAt: input.observedAt,
    });
  }
}
import { mapBinanceSnapshot, validateBinanceReadOnlyPermissions } from "@/server/asset-sources/binance";
import { binanceFixture, BINANCE_READ_ONLY_PERMISSIONS } from "@/server/testing/binance-fixtures";
import { validateOkxReadOnlyPermission } from "@/server/asset-sources/okx";
import { okxFixtureSnapshot } from "@/server/testing/okx-fixtures";
import { validateBitgetReadOnlyPermission } from "@/server/asset-sources/bitget";
import { bitgetFixtureSnapshot } from "@/server/testing/bitget-fixtures";

export class FakeOkxReadOnly implements OkxReadOnly {
  preview(input: {
    apiKey: string;
    apiSecret: string;
    passphrase: string;
    region?: OkxRegion;
    observedAt: string;
  }): Promise<OkxAuthorizationResult> {
    const permissions = validateOkxReadOnlyPermission("read_only");
    const uid = "880001";
    return Promise.resolve({
      credentials: JSON.stringify({
        apiKey: input.apiKey,
        apiSecret: input.apiSecret,
        passphrase: input.passphrase,
        region: input.region ?? "global",
      }),
      permissions,
      account: { id: `okx:${uid}`, label: `OKX 账户 · UID ${uid}` },
      scopeFingerprint: `${uid}:${uid}:0`,
      snapshot: okxFixtureSnapshot(input.observedAt),
    });
  }

  revalidate(input: {
    credentials: string;
    observedAt: string;
  }): Promise<OkxAuthorizationResult> {
    const credentials = JSON.parse(input.credentials) as {
      apiKey: string;
      apiSecret: string;
      passphrase: string;
      region?: OkxRegion;
    };
    return this.preview({ ...credentials, observedAt: input.observedAt });
  }
}

export class FakeBitgetReadOnly implements BitgetReadOnly {
  preview(input: {
    apiKey: string;
    apiSecret: string;
    passphrase: string;
    accountMode: BitgetAccountMode;
    observedAt: string;
  }): Promise<BitgetAuthorizationResult> {
    const permissions = validateBitgetReadOnlyPermission(["stor", "wtor"]);
    const userId = "770001";
    return Promise.resolve({
      credentials: JSON.stringify({
        apiKey: input.apiKey,
        apiSecret: input.apiSecret,
        passphrase: input.passphrase,
        accountMode: input.accountMode,
      }),
      accountMode: input.accountMode,
      permissions,
      account: {
        id: `bitget:${userId}`,
        label: `Bitget 账户 · UID ${userId}`,
      },
      scopeFingerprint: `${userId}:770001:${input.accountMode}:stor,wtor`,
      snapshot: bitgetFixtureSnapshot(input.observedAt, input.accountMode),
    });
  }

  revalidate(input: {
    credentials: string;
    observedAt: string;
  }): Promise<BitgetAuthorizationResult> {
    const credentials = JSON.parse(input.credentials) as {
      apiKey: string;
      apiSecret: string;
      passphrase: string;
      accountMode: BitgetAccountMode;
    };
    return this.preview({ ...credentials, observedAt: input.observedAt });
  }
}

export class FakeBitReadOnly implements BitReadOnly {
  private snapshot(observedAt: string) {
    return {
      total: { amount: "160", currency: "USD" },
      holdings: [
        {
          symbol: "USDT",
          name: "USDT · Wallet",
          sourceAsset: "bit:wallet:USDT",
          sourceAccount: "wallet" as const,
          sourceProduct: "wallet",
          quantity: "100",
          currency: "USD",
          assetClass: "cash" as const,
          currentPrice: { amount: "1", currency: "USD" },
          marketValue: "100",
          sourceMarketValue: { amount: "100", currency: "USD" },
          valuation: {
            status: "valued" as const,
            priceSource: "BIT Wallet USD 计价",
            pricedAt: observedAt,
          },
          costPrice: null,
          platformProfit: null,
          changePercent: null,
        },
        {
          symbol: "USDT",
          name: "USDT · Balance+",
          sourceAsset: "bit:balance-plus:USDT",
          sourceAccount: "earn" as const,
          sourceProduct: "balance-plus",
          quantity: "30",
          currency: "USD",
          assetClass: "cash" as const,
          currentPrice: { amount: "1", currency: "USD" },
          marketValue: "30",
          sourceMarketValue: { amount: "30", currency: "USD" },
          valuation: {
            status: "valued" as const,
            priceSource: "BIT Balance+ USD 计价",
            pricedAt: observedAt,
          },
          costPrice: null,
          platformProfit: null,
          changePercent: null,
        },
        {
          symbol: "USD",
          name: "DCP（USD 总头寸）",
          sourceAsset: "bit:dcp:aggregate",
          sourceAccount: "earn" as const,
          sourceProduct: "dcp",
          providerPositionId: "aggregate",
          quantity: "30",
          currency: "USD",
          assetClass: "cash" as const,
          currentPrice: { amount: "1", currency: "USD" },
          marketValue: "30",
          sourceMarketValue: { amount: "30", currency: "USD" },
          valuation: {
            status: "valued" as const,
            priceSource: "BIT DCP USD 汇总",
            pricedAt: observedAt,
          },
          costPrice: null,
          platformProfit: null,
          changePercent: null,
        },
        {
          symbol: "USDT",
          name: "DCP #7125082312731329000 · BTC-USDT · 进行中 · 2024-08-09 到期",
          sourceAsset: "bit:dcp:order:7125082312731329000",
          sourceAccount: "earn" as const,
          sourceProduct: "dcp",
          providerPositionId: "7125082312731329000",
          providerPositionState: "进行中",
          quantity: "30",
          currency: "USDT",
          assetClass: "crypto" as const,
          currentPrice: null,
          marketValue: null,
          sourceMarketValue: null,
          valuation: {
            status: "quote-unavailable" as const,
            reason: "BIT / Matrixport DCP 已含入 USD 总头寸，订单级当前估值未提供",
          },
          costPrice: null,
          platformProfit: null,
          changePercent: null,
        },
      ],
      exchangeRates: [],
      syncedAt: observedAt,
      coverage: {
        status: "complete" as const,
        totalIsAuthoritative: false,
        products: [
          {
            product: "wallet",
            capability: "detailed" as const,
            freshness: "current" as const,
            message: "余额明细已读取；未估值币种不会按零计入总额",
          },
          {
            product: "balance-plus",
            capability: "detailed" as const,
            freshness: "current" as const,
            message: "逐币余额；total_balance_amount 未作为总资产口径",
          },
          {
            product: "dcp",
            capability: "detailed" as const,
            freshness: "current" as const,
            message: "已读取 1 个活跃订单；总额仍以平台 USD 总头寸为准",
          },
        ],
        unexplainedValue: null,
        excludedPositiveAccounts: [],
      },
    };
  }

  preview(input: {
    apiKey: string;
    apiSecret: string;
    userId: string;
    observedAt: string;
  }): Promise<BitAuthorizationResult> {
    if (!/^\d+$/.test(input.userId)) {
      return Promise.reject(new Error("BIT 用户 ID 格式无效"));
    }
    const userId = input.userId;
    return Promise.resolve({
      credentials: JSON.stringify({
        apiKey: input.apiKey,
        apiSecret: input.apiSecret,
        userId: input.userId,
      }),
      permissions: ["account", "positions"],
      account: {
        id: `bit:${userId}`,
        label: `BIT / Matrixport 账户 · UID ${userId}`,
      },
      snapshot: this.snapshot(input.observedAt),
    });
  }

  revalidate(input: {
    credentials: string;
    observedAt: string;
  }): Promise<BitAuthorizationResult> {
    const credentials = JSON.parse(input.credentials) as {
      apiKey: string;
      apiSecret: string;
      userId: string;
    };
    return this.preview({ ...credentials, observedAt: input.observedAt });
  }
}

export class FakeEvmWatchWallet implements EvmWatchWalletReadOnly {
  async preview(input: { chain: EvmChain; addresses: string[]; observedAt: string }): Promise<EvmWatchAuthorizationResult> {
    const addresses = input.addresses.map((address) => address.trim().toLowerCase()).filter(Boolean);
    if (addresses.length === 0 || addresses.some((address) => !/^0x[0-9a-f]{40}$/.test(address))) {
      throw new Error("Ethereum 地址格式无效");
    }
    if (new Set(addresses).size !== addresses.length) throw new Error("Ethereum 公开地址不能重复");
    const config = input.chain === "ethereum"
      ? { chainId: "1", label: "Ethereum", symbol: "ETH", standard: "ERC-20", nativePrice: "2000", nativeValue: "5000", total: "5519" }
      : { chainId: "56", label: "BNB Smart Chain", symbol: "BNB", standard: "BEP-20", nativePrice: "600", nativeValue: "1500", total: "2019" };
    const holdings: EvmWatchAuthorizationResult["snapshot"]["holdings"] = [
      {
        symbol: config.symbol,
        name: config.label,
        sourceAsset: `evm:${config.chainId}:native`,
        quantity: "2.5",
        currency: "USD",
        assetClass: "crypto" as const,
        currentPrice: { amount: config.nativePrice, currency: "USD" },
        marketValue: config.nativeValue,
        sourceMarketValue: { amount: config.nativeValue, currency: "USD" },
        valuation: { status: "valued" as const, priceSource: `CoinGecko ${config.label}/USD 参考价格`, pricedAt: input.observedAt },
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      },
      {
        symbol: "SAME",
        name: `SAME · ${config.label} ${config.standard}`,
        sourceAsset: `evm:${config.chainId}:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`,
        quantity: "500",
        currency: "USD",
        assetClass: "crypto" as const,
        currentPrice: { amount: "1", currency: "USD" },
        marketValue: "500",
        sourceMarketValue: { amount: "500", currency: "USD" },
        valuation: { status: "valued" as const, priceSource: "CoinGecko Ethereum token/USD 参考价格", pricedAt: input.observedAt },
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      },
      {
        symbol: "SAME",
        name: `SAME · ${config.label} ${config.standard}`,
        sourceAsset: `evm:${config.chainId}:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`,
        quantity: "10",
        currency: "USD",
        assetClass: "crypto" as const,
        currentPrice: { amount: "1.9", currency: "USD" },
        marketValue: "19",
        sourceMarketValue: { amount: "19", currency: "USD" },
        valuation: { status: "valued" as const, priceSource: "CoinGecko Ethereum token/USD 参考价格", pricedAt: input.observedAt },
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      },
      {
        symbol: "UNKNOWN",
        name: `UNKNOWN · ${config.label} ${config.standard}`,
        sourceAsset: `evm:${config.chainId}:0xcccccccccccccccccccccccccccccccccccccccc`,
        quantity: "7",
        currency: "USD",
        assetClass: "crypto" as const,
        currentPrice: null,
        marketValue: null,
        sourceMarketValue: null,
        valuation: { status: "unvalued" as const, reason: "CoinGecko 未返回可靠 USD 参考价格" },
        costPrice: null,
        platformProfit: null,
        changePercent: null,
      },
    ];
    return {
      credentials: JSON.stringify({ chain: input.chain, addresses }),
      chain: input.chain,
      permissions: ["public-address", "market-data", "positions"],
      account: {
        id: `evm:${config.chainId}:test-${[...addresses].sort().join(",")}`,
        label: `${config.label} 观察钱包 · ${addresses.length} 个地址`,
      },
      snapshot: {
        total: {
          amount: config.total,
          currency: "USD",
        },
        holdings,
        exchangeRates: [],
        syncedAt: input.observedAt,
      },
    };
  }

  revalidate(input: { credentials: string; observedAt: string }): Promise<EvmWatchAuthorizationResult> {
    const value = JSON.parse(input.credentials) as { chain: EvmChain; addresses: string[] };
    return this.preview({ chain: value.chain, addresses: value.addresses, observedAt: input.observedAt });
  }
}
