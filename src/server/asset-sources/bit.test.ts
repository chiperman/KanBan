import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  ProductionBitReadOnly,
} from "@/server/asset-sources/bit";
import type { Prices } from "@/server/ports";

const API_KEY = "bit-production-api-key";
const API_SECRET = "bit-production-secret-must-not-leak";
const OBSERVED_AT = "2026-08-04T00:00:00.000Z";

function response(data: unknown) {
  return new Response(JSON.stringify({ code: 0, data, message: "" }), {
    headers: { "content-type": "application/json" },
  });
}

test("BIT DCP 活跃订单作为明细展示，且总头寸只计一次", async () => {
  const requests: string[] = [];
  const prices: Prices = {
    async quote(symbol) {
      if (symbol === "BTC") {
        return {
          symbol: "BTC",
          currency: "USD",
          price: "68000",
          quotedAt: new Date(OBSERVED_AT),
        };
      }
      if (symbol === "USDT") {
        return {
          symbol: "USDT",
          currency: "USD",
          price: "1",
          quotedAt: new Date(OBSERVED_AT),
        };
      }
      return null;
    },
  };
  const readOnly = new ProductionBitReadOnly(
    prices,
    async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const headers = new Headers(init?.headers);
      const timestamp = headers.get("X-Timestamp") ?? "";
      const expectedSignature = createHmac("sha256", API_SECRET)
        .update(`${timestamp}GET${url.pathname}&${url.search.slice(1)}`)
        .digest("hex");
      assert.equal(headers.get("X-MatrixPort-Access-Key"), API_KEY);
      assert.equal(headers.get("X-Auth-Version"), "v2");
      assert.equal(headers.get("X-Signature"), expectedSignature);
      requests.push(`${init?.method} ${url.pathname}${url.search}`);
      if (url.pathname === "/mapi/v1/wallet/balance") {
        return response({
          items: [{
            currency: "USDT",
            balance: "100",
            available_balance: "100",
            frozen_balance: "0",
            unconfirmed_balance: "0",
          }],
        });
      }
      if (url.pathname === "/flexible/api/v2/app/homepage") {
        return response({
          currencies: [{
            currency: "USDT",
            balance: "30",
          }],
        });
      }
      if (url.pathname === "/dcp/api/v1/total-positions") {
        return response({ total_position: "30", ask_price_status: 0 });
      }
      if (url.pathname === "/dcp/api/v1/orders") {
        return new Response(`{
          "code": 0,
          "data": {
            "total": 1,
            "items": [{
              "id": 7125082312731329000,
              "invest_amount": "30",
              "invest_currency": "USDT",
              "underlying_pair": "BTC-USDT",
              "status": 200,
              "maturity_time": 1723132800000
            }]
          },
          "message": ""
        }`, {
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`意外请求：${url.pathname}`);
    },
    {
      now: () => 1_723_125_600_000,
      sleep: async () => undefined,
      requestIntervalMs: 1,
    },
  );

  const authorization = await readOnly.preview({
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    userId: "605788",
    observedAt: OBSERVED_AT,
  });

  assert.deepEqual(requests, [
    "GET /mapi/v1/wallet/balance",
    "GET /flexible/api/v2/app/homepage?product_type=flexi_saving&subject_type=flexi_saving",
    "GET /dcp/api/v1/total-positions",
    "GET /dcp/api/v1/orders?status_category=1&order_sort_by=4&limit=100&offset=0",
  ]);
  assert.deepEqual(authorization.snapshot.total, { amount: "160", currency: "USD" });
  const order = authorization.snapshot.holdings.find(
    ({ providerPositionId }) => providerPositionId === "7125082312731329000",
  );
  assert.deepEqual(order, {
    symbol: "USDT",
    name: "DCP #7125082312731329000 · BTC-USDT · 进行中 · 2024-08-09 到期",
    sourceAsset: "bit:dcp:order:7125082312731329000",
    sourceAccount: "earn",
    sourceProduct: "dcp",
    providerPositionId: "7125082312731329000",
    providerPositionState: "进行中",
    quantity: "30",
    currency: "USDT",
    assetClass: "crypto",
    currentPrice: null,
    marketValue: null,
    sourceMarketValue: null,
    valuation: {
      status: "quote-unavailable",
      reason: "BIT / Matrixport DCP 已含入 USD 总头寸，订单级当前估值未提供",
    },
    costPrice: null,
    platformProfit: null,
    changePercent: null,
  });
  assert.deepEqual(
    authorization.snapshot.coverage?.products.find(
      ({ product }) => product === "dcp",
    ),
    {
      product: "dcp",
      capability: "detailed",
      freshness: "current",
      message: "已读取 1 个活跃订单；总额仍以平台 USD 总头寸为准",
    },
  );
});
