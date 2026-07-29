import { createHmac } from "node:crypto";

import {
  CoinGeckoUsdtUsdPrices,
  ProductionBinanceReadOnly,
  ProductionBinanceSourceRefresher,
} from "@/server/asset-sources/binance";
import { isTestEnv } from "@/server/composition";
import type { Prices } from "@/server/ports";
import {
  BINANCE_OBSERVED_AT,
  BINANCE_USDT_USD_QUOTE,
  binanceFixture,
  binancePermissions,
} from "@/server/testing/binance-fixtures";

export const dynamic = "force-dynamic";

const API_KEY = "binance-browser-api-key";
const API_SECRET = "binance-browser-secret-must-not-leak";

function businessLabel(method: string, url: URL, body: URLSearchParams | null) {
  const params = method === "POST" ? body! : url.searchParams;
  const allowed = [
    "omitZeroBalances",
    "needBtcValuation",
    "current",
    "size",
    "pageIndex",
    "pageSize",
  ];
  const query = new URLSearchParams();
  for (const key of allowed) {
    const value = params.get(key);
    if (value !== null) query.set(key, value);
  }
  return `${method} ${url.pathname}${query.size ? `?${query}` : ""}`;
}

export async function POST(request: Request) {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  if (
    body?.action !== "preview-valid" &&
    body?.action !== "preview-trade" &&
    body?.action !== "preview-missing-price" &&
    body?.action !== "preview-collateral-receipt" &&
    body?.action !== "preview-invalid-locked-status" &&
    body?.action !== "preview-unsafe-position-id" &&
    body?.action !== "preview-investments" &&
    body?.action !== "preview-wallet-gap" &&
    body?.action !== "preview-unknown-product-state" &&
    body?.action !== "preview-wrapped-staking" &&
    body?.action !== "preview-product-failure" &&
    body?.action !== "preview-native-usdt-usd" &&
    body?.action !== "preview-usdt-usd-fallback" &&
    body?.action !== "refresh-prices"
  ) {
    return Response.json({ error: "Binance 生产测试场景无效" }, { status: 400 });
  }
  const missingPrice = body.action === "preview-missing-price";
  const investmentScenario = body.action === "preview-wallet-gap"
    ? "wallet-gap"
    : body.action === "preview-unknown-product-state"
      ? "unknown-state"
      : body.action === "preview-investments"
        ? "investments"
        : body.action === "preview-product-failure"
          ? "investments"
        : body.action === "preview-wrapped-staking"
          ? "wrapped-staking"
        : "baseline";
  const fixture = binanceFixture(
    missingPrice,
    body.action === "preview-collateral-receipt",
    false,
    investmentScenario,
  );
  if (body.action === "preview-native-usdt-usd") {
    fixture.exchangeInfo.symbols.push({
      symbol: "USDTUSD",
      status: "TRADING",
      baseAsset: "USDT",
      quoteAsset: "USD",
      isSpotTradingAllowed: true,
    });
    fixture.tickers.push({ symbol: "USDTUSD", price: "0.997" });
  }
  const privateRequests: string[] = [];
  const publicRequests: string[] = [];
  const signedChecks: boolean[] = [];
  const hostChecks: boolean[] = [];
  const transport = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    hostChecks.push(url.origin === "https://api.binance.com");
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const requestBody = init?.body instanceof URLSearchParams
      ? init.body
      : typeof init?.body === "string"
        ? new URLSearchParams(init.body)
        : null;
    const privatePath = [
      "/sapi/v1/account/apiRestrictions",
      "/api/v3/account",
      "/sapi/v1/asset/get-funding-asset",
      "/sapi/v1/simple-earn/flexible/position",
      "/sapi/v1/simple-earn/locked/position",
      "/sapi/v1/asset/wallet/balance",
      "/sapi/v1/simple-earn/account",
      "/sapi/v1/dci/product/accounts",
      "/sapi/v1/dci/product/positions",
      "/sapi/v1/accumulator/product/sum-holding",
      "/sapi/v1/accumulator/product/position/list",
      "/sapi/v1/bfusd/account",
      "/sapi/v1/rwusd/account",
      "/sapi/v2/eth-staking/account",
      "/sapi/v1/sol-staking/account",
      "/sapi/v1/onchain-yields/account",
      "/sapi/v1/onchain-yields/locked/position",
      "/sapi/v1/soft-staking/list",
    ].includes(url.pathname);
    if (privatePath) {
      privateRequests.push(businessLabel(method, url, requestBody));
      const signed = method === "POST" ? requestBody! : url.searchParams;
      const unsigned = new URLSearchParams(signed);
      const receivedSignature = unsigned.get("signature");
      unsigned.delete("signature");
      const expectedSignature = createHmac("sha256", API_SECRET)
        .update(unsigned.toString())
        .digest("hex");
      signedChecks.push(
        new Headers(init?.headers).get("x-mbx-apikey") === API_KEY &&
        /^\d+$/.test(signed.get("timestamp") ?? "") &&
        signed.get("recvWindow") === "5000" &&
        receivedSignature === expectedSignature,
      );
    } else if (
      url.pathname === "/api/v3/exchangeInfo" ||
      url.pathname === "/api/v3/ticker/price"
    ) {
      publicRequests.push(`${method} ${url.pathname}`);
    }

    if (
      body.action === "preview-product-failure" &&
      url.pathname === "/sapi/v1/bfusd/account"
    ) {
      return Response.json(
        { code: -1000, msg: "fixture BFUSD unavailable" },
        { status: 500 },
      );
    }

    let response: unknown;
    if (url.pathname === "/api/v3/time") {
      response = { serverTime: Date.parse(BINANCE_OBSERVED_AT) };
    } else if (url.pathname === "/sapi/v1/account/apiRestrictions") {
      response = binancePermissions(body.action === "preview-trade" ? "trade" : "valid");
    } else if (url.pathname === "/api/v3/account") {
      response = fixture.spotAccount;
    } else if (url.pathname === "/sapi/v1/asset/get-funding-asset") {
      response = fixture.fundingAssets;
    } else if (url.pathname === "/sapi/v1/simple-earn/flexible/position") {
      const current = Number(url.searchParams.get("current"));
      response = fixture.flexiblePages[current - 1];
    } else if (url.pathname === "/sapi/v1/simple-earn/locked/position") {
      const current = Number(url.searchParams.get("current"));
      response = fixture.lockedPages[current - 1];
    } else if (url.pathname === "/sapi/v1/asset/wallet/balance") {
      response = fixture.walletBalances;
    } else if (url.pathname === "/sapi/v1/simple-earn/account") {
      response = fixture.simpleEarnAccount;
    } else if (url.pathname === "/sapi/v1/dci/product/accounts") {
      response = fixture.dualAccounts;
    } else if (url.pathname === "/sapi/v1/dci/product/positions") {
      const pageIndex = Number(url.searchParams.get("pageIndex"));
      response = fixture.dualPages[pageIndex - 1];
    } else if (url.pathname === "/sapi/v1/accumulator/product/sum-holding") {
      response = fixture.discountAccount;
    } else if (url.pathname === "/sapi/v1/accumulator/product/position/list") {
      const pageIndex = Number(url.searchParams.get("pageIndex"));
      response = fixture.discountPages[pageIndex - 1];
    } else if (url.pathname === "/sapi/v1/bfusd/account") {
      response = fixture.bfusdAccount;
    } else if (url.pathname === "/sapi/v1/rwusd/account") {
      response = fixture.rwusdAccount;
    } else if (url.pathname === "/sapi/v2/eth-staking/account") {
      response = fixture.ethStakingAccount;
    } else if (url.pathname === "/sapi/v1/sol-staking/account") {
      response = fixture.solStakingAccount;
    } else if (url.pathname === "/sapi/v1/onchain-yields/account") {
      response = fixture.onchainAccount;
    } else if (url.pathname === "/sapi/v1/onchain-yields/locked/position") {
      const pageIndex = Number(url.searchParams.get("pageIndex"));
      response = fixture.onchainPages[pageIndex - 1];
    } else if (url.pathname === "/sapi/v1/soft-staking/list") {
      response = fixture.softStaking;
    } else if (url.pathname === "/api/v3/exchangeInfo") {
      response = fixture.exchangeInfo;
    } else if (url.pathname === "/api/v3/ticker/price") {
      response = fixture.tickers;
    } else {
      return Response.json({ code: -1000, msg: "unexpected endpoint" }, { status: 500 });
    }
    return Response.json(response);
  };
  let referencePriceRequests = 0;
  const prices: Prices = {
    async quote(symbol) {
      referencePriceRequests += 1;
      if (body.action === "preview-native-usdt-usd") {
        throw new Error("原生 USDT/USD 可用时不应请求参考价格");
      }
      if (body.action === "preview-usdt-usd-fallback") return null;
      return symbol === "USDT" ? BINANCE_USDT_USD_QUOTE : null;
    },
  };
  if (body.action === "preview-invalid-locked-status") {
    fixture.lockedPages[0].rows[0].status = "REDEEMED";
  }
  if (body.action === "preview-unsafe-position-id") {
    fixture.lockedPages[0].rows[0].positionId = Number.MAX_SAFE_INTEGER + 2;
  }
  try {
    const result = await new ProductionBinanceReadOnly(prices, transport).preview({
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      observedAt: BINANCE_OBSERVED_AT,
    });
    if (body.action === "refresh-prices") {
      privateRequests.length = 0;
      publicRequests.length = 0;
      const refreshed = await new ProductionBinanceSourceRefresher(
        prices,
        transport,
      ).refresh({
        source: {
          id: "binance-price-refresh",
          kind: "binance",
          label: result.account.label,
          accountId: result.account.id,
          permissions: result.permissions,
          credentialReference: "server-only-reference",
          snapshot: result.snapshot,
          sync: {
            status: "current",
            lastSuccessfulAt: result.snapshot.syncedAt,
            lastAttemptAt: result.snapshot.syncedAt,
            error: null,
          },
        },
        credentials: result.credentials,
        mode: "prices",
        attemptedAt: BINANCE_OBSERVED_AT,
        signal: new AbortController().signal,
        async persistCredentials() {},
      });
      return Response.json({
        privateRequests,
        publicRequests,
        total: refreshed.snapshot.total,
      });
    }
    return Response.json({
      permissions: result.permissions,
      account: result.account,
      snapshot: result.snapshot,
      referencePriceRequests,
      privateRequests,
      allRequestsSigned: signedChecks.length > 0 && signedChecks.every(Boolean),
      allHostsPinned: hostChecks.length > 0 && hostChecks.every(Boolean),
      missingReferencePriceFallsBack:
        (await new CoinGeckoUsdtUsdPrices(async () => {
          throw new Error("reference price unavailable");
        }).quote("USDT")) === null,
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Binance 读取失败",
        privateRequests,
        allRequestsSigned: signedChecks.length > 0 && signedChecks.every(Boolean),
        allHostsPinned: hostChecks.length > 0 && hostChecks.every(Boolean),
      },
      { status: 400 },
    );
  }
}
