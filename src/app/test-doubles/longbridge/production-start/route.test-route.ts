import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  KeychainLongbridgeOAuth,
  KeychainLongbridgeSourceRefresher,
  ProductionLongbridgeOAuth,
  ProductionLongbridgeSourceRefresher,
} from "@/server/asset-sources/longbridge";

import type { AssetSourceSummary } from "@/server/ports";
import { testGuard } from "@/server/testing/route-support";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = testGuard();
  if (denied) return denied;
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
      | "keychain-quote-sessions"
      | "keychain-holdings-retains-quote-evidence"
      | "keychain-refresh-retry"
      | "keychain-refresh-retry-exhausted"
      | "rest-source-audit";
    scenario?:
      | "readonly"
      | "readonly-combined"
      | "trade"
      | "missing"
      | "unknown"
      | "extra"
      | "duplicate";
  };
  const previousClientId = process.env.LONGBRIDGE_OAUTH_CLIENT_ID;
  process.env.LONGBRIDGE_OAUTH_CLIENT_ID = "browser-test-client";
  const assetRequests: string[] = [];
  let tokenRequests = 0;
  let credentialsRotated = false;
  const scope = {
    readonly: "account.read",
    "readonly-combined": "trade.read watchlist account.read",
    trade: "account.read 11",
    missing: undefined,
    unknown: "account.read 99",
    extra: "account.read 10",
    duplicate: "watchlist account.read account.read",
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
    if (
      body.action === "keychain-refresh-retry" ||
      body.action === "keychain-refresh-retry-exhausted"
    ) {
      let readAssetsCalls = 0;
      const credentialReference = "macos-keychain:browser-test-client";
      const refresher = new KeychainLongbridgeSourceRefresher({
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
        credentialReference: () => credentialReference,
        readAssets: async () => {
          readAssetsCalls += 1;
          if (
            readAssetsCalls === 1 ||
            body.action === "keychain-refresh-retry-exhausted"
          ) {
            throw new Error(
              "无法读取 macOS Keychain 中的长桥凭证：Platform secure storage failure: The user name or passphrase you entered is not correct.",
            );
          }
          return {
            accountPage: {
              data: { list: [{ currency: "USD", net_assets: "74442.43" }] },
            },
            stockPage: { data: { list: [] } },
            fundPage: { data: { list: [] } },
            exchangeRates: [],
          };
        },
        readQuotes: async () => [],
        readDailyCandles: async () => [],
        readCandlesticks: async () => [],
        readFiveDayTrend: async () => [],
      });
      const source: AssetSourceSummary = {
        id: "keychain-retry-source",
        kind: "longbridge",
        label: "长桥 Keychain 重试测试",
        accountId: "longbridge:keychain-retry",
        permissions: ["account", "positions", "market-data"],
        credentialReference,
        snapshot: {
          total: { amount: "70000", currency: "USD" },
          holdings: [],
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
      const result = await refresher.refresh({
        source,
        credentials: credentialReference,
        mode: "holdings",
        attemptedAt: "2026-05-29T00:00:00.000Z",
        signal: new AbortController().signal,
        persistCredentials: async () => undefined,
      });
      return Response.json({
        readAssetsCalls,
        snapshot: result.snapshot,
      });
    }
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
              data: {
                list: [{
                  currency: "USD",
                  net_assets: "74442.43",
                  total_cash: "677.82",
                  cash_infos: [{
                    available_cash: "660.54",
                    currency: "USD",
                    frozen_cash: "0.57",
                    settling_cash: "0.57",
                    withdraw_cash: "660.54",
                  }, {
                    available_cash: "131.05",
                    currency: "HKD",
                    frozen_cash: "0",
                    settling_cash: "0",
                    withdraw_cash: "131.05",
                  }],
                }],
              },
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
                  }, {
                    symbol: "NVDA260805C210000.US",
                    symbol_name: "NVDA 260805 210 Call",
                    quantity: "-1",
                    currency: "USD",
                    cost_price: "0.450",
                  }, {
                    symbol: "HOOD260807P89000.US",
                    symbol_name: "HOOD 260807 89 Put",
                    quantity: "-2",
                    currency: "USD",
                    cost_price: "0.650",
                  }, {
                    symbol: "SPXW260807P6345.US",
                    symbol_name: "SPXW 260807 6345 Put",
                    quantity: "-1",
                    currency: "USD",
                    cost_price: "10.000",
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
          prevClose: "590",
          timestamp: 1785150000,
        }],
        readDailyCandles: async () => [],
        readCandlesticks: async () => [],
        readFiveDayTrend: async () => [],
      });
      const { credentials: _credentials, ...safe } = await oauth.finish({
        code: "browser-test-code",
        codeVerifier: "test-state",
        redirectUri: new URL("/callback", request.url).toString(),
      });
      return Response.json(safe);
    }
    if (body.action === "keychain-quote-sessions") {
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
        readAssets: async () => ({
          accountPage: {
            data: {
              list: [{
                currency: "USD",
                net_assets: "25000",
              }],
            },
          },
          stockPage: {
            data: {
              list: [{
                account_channel: "lb",
                stock_info: [{
                  symbol: "AAPL.US",
                  symbol_name: "Apple",
                  quantity: "10",
                  currency: "USD",
                  cost_price: "190",
                }, {
                  symbol: "NVDA.US",
                  symbol_name: "NVIDIA",
                  quantity: "5",
                  currency: "USD",
                  cost_price: "170",
                }, {
                  symbol: "TSLA.US",
                  symbol_name: "Tesla",
                  quantity: "3",
                  currency: "USD",
                  cost_price: "400",
                }, {
                  symbol: "MSFT.US",
                  symbol_name: "Microsoft",
                  quantity: "4",
                  currency: "USD",
                  cost_price: "480",
                }, {
                  symbol: "0700.HK",
                  symbol_name: "Tencent",
                  quantity: "20",
                  currency: "HKD",
                  cost_price: "550",
                }, {
                  symbol: "AMD.US",
                  symbol_name: "AMD",
                  quantity: "8",
                  currency: "USD",
                  cost_price: "160",
                }, {
                  symbol: "META.US",
                  symbol_name: "Meta",
                  quantity: "2",
                  currency: "USD",
                  cost_price: "590",
                }],
              }],
            },
          },
          fundPage: { data: { list: [] } },
          exchangeRates: [],
        }),
        readQuotes: async () => [{
          symbol: "AAPL.US",
          lastDone: "215.000",
          prevClose: "210",
          timestamp: 1785960000,
          tradeStatus: "NORMAL",
          delivery: "unknown",
        }, {
          symbol: "NVDA.US",
          lastDone: "181.000",
          prevClose: "180",
          timestamp: 1785960000,
          tradeStatus: "US_PREV",
          preMarketQuote: {
            lastDone: "184.250",
            timestamp: 1785964320,
          },
        }, {
          symbol: "TSLA.US",
          lastDone: "420.000",
          prevClose: "415",
          timestamp: 1785960000,
          tradeStatus: "US_AFTER",
          postMarketQuote: {
            lastDone: "422.500",
            timestamp: 1785963360,
          },
        }, {
          symbol: "MSFT.US",
          lastDone: "495.000",
          prevClose: "490",
          timestamp: 1785960000,
          tradeStatus: "US_NIGHT",
          overnightQuote: {
            lastDone: "500.125",
            timestamp: 1785958800,
          },
        }, {
          symbol: "0700.HK",
          lastDone: "600.000",
          prevClose: "590",
          timestamp: 1785961320,
          tradeStatus: "CLOSING",
          delivery: "delayed",
        }, {
          symbol: "AMD.US",
          lastDone: "177.000",
          prevClose: "176",
          timestamp: 1785960300,
          tradeStatus: "US_AFTER",
          preMarketQuote: {
            lastDone: "178.000",
            timestamp: 1785960300,
          },
          postMarketQuote: {
            lastDone: "179.000",
            timestamp: 1785960300,
          },
        }, {
          symbol: "META.US",
          lastDone: "601.000",
          prevClose: "600",
          timestamp: -1,
          tradeStatus: "US_PREV",
          preMarketQuote: {
            lastDone: "602.000",
            timestamp: -1,
          },
        }],
        readDailyCandles: async () => [],
        readCandlesticks: async () => [],
        readFiveDayTrend: async () => [],
      });
      const { credentials: _credentials, ...safe } = await oauth.finish({
        code: "browser-test-code",
        codeVerifier: "test-state",
        redirectUri: new URL("/callback", request.url).toString(),
      });
      return Response.json(safe);
    }
    if (body.action === "keychain-holdings-retains-quote-evidence") {
      const credentialReference = "macos-keychain:browser-test-client";
      const refresher = new KeychainLongbridgeSourceRefresher({
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
        credentialReference: () => credentialReference,
        readAssets: async () => ({
          accountPage: {
            data: { list: [{ currency: "USD", net_assets: "1000" }] },
          },
          stockPage: {
            data: {
              list: [{
                account_channel: "lb",
                stock_info: [{
                  symbol: "AAPL.US",
                  symbol_name: "Apple",
                  quantity: "10",
                  currency: "USD",
                  cost_price: "90",
                }],
              }],
            },
          },
          fundPage: { data: { list: [] } },
          exchangeRates: [],
        }),
        readQuotes: async () => [],
        readDailyCandles: async () => [],
        readCandlesticks: async () => [],
        readFiveDayTrend: async () => [],
      });
      const source: AssetSourceSummary = {
        id: "keychain-retained-quote-source",
        kind: "longbridge",
        label: "长桥保留行情测试",
        accountId: "longbridge:keychain-retained-quote",
        permissions: ["account", "positions", "market-data"],
        credentialReference,
        snapshot: {
          total: { amount: "1000", currency: "USD" },
          holdings: [{
            symbol: "AAPL.US",
            name: "Apple",
            quantity: "10",
            currency: "USD",
            assetClass: "securities",
            currentPrice: { amount: "100", currency: "USD" },
            quoteEvidence: {
              session: "post-market",
              quotedAt: "2026-05-28T20:04:00.000Z",
              observedAt: "2026-05-28T20:04:00.000Z",
              freshness: "current",
              delivery: "unknown",
              provider: {
                name: "longbridge",
                tradeStatus: "US_AFTER",
              },
            },
            previousClose: { amount: "95", currency: "USD" },
            marketValue: "1000",
            sourceMarketValue: { amount: "1000", currency: "USD" },
            valuation: {
              status: "valued",
              priceSource: "Longbridge 行情",
              pricedAt: "2026-05-28T20:04:00.000Z",
            },
            costPrice: "90",
            platformProfit: null,
            changePercent: null,
          }],
          exchangeRates: [],
          syncedAt: "2026-05-28T20:04:00.000Z",
        },
        sync: {
          status: "current",
          lastSuccessfulAt: "2026-05-28T20:04:00.000Z",
          lastAttemptAt: "2026-05-28T20:04:00.000Z",
          error: null,
        },
      };
      const result = await refresher.refresh({
        source,
        credentials: credentialReference,
        mode: "holdings",
        attemptedAt: "2026-05-29T00:00:00.000Z",
        signal: new AbortController().signal,
        persistCredentials: async () => undefined,
      });
      return Response.json({ snapshot: result.snapshot });
    }
    if (body.action === "rest-source-audit") {
      const [adapter, packageJson, lockfile] = await Promise.all([
        readFile(path.join(/* turbopackIgnore: true */ process.cwd(), "plugins/longbridge/src/longbridge.ts"), "utf8"),
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
