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
  private scenario = "valid";

  constructor(private readonly prices: Prices) {}

  configure(scenario: string): void {
    this.scenario = scenario;
  }

  async preview(input: {
    apiKey: string;
    apiSecret: string;
    observedAt: string;
  }): Promise<BinanceAuthorizationResult> {
    const permissions = validateBinanceReadOnlyPermissions(
      binancePermissions(this.scenario),
    );
    const fixture = binanceFixture(
      this.scenario === "missing-price",
      false,
      this.scenario === "dust",
    );
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
import { binanceFixture, binancePermissions } from "@/server/testing/binance-fixtures";
import { validateOkxReadOnlyPermission } from "@/server/asset-sources/okx";
import { okxFixtureSnapshot } from "@/server/testing/okx-fixtures";
import { validateBitgetReadOnlyPermission } from "@/server/asset-sources/bitget";
import { bitgetFixtureSnapshot } from "@/server/testing/bitget-fixtures";

export class FakeOkxReadOnly implements OkxReadOnly {
  private scenario = "valid";

  configure(scenario: string): void {
    this.scenario = scenario;
  }

  private permission(): string {
    const permissions: Record<string, string> = {
      valid: "read_only",
      trade: "trade",
      withdraw: "withdraw",
      "read-and-trade": "read_only,trade",
      "unknown-permission": "read_only,new_permission",
      "missing-read": "",
      "commit-failure": "read_only",
    };
    return permissions[this.scenario] ?? "read_only";
  }

  preview(input: {
    apiKey: string;
    apiSecret: string;
    passphrase: string;
    region?: OkxRegion;
    observedAt: string;
  }): Promise<OkxAuthorizationResult> {
    const permissions = validateOkxReadOnlyPermission(this.permission());
    const uid = this.scenario === "identity-changed" ? "880002" : "880001";
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
  private scenario = "valid";

  configure(scenario: string): void {
    this.scenario = scenario;
  }

  private authorities(): unknown {
    const values: Record<string, unknown> = {
      valid: ["stor", "wtor"],
      trade: ["stor", "stow"],
      transfer: ["stor", "wtow"],
      withdraw: ["stor", "wow"],
      "read-and-write": ["stor", "stow", "wtow"],
      "unknown-permission": ["stor", "future_new_scope"],
      "missing-read": [],
      "commit-failure": ["stor", "wtor"],
    };
    return values[this.scenario] ?? ["stor", "wtor"];
  }

  preview(input: {
    apiKey: string;
    apiSecret: string;
    passphrase: string;
    accountMode: BitgetAccountMode;
    observedAt: string;
  }): Promise<BitgetAuthorizationResult> {
    const permissions = validateBitgetReadOnlyPermission(this.authorities());
    const userId = this.scenario === "identity-changed" ? "770002" : "770001";
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
  private scenario = "valid";

  configure(scenario: string): void {
    this.scenario = scenario;
  }

  private snapshot(observedAt: string) {
    const dcpOrdersAvailable = this.scenario !== "dcp-orders-failure";
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
        ...(dcpOrdersAvailable ? [{
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
        }] : []),
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
          dcpOrdersAvailable
            ? {
              product: "dcp",
              capability: "detailed" as const,
              freshness: "current" as const,
              message: "已读取 1 个活跃订单；总额仍以平台 USD 总头寸为准",
            }
            : {
              product: "dcp",
              capability: "aggregate-only" as const,
              freshness: "current" as const,
              message: "订单明细本次未读取；保留 USD 总头寸",
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
    if (this.scenario === "failure") {
      return Promise.reject(new Error("BIT Wallet 暂时不可用"));
    }
    if (!/^\d+$/.test(input.userId)) {
      return Promise.reject(new Error("BIT 用户 ID 格式无效"));
    }
    const userId = this.scenario === "identity-changed" ? "609999" : input.userId;
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
  private scenario = "valid";

  configure(scenario: string): void {
    this.scenario = scenario;
  }

  async preview(input: { chain: EvmChain; addresses: string[]; observedAt: string }): Promise<EvmWatchAuthorizationResult> {
    if (this.scenario === "failure") throw new Error("Ethereum RPC 暂时不可用");
    const addresses = input.addresses.map((address) => address.trim().toLowerCase()).filter(Boolean);
    if (addresses.length === 0 || addresses.some((address) => !/^0x[0-9a-f]{40}$/.test(address))) {
      throw new Error("Ethereum 地址格式无效");
    }
    if (new Set(addresses).size !== addresses.length) throw new Error("Ethereum 公开地址不能重复");
    const config = input.chain === "ethereum"
      ? { chainId: "1", label: "Ethereum", symbol: "ETH", standard: "ERC-20", nativePrice: "2000", nativeValue: "5000", total: "5519" }
      : { chainId: "56", label: "BNB Smart Chain", symbol: "BNB", standard: "BEP-20", nativePrice: "600", nativeValue: "1500", total: "2019" };
    const holdings: EvmWatchAuthorizationResult["snapshot"]["holdings"] = this.scenario === "empty" ? [] : [
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
    const hasLidoWithdrawal = this.scenario === "lido-withdrawal" && config.chainId === "1";
    const hasListaWithdrawal =
      this.scenario === "lista-slisbnb-withdrawal" && config.chainId === "56";
    if (hasLidoWithdrawal) {
      const unknownIndex = holdings.findIndex(({ symbol }) => symbol === "UNKNOWN");
      if (unknownIndex >= 0) holdings.splice(unknownIndex, 1);
      holdings.push(
        {
          symbol: "ETH",
          name: "Lido 提现申请 #18",
          sourceAsset: "evm:1:lido-withdrawal:18",
          sourceAccount: "wallet",
          sourceProduct: "lido-withdrawal-request",
          providerPositionId: "18",
          providerPositionState: "排队中",
          economicAssetKey: "lido-withdrawal:18",
          positionState: "redeeming",
          quantity: "1.5",
          currency: "USD",
          assetClass: "crypto",
          currentPrice: { amount: "2000", currency: "USD" },
          marketValue: "3000",
          sourceMarketValue: { amount: "3000", currency: "USD" },
          valuation: { status: "valued", priceSource: "CoinGecko Ethereum/USD 参考价格", pricedAt: input.observedAt },
          costPrice: null,
          platformProfit: null,
          changePercent: null,
        },
        {
          symbol: "ETH",
          name: "Lido 提现申请 #27",
          sourceAsset: "evm:1:lido-withdrawal:27",
          sourceAccount: "wallet",
          sourceProduct: "lido-withdrawal-request",
          providerPositionId: "27",
          providerPositionState: "可领取",
          economicAssetKey: "lido-withdrawal:27",
          positionState: "redeeming",
          quantity: "0.49",
          currency: "USD",
          assetClass: "crypto",
          currentPrice: { amount: "2000", currency: "USD" },
          marketValue: "980",
          sourceMarketValue: { amount: "980", currency: "USD" },
          valuation: { status: "valued", priceSource: "CoinGecko Ethereum/USD 参考价格", pricedAt: input.observedAt },
          costPrice: null,
          platformProfit: null,
          changePercent: null,
        },
      );
    }
    if (hasListaWithdrawal) {
      const unknownIndex = holdings.findIndex(({ symbol }) => symbol === "UNKNOWN");
      if (unknownIndex >= 0) {
        holdings.splice(unknownIndex, 1, {
          symbol: "slisBNB",
          name: "slisBNB · BNB Smart Chain BEP-20",
          sourceAsset: "evm:56:0xdddddddddddddddddddddddddddddddddddddddd",
          quantity: "2",
          currency: "USD",
          assetClass: "crypto",
          currentPrice: { amount: "620", currency: "USD" },
          marketValue: "1240",
          sourceMarketValue: { amount: "1240", currency: "USD" },
          valuation: { status: "valued", priceSource: "CoinGecko BNB Smart Chain slisBNB/USD 参考价格", pricedAt: input.observedAt },
          costPrice: null,
          platformProfit: null,
          changePercent: null,
        });
      }
      holdings.push(
        {
          symbol: "BNB",
          name: "Lista slisBNB 提现申请 #101",
          sourceAsset: "evm:56:lista-slisbnb-withdrawal:101",
          sourceAccount: "wallet",
          sourceProduct: "lista-slisbnb-withdrawal-request",
          providerPositionId: "101",
          providerPositionState: "锁仓中",
          providerPositionAvailableOn: "2026-08-27",
          economicAssetKey: "lista-slisbnb-withdrawal:101",
          positionState: "redeeming",
          quantity: "1.2",
          currency: "USD",
          assetClass: "crypto",
          currentPrice: { amount: "600", currency: "USD" },
          marketValue: "720",
          sourceMarketValue: { amount: "720", currency: "USD" },
          valuation: { status: "valued", priceSource: "CoinGecko BNB Smart Chain/USD 参考价格", pricedAt: input.observedAt },
          costPrice: null,
          platformProfit: null,
          changePercent: null,
        },
        {
          symbol: "BNB",
          name: "Lista slisBNB 提现申请 #102",
          sourceAsset: "evm:56:lista-slisbnb-withdrawal:102",
          sourceAccount: "wallet",
          sourceProduct: "lista-slisbnb-withdrawal-request",
          providerPositionId: "102",
          providerPositionState: "可领取",
          economicAssetKey: "lista-slisbnb-withdrawal:102",
          positionState: "redeeming",
          quantity: "2.45",
          currency: "USD",
          assetClass: "crypto",
          currentPrice: { amount: "600", currency: "USD" },
          marketValue: "1470",
          sourceMarketValue: { amount: "1470", currency: "USD" },
          valuation: { status: "valued", priceSource: "CoinGecko BNB Smart Chain/USD 参考价格", pricedAt: input.observedAt },
          costPrice: null,
          platformProfit: null,
          changePercent: null,
        },
      );
    }
    const unrecognizedEvmTokens =
      this.scenario === "metadata-decimals-failure" && config.chainId === "1"
        ? [{
          sourceAsset: "evm:1:0x889edc2edab5f40e902b864ad4d7ade8e412f9b1",
          symbol: "unstETH",
          name: "unstETH",
          quantity: null,
          reason: "代币合约未返回可靠 decimals，数量无法读取",
        }]
        : [];
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
          amount: this.scenario === "empty"
            ? "0"
            : hasLidoWithdrawal
              ? "9499"
              : hasListaWithdrawal
                ? "5449"
              : config.total,
          currency: "USD",
        },
        holdings,
        ...(unrecognizedEvmTokens.length > 0 ? { unrecognizedEvmTokens } : {}),
        ...(hasLidoWithdrawal || hasListaWithdrawal
          ? {
              coverage: {
                status: "complete" as const,
                products: [{
                  product: hasLidoWithdrawal
                    ? "lido-withdrawal-request"
                    : "lista-slisbnb-withdrawal-request",
                  capability: "detailed" as const,
                  freshness: "current" as const,
                  message: hasLidoWithdrawal
                    ? "已读取 2 笔未领取申请 · 1 笔排队中、1 笔可领取"
                    : "已读取 2 笔未领取申请 · 1 笔锁仓中、1 笔可领取",
                }],
                unexplainedValue: null,
                excludedPositiveAccounts: [],
              },
            }
          : {}),
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
