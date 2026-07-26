import { createHmac } from "node:crypto";

import {
  ProductionOkxReadOnly,
  ProductionOkxSourceRefresher,
} from "@/server/asset-sources/okx";
import { isTestEnv } from "@/server/composition";
import type { Prices } from "@/server/ports";
import {
  OKX_OBSERVED_AT,
  OKX_USDT_USD_QUOTE,
  okxAccountConfig,
  okxApiFixture,
} from "@/server/testing/okx-fixtures";

export const dynamic = "force-dynamic";

const API_KEY = "okx-browser-api-key";
const API_SECRET = "okx-browser-secret-must-not-leak";
const PASSPHRASE = "okx-browser-passphrase-must-not-leak";

export async function POST(request: Request) {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
  } | null;
  const actions = new Set([
    "preview-valid",
    "preview-trade",
    "preview-withdraw",
    "preview-futures",
    "preview-borrow",
    "preview-option",
    "preview-liability",
    "preview-missing-liability-proof",
    "preview-missing-price",
    "preview-zero-price",
    "refresh-prices",
    "refresh-older-ticker",
    "refresh-all-older-ticker",
    "timestamp-retry",
    "invalid-auth",
    "preview-eea",
  ]);
  if (typeof body?.action !== "string" || !actions.has(body.action)) {
    return Response.json({ error: "OKX 生产测试场景无效" }, { status: 400 });
  }
  const fixture = okxApiFixture();
  const config = okxAccountConfig(
    body.action === "preview-trade"
      ? "read_only,trade"
      : body.action === "preview-withdraw"
        ? "read_only,withdraw"
        : "read_only",
  );
  if (body.action === "preview-futures") config.data[0].acctLv = "2";
  if (body.action === "preview-borrow") {
    config.data[0].enableSpotBorrow = true;
  }
  if (body.action === "preview-option") {
    fixture.options.data.push({ instType: "OPTION", instId: "BTC-USD-260101-60000-C", pos: "1" });
  }
  if (body.action === "preview-liability") {
    fixture.trading.data[0].details[0].liab = "0.01";
  }
  if (body.action === "preview-missing-liability-proof") {
    delete (fixture.trading.data[0].details[0] as { liab?: string }).liab;
  }
  if (body.action === "preview-missing-price") {
    fixture.funding.data.push({
      ccy: "UNKNOWN",
      bal: "8.123456789",
      availBal: "8.123456789",
      frozenBal: "0",
    });
  }
  if (body.action === "preview-zero-price") {
    const btc = fixture.tickers.data.find(({ instId }) => instId === "BTC-USDT");
    if (btc) btc.last = "0";
  }
  const privatePaths = new Set([
    "/api/v5/account/config",
    "/api/v5/account/positions",
    "/api/v5/account/balance",
    "/api/v5/asset/balances",
    "/api/v5/finance/savings/balance",
  ]);
  const privateRequests: string[] = [];
  const publicRequests: string[] = [];
  const methods: string[] = [];
  const signatures: boolean[] = [];
  const hosts: boolean[] = [];
  let timeRequests = 0;
  let configRequests = 0;
  const expectedOrigin = body.action === "preview-eea"
    ? "https://eea.okx.com"
    : "https://openapi.okx.com";
  const transport = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    methods.push(method);
    hosts.push(url.origin === expectedOrigin);
    if (
      url.pathname === "/api/v5/public/instruments" ||
      url.pathname === "/api/v5/market/tickers"
    ) {
      publicRequests.push(`${method} ${url.pathname}${url.search}`);
    }
    if (privatePaths.has(url.pathname)) {
      const requestPath = `${url.pathname}${url.search}`;
      privateRequests.push(`${method} ${requestPath}`);
      const headers = new Headers(init?.headers);
      const timestamp = headers.get("OK-ACCESS-TIMESTAMP") ?? "";
      const expected = createHmac("sha256", API_SECRET)
        .update(`${timestamp}${method}${requestPath}`)
        .digest("base64");
      signatures.push(
        headers.get("OK-ACCESS-KEY") === API_KEY &&
        headers.get("OK-ACCESS-PASSPHRASE") === PASSPHRASE &&
        headers.get("OK-ACCESS-SIGN") === expected &&
        !Number.isNaN(Date.parse(timestamp)),
      );
    }
    let response: unknown;
    if (url.pathname === "/api/v5/public/time") {
      timeRequests += 1;
      response = fixture.time;
    }
    else if (url.pathname === "/api/v5/account/config") {
      configRequests += 1;
      response = body.action === "invalid-auth"
        ? { code: "50114", msg: "Invalid authorization", data: [] }
        : body.action === "timestamp-retry" && configRequests === 1
          ? { code: "50102", msg: "Timestamp request expired", data: [] }
          : config;
    } else if (url.pathname === "/api/v5/account/positions") {
      response = fixture.options;
    } else if (url.pathname === "/api/v5/account/balance") {
      response = fixture.trading;
    } else if (url.pathname === "/api/v5/asset/balances") {
      response = fixture.funding;
    } else if (url.pathname === "/api/v5/finance/savings/balance") {
      response = fixture.savings;
    } else if (url.pathname === "/api/v5/public/instruments") {
      response = fixture.instruments;
    } else if (url.pathname === "/api/v5/market/tickers") {
      response = fixture.tickers;
    } else {
      response = { code: "51000", msg: "unexpected endpoint", data: [] };
    }
    return Response.json(response);
  };
  const prices: Prices = {
    async quote(symbol) {
      return symbol === "USDT" ? OKX_USDT_USD_QUOTE : null;
    },
  };
  try {
    const result = await new ProductionOkxReadOnly(prices, transport).preview({
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      passphrase: PASSPHRASE,
      region: body.action === "preview-eea" ? "eea" : "global",
      observedAt: OKX_OBSERVED_AT,
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
        const btc = fixture.tickers.data.find(({ instId }) => instId === "BTC-USDT");
        if (btc) {
          btc.last = "1";
          btc.ts = String(Date.parse(OKX_OBSERVED_AT) - 60_000);
        }
      }
      privateRequests.length = 0;
      publicRequests.length = 0;
      methods.length = 0;
      signatures.length = 0;
      hosts.length = 0;
      const refreshed = await new ProductionOkxSourceRefresher(
        prices,
        transport,
      ).refresh({
        source: {
          id: "okx-price-refresh",
          kind: "okx",
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
        attemptedAt: OKX_OBSERVED_AT,
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
      allRequestsGet: methods.every((method) => method === "GET"),
      allPrivateRequestsSigned:
        signatures.length === privateRequests.length && signatures.every(Boolean),
      allHostsPinned: hosts.length > 0 && hosts.every(Boolean),
      timeRequests,
      configRequests,
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "OKX 读取失败",
        privateRequests,
        timeRequests,
        configRequests,
        allPrivateRequestsSigned:
          signatures.length === privateRequests.length && signatures.every(Boolean),
      },
      { status: 400 },
    );
  }
}
