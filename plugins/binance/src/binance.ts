import { createHash } from "node:crypto";

import { createJsonDecoder, type JsonRecord } from "../../sdk/json";
import { usdtUsdValuation } from "../../sdk/valuation-policy";
import { integer } from "./binance-json";
import {
  BinanceClient,
  parseCredentials,
  type BinanceFetch,
  type StoredBinanceCredentials,
} from "./binance-client";
import {
  addInvestmentPositions,
  baselineBinanceCoverage,
  extractPositions,
} from "./binance-positions";
import {
  readBinanceStocksCostPrices,
  readBinanceStocksMarketData,
  readSpotCostPrices,
} from "./binance-costs";
import {
  stocksSymbolForAsset,
  type BinanceEquityQuote,
} from "./binance-market";
import {
  nativeUsdtUsdQuote,
  reconcileWallet,
  valuePositions,
} from "./binance-valuation";
import type {
  AssetPermission,
  AssetSnapshot,
  AssetSourceRefreshResult,
  AssetSourceRefresher,
  BinanceAuthorizationResult,
  BinanceReadOnly,
} from "@/server/ports";
import type { PriceQuote, Prices } from "../../sdk/host-capabilities";

const WRITABLE_PERMISSION_FIELDS = [
  "enableSpotAndMarginTrading",
  "enableMargin",
  "enableFutures",
  "enablePortfolioMarginTrading",
  "enableVanillaOptions",
  "enableFixApiTrade",
  "enableWithdrawals",
  "enableInternalTransfer",
  "permitsUniversalTransfer",
] as const;
const REQUIRED_PERMISSION_FIELDS = [
  "enableReading",
  ...WRITABLE_PERMISSION_FIELDS,
] as const;
const READ_ONLY_PERMISSIONS: AssetPermission[] = [
  "market-data",
  "account",
  "positions",
];
const { record, list } = createJsonDecoder("Binance");

export function validateBinanceReadOnlyPermissions(
  value: unknown,
): AssetPermission[] {
  const permissions = record(value, "Binance 权限响应");
  for (const field of REQUIRED_PERMISSION_FIELDS) {
    if (typeof permissions[field] !== "boolean") {
      throw new Error(`Binance 无法证明只读权限：缺少 ${field}`);
    }
  }
  if (permissions.enableReading !== true) {
    throw new Error("Binance API Key 未启用读取权限");
  }
  const enabled = WRITABLE_PERMISSION_FIELDS.filter(
    (field) => permissions[field] === true,
  );
  const unknownEnabled = Object.entries(permissions).flatMap(([field, enabled]) =>
    enabled === true &&
    !REQUIRED_PERMISSION_FIELDS.includes(
      field as (typeof REQUIRED_PERMISSION_FIELDS)[number],
    ) &&
    (/^(?:enable|permit)/i.test(field) || /^(?:canTrade|canWithdraw)$/i.test(field)) &&
    field !== "enableFixReadOnly"
      ? [field]
      : [],
  );
  if (enabled.length > 0 || unknownEnabled.length > 0) {
    throw new Error(
      `检测到 Binance 交易或资产写权限，已拒绝连接（${[
        ...enabled,
        ...unknownEnabled,
      ].join(", ")}）`,
    );
  }
  return [...READ_ONLY_PERMISSIONS];
}

export function mapBinanceSnapshot(input: {
  spotAccount: unknown;
  fundingAssets: unknown;
  flexiblePages: unknown[];
  lockedPages: unknown[];
  exchangeInfo: unknown;
  tickers: unknown;
  equityQuotes?: ReadonlyMap<string, BinanceEquityQuote>;
  equityCostPrices?: ReadonlyMap<string, string>;
  spotCostPrices?: ReadonlyMap<string, string>;
  observedAt: string;
  usdtUsdQuote: PriceQuote | null;
}): AssetSnapshot {
  return valuePositions({
    positions: extractPositions(input),
    exchangeInfo: input.exchangeInfo,
    tickers: input.tickers,
    equityQuotes: input.equityQuotes,
    equityCostPrices: input.equityCostPrices,
    spotCostPrices: input.spotCostPrices,
    observedAt: input.observedAt,
    usdtUsdQuote: input.usdtUsdQuote,
    coverage: baselineBinanceCoverage(),
  });
}

