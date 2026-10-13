import {
  ProductionEvmWatchSourceRefresher,
  ProductionEvmWatchWallet,
} from "@/server/asset-sources/ethereum";

import type {
  EvmChain,
  ExternalServiceConfiguration,
  ExternalServiceConfigurationInput,
  ExternalServiceConfigurationStatus,
} from "@/server/ports";
import { testGuard } from "@/server/testing/route-support";

export const dynamic = "force-dynamic";

const ADDRESS_ONE = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
const ADDRESS_TWO = "0x1111111111111111111111111111111111111111";
const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "0xcccccccccccccccccccccccccccccccccccccccc";
const LIDO_WITHDRAWAL_QUEUE = "0x889edc2edab5f40e902b864ad4d7ade8e412f9b1";
const LISTA_STAKE_MANAGER = "0x1adb950d8bb3da4be104211d5ab038628e477fe6";
const SLIS_BNB = "0xdddddddddddddddddddddddddddddddddddddddd";
const RPC = "https://eth-mainnet.g.alchemy.com/v2/server-secret-test-key";
const GET_WITHDRAWAL_REQUESTS = "0x7d031b65";
const GET_WITHDRAWAL_STATUS = "0xb8c4b85a";
const GET_LAST_CHECKPOINT_INDEX = "0x526eae3e";
const FIND_CHECKPOINT_HINTS = "0x62abe3fa";
const GET_CLAIMABLE_ETHER = "0xc97912d8";
const LISTA_GET_USER_WITHDRAWAL_REQUESTS = "0x6c930228";
const LISTA_GET_USER_REQUEST_STATUS = "0x026e3e7b";

