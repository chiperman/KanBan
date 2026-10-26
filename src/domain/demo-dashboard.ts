import { shanghaiDay } from "@/domain/daily-asset-snapshots";
import type { AssetExchangeRate, AssetHolding, AssetSnapshotCoverage } from "@/domain/assets";
import type { Card } from "@/domain/asset-cards";
import type { DailyAssetSourceSnapshot, DailyAssetTrendObservation } from "@/domain/asset-history";
import type { ManualAssetRecord } from "@/domain/manual-asset-records";
import type { AssetSourceSummary } from "@/domain/asset-sources";

const HISTORY_DAY_COUNT = 35;
const USD_TO_CNY = 7.18;
const USD_TO_HKD = 7.81;

type DemoSource = Omit<AssetSourceSummary, "credentialReference" | "permissions"> & { manualRecords?: ManualAssetRecord[] };

export interface DemoDashboardData {
  cards: Card[];
  assetSources: DemoSource[];
  dailyAssetTrendObservations: DailyAssetTrendObservation[];
  currentDay: string;
}

function dayAtOffset(day: string, offset: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, date));
  cursor.setUTCDate(cursor.getUTCDate() + offset);
  return cursor.toISOString().slice(0, 10);
}

function capturedAt(day: string): string {
  return `${day}T02:30:00.000Z`;
}

function money(value: number): string {
  return value.toFixed(2);
}

function rates(observedAt: string): AssetExchangeRate[] {
  return [
    {
      baseCurrency: "USD",
      quoteCurrency: "CNY",
      rate: String(USD_TO_CNY),
      source: "DEMO FX",
      observedAt,
    },
    {
      baseCurrency: "USD",
      quoteCurrency: "HKD",
      rate: String(USD_TO_HKD),
      source: "DEMO FX",
      observedAt,
    },
  ];
}

function completeCoverage(product: string): AssetSnapshotCoverage {
  return {
    status: "complete",
    totalIsAuthoritative: true,
    products: [{
      product,
      capability: "detailed",
      freshness: "current",
      message: null,
    }],
    unexplainedValue: null,
    excludedPositiveAccounts: [],
  };
}

function partialCoverage(product: string): AssetSnapshotCoverage {
  return {
    status: "partial",
    totalIsAuthoritative: true,
    products: [{
      product,
      capability: "detailed",
      freshness: "current",
      message: "演示：一项链上代币缺少可靠行情",
    }],
    unexplainedValue: null,
    excludedPositiveAccounts: [],
  };
}

function holding(input: {
  name: string;
  symbol: string;
  quantity: string;
  price: string;
  previousClose: string;
  marketValue: string;
  costPrice: string;
  assetClass: AssetHolding["assetClass"];
  sourceAccount?: AssetHolding["sourceAccount"];
  sourceAsset?: string;
  sourceProduct?: string;
  platformProfit?: string;
}): AssetHolding {
  const observedAt = "2026-08-04T02:30:00.000Z";
  return {
    name: input.name,
    symbol: input.symbol,
    quantity: input.quantity,
    currency: "USD",
    assetClass: input.assetClass,
    ...(input.sourceAccount ? { sourceAccount: input.sourceAccount } : {}),
    ...(input.sourceAsset ? { sourceAsset: input.sourceAsset } : {}),
    ...(input.sourceProduct ? { sourceProduct: input.sourceProduct } : {}),
    currentPrice: { amount: input.price, currency: "USD" },
    previousClose: { amount: input.previousClose, currency: "USD" },
    marketValue: input.marketValue,
    sourceMarketValue: { amount: input.marketValue, currency: "USD" },
    valuation: {
      status: "valued",
      priceSource: "DEMO MARKET",
      pricedAt: observedAt,
    },
    costPrice: input.costPrice,
    costPriceSource: "DEMO COST",
    platformProfit: input.platformProfit ?? null,
    changePercent: null,
  };
}

function cashHolding(amount: string): AssetHolding {
  return {
    name: "美元现金",
    symbol: "USD",
    quantity: amount,
    currency: "USD",
    assetClass: "cash",
    sourceAccount: "funding",
    currentPrice: { amount: "1", currency: "USD" },
    previousClose: { amount: "1", currency: "USD" },
    marketValue: amount,
    sourceMarketValue: { amount, currency: "USD" },
    valuation: {
      status: "valued",
      priceSource: "DEMO FX",
      pricedAt: "2026-08-04T02:30:00.000Z",
    },
    costPrice: "1",
    costPriceSource: "DEMO COST",
    platformProfit: null,
    changePercent: null,
    cashBalances: [{
      amount,
      availableCash: amount,
      currency: "USD",
      frozenCash: "0",
      settlingCash: "0",
      withdrawCash: amount,
    }],
  };
}