async function collectEarnPages(
  kind: "flexible" | "locked",
  fetchPage: (current: number) => Promise<unknown>,
): Promise<unknown[]> {
  const pages: unknown[] = [];
  let collected = 0;
  let expectedTotal: number | null = null;
  for (let current = 1; current <= 100; current += 1) {
    const page = record(await fetchPage(current), `Binance ${kind} Earn 分页`);
    const total = integer(page.total, "total");
    if (expectedTotal === null) expectedTotal = total;
    if (total !== expectedTotal) {
      throw new Error(`Binance ${kind} Earn 分页 total 发生变化`);
    }
    const rows = list(page.rows, `Binance ${kind} Earn rows`);
    pages.push(page);
    collected += rows.length;
    if (collected >= total) {
      if (collected !== total) {
        throw new Error(`Binance ${kind} Earn 分页数量超过 total`);
      }
      return pages;
    }
    if (rows.length === 0) {
      throw new Error(`Binance ${kind} Earn 分页提前结束`);
    }
  }
  throw new Error(`Binance ${kind} Earn 分页超过安全上限`);
}

async function collectPositionPages(
  context: string,
  fetchPage: (pageIndex: number) => Promise<unknown>,
): Promise<unknown[]> {
  const pages: unknown[] = [];
  let collected = 0;
  let expectedTotal: number | null = null;
  for (let pageIndex = 1; pageIndex <= 100; pageIndex += 1) {
    const page = record(await fetchPage(pageIndex), `${context}分页`);
    const total = integer(page.total, "total");
    if (expectedTotal === null) expectedTotal = total;
    if (total !== expectedTotal) throw new Error(`${context}分页 total 发生变化`);
    const rows = list(page.rows ?? page.list, `${context} rows`);
    pages.push(page);
    collected += rows.length;
    if (collected >= total) {
      if (collected !== total) throw new Error(`${context}分页数量超过 total`);
      return pages;
    }
    if (rows.length === 0) throw new Error(`${context}分页提前结束`);
  }
  throw new Error(`${context}分页超过安全上限`);
}

async function optionalProductRead<T>(
  label: string,
  fallback: T,
  operation: () => Promise<T>,
): Promise<{ value: T; error: string | null }> {
  try {
    return { value: await operation(), error: null };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "未知错误";
    return { value: fallback, error: `${label}读取失败：${detail}` };
  }
}

