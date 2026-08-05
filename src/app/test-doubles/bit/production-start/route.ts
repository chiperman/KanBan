import { createHmac } from "node:crypto";

import {
  BIT_READ_ONLY_ENDPOINTS,
  ProductionBitReadOnly,
  ProductionBitSourceRefresher,
} from "@/server/asset-sources/bit";
import { CoinGeckoUsdtUsdPrices } from "@/server/asset-sources/binance";
import { isTestEnv } from "@/server/composition";
import type {
  AssetSourceSummary,
  ExternalServiceConfiguration,
  ExternalServiceConfigurationInput,
  ExternalServiceConfigurationStatus,
  Prices,
} from "@/server/ports";

export const dynamic = "force-dynamic";

const API_KEY = "bit-production-api-key";
const API_SECRET = "bit-production-secret-must-not-leak";
const USER_ID = "605788";
const OBSERVED_AT = "2026-08-04T00:00:00.000Z";

const coinGeckoServices: ExternalServiceConfiguration = {
  async status(): Promise<ExternalServiceConfigurationStatus> {
    return {
      coinGecko: { configured: true, verifiedAt: OBSERVED_AT },
      ethereumRpc: { configured: false, verifiedAt: null },
      bscRpc: { configured: false, verifiedAt: null },
    };
  },
  async saveAndVerify(
    _input: ExternalServiceConfigurationInput,
  ): Promise<ExternalServiceConfigurationStatus> {
    throw new Error("BIT 生产测试不支持保存外部服务");
  },
  async coinGeckoDemoApiKey() {
    return "bit-test-coingecko-key";
  },
  async rpcUrl() {
    return null;
  },
};

function referencePrices(
  btcUsd: string,
  referencePriceRequests: string[],
): Prices {
  return new CoinGeckoUsdtUsdPrices(coinGeckoServices, async (input) => {
    const url = new URL(input.toString());
    const id = url.searchParams.get("ids");
    referencePriceRequests.push(id ?? "");
    if (id !== "bitcoin,tether") return Response.json({});
    return Response.json({
      bitcoin: {
        usd: btcUsd,
        last_updated_at: 1_723_120_000,
      },
      tether: {
        usd: "1",
        last_updated_at: 1_723_120_000,
      },
    });
  });
}

function response(data: unknown) {
  return new Response(JSON.stringify({ code: 0, data, message: "" }), {
    headers: { "content-type": "application/json" },
  });
}

export async function POST(request: Request) {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
  } | null;
  if (body?.action !== "preview-valid" && body?.action !== "refresh-prices") {
    return Response.json({ error: "BIT 生产测试场景无效" }, { status: 400 });
  }

  const requests: string[] = [];
  const authenticated: boolean[] = [];
  const transport = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const headers = new Headers(init?.headers);
    const timestamp = headers.get("X-Timestamp") ?? "";
    const expected = createHmac("sha256", API_SECRET)
      .update(`${timestamp}GET${url.pathname}&${url.search.slice(1)}`)
      .digest("hex");
    authenticated.push(
      url.origin === "https://mapi.matrixport.com" &&
      init?.method === "GET" &&
      headers.get("X-MatrixPort-Access-Key") === API_KEY &&
      headers.get("X-Auth-Version") === "v2" &&
      headers.get("X-Signature") === expected &&
      /^\d+$/.test(timestamp),
    );
    requests.push(`${init?.method} ${url.pathname}${url.search}`);
    if (url.pathname === "/mapi/v1/wallet/balance") {
      return response({
        items: [
          {
            currency: "USDT",
            balance: "100",
            available_balance: "95",
            frozen_balance: "5",
            unconfirmed_balance: "0",
          },
          {
            currency: "BTC",
            balance: "0.2",
            available_balance: "0.2",
            frozen_balance: "0",
            unconfirmed_balance: "0",
          },
        ],
      });
    }
    if (url.pathname === "/flexible/api/v2/app/homepage") {
      return response({
        total_balance_amount: "30",
        total_interest: "1",
        currencies: [{
          currency: "USDT",
          product_type: "flexi_saving",
          subject_type: "flexi_saving",
          balance: "30",
          deposit_apy: "0.08",
          interest: "1",
        }],
      });
    }
    if (url.pathname === "/dcp/api/v1/total-positions") {
      return response({ total_position: "30", ask_price_status: 0 });
    }
    return new Response(JSON.stringify({ code: 404, message: "unexpected" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };
  const runtime = {
    now: () => 1_723_125_600_000,
    sleep: async () => undefined,
    requestIntervalMs: 1,
  };
  const referencePriceRequests: string[] = [];
  const readOnly = new ProductionBitReadOnly(
    referencePrices("68000", referencePriceRequests),
    transport,
    runtime,
  );
  const authorization = await readOnly.preview({
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    userId: USER_ID,
    observedAt: OBSERVED_AT,
  });
  let refreshedSnapshot: AssetSourceSummary["snapshot"] | null = null;
  if (body.action === "refresh-prices") {
    const refresher = new ProductionBitSourceRefresher(
      referencePrices("69000", referencePriceRequests),
      transport,
      runtime,
    );
    const source: AssetSourceSummary = {
      id: "bit-source",
      kind: "bit",
      label: authorization.account.label,
      accountId: authorization.account.id,
      permissions: authorization.permissions,
      credentialReference: "test-only",
      snapshot: authorization.snapshot,
      sync: {
        status: "current",
        lastSuccessfulAt: OBSERVED_AT,
        lastAttemptAt: OBSERVED_AT,
        error: null,
      },
    };
    requests.length = 0;
    referencePriceRequests.length = 0;
    refreshedSnapshot = (await refresher.refresh({
      source,
      credentials: authorization.credentials,
      mode: "prices",
      attemptedAt: "2026-08-04T00:10:00.000Z",
      signal: new AbortController().signal,
      async persistCredentials() {},
    })).snapshot;
  }
  return Response.json({
    requests,
    authenticated: authenticated.every(Boolean),
    allowedPathsOnly: requests.every((entry) =>
      BIT_READ_ONLY_ENDPOINTS.some((path) => entry.includes(` ${path}`)),
    ),
    account: authorization.account,
    snapshot: authorization.snapshot,
    refreshedSnapshot,
    referencePriceRequests,
  });
}