function unvaluedEvmHolding(): AssetHolding {
  return {
    name: "示例链上代币",
    symbol: "DEMO",
    sourceProduct: "Wallet",
    quantity: "2800",
    currency: "USD",
    assetClass: "crypto",
    currentPrice: null,
    previousClose: null,
    marketValue: null,
    sourceMarketValue: null,
    valuation: {
      status: "unvalued",
      reason: "演示：行情源尚未覆盖该代币",
    },
    costPrice: null,
    platformProfit: null,
    changePercent: null,
  };
}

function source(input: {
  id: string;
  kind: DemoSource["kind"];
  label: string;
  displayName: string;
  accountId: string;
  total: string;
  holdings: AssetHolding[];
  capturedAt: string;
  coverage: AssetSnapshotCoverage;
  status?: "current" | "expired";
  hasManualRecord?: boolean;
  manualAssetClass?: DemoSource["manualAssetClass"];
  manualRecords?: ManualAssetRecord[];
}): DemoSource {
  const status = input.status ?? "current";
  const holdings = input.holdings.map((holding) =>
    holding.valuation.status === "valued"
      ? {
        ...holding,
        valuation: {
          ...holding.valuation,
          pricedAt: input.capturedAt,
        },
      }
      : holding,
  );
  const syncedAt = status === "expired"
    ? new Date(
      new Date(input.capturedAt).getTime() - 24 * 60 * 60 * 1_000,
    ).toISOString()
    : input.capturedAt;
  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    displayName: input.displayName,
    accountId: input.accountId,
    snapshot: {
      total: { amount: input.total, currency: "USD" },
      holdings,
      exchangeRates: rates(input.capturedAt),
      syncedAt,
      coverage: input.coverage,
    },
    sync: {
      status,
      lastSuccessfulAt: syncedAt,
      lastAttemptAt: input.capturedAt,
      error: null,
    },
    ...(input.hasManualRecord === undefined
      ? {}
      : { hasManualRecord: input.hasManualRecord }),
    ...(input.manualAssetClass === undefined
      ? {}
      : { manualAssetClass: input.manualAssetClass }),
    ...(input.manualRecords === undefined
      ? {}
      : { manualRecords: input.manualRecords }),
    lifecycle: "connected",
  };
}

function totalInCurrency(usd: number, currency: "USD" | "CNY" | "HKD"): string {
  if (currency === "USD") return money(usd);
  return money(usd * (currency === "CNY" ? USD_TO_CNY : USD_TO_HKD));
}

function historyFor(
  sources: DemoSource[],
  currentDay: string,
): DailyAssetTrendObservation[] {
  const dailyChangeBySource = new Map([
    ["demo-longbridge", 680],
    ["demo-binance", -420],
    ["demo-okx", 260],
    ["demo-bitget", 130],
    ["demo-ethereum", 210],
    ["demo-bsc", -80],
    ["demo-manual", 65],
  ]);
  const volatilityBySource = new Map([
    ["demo-longbridge", { amplitude: 6_500, phase: 0.8 }],
    ["demo-binance", { amplitude: 10_500, phase: 2.1 }],
    ["demo-okx", { amplitude: 6_200, phase: 1.4 }],
    ["demo-bitget", { amplitude: 4_800, phase: 2.7 }],
    ["demo-ethereum", { amplitude: 5_300, phase: 0.4 }],
    ["demo-bsc", { amplitude: 2_900, phase: 1.9 }],
    ["demo-manual", { amplitude: 1_800, phase: 2.4 }],
  ]);

  return Array.from({ length: HISTORY_DAY_COUNT }, (_, index) => {
    const day = dayAtOffset(currentDay, index - HISTORY_DAY_COUNT + 1);
    const sourceSnapshots: DailyAssetSourceSnapshot[] = sources.map(
      (source) => {
        const daysBeforeToday = HISTORY_DAY_COUNT - 1 - index;
        const currentTotal = Number(source.snapshot.total.amount);
        const dailyChange = dailyChangeBySource.get(source.id) ?? 0;
        const volatility = volatilityBySource.get(source.id) ?? {
          amplitude: 0,
          phase: 0,
        };
        const wave = daysBeforeToday === 0
          ? 0
          : Math.sin(daysBeforeToday * 1.12 + volatility.phase) *
            volatility.amplitude +
            Math.cos(daysBeforeToday * 0.43 + volatility.phase) *
            volatility.amplitude * 0.38;
        const usd = Math.max(
          0,
          Math.round(
            (currentTotal - daysBeforeToday * dailyChange + wave) * 100,
          ) / 100,
        );
        const status =
          daysBeforeToday === 2 && source.id === "demo-bsc"
            ? "expired"
            : daysBeforeToday === 0 && source.id === "demo-ethereum"
              ? "incomplete"
              : "complete";
        return {
          sourceId: source.id,
          label: source.label,
          kind: source.kind,
          capturedAt: capturedAt(day),
          complete: status === "complete",
          status,
          total: {
            USD: totalInCurrency(usd, "USD"),
            CNY: totalInCurrency(usd, "CNY"),
            HKD: totalInCurrency(usd, "HKD"),
          },
        };
      },
    );
    const totalFor = (currency: "USD" | "CNY" | "HKD") => money(
      sourceSnapshots.reduce(
        (sum, source) => sum + Number(source.total[currency] ?? "0"),
        0,
      ),
    );
    const status = sourceSnapshots.some((source) => source.status === "expired")
      ? "expired"
      : sourceSnapshots.some((source) => source.status === "incomplete")
        ? "incomplete"
        : "complete";

    return {
      day,
      capturedAt: capturedAt(day),
      exchangeRates: rates(capturedAt(day)),
      complete: status === "complete",
      status,
      total: {
        USD: totalFor("USD"),
        CNY: totalFor("CNY"),
        HKD: totalFor("HKD"),
      },
      sources: sourceSnapshots,
    };
  });
}