async function readFullSnapshot(input: {
  client: BinanceClient;
  observedAt: string;
  prices: Prices;
}): Promise<{ snapshot: AssetSnapshot; account: JsonRecord }> {
  await input.client.syncTime();
  validateBinanceReadOnlyPermissions(await input.client.permissions());
  const spotAccount = await input.client.spotAccount();
  const fundingAssets = await input.client.fundingAssets();
  const flexiblePages = await collectEarnPages(
    "flexible",
    (page) => input.client.flexiblePage(page),
  );
  const lockedPages = await collectEarnPages(
    "locked",
    (page) => input.client.lockedPage(page),
  );
  const walletBalances = await input.client.walletBalances();
  const [
    simpleEarn,
    dual,
    discount,
    bfusd,
    rwusd,
    ethStaking,
    solStaking,
    onchain,
    softStakingResult,
  ] = await Promise.all([
    optionalProductRead("Simple Earn 账户汇总", {}, () =>
      input.client.simpleEarnAccount()),
    optionalProductRead(
      "Dual Investment",
      { pages: [{ total: 0, list: [] }] as unknown[] },
      async () => {
        await input.client.dualAccounts();
        return {
          pages: await collectPositionPages(
            "Binance Dual Investment",
            (page) => input.client.dualPage(page),
          ),
        };
      },
    ),
    optionalProductRead(
      "Discount Buy",
      { pages: [{ total: 0, list: [] }] as unknown[] },
      async () => {
        await input.client.discountAccount();
        return {
          pages: await collectPositionPages(
            "Binance Discount Buy",
            (page) => input.client.discountPage(page),
          ),
        };
      },
    ),
    optionalProductRead("BFUSD", { bfusdAmount: "0" } as unknown, () =>
      input.client.bfusdAccount()),
    optionalProductRead("RWUSD", { rwusdAmount: "0" } as unknown, () =>
      input.client.rwusdAccount()),
    optionalProductRead("ETH Staking", { holdingInETH: "0" } as unknown, () =>
      input.client.ethStakingAccount()),
    optionalProductRead(
      "SOL Staking",
      { holdingInSOL: "0", bnsolAmount: "0" } as unknown,
      () => input.client.solStakingAccount(),
    ),
    optionalProductRead(
      "On-chain Yields",
      {
        account: { totalFlexibleAmountInUSDT: "0" },
        pages: [{ total: 0, rows: [] }] as unknown[],
      },
      async () => ({
        account: await input.client.onchainAccount(),
        pages: await collectPositionPages(
          "Binance On-chain Yields Locked",
          (page) => input.client.onchainPage(page),
        ),
      }),
    ),
    optionalProductRead("Soft Staking", [] as unknown, () =>
      input.client.softStaking()),
  ]);
  const failures: Record<string, string> = {};
  if (simpleEarn.error) {
    failures["simple-earn-flexible"] = simpleEarn.error;
    failures["simple-earn-locked"] = simpleEarn.error;
  }
  for (const [product, result] of [
    ["dual-investment", dual],
    ["discount-buy", discount],
    ["bfusd", bfusd],
    ["rwusd", rwusd],
    ["eth-staking", ethStaking],
    ["sol-staking", solStaking],
    ["onchain-yields", onchain],
    ["soft-staking", softStakingResult],
  ] as const) {
    if (result.error) failures[product] = result.error;
  }
  const [exchangeInfo, tickers] = await Promise.all([
    input.client.exchangeInfo(),
    input.client.tickers(),
  ]);
  const usdtUsd = await usdtUsdValuation({
    native: nativeUsdtUsdQuote(exchangeInfo, tickers, input.observedAt),
    nativeSource: "Binance 现货 USDTUSD",
    observedAt: input.observedAt,
    prices: input.prices,
  });
  const investment = addInvestmentPositions(
    extractPositions({
      spotAccount,
      fundingAssets,
      flexiblePages,
      lockedPages,
      exchangeInfo,
    }),
    {
      dualPages: dual.value.pages,
      discountPages: discount.value.pages,
      bfusdAccount: bfusd.value,
      rwusdAccount: rwusd.value,
      ethStakingAccount: ethStaking.value,
      solStakingAccount: solStaking.value,
      onchainAccount: onchain.value.account,
      onchainPages: onchain.value.pages,
      softStaking: softStakingResult.value,
      failures,
    },
  );
  const [spotCostPrices, equityCostPrices, equities] = await Promise.all([
    readSpotCostPrices({
      client: input.client,
      positions: investment.positions,
      exchangeInfo,
    }),
    readBinanceStocksCostPrices({
      client: input.client,
      positions: investment.positions,
      observedAt: input.observedAt,
    }),
    readBinanceStocksMarketData({
      client: input.client,
      positions: investment.positions,
    }),
  ]);
  return {
    account: record(spotAccount, "Binance 现货账户响应"),
    snapshot: reconcileWallet({
      snapshot: valuePositions({
        positions: investment.positions,
        exchangeInfo,
        tickers,
        equityQuotes: equities.equityQuotes,
        equityCostPrices,
        spotCostPrices,
        observedAt: input.observedAt,
        usdtUsdQuote: usdtUsd.quote,
        usdtUsdSource: usdtUsd.source,
      }),
      walletBalances,
      tickers,
      products: investment.products,
      incomplete: investment.incomplete,
    }),
  };
}

export class ProductionBinanceReadOnly implements BinanceReadOnly {
  constructor(
    private readonly prices: Prices,
    private readonly request: BinanceFetch = globalThis.fetch,
  ) {}

  async preview(input: {
    apiKey: string;
    apiSecret: string;
    observedAt: string;
  }): Promise<BinanceAuthorizationResult> {
    if (input.apiKey.trim().length < 8 || input.apiSecret.trim().length < 8) {
      throw new Error("Binance API Key 或 Secret 格式无效");
    }
    return this.authorize({
      apiKey: input.apiKey.trim(),
      apiSecret: input.apiSecret.trim(),
    }, input.observedAt);
  }

