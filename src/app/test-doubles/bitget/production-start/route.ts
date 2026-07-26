import { createHmac } from "node:crypto";

import {
  ProductionBitgetReadOnly,
  ProductionBitgetSourceRefresher,
  type BitgetRuntime,
} from "@/server/asset-sources/bitget";
import { isTestEnv } from "@/server/composition";
import type { Prices } from "@/server/ports";
import {
  BITGET_OBSERVED_AT,
  BITGET_USDT_USD_QUOTE,
  bitgetAccountInfo,
  bitgetApiFixture,
  bitgetUtaAccountInfo,
  bitgetUtaApiFixture,
} from "@/server/testing/bitget-fixtures";

export const dynamic = "force-dynamic";

const API_KEY = "bitget-browser-api-key";
const API_SECRET = "bitget-browser-secret-must-not-leak";
const PASSPHRASE = "bitget-browser-passphrase-must-not-leak";

export async function POST(request: Request) {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
  } | null;
  const actions = new Set([
    "preview-valid",
    "preview-trade",
    "preview-withdraw",
    "preview-unknown",
    "preview-missing-price",
    "preview-zero-price",
    "refresh-prices",
    "refresh-older-ticker",
    "refresh-all-older-ticker",
    "timestamp-retry",
    "invalid-auth",
    "preview-uta-valid",
    "preview-uta-write",
    "preview-uta-missing-trade",
    "preview-uta-withdraw",
    "preview-uta-position",
    "preview-uta-order-second-page",
    "preview-uta-debt",
    "preview-uta-risk",
    "preview-uta-funding-mismatch",
    "preview-earn-mismatch",
    "preview-earn-cursor-repeat",
    "preview-empty-funding",
    "preview-earn-multi-page",
    "preview-earn-page-failure",
    "preview-earn-missing-end-id",
    "transient-retry",
    "transient-exhausted",
    "permission-error",
    "uta-permission-error",
    "ip-error",
    "region-error",
    "http-429-retry",
    "http-500-retry",
  ]);
  if (typeof body?.action !== "string" || !actions.has(body.action)) {
    return Response.json({ error: "Bitget 生产测试场景无效" }, { status: 400 });
  }

  const fixture = bitgetApiFixture();
  const utaFixture = bitgetUtaApiFixture();
  const isUta =
    body.action.startsWith("preview-uta-") ||
    body.action === "uta-permission-error";
  const authorities = body.action === "preview-trade"
    ? ["stor", "stow"]
    : body.action === "preview-withdraw"
      ? ["stor", "wow"]
      : body.action === "preview-unknown"
        ? ["stor", "future_scope"]
        : ["stor", "wtor"];
  const accountInfo = bitgetAccountInfo(authorities);
  if (body.action === "preview-earn-multi-page") {
    accountInfo.data.regisTime = String(Date.parse(BITGET_OBSERVED_AT) - 100 * 24 * 60 * 60_000);
    fixture.earnOverview.data.push({ coin: "ADA", amount: "10" });
    fixture.instruments.data.push({
      symbol: "ADAUSDT",
      baseCoin: "ADA",
      quoteCoin: "USDT",
      status: "online",
    });
    fixture.tickers.data.push({
      symbol: "ADAUSDT",
      lastPr: "1",
      ts: String(Date.parse(BITGET_OBSERVED_AT)),
    });
  }
  const utaAccountInfo = bitgetUtaAccountInfo(
    body.action === "preview-uta-write" ? "read-and-write" : "read-only",
    body.action === "preview-uta-missing-trade"
      ? ["uta_mgt"]
      : body.action === "preview-uta-withdraw"
        ? ["uta_mgt", "uta_trade", "withdraw"]
        : ["uta_mgt", "uta_trade"],
  );
  if (body.action === "preview-missing-price") {
    fixture.funding.data.push({
      coin: "UNKNOWN",
      available: "8.123456789",
      frozen: "0",
      usdtValue: "0",
    });
  }
  if (body.action === "preview-earn-mismatch") {
    fixture.earnOverview.data[0].amount = "6";
  }
  if (body.action === "preview-earn-cursor-repeat") {
    fixture.flexible.data.endId = "same-cursor";
  }
  if (body.action === "preview-empty-funding") {
    fixture.funding.data[0].frozen = "";
  }
  if (body.action === "preview-uta-debt") {
    utaFixture.assets.data.assets[0].debt = "0.01";
  }
  if (body.action === "preview-uta-risk") {
    utaFixture.assets.data.unrealisedPnl = "1";
  }
  if (body.action === "preview-uta-funding-mismatch") {
    utaFixture.funding.data[0].balance = "2";
  }
  if (body.action === "preview-zero-price") {
    const btc = fixture.tickers.data.find(({ symbol }) => symbol === "BTCUSDT");
    if (btc) btc.lastPr = "0";
  }

  const privatePaths = new Set([
    "/api/v2/spot/account/info",
    "/api/v2/spot/account/assets",
    "/api/v2/account/funding-assets",
    "/api/v2/earn/account/assets",
    "/api/v2/earn/savings/assets",
    "/api/v3/account/info",
    "/api/v3/account/assets",
    "/api/v3/account/funding-assets",
    "/api/v3/position/current-position",
    "/api/v3/trade/unfilled-orders",
  ]);
  const privateRequests: string[] = [];
  const publicRequests: string[] = [];
  const methods: string[] = [];
  const signatures: boolean[] = [];
  const hosts: boolean[] = [];
  let timeRequests = 0;
  let accountInfoRequests = 0;
  const positionCategories = new Set<string>();
  const orderCategories = new Set<string>();
  const recordedSleeps: number[] = [];
  let runtimeNow = Date.parse(BITGET_OBSERVED_AT);
  const runtime: BitgetRuntime = {
    now: () => runtimeNow,
    async sleep(milliseconds) {
      recordedSleeps.push(milliseconds);
      runtimeNow += milliseconds;
    },
    earnRequestIntervalMs: 100,
    retryDelaysMs: [250, 750],
  };

  const transport = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    methods.push(method);
    hosts.push(url.origin === "https://api.bitget.com");
    if (
      url.pathname === "/api/v2/public/time" ||
      url.pathname === "/api/v2/spot/public/symbols" ||
      url.pathname === "/api/v2/spot/market/tickers"
    ) {
      publicRequests.push(`${method} ${url.pathname}${url.search}`);
    }
    if (privatePaths.has(url.pathname)) {
      const requestPath = `${url.pathname}${url.search}`;
      privateRequests.push(`${method} ${requestPath}`);
      const headers = new Headers(init?.headers);
      const timestamp = headers.get("ACCESS-TIMESTAMP") ?? "";
      const expected = createHmac("sha256", API_SECRET)
        .update(`${timestamp}${method}${requestPath}`)
        .digest("base64");
      signatures.push(
        headers.get("ACCESS-KEY") === API_KEY &&
        headers.get("ACCESS-PASSPHRASE") === PASSPHRASE &&
        headers.get("ACCESS-SIGN") === expected &&
        /^\d+$/.test(timestamp),
      );
    }

    let response: unknown;
    let responseStatus = 200;
    if (url.pathname === "/api/v2/public/time") {
      timeRequests += 1;
      response = fixture.time;
    } else if (url.pathname === "/api/v2/spot/account/info") {
      accountInfoRequests += 1;
      response = body.action === "invalid-auth"
        ? { code: "40006", msg: "Invalid ACCESS_KEY", data: {} }
        : body.action === "permission-error"
          ? { code: "40014", msg: "Incorrect permissions", data: {} }
          : body.action === "ip-error"
            ? { code: "40018", msg: "Invalid IP", data: {} }
            : body.action === "region-error"
              ? { code: "40000", msg: "Region restricted", data: {} }
              : body.action === "transient-exhausted"
                ? { code: "25000", msg: "System error", data: {} }
                : body.action === "transient-retry" && accountInfoRequests === 1
                  ? { code: "25000", msg: "System error", data: {} }
        : body.action === "timestamp-retry" && accountInfoRequests === 1
          ? { code: "40008", msg: "Request timestamp expired", data: {} }
          : accountInfo;
      if (body.action === "http-429-retry" && accountInfoRequests === 1) {
        response = { code: "429", msg: "Too Many Requests", data: {} };
        responseStatus = 429;
      }
      if (body.action === "http-500-retry" && accountInfoRequests === 1) {
        response = { code: "25000", msg: "System error", data: {} };
        responseStatus = 500;
      }
    } else if (url.pathname === "/api/v3/account/info") {
      accountInfoRequests += 1;
      response = body.action === "uta-permission-error"
        ? { code: "25620", msg: "Permission denied", data: {} }
        : utaAccountInfo;
    } else if (url.pathname === "/api/v2/spot/account/assets") {
      response = fixture.spot;
    } else if (url.pathname === "/api/v3/account/assets") {
      response = utaFixture.assets;
    } else if (url.pathname === "/api/v2/account/funding-assets") {
      response = fixture.funding;
    } else if (url.pathname === "/api/v3/account/funding-assets") {
      response = utaFixture.funding;
    } else if (url.pathname === "/api/v2/earn/account/assets") {
      response = fixture.earnOverview;
    } else if (url.pathname === "/api/v2/earn/savings/assets") {
      if (body.action === "preview-earn-missing-end-id") {
        response = {
          ...fixture.flexible,
          data: { resultList: fixture.flexible.data.resultList },
        };
      } else if (body.action === "preview-earn-multi-page") {
        const periodType = url.searchParams.get("periodType");
        const firstWindowStart = Date.parse(BITGET_OBSERVED_AT) - 90 * 24 * 60 * 60_000 + 1;
        const isOlderWindow = Number(url.searchParams.get("startTime")) < firstWindowStart;
        if (periodType === "flexible" && url.searchParams.has("idLessThan")) {
          response = {
            ...fixture.flexible,
            data: { resultList: [], endId: "" },
          };
        } else if (periodType === "flexible" && isOlderWindow) {
          response = {
            ...fixture.flexible,
            data: {
              resultList: [
                ...fixture.flexible.data.resultList,
                {
                  productId: "flex-ada-old",
                  productCoin: "ADA",
                  interestCoin: "ADA",
                  periodType: "flexible",
                  holdAmount: "10",
                  lastProfit: "0",
                  totalProfit: "0.1",
                  status: "in_holding",
                  productLevel: "normal",
                },
              ],
              endId: "",
            },
          };
        } else if (periodType === "flexible") {
          response = {
            ...fixture.flexible,
            data: { ...fixture.flexible.data, endId: "flex-page-2" },
          };
        } else if (isOlderWindow) {
          response = {
            ...fixture.fixed,
            data: { resultList: [], endId: "" },
          };
        } else {
          response = fixture.fixed;
        }
      } else if (body.action === "preview-earn-page-failure") {
        response = url.searchParams.has("idLessThan")
          ? { code: "40014", msg: "Incorrect permissions", data: {} }
          : {
              ...fixture.flexible,
              data: { ...fixture.flexible.data, endId: "failed-page" },
            };
      } else if (
        body.action === "preview-earn-cursor-repeat" &&
        url.searchParams.has("idLessThan")
      ) {
        response = fixture.flexible;
      } else {
        response = url.searchParams.get("periodType") === "fixed"
          ? fixture.fixed
          : fixture.flexible;
      }
    } else if (url.pathname === "/api/v3/position/current-position") {
      const category = url.searchParams.get("category") ?? "";
      positionCategories.add(category);
      response = body.action === "preview-uta-position" && category === "USDT-FUTURES"
        ? {
            ...utaFixture.emptyProof,
            data: { list: [{ symbol: "BTCUSDT", total: "0.1" }], cursor: "" },
          }
        : utaFixture.emptyProof;
    } else if (url.pathname === "/api/v3/trade/unfilled-orders") {
      const category = url.searchParams.get("category") ?? "";
      orderCategories.add(category);
      if (
        body.action === "preview-uta-order-second-page" &&
        category === "MARGIN"
      ) {
        response = url.searchParams.get("cursor") === "page-2"
          ? {
              ...utaFixture.emptyProof,
              data: { list: [{ orderId: "margin-order" }], cursor: "" },
            }
          : {
              ...utaFixture.emptyProof,
              data: { list: [], cursor: "page-2" },
            };
      } else {
        response = utaFixture.emptyProof;
      }
    } else if (url.pathname === "/api/v2/spot/public/symbols") {
      response = fixture.instruments;
    } else if (url.pathname === "/api/v2/spot/market/tickers") {
      response = fixture.tickers;
    } else {
      response = { code: "40034", msg: "unexpected endpoint", data: {} };
    }
    return Response.json(response, { status: responseStatus });
  };

  const prices: Prices = {
    async quote(symbol) {
      return symbol === "USDT" ? BITGET_USDT_USD_QUOTE : null;
    },
  };

  try {
    const result = await new ProductionBitgetReadOnly(
      prices,
      transport,
      runtime,
    ).preview({
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      passphrase: PASSPHRASE,
      accountMode: isUta ? "uta" : "classic",
      observedAt: BITGET_OBSERVED_AT,
    });
    if (
      body.action === "refresh-prices" ||
      body.action === "refresh-older-ticker" ||
      body.action === "refresh-all-older-ticker"
    ) {
      if (
        body.action === "refresh-older-ticker" ||
        body.action === "refresh-all-older-ticker"
      ) {
        const btc = fixture.tickers.data.find(({ symbol }) => symbol === "BTCUSDT");
        if (btc) {
          btc.lastPr = "1";
          btc.ts = String(Date.parse(BITGET_OBSERVED_AT) - 60_000);
        }
      }
      privateRequests.length = 0;
      publicRequests.length = 0;
      methods.length = 0;
      signatures.length = 0;
      hosts.length = 0;
      const refreshed = await new ProductionBitgetSourceRefresher(
        prices,
        transport,
        runtime,
      ).refresh({
        source: {
          id: "bitget-price-refresh",
          kind: "bitget",
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
        mode: body.action === "refresh-all-older-ticker" ? "all" : "prices",
        attemptedAt: BITGET_OBSERVED_AT,
        signal: new AbortController().signal,
        async persistCredentials() {},
      });
      return Response.json({
        privateRequests,
        publicRequests,
        total: refreshed.snapshot.total,
        holdingOrder: refreshed.snapshot.holdings
          .slice(0, 5)
          .map(({ sourceAsset }) => sourceAsset),
        btc: refreshed.snapshot.holdings.find(
          ({ sourceAsset, sourceAccount }) =>
            sourceAsset === "BTC" && sourceAccount === "spot",
        ),
      });
    }
    return Response.json({
      permissions: result.permissions,
      account: result.account,
      snapshot: result.snapshot,
      privateRequests,
      publicRequests,
      allRequestsGet: methods.every((method) => method === "GET"),
      allPrivateRequestsSigned:
        signatures.length === privateRequests.length && signatures.every(Boolean),
      allHostsPinned: hosts.length > 0 && hosts.every(Boolean),
      timeRequests,
      accountInfoRequests,
      savingsRequests: privateRequests.filter((path) =>
        path.includes("/api/v2/earn/savings/assets")),
      retrySleeps: recordedSleeps.filter((value) => value !== 100),
      earnThrottleSleeps: recordedSleeps.filter((value) => value === 100),
      btc: result.snapshot.holdings.find(
        ({ sourceAsset, sourceAccount }) =>
          sourceAsset === "BTC" && sourceAccount === "spot",
      ),
      utaProof: {
        positionCategories: positionCategories.size,
        orderCategories: orderCategories.size,
      },
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Bitget 读取失败",
        privateRequests,
        timeRequests,
        accountInfoRequests,
        savingsRequests: privateRequests.filter((path) =>
          path.includes("/api/v2/earn/savings/assets")),
        retrySleeps: recordedSleeps.filter((value) => value !== 100),
        earnThrottleSleeps: recordedSleeps.filter((value) => value === 100),
        snapshotCommitted: false,
        allPrivateRequestsSigned:
          signatures.length === privateRequests.length && signatures.every(Boolean),
      },
      { status: 400 },
    );
  }
}