function word(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function lidoRequestIds(ids: bigint[]): string {
  return `0x${word(32n)}${word(BigInt(ids.length))}${ids.map(word).join("")}`;
}

function lidoStatuses(owner: string): string {
  const statuses = [
    {
      amountOfStEth: 1_500_000_000_000_000_000n,
      amountOfShares: 1_500_000_000_000_000_000n,
      timestamp: 1_769_904_000n,
      isFinalized: false,
    },
    {
      amountOfStEth: 500_000_000_000_000_000n,
      amountOfShares: 500_000_000_000_000_000n,
      timestamp: 1_769_904_100n,
      isFinalized: true,
    },
  ];
  return `0x${word(32n)}${word(BigInt(statuses.length))}${statuses.map((status) => [
    word(status.amountOfStEth),
    word(status.amountOfShares),
    owner.slice(2).padStart(64, "0"),
    word(status.timestamp),
    word(status.isFinalized ? 1n : 0n),
    word(0n),
  ].join("")).join("")}`;
}

function listaRequests(requests: Array<{
  uuid: bigint;
  amountInSnBnb: bigint;
  startTime: bigint;
}>): string {
  return `0x${word(32n)}${word(BigInt(requests.length))}${requests.map((request) => [
    word(request.uuid),
    word(request.amountInSnBnb),
    word(request.startTime),
  ].join("")).join("")}`;
}

function listaStatus(isClaimable: boolean, amount: bigint): string {
  return `0x${word(isClaimable ? 1n : 0n)}${word(amount)}`;
}

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
  const denied = testGuard();
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as {
    chain?: "ethereum" | "bsc";
    action?: "preview" | "empty" | "partial-failure" | "index-failure" | "price-failure" | "price-network-failure" | "rpc-network-once" | "metadata-decimals-failure" | "metadata-rpc-failure" | "refresh-ignored-unreadable" | "refresh-prices" | "refresh-holdings" | "preview-lido-withdrawal" | "preview-lido-failure" | "refresh-lido-prices" | "preview-lista-withdrawal" | "preview-lista-empty" | "preview-lista-failure" | "refresh-lista-holdings";
  };
  const rpcMethods: string[] = [];
  const metadataContracts: string[] = [];
  const priceRequests: string[] = [];
  let remainingRpcNetworkFailures = body.action === "rpc-network-once" ? 1 : 0;
  const lidoScenario = body.action === "preview-lido-withdrawal"
    || body.action === "preview-lido-failure"
    || body.action === "refresh-lido-prices";
  const listaWithdrawalScenario = body.action === "preview-lista-withdrawal"
    || body.action === "refresh-lista-holdings";
  const listaFixtureScenario = listaWithdrawalScenario
    || body.action === "preview-lista-empty"
    || body.action === "preview-lista-failure";
  const listaTokenScenario = listaWithdrawalScenario
    || body.action === "preview-lista-failure";
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
          attributes: { token_prices: { [A]: "1", [B]: "1.9", [SLIS_BNB]: "620" } },
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
          ? lidoScenario || listaFixtureScenario
            ? []
            : [{ contractAddress: C, tokenBalance: "0x1b58" }]
          : [
              { contractAddress: A, tokenBalance: "0x1dcd6500" },
              { contractAddress: B, tokenBalance: "0x3e8" },
              ...(lidoScenario
                ? [{ contractAddress: LIDO_WITHDRAWAL_QUEUE, tokenBalance: "0x2" }]
                : listaTokenScenario
                  ? [{ contractAddress: SLIS_BNB, tokenBalance: "0x1bc16d674ec80000" }]
                  : []),
            ];
      return Response.json({
        jsonrpc: "2.0",
        id: payload.id,
        result: {
          address,
          tokenBalances,
          ...(
            body.action !== "empty" &&
            !lidoScenario &&
            !listaFixtureScenario &&
            address === ADDRESS_ONE &&
            !options.pageKey
              ? { pageKey: "next" }
              : {}
          ),
        },
      });
    }
    if (payload.method === "eth_call") {
      const call = payload.params[0] as { to?: unknown; data?: unknown };
      const to = typeof call.to === "string" ? call.to.toLowerCase() : "";
      const data = typeof call.data === "string" ? call.data.toLowerCase() : "";
      if (to === LISTA_STAKE_MANAGER) {
        if (
          body.action === "preview-lista-failure" &&
          data.startsWith(LISTA_GET_USER_WITHDRAWAL_REQUESTS)
        ) {
          return Response.json({
            jsonrpc: "2.0",
            id: payload.id,
            error: { code: -32000, message: "Lista request status unavailable" },
          });
        }
        if (data.startsWith(LISTA_GET_USER_WITHDRAWAL_REQUESTS)) {
          return Response.json({
            jsonrpc: "2.0",
            id: payload.id,
            result: listaWithdrawalScenario && data.endsWith(ADDRESS_ONE.slice(2))
              ? listaRequests([
                {
                  uuid: 101n,
                  amountInSnBnb: 1_250_000_000_000_000_000n,
                  startTime: 1_769_904_000n,
                },
                {
                  uuid: 102n,
                  amountInSnBnb: 2_500_000_000_000_000_000n,
                  startTime: 1_769_990_400n,
                },
              ])
              : listaWithdrawalScenario
                ? listaRequests([{
                  uuid: 201n,
                  amountInSnBnb: 750_000_000_000_000_000n,
                  startTime: 1_770_076_800n,
                }])
                : listaRequests([]),
          });
        }
        if (data.startsWith(LISTA_GET_USER_REQUEST_STATUS)) {
          const index = BigInt(`0x${data.slice(-64)}`);
          const owner = data.slice(10, 74);
          const firstAddress = owner.endsWith(ADDRESS_ONE.slice(2));
          return Response.json({
            jsonrpc: "2.0",
            id: payload.id,
            result: firstAddress
              ? index === 0n
                ? listaStatus(false, 1_200_000_000_000_000_000n)
                : listaStatus(true, 2_450_000_000_000_000_000n)
              : listaStatus(false, 700_000_000_000_000_000n),
          });
        }
        return Response.json({ error: "unexpected Lista eth_call" }, { status: 500 });
      }
      if (to !== LIDO_WITHDRAWAL_QUEUE) {
        return Response.json({ error: "unexpected eth_call target" }, { status: 500 });
      }
      if (body.action === "preview-lido-failure" && data.startsWith(GET_WITHDRAWAL_REQUESTS)) {
        return Response.json({
          jsonrpc: "2.0",
          id: payload.id,
          error: { code: -32000, message: "Lido request status unavailable" },
        });
      }
      if (data.startsWith(GET_WITHDRAWAL_REQUESTS)) {
        return Response.json({
          jsonrpc: "2.0",
          id: payload.id,
          result: data.endsWith(ADDRESS_ONE.slice(2))
            ? lidoRequestIds([18n, 27n])
            : lidoRequestIds([]),
        });
      }
      if (data.startsWith(GET_WITHDRAWAL_STATUS)) {
        return Response.json({
          jsonrpc: "2.0",
          id: payload.id,
          result: lidoStatuses(ADDRESS_ONE),
        });
      }
      if (data.startsWith(GET_LAST_CHECKPOINT_INDEX)) {
        return Response.json({
          jsonrpc: "2.0",
          id: payload.id,
          result: `0x${word(3n)}`,
        });
      }
      if (data.startsWith(FIND_CHECKPOINT_HINTS)) {
        return Response.json({
          jsonrpc: "2.0",
          id: payload.id,
          result: lidoRequestIds([2n]),
        });
      }
      if (data.startsWith(GET_CLAIMABLE_ETHER)) {
        return Response.json({
          jsonrpc: "2.0",
          id: payload.id,
          result: lidoRequestIds([490_000_000_000_000_000n]),
        });
      }
      return Response.json({ error: "unexpected Lido eth_call" }, { status: 500 });
    }
    if (payload.method === "alchemy_getTokenMetadata") {
      const contract = String(payload.params[0]);
      metadataContracts.push(contract);
      if (body.action === "metadata-rpc-failure" && contract === C) {
        return Response.json({
          jsonrpc: "2.0",
          id: payload.id,
          error: { code: -32000, message: "metadata temporary failure" },
        });
      }
      return Response.json({
        jsonrpc: "2.0",
        id: payload.id,
        result: {
          decimals: (
            (
              body.action === "metadata-decimals-failure" ||
              body.action === "refresh-ignored-unreadable"
            ) &&
            contract === C
          )
            ? null
            : contract === A ? 6 : contract === B ? 2 : 18,
          symbol: contract === C
            ? (
              body.action === "metadata-decimals-failure" ||
              body.action === "refresh-ignored-unreadable"
            )
              ? "WstETH"
              : "UNKNOWN"
            : contract === SLIS_BNB ? "slisBNB" : "SAME",
          name: contract === C
            ? (
              body.action === "metadata-decimals-failure" ||
              body.action === "refresh-ignored-unreadable"
            )
              ? "Lido: stETH Withdrawal NFT"
              : "Unknown"
            : contract === SLIS_BNB ? "Lista Staked BNB" : "Same Symbol",
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
    if (
      body.action === "refresh-prices" ||
      body.action === "refresh-holdings" ||
      body.action === "refresh-lido-prices" ||
      body.action === "refresh-lista-holdings" ||
      body.action === "refresh-ignored-unreadable"
    ) {
      rpcMethods.length = 0;
      metadataContracts.length = 0;
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
          ...(body.action === "refresh-ignored-unreadable"
            ? {
                ignoredAssetKeys: [
                  "evm:1:0xcccccccccccccccccccccccccccccccccccccccc",
                ],
              }
            : {}),
        },
        credentials: result.credentials,
        mode: body.action === "refresh-prices" || body.action === "refresh-lido-prices"
          ? "prices"
          : "holdings",
        attemptedAt: "2026-02-01T00:00:30.000Z",
        signal: new AbortController().signal,
        persistCredentials: async () => undefined,
      });
      return Response.json({
        snapshot: refreshed.snapshot,
        rpcMethods,
        metadataContracts,
        priceRequests,
      });
    }
    const { credentials: _credentials, ...safe } = result;
    return Response.json({ ...safe, rpcMethods, metadataContracts, priceRequests });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Ethereum 测试失败",
        rpcMethods,
        metadataContracts,
        priceRequests,
      },
      { status: 400 },
    );
  }
}
