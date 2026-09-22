import { getTestServices, isTestEnv } from "@/server/composition";
import type { AssetHolding, AssetSnapshot } from "@/server/ports";

export const dynamic = "force-dynamic";

const OBSERVED_AT = "2026-01-01T00:00:00.000Z";
const EXCHANGE_RATES = [{
  baseCurrency: "USD",
  quoteCurrency: "CNY",
  rate: "7.2",
  source: "发布验收汇率",
  observedAt: OBSERVED_AT,
}, {
  baseCurrency: "USD",
  quoteCurrency: "HKD",
  rate: "7.8",
  source: "发布验收汇率",
  observedAt: OBSERVED_AT,
}];

function valuedHolding(input: {
  symbol: string;
  name: string;
  sourceAsset: string;
  quantity: string;
  price: string;
  value: string;
  assetClass: "securities" | "crypto";
  priceSource: string;
}): AssetHolding {
  return {
    symbol: input.symbol,
    name: input.name,
    sourceAsset: input.sourceAsset,
    quantity: input.quantity,
    currency: "USD",
    assetClass: input.assetClass,
    currentPrice: { amount: input.price, currency: "USD" },
    marketValue: input.value,
    sourceMarketValue: { amount: input.value, currency: "USD" },
    valuation: {
      status: "valued",
      priceSource: input.priceSource,
      pricedAt: OBSERVED_AT,
    },
    costPrice: null,
    platformProfit: null,
    changePercent: null,
  };
}

function unvaluedHolding(
  sourceAsset: string,
  name: string,
): AssetHolding {
  return {
    symbol: "UNKNOWN",
    name,
    sourceAsset,
    quantity: "7",
    currency: "USD",
    assetClass: "crypto",
    currentPrice: null,
    marketValue: null,
    sourceMarketValue: null,
    valuation: {
      status: "unvalued",
      reason: "CoinGecko 未返回可靠 USD 参考价格",
    },
    costPrice: null,
    platformProfit: null,
    changePercent: null,
  };
}

function snapshot(total: string, holdings: AssetHolding[]): AssetSnapshot {
  return {
    total: { amount: total, currency: "USD" },
    holdings,
    exchangeRates: EXCHANGE_RATES,
    syncedAt: OBSERVED_AT,
  };
}

function evmSnapshot(chainId: "1" | "56"): AssetSnapshot {
  const ethereum = chainId === "1";
  const label = ethereum ? "Ethereum" : "BNB Smart Chain";
  const symbol = ethereum ? "ETH" : "BNB";
  const nativePrice = ethereum ? "2000" : "600";
  const nativeValue = ethereum ? "5000" : "1500";
  const total = ethereum ? "5519" : "2019";
  return snapshot(total, [
    valuedHolding({
      symbol,
      name: label,
      sourceAsset: `evm:${chainId}:native`,
      quantity: "2.5",
      price: nativePrice,
      value: nativeValue,
      assetClass: "crypto",
      priceSource: `CoinGecko ${label}/USD 参考价格`,
    }),
    valuedHolding({
      symbol: "SAME",
      name: `SAME · ${label}`,
      sourceAsset: `evm:${chainId}:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`,
      quantity: "500",
      price: "1",
      value: "500",
      assetClass: "crypto",
      priceSource: "CoinGecko token/USD 参考价格",
    }),
    valuedHolding({
      symbol: "SAME",
      name: `SAME · ${label}`,
      sourceAsset: `evm:${chainId}:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`,
      quantity: "10",
      price: "1.9",
      value: "19",
      assetClass: "crypto",
      priceSource: "CoinGecko token/USD 参考价格",
    }),
    unvaluedHolding(
      `evm:${chainId}:0xcccccccccccccccccccccccccccccccccccccccc`,
      `UNKNOWN · ${label}`,
    ),
  ]);
}

