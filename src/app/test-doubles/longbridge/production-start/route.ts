import {
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
      | "refresh-holdings"
      | "refresh-invalid"
      | "refresh-missing-quote"
      | "refresh-negative-residual"
      | "refresh-account-estimate"
      | "refresh-expired"
      | "refresh-expired-trade"
      | "refresh-expired-downstream-fail"
      | "refresh-expired-malformed-scope";
    scenario?: "readonly" | "trade" | "missing" | "unknown" | "extra";
  };
  const previousClientId = process.env.LONGBRIDGE_OAUTH_CLIENT_ID;
  process.env.LONGBRIDGE_OAUTH_CLIENT_ID = "browser-test-client";
  const assetRequests: string[] = [];
  const quotedSymbols: string[] = [];
  let tokenRequests = 0;
  let credentialsRotated = false;
  const scope = {
    readonly: "6",
    trade: "6 11",
    missing: undefined,
    unknown: "6 99",
    extra: "6 10",
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
    if (url.hostname === "mcp.longbridge.com") {
      if (method === "DELETE") return new Response(null, { status: 200 });
      const rawBody = input instanceof Request
        ? await input.clone().text()
        : typeof init?.body === "string"
          ? init.body
          : "{}";
      const message = JSON.parse(rawBody) as {
        id?: string | number;
        method?: string;
        params?: { protocolVersion?: string; arguments?: { symbols?: string[] } };
      };
      if (message.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }
      if (message.method === "initialize") {
        return Response.json(
          {
            jsonrpc: "2.0",
            id: message.id,
            result: {
              protocolVersion: message.params?.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: "longbridge-test", version: "1" },
            },
          },
          { headers: { "mcp-session-id": "browser-test-session" } },
        );
      }
      if (message.method === "tools/call") {
        const symbols = message.params?.arguments?.symbols ?? [];
        quotedSymbols.push(...symbols);
        const returnedSymbols =
          body.action === "refresh-missing-quote" ||
          body.action === "refresh-expired-downstream-fail"
          ? []
          : symbols;
        return Response.json({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [{
              type: "text",
              text: JSON.stringify(returnedSymbols.map((symbol) => ({
                symbol,
                last_done:
                  body.action === "refresh-negative-residual" ? "100" : "2000",
                prev_close:
                  body.action === "refresh-negative-residual" ? "100" : "1950",
                timestamp: "2026-05-29T00:00:00Z",
              }))),
            }],
          },
        });
      }
      return Response.json({ error: "unexpected MCP request" }, { status: 500 });
    }
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
              ? "6 11"
              : body.action === "refresh-expired-malformed-scope"
                ? null
                : "6",
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
    if (url.pathname === "/v1/asset/exchange_rates") {
      return Response.json({ code: 0, data: { exchanges: [] } });
    }
    if (url.pathname === "/v1/portfolio/profit-analysis/by-market") {
      const page = url.searchParams.get("page");
      return Response.json({
        code: 0,
        data: {
          profit: "100.25",
          has_more: page === "1",
          stock_items: page === "1"
            ? [{ code: "AAPL", name: "Apple", market: "US", profit: "100.25" }]
            : [],
        },
      });
    }
    return Response.json({ error: "unexpected request" }, { status: 500 });
  };
  try {
    if (body.action?.startsWith("refresh-")) {
      const source: AssetSourceSummary = {
        id: "production-refresh-source",
        kind: "longbridge",
        label: "长桥生产刷新测试账户",
        accountId: "longbridge:test",
        permissions: ["market-data", "account", "positions"],
        credentialReference: "server-only-reference",
        snapshot: {
          total: {
            amount: body.action === "refresh-negative-residual" ? "900" : "1000",
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
              priceSource:
                body.action === "refresh-account-estimate"
                  ? "Longbridge 账户估值"
                  : "Longbridge QuoteContext",
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
        body.action === "refresh-expired-downstream-fail" ||
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
          body.action === "refresh-prices" ||
          body.action === "refresh-missing-quote" ||
          body.action === "refresh-negative-residual" ||
          body.action === "refresh-account-estimate" ||
          body.action === "refresh-expired-downstream-fail" ||
          body.action === "refresh-invalid"
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
        quotedSymbols,
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
      return Response.json({ ...safe, assetRequests, quotedSymbols });
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
        quotedSymbols,
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