/**
 * 演示模式的全部数据只存在本次服务端渲染与浏览器内存中。
 * 日期随当前上海自然日滚动，样例的金额与结构保持固定。
 */
export function createDemoDashboardData(now: Date): DemoDashboardData {
  const currentDay = shanghaiDay(now);
  const observedAt = capturedAt(currentDay);
  const manualRecords: ManualAssetRecord[] = [
    { sourceId: "demo-manual", day: dayAtOffset(currentDay, -2), amount: "50200.00", currency: "USD" as const, recordedAt: capturedAt(dayAtOffset(currentDay, -2)) },
    { sourceId: "demo-manual", day: dayAtOffset(currentDay, -1), amount: "51100.00", currency: "USD" as const, recordedAt: capturedAt(dayAtOffset(currentDay, -1)) },
    { sourceId: "demo-manual", day: currentDay, amount: "51600.00", currency: "USD" as const, recordedAt: observedAt },
  ].reverse();
  const assetSources = [
    source({
      id: "demo-longbridge",
      kind: "longbridge",
      label: "长桥",
      displayName: "长桥",
      accountId: "DEMO-LB-001",
      total: "395840.00",
      capturedAt: observedAt,
      coverage: completeCoverage("证券账户"),
      holdings: [
        holding({ name: "Apple", symbol: "AAPL", quantity: "370", price: "200", previousClose: "198", marketValue: "74000.00", costPrice: "176", assetClass: "securities" }),
        holding({ name: "Microsoft", symbol: "MSFT", quantity: "450", price: "450", previousClose: "446", marketValue: "202500.00", costPrice: "398", assetClass: "securities" }),
        cashHolding("119340.00"),
      ],
    }),
    source({
      id: "demo-binance",
      kind: "binance",
      label: "Binance",
      displayName: "Binance（示例现货账户）",
      accountId: "DEMO-BN-001",
      total: "278460.00",
      capturedAt: observedAt,
      coverage: completeCoverage("现货与理财"),
      holdings: [
        holding({ name: "Bitcoin", symbol: "BTC", quantity: "2.1", price: "80000", previousClose: "78800", marketValue: "168000.00", costPrice: "61800", assetClass: "crypto", sourceAccount: "spot", sourceProduct: "Spot" }),
        holding({ name: "Ethereum", symbol: "ETH", quantity: "22", price: "4000", previousClose: "3920", marketValue: "88000.00", costPrice: "2650", assetClass: "crypto", sourceAccount: "earn-flexible", sourceProduct: "Simple Earn" }),
        cashHolding("22460.00"),
      ],
    }),
    source({
      id: "demo-okx",
      kind: "okx",
      label: "OKX",
      displayName: "OKX（示例交易账户）",
      accountId: "DEMO-OKX-001",
      total: "141240.00",
      capturedAt: observedAt,
      coverage: completeCoverage("交易与资金账户"),
      holdings: [
        holding({ name: "Solana", symbol: "SOL", quantity: "390", price: "180", previousClose: "176", marketValue: "70200.00", costPrice: "132", assetClass: "crypto", sourceAccount: "trading-bot", sourceProduct: "Trading" }),
        holding({ name: "Bitcoin", symbol: "BTC", quantity: "0.65", price: "80000", previousClose: "78800", marketValue: "52000.00", costPrice: "64600", assetClass: "crypto", sourceAccount: "spot", sourceProduct: "Spot" }),
        cashHolding("19040.00"),
      ],
    }),
    source({
      id: "demo-bitget",
      kind: "bitget",
      label: "Bitget",
      displayName: "Bitget（示例资金账户）",
      accountId: "DEMO-BG-001",
      total: "103260.00",
      capturedAt: observedAt,
      coverage: completeCoverage("现货、资金与 Earn"),
      holdings: [
        holding({ name: "Ethereum", symbol: "ETH", quantity: "11", price: "4000", previousClose: "3920", marketValue: "44000.00", costPrice: "2720", assetClass: "crypto", sourceAccount: "spot", sourceProduct: "Spot" }),
        holding({ name: "Bitget Token", symbol: "BGB", quantity: "14200", price: "3.1", previousClose: "3.02", marketValue: "44020.00", costPrice: "2.48", assetClass: "crypto", sourceAccount: "earn", sourceProduct: "Earn" }),
        cashHolding("15240.00"),
      ],
    }),
    source({
      id: "demo-ethereum",
      kind: "evm-watch-ethereum",
      label: "Ethereum",
      displayName: "Ethereum（示例观察钱包）",
      accountId: "DEMO-ETH-001",
      total: "124780.00",
      capturedAt: observedAt,
      coverage: partialCoverage("链上代币"),
      holdings: [
        holding({ name: "Ethereum", symbol: "ETH", quantity: "20", price: "4000", previousClose: "3920", marketValue: "80000.00", costPrice: "2310", assetClass: "crypto", sourceProduct: "Wallet" }),
        cashHolding("44780.00"),
        unvaluedEvmHolding(),
      ],
    }),
    source({
      id: "demo-bsc",
      kind: "evm-watch-bsc",
      label: "BNB Smart Chain",
      displayName: "BNB Smart Chain（示例观察钱包）",
      accountId: "DEMO-BSC-001",
      total: "49960.00",
      capturedAt: observedAt,
      coverage: completeCoverage("链上代币"),
      holdings: [
        holding({ name: "BNB", symbol: "BNB", quantity: "80", price: "620", previousClose: "628", marketValue: "49600.00", costPrice: "402", assetClass: "crypto", sourceProduct: "Wallet" }),
        cashHolding("360.00"),
      ],
    }),
    source({
      id: "demo-manual",
      kind: "manual",
      label: "DIY 手工资产",
      displayName: "DIY 手工资产",
      accountId: "DEMO-MANUAL-001",
      total: "51600.00",
      capturedAt: observedAt,
      coverage: completeCoverage("手工记录"),
      hasManualRecord: true,
      manualAssetClass: "other",
      manualRecords,
      holdings: [],
    }),
  ] satisfies DemoSource[];

  const cards: Card[] = [
    { id: "demo-longbridge-card", kind: "asset", title: "长桥", body: "演示数据", sourceId: "demo-longbridge", span: 1 },
    { id: "demo-binance-card", kind: "asset", title: "Binance（示例现货账户）", body: "演示数据", sourceId: "demo-binance", span: 1 },
    { id: "demo-okx-card", kind: "asset", title: "OKX（示例交易账户）", body: "演示数据", sourceId: "demo-okx", span: 1 },
    { id: "demo-bitget-card", kind: "asset", title: "Bitget（示例资金账户）", body: "演示数据", sourceId: "demo-bitget", span: 1 },
    { id: "demo-ethereum-card", kind: "asset", title: "Ethereum（示例观察钱包）", body: "演示数据", sourceId: "demo-ethereum", span: 1 },
    { id: "demo-bsc-card", kind: "asset", title: "BNB Smart Chain（示例观察钱包）", body: "演示数据", sourceId: "demo-bsc", span: 1 },
    { id: "demo-manual-card", kind: "asset", title: "DIY 手工资产", body: "演示数据", sourceId: "demo-manual", span: 1 },
  ];

  return {
    cards,
    assetSources,
    dailyAssetTrendObservations: historyFor(assetSources, currentDay),
    currentDay,
  };
}