  revalidate(input: {
    credentials: string;
    observedAt: string;
  }): Promise<BinanceAuthorizationResult> {
    return this.authorize(parseCredentials(input.credentials), input.observedAt);
  }

  private async authorize(
    credentials: StoredBinanceCredentials,
    observedAt: string,
  ): Promise<BinanceAuthorizationResult> {
    const client = new BinanceClient(credentials, this.request);
    const { snapshot, account } = await readFullSnapshot({
      client,
      observedAt,
      prices: this.prices,
    });
    const uid = typeof account.uid === "number" || typeof account.uid === "string"
      ? String(account.uid)
      : createHash("sha256").update(credentials.apiKey).digest("hex").slice(0, 12);
    return {
      credentials: JSON.stringify(credentials),
      permissions: [...READ_ONLY_PERMISSIONS],
      account: {
        id: `binance:${uid}`,
        label: `Binance 账户 · UID ${uid}`,
      },
      snapshot,
    };
  }
}

export class ProductionBinanceSourceRefresher
  implements AssetSourceRefresher
{
  constructor(
    private readonly prices: Prices,
    private readonly request: BinanceFetch = globalThis.fetch,
  ) {}

  async refresh({
    source,
    credentials,
    mode,
    attemptedAt,
    signal,
  }: Parameters<AssetSourceRefresher["refresh"]>[0]): Promise<AssetSourceRefreshResult> {
    if (source.kind !== "binance") {
      throw new Error(`Binance 刷新器不支持来源类型：${source.kind}`);
    }
    const stored = parseCredentials(credentials);
    const client = new BinanceClient(stored, this.request, signal);
    if (mode === "prices") {
      const [exchangeInfo, tickers] = await Promise.all([
        client.exchangeInfo(),
        client.tickers(),
      ]);
      const usdtUsd = await usdtUsdValuation({
        native: nativeUsdtUsdQuote(exchangeInfo, tickers, attemptedAt),
        nativeSource: "Binance 现货 USDTUSD",
        observedAt: attemptedAt,
        prices: this.prices,
      });
      const positions = source.snapshot.holdings.map((holding) => {
        if (!holding.sourceAsset || !holding.sourceAccount) {
          throw new Error("Binance 旧快照缺少来源资产分区");
        }
        return {
          asset: holding.sourceAsset,
          account: holding.sourceAccount,
          product: holding.sourceProduct ?? holding.sourceAccount,
          providerPositionId: holding.providerPositionId ?? null,
          providerState: holding.providerPositionState ?? null,
          economicAssetKey:
            holding.economicAssetKey ??
            `binance:${holding.sourceAccount}:${holding.sourceAsset}`,
          state: holding.positionState ?? "active",
          quantity: holding.quantity,
        };
      });
      const equities = await readBinanceStocksMarketData({
        client,
        positions,
      });
      const spotCostPrices = new Map(
        source.snapshot.holdings.flatMap((holding) =>
          holding.sourceAccount === "spot" &&
          holding.costPrice !== null &&
          holding.sourceAsset
            ? [[holding.sourceAsset, holding.costPrice] as const]
            : []
        ),
      );
      const equityCostPrices = new Map(
        source.snapshot.holdings.flatMap((holding) => {
          const symbol = holding.sourceAsset === undefined
            ? null
            : stocksSymbolForAsset(holding.sourceAsset);
          return symbol !== null && holding.costPrice !== null
            ? [[symbol, holding.costPrice] as const]
            : [];
        }),
      );
      const snapshot = valuePositions({
        positions,
        exchangeInfo,
        tickers,
        equityQuotes: equities.equityQuotes,
        equityCostPrices,
        spotCostPrices,
        observedAt: attemptedAt,
        usdtUsdQuote: usdtUsd.quote,
        usdtUsdSource: usdtUsd.source,
        coverage: source.snapshot.coverage,
        authoritativeTotal: source.snapshot.total,
      });
      return {
        snapshot,
      };
    }
    return {
      snapshot: (await readFullSnapshot({
        client,
        observedAt: attemptedAt,
        prices: this.prices,
      })).snapshot,
    };
  }
}
