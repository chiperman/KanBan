import {
  ProductionEvmWatchSourceRefresher,
  ProductionEvmWatchWallet,
} from "@/server/asset-sources/ethereum";
import { isTestEnv } from "@/server/composition";
import type {
  EvmChain,
  ExternalServiceConfiguration,
  ExternalServiceConfigurationInput,
  ExternalServiceConfigurationStatus,
} from "@/server/ports";

export const dynamic = "force-dynamic";

const ADDRESS_ONE = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
const ADDRESS_TWO = "0x1111111111111111111111111111111111111111";
const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "0xcccccccccccccccccccccccccccccccccccccccc";
const RPC = "https://eth-mainnet.g.alchemy.com/v2/server-secret-test-key";

const testExternalServices: ExternalServiceConfiguration = {
  async status(): Promise<ExternalServiceConfigurationStatus> {
    return {
      coinGecko: { configured: true, verifiedAt: null },
      ethereumRpc: { configured: true, verifiedAt: null },
      bscRpc: { configured: true, verifiedAt: null },
    };
  },
  async saveAndVerify(
    _input: ExternalServiceConfigurationInput,
  ): Promise<ExternalServiceConfigurationStatus> {
    throw new Error("生产 EVM 测试不支持保存外部服务");
  },
  async coinGeckoDemoApiKey() {
    return "server-secret-test-key";
  },
  async rpcUrl(_chain: EvmChain) {
    return RPC;
  },
};

export async function POST(request: Request) {
  if (!isTestEnv()) return Response.json({ error: "not found" }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as {
    chain?: "ethereum" | "bsc";
    action?: "preview" | "empty" | "partial-failure" | "index-failure" | "price-failure" | "price-network-failure" | "rpc-network-once" | "refresh-prices" | "refresh-holdings";
  };
  const rpcMethods: string[] = [];
  const priceRequests: string[] = [];
  let remainingRpcNetworkFailures = body.action === "rpc-network-once" ? 1 : 0;
  const mockFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.origin === "https://api.coingecko.com") {
      priceRequests.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
      if (body.action === "price-network-failure") {
        throw new TypeError("fetch failed");
      }
      if (body.action === "price-failure") {
        return Response.json({ error: "rate limited" }, { status: 429 });
      }
      if (url.pathname === "/api/v3/simple/price") {
        return Response.json(
          body.chain === "bsc"
            ? { binancecoin: { usd: 600, last_updated_at: 1_769_904_000 } }
            : { ethereum: { usd: 2000, last_updated_at: 1_769_904_000 } },
        );
      }
      return Response.json({
        data: {
          type: "simple_token_price",
          attributes: { token_prices: { [A]: "1", [B]: "1.9" } },
        },
      });
    }
    const payload = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
      id: number;
      method: string;
      params: unknown[];
    };
    if (remainingRpcNetworkFailures > 0) {
      remainingRpcNetworkFailures -= 1;
      throw new TypeError("fetch failed");
    }
    rpcMethods.push(payload.method);
    if (payload.method === "eth_chainId") {
      return Response.json({
        jsonrpc: "2.0",
        id: payload.id,
        result: body.chain === "bsc" ? "0x38" : "0x1",
      });
    }
    if (body.action === "partial-failure" && payload.method === "eth_getBalance" && payload.params[0] === ADDRESS_TWO) {
      return Response.json({ jsonrpc: "2.0", id: payload.id, error: { code: -32000, message: "sample RPC failure" } });
    }
    if (payload.method === "eth_getBalance") {
      const result = body.action === "empty"
        ? "0x0"
        : payload.params[0] === ADDRESS_ONE
          ? "0x1bc16d674ec80000"
          : "0x6f05b59d3b20000";
      return Response.json({ jsonrpc: "2.0", id: payload.id, result });
    }
    if (payload.method === "alchemy_getTokenBalances") {
      if (body.action === "index-failure") {
        return Response.json({
          jsonrpc: "2.0",
          id: payload.id,
          error: { code: -32005, message: "sample index failure" },
        });
      }
      const address = String(payload.params[0]);
      const options = payload.params[2] as { pageKey?: string };
      const tokenBalances = body.action === "empty" || address === ADDRESS_TWO
        ? []
        : options.pageKey
          ? [{ contractAddress: C, tokenBalance: "0x1b58" }]
          : [
              { contractAddress: A, tokenBalance: "0x1dcd6500" },
              { contractAddress: B, tokenBalance: "0x3e8" },
            ];
      return Response.json({
        jsonrpc: "2.0",
        id: payload.id,
        result: {
          address,
          tokenBalances,
          ...(body.action !== "empty" && address === ADDRESS_ONE && !options.pageKey ? { pageKey: "next" } : {}),
        },
      });
    }
    if (payload.method === "alchemy_getTokenMetadata") {
      const contract = String(payload.params[0]);
      return Response.json({
        jsonrpc: "2.0",
        id: payload.id,
        result: {
          decimals: contract === A ? 6 : contract === B ? 2 : 3,
          symbol: contract === C ? "UNKNOWN" : "SAME",
          name: contract === C ? "Unknown" : "Same Symbol",
        },
      });
    }
    return Response.json({ error: "unexpected method" }, { status: 500 });
  };
  try {
    const chain = body.chain ?? "ethereum";
    const adapter = new ProductionEvmWatchWallet(
      testExternalServices,
      mockFetch,
    );
    const result = await adapter.preview({
      chain,
      addresses: [ADDRESS_ONE, ADDRESS_TWO],
      observedAt: "2026-02-01T00:00:00.000Z",
    });
    if (body.action === "refresh-prices" || body.action === "refresh-holdings") {
      rpcMethods.length = 0;
      priceRequests.length = 0;
      const refreshed = await new ProductionEvmWatchSourceRefresher(
        testExternalServices,
        mockFetch,
      ).refresh({
        source: {
          id: "ethereum-production-test",
          kind: chain === "ethereum" ? "evm-watch-ethereum" : "evm-watch-bsc",
          label: result.account.label,
          accountId: result.account.id,
          permissions: result.permissions,
          credentialReference: "server-only",
          snapshot: result.snapshot,
          sync: {
            status: "current",
            lastSuccessfulAt: result.snapshot.syncedAt,
            lastAttemptAt: result.snapshot.syncedAt,
            error: null,
          },
        },
        credentials: result.credentials,
        mode: body.action === "refresh-prices" ? "prices" : "holdings",
        attemptedAt: "2026-02-01T00:00:30.000Z",
        signal: new AbortController().signal,
        persistCredentials: async () => undefined,
      });
      return Response.json({ snapshot: refreshed.snapshot, rpcMethods, priceRequests });
    }
    const { credentials: _credentials, ...safe } = result;
    return Response.json({ ...safe, rpcMethods, priceRequests });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Ethereum 测试失败", rpcMethods, priceRequests },
      { status: 400 },
    );
  }
}