async function seed() {
  const services = getTestServices();
  if ((await services.assetSources.list()).length > 0) {
    throw new Error("发布验收夹具必须从空状态开始");
  }
  await services.assetSourceConnections.connectLongbridge({
    credentials: "release-longbridge-token",
    permissions: ["account", "positions"],
    account: { id: "release-longbridge", label: "长桥只读账户" },
    snapshot: snapshot("100000", [
      valuedHolding({
        symbol: "NVDA",
        name: "NVIDIA",
        sourceAsset: "NVDA.US",
        quantity: "100",
        price: "1000",
        value: "100000",
        assetClass: "securities",
        priceSource: "长桥来源原生价格",
      }),
    ]),
  });
  await services.assetSourceConnections.connectBinance({
    credentials: "release-binance-secret",
    permissions: ["account", "positions", "market-data"],
    account: { id: "release-binance", label: "Binance 只读账户" },
    snapshot: snapshot("19960", [
      valuedHolding({
        symbol: "USDT",
        name: "USDT · Binance Spot",
        sourceAsset: "USDT",
        quantity: "20000",
        price: "0.998",
        value: "19960",
        assetClass: "crypto",
        priceSource: "Binance 来源原生价格",
      }),
    ]),
  });
  await services.assetSourceConnections.connectOkx({
    credentials: "release-okx-secret",
    permissions: ["account", "positions", "market-data"],
    account: { id: "release-okx", label: "OKX 只读账户" },
    scopeFingerprint: "release-okx:read-only",
    snapshot: snapshot("10050", [
      valuedHolding({
        symbol: "USDT",
        name: "USDT · OKX Spot",
        sourceAsset: "USDT",
        quantity: "10000",
        price: "1.005",
        value: "10050",
        assetClass: "crypto",
        priceSource: "OKX 来源原生价格",
      }),
    ]),
  });
  await services.assetSourceConnections.connectBitget({
    credentials: "release-bitget-secret",
    accountMode: "classic",
    permissions: ["account", "positions", "market-data"],
    account: { id: "release-bitget", label: "Bitget 只读账户" },
    scopeFingerprint: "release-bitget:read-only",
    snapshot: snapshot("5000", [
      valuedHolding({
        symbol: "BTC",
        name: "Bitcoin · Bitget Spot",
        sourceAsset: "BTC",
        quantity: "0.1",
        price: "50000",
        value: "5000",
        assetClass: "crypto",
        priceSource: "Bitget 来源原生价格",
      }),
    ]),
  });
  await services.assetSourceConnections.connectEvm({
    credentials: "release-ethereum-addresses",
    chain: "ethereum",
    permissions: ["public-address", "positions", "market-data"],
    account: { id: "release-ethereum", label: "Ethereum 观察钱包" },
    snapshot: evmSnapshot("1"),
  });
  await services.assetSourceConnections.connectEvm({
    credentials: "release-bsc-addresses",
    chain: "bsc",
    permissions: ["public-address", "positions", "market-data"],
    account: { id: "release-bsc", label: "BNB Smart Chain 观察钱包" },
    snapshot: evmSnapshot("56"),
  });
  return services;
}

async function seedMigrationAcceptance() {
  const services = await seed();
  await services.manualAssetRecords.create({ label: "迁移手工储备" });
  const manualSource = (await services.assetSources.list()).find(
    (source) => source.kind === "manual",
  );
  if (manualSource === undefined) {
    throw new Error("迁移验收夹具未创建手工资产来源");
  }
  await services.manualAssetRecords.record(manualSource.id, {
    day: "2025-12-31",
    amount: "12345.67",
    currency: "USD",
  });
  await services.assetCards.replaceAll(
    (await services.assetCards.list()).map((card) =>
      card.sourceId === "test-binance-source-2"
        ? { ...card, span: 2, startsNewRow: true }
        : card,
    ),
  );
  return services;
}

export async function POST(request: Request) {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
  } | null;
  if (body?.action === "partial-failure") {
    getTestServices().assetSynchronization.reset("release-partial-failure");
    return Response.json({ ok: true });
  }
  if (body?.action !== "seed" && body?.action !== "seed-migration") {
    return Response.json({ error: "发布验收操作无效" }, { status: 400 });
  }
  try {
    const services = body.action === "seed-migration"
      ? await seedMigrationAcceptance()
      : await seed();
    return Response.json({
      sourceCount: (await services.assetSources.list()).length,
      secretCount: services.secrets.size(),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "发布验收夹具失败" },
      { status: 409 },
    );
  }
}
