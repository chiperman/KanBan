import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  KeychainLongbridgeOAuth,
  ProductionLongbridgeOAuth,
  ProductionLongbridgeSourceRefresher,
} from "@/server/asset-sources/longbridge";
import { isTestEnv } from "@/server/composition";
import type { AssetSourceSummary } from "@/server/ports";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as {
    action?:
      | "start"
      | "finish"
      | "refresh-prices"
      | "refresh-prices-expired"
      | "refresh-holdings"
      | "refresh-invalid"
      | "refresh-expired"
      | "refresh-expired-trade"
      | "refresh-expired-malformed-scope"
      | "keychain-snapshot"
      | "rest-source-audit";
    scenario?: "readonly" | "trade" | "missing" | "unknown" | "extra";
  };
  const previousClientId = process.env.LONGBRIDGE_OAUTH_CLIENT_ID;
  process.env.LONGBRIDGE_OAUTH_CLIENT_ID = "browser-test-client";
  const assetRequests: string[] = [];
  let tokenRequests = 0;
  let credentialsRotated = false;
  const scope = {
    readonly: "account.read",
    trade: "account.read 11",
    missing: undefined,
    unknown: "account.read 99",
    extra: "account.read 10",
  }[body.scenario ?? "readonly"];
  const accessToken = [
    Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
    Buffer.from(JSON.stringify({
      sub: JSON.stringify({ account_channel: "lb" }),
    })).toString("base64url"),
    "test-signature",
  ].join(".");
  const mockFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
    );
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    if (url.pathname === "/oauth2/token") {
      const rawBody = input instanceof Request
        ? await input.clone().text()
        : typeof init?.body === "string" || init?.body instanceof URLSearchParams
          ? init.body.toString()
          : "";
      const form = new URLSearchParams(rawBody);
      if (form.get("grant_type") === "refresh_token") {
        tokenRequests += 1;
        return Response.json({
          access_token: "rotated-readonly-access-token",
          refresh_token: "rotated-readonly-refresh-token",
          expires_in: 2592000,
          token_type: "Bearer",
          scope:
            body.action === "refresh-expired-trade"
              ? "account.read 11"
              : body.action === "refresh-expired-malformed-scope"
                ? null
                : "account.read",
        });
      }
      return Response.json({
        access_token: accessToken,
        refresh_token: "refresh-token-must-never-reach-browser",
        expires_in: 3600,
        token_type: "Bearer",
        ...(scope ? { scope } : {}),
      });
    }
    assetRequests.push(`${method} ${url.pathname}${url.search}`);
    if (url.pathname === "/v1/asset/account") {
      return Response.json({
        code: 0,
        data: {
          list: [{ currency: "USD", net_assets: "123456.7891" }],
        },
      });
    }
    if (url.pathname === "/v1/asset/stock") {
      return Response.json({
        code: 0,
        data: {
          list: [{
            account_channel: "lb",
            stock_info: [{
              symbol: "AAPL.US",
              symbol_name: "Apple",
              quantity: "10.125",
              available_quantity: "10.125",
              currency: "USD",
              cost_price: "190.1234",
              market: "US",
              init_quantity: "10.125",
            }],
          }],
        },
      });
    }
    if (url.pathname === "/v1/asset/fund") {
      return Response.json({ code: 0, data: { list: [] } });
    }
    return Response.json({ error: "unexpected request" }, { status: 500 });
  };
  try {
    if (body.action === "keychain-snapshot") {
      const oauth = new KeychainLongbridgeOAuth({
        beginAuthorization: () => ({
          status: "authorized" as const,
          authorizationUrl: null,
        }),
        beginBrowserAuthorization: () => ({
          authorizationUrl: "https://openapi.longbridge.com/oauth2/authorize",
          state: "test-state",
        }),
        completeBrowserAuthorization: async () => undefined,
        authorizationStatus: () => ({
          status: "authorized" as const,
          authorizationUrl: null,
        }),
        credentialReference: () => "macos-keychain:browser-test-client",
        readAssets: async () => {
          const assets = {
            accountPage: {
              data: { list: [{ currency: "USD", net_assets: "74442.43" }] },
            },
            stockPage: {
              data: {
                list: [{
                  account_channel: "lb",
                  stock_info: [{
                    symbol: "700.HK",
                    symbol_name: "Tencent",
                    quantity: "10",
                    currency: "HKD",
                    cost_price: "500",
                  }],
                }],
              },
            },
            fundPage: { data: { list: [] } },
            exchangeRates: [{
              base_currency: "USD",
              other_currency: "HKD",
              average_rate: 0.12751,
              bid_rate: 0.12751,
              offer_rate: 0.12751,
            }],
          };
          return assets;
        },
        readQuotes: async () => [{
          symbol: "700.HK",
          lastDone: "600",
          timestamp: 1785150000,
        }],
      });
      const { credentials: _credentials, ...safe } = await oauth.finish({
        code: "browser-test-code",
        codeVerifier: "test-state",
        redirectUri: new URL("/callback", request.url).toString(),
      });
      return Response.json(safe);
    }
    if (body.action === "rest-source-audit") {
      const [adapter, packageJson, lockfile] = await Promise.all([
        readFile(path.join(/* turbopackIgnore: true */ process.cwd(), "src/server/asset-sources/longbridge.ts"), "utf8"),
        readFile(path.join(/* turbopackIgnore: true */ process.cwd(), "package.json"), "utf8"),
        readFile(path.join(/* turbopackIgnore: true */ process.cwd(), "pnpm-lock.yaml"), "utf8"),
      ]);
      const forbidden = [
        "TradeContext",
        "submitOrder",
        "replaceOrder",
        "cancelOrder",
        "/v1/trade/order",
      ].filter((identifier) => adapter.includes(identifier));
      return Response.json({
        forbidden,
        hasMcpDependency:
          packageJson.includes("@modelcontextprotocol/sdk") ||
          lockfile.includes("@modelcontextprotocol/sdk"),
        hasMcpEndpoint: adapter.includes("mcp.longbridge.com"),
        hasSdkDependency: packageJson.includes('"longbridge"') || lockfile.includes("longbridge@"),
        hasSdkReference: adapter.includes("QuoteContext") || adapter.includes("LongbridgeSdk"),
      });
    }
    if (body.action?.startsWith("refresh-")) {
      const source: AssetSourceSummary = {
        id: "production-refresh-source",
        kind: "longbridge",
        label: "长桥生产刷新测试账户",
        accountId: "longbridge:test",
        permissions: ["account", "positions"],
        credentialReference: "server-only-reference",
        snapshot: {
          total: {
            amount: "1000",
            currency: "USD",
          },
          holdings: [{
            symbol: "AAPL.US",
            name: "Apple",
            quantity: "10",
            currency: "USD",
            assetClass: "securities",
            currentPrice: { amount: "100", currency: "USD" },
            marketValue: "1000",
            sourceMarketValue: { amount: "1000", currency: "USD" },
            valuation: {
              status: "valued",
              priceSource: "Longbridge 账户估值",
              pricedAt: "2026-05-28T00:00:00.000Z",
            },
            costPrice: "90",
            platformProfit: "100",
            changePercent: "1",
          }],
          exchangeRates: [],
          syncedAt: "2026-05-28T00:00:00.000Z",
        },
        sync: {
          status: "current",
          lastSuccessfulAt: "2026-05-28T00:00:00.000Z",
          lastAttemptAt: "2026-05-28T00:00:00.000Z",
          error: null,
        },
      };
      const refresher = new ProductionLongbridgeSourceRefresher(mockFetch);
      const expired =
        body.action === "refresh-expired" ||
        body.action === "refresh-expired-trade" ||
        body.action === "refresh-prices-expired" ||
        body.action === "refresh-expired-malformed-scope";
      const result = await refresher.refresh({
        source,
        credentials: JSON.stringify({
          accessToken,
          refreshToken: expired ? "saved-readonly-refresh-token" : null,
          expiresIn: expired ? 3600 : null,
          obtainedAt: expired ? "2026-05-01T00:00:00.000Z" : null,
          validatedScopes:
            body.action === "refresh-invalid" ? ["6", "11"] : ["6"],
        }),
        mode:
          body.action === "refresh-prices" || body.action === "refresh-prices-expired"
            ? "prices"
            : "holdings",
        attemptedAt: "2026-05-29T00:00:00.000Z",
        signal: new AbortController().signal,
        persistCredentials: async () => {
          credentialsRotated = true;
        },
      });
      return Response.json({
        snapshot: result.snapshot,
        credentialsRotated,
        assetRequests,
        quotedSymbols: [],
        tokenRequests,
      });
    }
    const oauth = new ProductionLongbridgeOAuth(mockFetch);
    if (body.action === "finish") {
      const { credentials: _credentials, ...safe } = await oauth.finish({
        code: "browser-test-code",
        codeVerifier: "browser-test-code-verifier",
        redirectUri: new URL("/callback", request.url).toString(),
      });
      return Response.json({
        ...safe,
        assetRequests,
      });
    }
    const started = await oauth.start(new URL("/callback", request.url).toString());
    return Response.json({
      authorizationUrl: started.authorizationUrl,
      state: started.state,
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "无法完成授权",
        assetRequests,
        quotedSymbols: [],
        tokenRequests,
        credentialsRotated,
      },
      { status: 400 },
    );
  } finally {
    if (previousClientId === undefined) {
      delete process.env.LONGBRIDGE_OAUTH_CLIENT_ID;
    } else {
      process.env.LONGBRIDGE_OAUTH_CLIENT_ID = previousClientId;
    }
  }
}
