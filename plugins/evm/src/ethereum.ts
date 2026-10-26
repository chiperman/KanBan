import { createHash } from "node:crypto";

import {
  decimalAdd,
  decimalCompare,
  decimalMultiply,
} from "@/domain/decimal";
import type {
  AssetHolding,
  AssetProductCoverage,
  AssetSnapshot,
  AssetSourceRefreshResult,
  AssetSourceRefresher,
  EvmChain,
  EvmUnrecognizedToken,
  EvmWatchAuthorizationResult,
  EvmWatchWalletReadOnly,
} from "@/server/ports";
import type { ExternalServiceConfigurationReader } from "../../sdk/host-capabilities";
import { assetResponseError, hasManagedAssetRetry } from "../../sdk/asset-sync-diagnostics";

type JsonRecord = Record<string, unknown>;
type EvmFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const RPC_PAGE_LIMIT = 100;
const RPC_NETWORK_ATTEMPTS = 3;
const COINGECKO_ORIGIN = "https://api.coingecko.com";
const LIDO_WITHDRAWAL_QUEUE = "0x889edc2edab5f40e902b864ad4d7ade8e412f9b1";
const LIDO_GET_WITHDRAWAL_REQUESTS = "0x7d031b65";
const LIDO_GET_WITHDRAWAL_STATUS = "0xb8c4b85a";
const LIDO_GET_LAST_CHECKPOINT_INDEX = "0x526eae3e";
const LIDO_FIND_CHECKPOINT_HINTS = "0x62abe3fa";
const LIDO_GET_CLAIMABLE_ETHER = "0xc97912d8";
const LIDO_REQUEST_LIMIT = 100;
const LISTA_STAKE_MANAGER = "0x1adb950d8bb3da4be104211d5ab038628e477fe6";
const LISTA_GET_USER_WITHDRAWAL_REQUESTS = "0x6c930228";
const LISTA_GET_USER_REQUEST_STATUS = "0x026e3e7b";
const LISTA_REQUEST_LIMIT = 100;

interface EvmChainConfig {
  chain: EvmChain;
  chainId: "1" | "56";
  sourceKind: "evm-watch-ethereum" | "evm-watch-bsc";
  label: "Ethereum" | "BNB Smart Chain";
  nativeSymbol: "ETH" | "BNB";
  tokenStandard: "ERC-20" | "BEP-20";
  coinGeckoCoinId: "ethereum" | "binancecoin";
  coinGeckoNetwork: "eth" | "bsc";
}

const EVM_CHAINS: Record<EvmChain, EvmChainConfig> = {
  ethereum: {
    chain: "ethereum",
    chainId: "1",
    sourceKind: "evm-watch-ethereum",
    label: "Ethereum",
    nativeSymbol: "ETH",
    tokenStandard: "ERC-20",
    coinGeckoCoinId: "ethereum",
    coinGeckoNetwork: "eth",
  },
  bsc: {
    chain: "bsc",
    chainId: "56",
    sourceKind: "evm-watch-bsc",
    label: "BNB Smart Chain",
    nativeSymbol: "BNB",
    tokenStandard: "BEP-20",
    coinGeckoCoinId: "binancecoin",
    coinGeckoNetwork: "bsc",
  },
};

function record(value: unknown, context: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context}格式无效`);
  }
  return value as JsonRecord;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`EVM 响应缺少 ${field}`);
  }
  return value;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function decimal(value: unknown, field: string): string {
  const output = typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : typeof value === "string"
      ? value
      : "";
  if (!/^\d+(?:\.\d+)?$/.test(output)) {
    throw new Error(`EVM 响应中的 ${field} 不是有效非负十进制数`);
  }
  return output;
}

function normalizeAddresses(values: string[]): string[] {
  const addresses = values.map((value) => value.trim()).filter(Boolean);
  if (addresses.length === 0) throw new Error("请至少输入一个 EVM 公开地址");
  if (addresses.length > 20) throw new Error("一次最多添加 20 个 EVM 公开地址");
  const normalized = addresses.map((address) => {
    if (!ADDRESS_PATTERN.test(address)) throw new Error(`EVM 地址格式无效：${address}`);
    return address.toLowerCase();
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("EVM 公开地址不能重复");
  }
  return normalized.sort();
}

function units(hex: unknown, decimals: number, field: string): string {
  if (typeof hex !== "string" || !/^0x[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`EVM 响应中的 ${field} 不是有效十六进制数量`);
  }
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error(`EVM 响应中的 ${field} decimals 无效`);
  }
  const digits = BigInt(hex).toString().padStart(decimals + 1, "0");
  if (decimals === 0) return digits;
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return `${digits.slice(0, -decimals)}${fraction ? `.${fraction}` : ""}`;
}

interface DiscoveredBalance {
  sourceAsset: string;
  contractAddress: string | null;
  symbol: string;
  name: string;
  quantity: string;
  priceAsset?: string;
  sourceAccount?: AssetHolding["sourceAccount"];
  sourceProduct?: string;
  providerPositionId?: string;
  providerPositionState?: string;
  providerPositionAvailableOn?: string;
  economicAssetKey?: string;
  positionState?: AssetHolding["positionState"];
}

interface ReferencePrice {
  price: string;
  quotedAt: string;
  source: string;
}

interface TokenMetadata {
  symbol: string;
  name: string;
  decimals: number;
}

type TokenMetadataResult =
  | { kind: "available"; metadata: TokenMetadata }
  | { kind: "unrecognized"; token: EvmUnrecognizedToken };

class EvmTokenMetadataUnavailableError extends Error {}

function tokenAssetKey(config: EvmChainConfig, contract: string): string {
  return `evm:${config.chainId}:${contract}`;
}

function unrecognizedToken(
  config: EvmChainConfig,
  contract: string,
  input: Pick<EvmUnrecognizedToken, "symbol" | "name" | "reason">,
): EvmUnrecognizedToken {
  return {
    sourceAsset: tokenAssetKey(config, contract),
    symbol: input.symbol,
    name: input.name,
    quantity: null,
    reason: input.reason,
  };
}

function buildSnapshot(
  balances: DiscoveredBalance[],
  prices: Map<string, ReferencePrice>,
  observedAt: string,
): AssetSnapshot {
  const aggregated = new Map<string, DiscoveredBalance>();
  for (const balance of balances) {
    if (decimalCompare(balance.quantity, "0") <= 0) continue;
    const previous = aggregated.get(balance.sourceAsset);
    aggregated.set(balance.sourceAsset, {
      ...balance,
      quantity: previous
        ? decimalAdd(previous.quantity, balance.quantity)
        : balance.quantity,
    });
  }
  const holdings: AssetHolding[] = [...aggregated.values()].map((balance) => {
    const price = prices.get(balance.priceAsset ?? balance.sourceAsset) ?? null;
    const marketValue = price
      ? decimalMultiply(balance.quantity, price.price)
      : null;
    return {
      symbol: balance.symbol,
      name: balance.name,
      sourceAsset: balance.sourceAsset,
      ...(balance.sourceAccount ? { sourceAccount: balance.sourceAccount } : {}),
      ...(balance.sourceProduct ? { sourceProduct: balance.sourceProduct } : {}),
      ...(balance.providerPositionId ? { providerPositionId: balance.providerPositionId } : {}),
      ...(balance.providerPositionState ? { providerPositionState: balance.providerPositionState } : {}),
      ...(balance.providerPositionAvailableOn
        ? { providerPositionAvailableOn: balance.providerPositionAvailableOn }
        : {}),
      ...(balance.economicAssetKey ? { economicAssetKey: balance.economicAssetKey } : {}),
      ...(balance.positionState ? { positionState: balance.positionState } : {}),
      quantity: balance.quantity,
      currency: "USD",
      assetClass: "crypto" as const,
      currentPrice: price ? { amount: price.price, currency: "USD" } : null,
      marketValue,
      sourceMarketValue: marketValue
        ? { amount: marketValue, currency: "USD" }
        : null,
      valuation: price
        ? { status: "valued" as const, priceSource: price.source, pricedAt: price.quotedAt }
        : { status: "unvalued" as const, reason: "CoinGecko 未返回可靠 USD 参考价格" },
      costPrice: null,
      platformProfit: null,
      changePercent: null,
    };
  }).sort((left, right) => {
    if (left.marketValue === null) return right.marketValue === null ? 0 : 1;
    if (right.marketValue === null) return -1;
    return decimalCompare(right.marketValue, left.marketValue);
  });
  return {
    total: {
      amount: holdings.reduce(
        (sum, holding) => holding.marketValue
          ? decimalAdd(sum, holding.marketValue)
          : sum,
        "0",
      ),
      currency: "USD",
    },
    holdings,
    exchangeRates: [],
    syncedAt: observedAt,
  };
}

function snapshotTokenCandidates(
  snapshot: AssetSnapshot,
  config: EvmChainConfig,
  candidates: EvmUnrecognizedToken[],
): AssetSnapshot {
  const prefix = `evm:${config.chainId}:0x`;
  const merged = new Map<string, EvmUnrecognizedToken>();
  for (const candidate of candidates) {
    if (candidate.sourceAsset.startsWith(prefix)) {
      merged.set(candidate.sourceAsset, candidate);
    }
  }
  for (const holding of snapshot.holdings) {
    if (
      !holding.sourceAsset?.startsWith(prefix) ||
      holding.valuation.status !== "unvalued"
    ) {
      continue;
    }
    merged.set(holding.sourceAsset, {
      sourceAsset: holding.sourceAsset,
      symbol: holding.symbol,
      name: holding.name,
      quantity: holding.quantity,
      reason: holding.valuation.reason,
    });
  }
  return merged.size === 0
    ? snapshot
    : {
        ...snapshot,
        unrecognizedEvmTokens: [...merged.values()].sort((left, right) =>
          left.sourceAsset.localeCompare(right.sourceAsset),
        ),
      };
}

function previousUnrecognizedToken(
  snapshot: AssetSnapshot | undefined,
  sourceAsset: string,
): EvmUnrecognizedToken {
  const existing = snapshot?.unrecognizedEvmTokens?.find(
    (token) => token.sourceAsset === sourceAsset,
  );
  if (existing) return existing;
  const holding = snapshot?.holdings.find(
    (item) =>
      item.sourceAsset === sourceAsset &&
      item.valuation.status === "unvalued",
  );
  if (holding) {
    return {
      sourceAsset,
      symbol: holding.symbol,
      name: holding.name,
      quantity: holding.quantity,
      reason: holding.valuation.status === "unvalued"
        ? holding.valuation.reason
        : "已忽略代币缺少可靠 USD 参考价格",
    };
  }
  return {
    sourceAsset,
    symbol: null,
    name: null,
    quantity: null,
    reason: "已忽略代币缺少可读取的元数据",
  };
}

class EvmRpcClient {
  private id = 0;

  constructor(
    private readonly rpcUrl: string,
    private readonly request: EvmFetch,
    private readonly signal?: AbortSignal,
  ) {}

  async call(method: string, params: unknown[]): Promise<unknown> {
    let response: Response | null = null;
    const maxAttempts = hasManagedAssetRetry() ? 1 : RPC_NETWORK_ATTEMPTS;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        response = await this.request(this.rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
          cache: "no-store",
          redirect: "error",
          signal: this.signal,
        });
        break;
      } catch (error) {
        if (!(error instanceof TypeError) || attempt === maxAttempts || this.signal?.aborted) {
          if (error instanceof TypeError) {
            throw new Error(`EVM RPC ${method} 网络请求失败，请稍后重试`, { cause: error });
          }
          throw error;
        }
      }
    }
    if (!response) throw new Error(`EVM RPC ${method} 网络请求失败，请稍后重试`);
    if (!response.ok) throw assetResponseError("EVM RPC 读取失败", response);
    const body = record(
      await response.json().catch(() => null),
      "EVM JSON-RPC 响应",
    );
    if (!response.ok || body.error !== undefined) {
      const error = typeof body.error === "object" && body.error !== null
        ? body.error as { message?: unknown }
        : null;
      const message = typeof error?.message === "string"
        ? error.message
        : `HTTP ${response.status}`;
      if (
        method === "alchemy_getTokenMetadata" &&
        /execution reverted|revert/i.test(message)
      ) {
        throw new EvmTokenMetadataUnavailableError(message);
      }
      throw assetResponseError(
        `EVM RPC 读取失败${typeof error?.message === "string" ? `：${error.message}` : `（HTTP ${response.status}）`}`,
        response,
      );
    }
    if (!("result" in body)) throw new Error("EVM JSON-RPC 响应缺少 result");
    return body.result;
  }

  nativeBalance(address: string) {
    return this.call("eth_getBalance", [address, "latest"]);
  }

  chainId() {
    return this.call("eth_chainId", []);
  }

  ethCall(to: string, data: string) {
    if (!ADDRESS_PATTERN.test(to) || !/^0x[0-9a-fA-F]*$/.test(data)) {
      throw new Error("EVM eth_call 参数无效");
    }
    return this.call("eth_call", [{ to, data }, "latest"]);
  }

  async tokenBalances(address: string): Promise<Array<{ contract: string; balance: string }>> {
    const balances: Array<{ contract: string; balance: string }> = [];
    const seenContracts = new Set<string>();
    let pageKey: string | null = null;
    const seenPageKeys = new Set<string>();
    for (let page = 1; page <= RPC_PAGE_LIMIT; page += 1) {
      const options: Record<string, unknown> = { maxCount: 100 };
      if (pageKey) options.pageKey = pageKey;
      const result = record(
        await this.call("alchemy_getTokenBalances", [address, "erc20", options]),
        "Alchemy Token Balances 响应",
      );
      const returnedAddress = text(result.address, "address").toLowerCase();
      if (returnedAddress !== address) throw new Error("Alchemy 返回了其他 EVM 地址");
      if (!Array.isArray(result.tokenBalances)) {
        throw new Error("Alchemy Token Balances 缺少 tokenBalances");
      }
      for (const raw of result.tokenBalances) {
        const item = record(raw, "Alchemy Token Balance");
        const contract = text(item.contractAddress, "contractAddress").toLowerCase();
        if (!ADDRESS_PATTERN.test(contract)) throw new Error("Alchemy 返回无效合约地址");
        if (item.tokenBalance === null) throw new Error(`Alchemy 无法读取代币余额：${contract}`);
        if (seenContracts.has(contract)) throw new Error(`Alchemy Token Balances 重复返回合约：${contract}`);
        seenContracts.add(contract);
        balances.push({ contract, balance: text(item.tokenBalance, "tokenBalance") });
      }
      pageKey = typeof result.pageKey === "string" && result.pageKey.length > 0
        ? result.pageKey
        : null;
      if (!pageKey) return balances;
      if (seenPageKeys.has(pageKey)) throw new Error("Alchemy Token Balances 返回重复 pageKey");
      seenPageKeys.add(pageKey);
    }
    throw new Error("Alchemy Token Balances 分页超过安全上限");
  }

  async tokenMetadata(
    contract: string,
    config: EvmChainConfig,
  ): Promise<TokenMetadataResult> {
    let metadata: JsonRecord;
    try {
      metadata = record(
        await this.call("alchemy_getTokenMetadata", [contract]),
        "Alchemy Token Metadata 响应",
      );
    } catch (error) {
      if (error instanceof EvmTokenMetadataUnavailableError) {
        return {
          kind: "unrecognized",
          token: unrecognizedToken(config, contract, {
            symbol: null,
            name: null,
            reason: "代币合约未返回可读取的元数据",
          }),
        };
      }
      throw error;
    }
    const symbol = optionalText(metadata.symbol)?.slice(0, 40) ?? null;
    const name = optionalText(metadata.name)?.slice(0, 120) ?? null;
    const decimals = metadata.decimals;
    if (!Number.isSafeInteger(decimals) || Number(decimals) < 0 || Number(decimals) > 255) {
      return {
        kind: "unrecognized",
        token: unrecognizedToken(config, contract, {
          symbol,
          name,
          reason: "代币合约未返回可靠 decimals，数量无法读取",
        }),
      };
    }
    if (symbol === null) {
      return {
        kind: "unrecognized",
        token: unrecognizedToken(config, contract, {
          symbol: null,
          name,
          reason: "代币合约未返回可靠 symbol，暂无法识别",
        }),
      };
    }
    return {
      kind: "available",
      metadata: {
        symbol,
        name: `${symbol} · ${config.label} ${config.tokenStandard}`,
        decimals: Number(decimals),
      },
    };
  }
}

interface EvmProtocolPositionRead {
  balances: DiscoveredBalance[];
  coverage: AssetProductCoverage;
  consumedContracts: string[];
}

interface EvmProtocolPositionAdapter {
  contracts: readonly string[];
  matches(input: {
    config: EvmChainConfig;
    contracts: readonly string[];
  }): boolean;
  read(input: {
    config: EvmChainConfig;
    addresses: readonly string[];
    client: EvmRpcClient;
  }): Promise<EvmProtocolPositionRead>;
  failure(input: {
    config: EvmChainConfig;
    error: unknown;
  }): {
    coverage: AssetProductCoverage;
    candidates: EvmUnrecognizedToken[];
  };
}

export function shouldExposeProtocolCoverage(input: {
  balances: readonly DiscoveredBalance[];
  coverage: AssetProductCoverage;
}): boolean {
  return input.balances.length > 0 || input.coverage.capability !== "detailed";
}

function abiWord(value: bigint): string {
  if (value < 0n) throw new Error("EVM ABI 不支持负数");
  return value.toString(16).padStart(64, "0");
}

function abiWords(value: unknown, context: string): string[] {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error(`${context}不是有效 ABI 十六进制结果`);
  }
  const raw = value.slice(2);
  if (raw.length % 64 !== 0) throw new Error(`${context}长度不是 ABI word 的整数倍`);
  return raw.match(/.{64}/g) ?? [];
}

function abiOffset(words: string[], context: string): number {
  if (words.length === 0) throw new Error(`${context}缺少 ABI offset`);
  const bytes = BigInt(`0x${words[0]}`);
  if (bytes % 32n !== 0n || bytes > BigInt(Number.MAX_SAFE_INTEGER * 32)) {
    throw new Error(`${context}包含无效 ABI offset`);
  }
  const offset = Number(bytes / 32n);
  if (offset >= words.length) throw new Error(`${context}ABI offset 超出范围`);
  return offset;
}

function abiArrayLength(
  words: string[],
  offset: number,
  context: string,
  itemWords: number,
): number {
  const length = BigInt(`0x${words[offset] ?? ""}`);
  if (
    length > BigInt(LIDO_REQUEST_LIMIT) ||
    length > BigInt(Number.MAX_SAFE_INTEGER) ||
    offset + 1 + Number(length) * itemWords > words.length
  ) {
    throw new Error(`${context}数组长度无效`);
  }
  return Number(length);
}

function decodeUint256Array(value: unknown, context: string): bigint[] {
  const words = abiWords(value, context);
  const offset = abiOffset(words, context);
  const length = abiArrayLength(words, offset, context, 1);
  return words.slice(offset + 1, offset + 1 + length).map((word) => BigInt(`0x${word}`));
}

function decodeUint256(value: unknown, context: string): bigint {
  const words = abiWords(value, context);
  if (words.length !== 1) throw new Error(`${context}不是单个 uint256`);
  return BigInt(`0x${words[0]}`);
}

interface LidoWithdrawalStatus {
  amountOfStEth: bigint;
  owner: string;
  isFinalized: boolean;
  isClaimed: boolean;
}

function decodeLidoWithdrawalStatuses(value: unknown): LidoWithdrawalStatus[] {
  const words = abiWords(value, "Lido 提现申请状态");
  const offset = abiOffset(words, "Lido 提现申请状态");
  const length = abiArrayLength(words, offset, "Lido 提现申请状态", 6);
  const statuses: LidoWithdrawalStatus[] = [];
  for (let index = 0; index < length; index += 1) {
    const start = offset + 1 + index * 6;
    const isFinalized = BigInt(`0x${words[start + 4]}`);
    const isClaimed = BigInt(`0x${words[start + 5]}`);
    if (
      (isFinalized !== 0n && isFinalized !== 1n) ||
      (isClaimed !== 0n && isClaimed !== 1n)
    ) {
      throw new Error("Lido 提现申请状态包含无效布尔值");
    }
    statuses.push({
      amountOfStEth: BigInt(`0x${words[start]}`),
      owner: `0x${words[start + 2].slice(-40)}`.toLowerCase(),
      isFinalized: isFinalized === 1n,
      isClaimed: isClaimed === 1n,
    });
  }
  return statuses;
}

function encodeAddressCall(selector: string, address: string): string {
  return `${selector}${address.slice(2).padStart(64, "0")}`;
}

function encodeAddressAndUint256Call(
  selector: string,
  address: string,
  value: bigint,
): string {
  return `${encodeAddressCall(selector, address)}${abiWord(value)}`;
}

function encodeUint256ArrayCall(selector: string, values: bigint[]): string {
  return `${selector}${abiWord(32n)}${abiWord(BigInt(values.length))}${values.map(abiWord).join("")}`;
}

function encodeUint256ArrayWithBoundsCall(
  selector: string,
  values: bigint[],
  first: bigint,
  last: bigint,
): string {
  return `${selector}${abiWord(96n)}${abiWord(first)}${abiWord(last)}${abiWord(BigInt(values.length))}${values.map(abiWord).join("")}`;
}

function encodeTwoUint256ArraysCall(
  selector: string,
  first: bigint[],
  second: bigint[],
): string {
  const firstOffset = 64n;
  const secondOffset = firstOffset + BigInt((first.length + 1) * 32);
  return `${selector}${abiWord(firstOffset)}${abiWord(secondOffset)}${abiWord(BigInt(first.length))}${first.map(abiWord).join("")}${abiWord(BigInt(second.length))}${second.map(abiWord).join("")}`;
}

async function lidoClaimableEth(
  client: EvmRpcClient,
  requestIds: bigint[],
): Promise<Map<string, bigint>> {
  if (requestIds.length === 0) return new Map();
  const sortedRequestIds = [...requestIds].toSorted((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const lastCheckpointIndex = decodeUint256(
    await client.ethCall(LIDO_WITHDRAWAL_QUEUE, LIDO_GET_LAST_CHECKPOINT_INDEX),
    "Lido 最后检查点",
  );
  if (lastCheckpointIndex === 0n) throw new Error("Lido 可领取申请缺少检查点");
  const hints = decodeUint256Array(
    await client.ethCall(
      LIDO_WITHDRAWAL_QUEUE,
      encodeUint256ArrayWithBoundsCall(
        LIDO_FIND_CHECKPOINT_HINTS,
        sortedRequestIds,
        1n,
        lastCheckpointIndex,
      ),
    ),
    "Lido 提现申请检查点",
  );
  if (hints.length !== sortedRequestIds.length) {
    throw new Error("Lido 提现申请检查点数量不一致");
  }
  const amounts = decodeUint256Array(
    await client.ethCall(
      LIDO_WITHDRAWAL_QUEUE,
      encodeTwoUint256ArraysCall(
        LIDO_GET_CLAIMABLE_ETHER,
        sortedRequestIds,
        hints,
      ),
    ),
    "Lido 可领取 ETH",
  );
  if (amounts.length !== sortedRequestIds.length || amounts.some((amount) => amount === 0n)) {
    throw new Error("Lido 可领取 ETH 数量无效");
  }
  return new Map(sortedRequestIds.map((requestId, index) => [
    requestId.toString(),
    amounts[index],
  ]));
}

function lidoWithdrawalReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "未知错误";
  return `Lido 提现申请读取失败：${message}`;
}

const lidoWithdrawalAdapter: EvmProtocolPositionAdapter = {
  contracts: [LIDO_WITHDRAWAL_QUEUE],

  matches({ config, contracts }) {
    return config.chain === "ethereum" && contracts.includes(LIDO_WITHDRAWAL_QUEUE);
  },

  async read({ config, addresses, client }) {
    const balances: DiscoveredBalance[] = [];
    const seenRequestIds = new Set<string>();
    let pending = 0;
    let claimable = 0;
    for (const owner of addresses) {
      const requestIds = decodeUint256Array(
        await client.ethCall(
          LIDO_WITHDRAWAL_QUEUE,
          encodeAddressCall(LIDO_GET_WITHDRAWAL_REQUESTS, owner),
        ),
        "Lido 提现申请编号",
      );
      if (requestIds.length === 0) continue;
      const statuses = decodeLidoWithdrawalStatuses(
        await client.ethCall(
          LIDO_WITHDRAWAL_QUEUE,
          encodeUint256ArrayCall(LIDO_GET_WITHDRAWAL_STATUS, requestIds),
        ),
      );
      if (statuses.length !== requestIds.length) {
        throw new Error("Lido 提现申请状态数量与申请编号不一致");
      }
      const positions = statuses.map((status, index) => {
        const requestId = requestIds[index];
        const providerPositionId = requestId.toString();
        if (status.owner !== owner || status.isClaimed || status.amountOfStEth === 0n) {
          throw new Error(`Lido 提现申请 #${providerPositionId} 状态无效`);
        }
        return { requestId, providerPositionId, status };
      });
      const claimableEth = await lidoClaimableEth(
        client,
        positions
          .filter(({ status }) => status.isFinalized)
          .map(({ requestId }) => requestId),
      );
      for (const { providerPositionId, status } of positions) {
        if (seenRequestIds.has(providerPositionId)) {
          throw new Error(`Lido 返回重复提现申请 #${providerPositionId}`);
        }
        seenRequestIds.add(providerPositionId);
        const providerPositionState = status.isFinalized ? "可领取" : "排队中";
        if (status.isFinalized) claimable += 1;
        else pending += 1;
        const quantityInWei = status.isFinalized
          ? claimableEth.get(providerPositionId)
          : status.amountOfStEth;
        if (quantityInWei === undefined) {
          throw new Error(`Lido 提现申请 #${providerPositionId} 缺少可领取 ETH`);
        }
        balances.push({
          sourceAsset: `evm:${config.chainId}:lido-withdrawal:${providerPositionId}`,
          contractAddress: LIDO_WITHDRAWAL_QUEUE,
          symbol: "ETH",
          name: `Lido 提现申请 #${providerPositionId}`,
          quantity: units(
            `0x${quantityInWei.toString(16)}`,
            18,
            `Lido 提现申请 #${providerPositionId}`,
          ),
          priceAsset: `evm:${config.chainId}:native`,
          sourceAccount: "wallet",
          sourceProduct: "lido-withdrawal-request",
          providerPositionId,
          providerPositionState,
          economicAssetKey: `lido-withdrawal:${providerPositionId}`,
          positionState: "redeeming",
        });
      }
    }
    return {
      balances,
      coverage: {
        product: "lido-withdrawal-request",
        capability: "detailed",
        freshness: "current",
        message: balances.length === 0
          ? "未发现未领取申请"
          : `已读取 ${balances.length} 笔未领取申请 · ${pending} 笔排队中、${claimable} 笔可领取`,
      },
      consumedContracts: [LIDO_WITHDRAWAL_QUEUE],
    };
  },

  failure({ config, error }) {
    return {
      coverage: {
        product: "lido-withdrawal-request",
        capability: "unknown",
        freshness: "current",
        message: lidoWithdrawalReason(error),
      },
      candidates: [unrecognizedToken(config, LIDO_WITHDRAWAL_QUEUE, {
        symbol: "unstETH",
        name: "Lido 提现申请",
        reason: lidoWithdrawalReason(error),
      })],
    };
  },
};

interface ListaWithdrawalRequest {
  uuid: bigint;
  amountInSnBnb: bigint;
  startTime: bigint;
}

function decodeListaWithdrawalRequests(value: unknown): ListaWithdrawalRequest[] {
  const context = "Lista slisBNB 提现申请";
  const words = abiWords(value, context);
  const offset = abiOffset(words, context);
  const length = BigInt(`0x${words[offset] ?? ""}`);
  if (
    length > BigInt(LISTA_REQUEST_LIMIT) ||
    length > BigInt(Number.MAX_SAFE_INTEGER) ||
    offset + 1 + Number(length) * 3 !== words.length
  ) {
    throw new Error(`${context}数组长度无效`);
  }
  return Array.from({ length: Number(length) }, (_, index) => {
    const start = offset + 1 + index * 3;
    return {
      uuid: BigInt(`0x${words[start]}`),
      amountInSnBnb: BigInt(`0x${words[start + 1]}`),
      startTime: BigInt(`0x${words[start + 2]}`),
    };
  });
}

function decodeListaWithdrawalStatus(value: unknown): {
  isClaimable: boolean;
  amount: bigint;
} {
  const words = abiWords(value, "Lista slisBNB 提现申请状态");
  if (words.length !== 2) throw new Error("Lista slisBNB 提现申请状态无效");
  const isClaimable = BigInt(`0x${words[0]}`);
  const amount = BigInt(`0x${words[1]}`);
  if ((isClaimable !== 0n && isClaimable !== 1n) || amount === 0n) {
    throw new Error("Lista slisBNB 提现申请状态无效");
  }
  return { isClaimable: isClaimable === 1n, amount };
}

function listaEarliestClaimableDate(startTime: bigint): string {
  const earliestTimestamp = startTime + 7n * 24n * 60n * 60n;
  const maxTimestamp = BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1_000));
  if (earliestTimestamp > maxTimestamp) {
    throw new Error("Lista slisBNB 提现申请开始时间无效");
  }
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(Number(earliestTimestamp) * 1_000));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) throw new Error("Lista slisBNB 提现申请开始时间无效");
  return `${year}-${month}-${day}`;
}

function listaWithdrawalReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "未知错误";
  return `Lista slisBNB 提现申请读取失败：${message}`;
}

const listaSlisBnbWithdrawalAdapter: EvmProtocolPositionAdapter = {
  contracts: [LISTA_STAKE_MANAGER],

  matches({ config }) {
    return config.chain === "bsc";
  },

  async read({ config, addresses, client }) {
    const balances: DiscoveredBalance[] = [];
    const seenRequestIds = new Set<string>();
    let pending = 0;
    let claimable = 0;
    for (const owner of addresses) {
      const requests = decodeListaWithdrawalRequests(
        await client.ethCall(
          LISTA_STAKE_MANAGER,
          encodeAddressCall(LISTA_GET_USER_WITHDRAWAL_REQUESTS, owner),
        ),
      );
      for (const [index, request] of requests.entries()) {
        const providerPositionId = request.uuid.toString();
        if (request.amountInSnBnb === 0n || request.startTime === 0n) {
          throw new Error(`Lista slisBNB 提现申请 #${providerPositionId} 数据无效`);
        }
        if (seenRequestIds.has(providerPositionId)) {
          throw new Error(`Lista 返回重复提现申请 #${providerPositionId}`);
        }
        seenRequestIds.add(providerPositionId);
        const status = decodeListaWithdrawalStatus(
          await client.ethCall(
            LISTA_STAKE_MANAGER,
            encodeAddressAndUint256Call(
              LISTA_GET_USER_REQUEST_STATUS,
              owner,
              BigInt(index),
            ),
          ),
        );
        const providerPositionState = status.isClaimable ? "可领取" : "锁仓中";
        if (status.isClaimable) claimable += 1;
        else pending += 1;
        const providerPositionAvailableOn = status.isClaimable
          ? undefined
          : listaEarliestClaimableDate(request.startTime);
        balances.push({
          sourceAsset: `evm:${config.chainId}:lista-slisbnb-withdrawal:${providerPositionId}`,
          contractAddress: LISTA_STAKE_MANAGER,
          symbol: "BNB",
          name: `Lista slisBNB 提现申请 #${providerPositionId}`,
          quantity: units(
            `0x${status.amount.toString(16)}`,
            18,
            `Lista slisBNB 提现申请 #${providerPositionId}`,
          ),
          priceAsset: `evm:${config.chainId}:native`,
          sourceAccount: "wallet",
          sourceProduct: "lista-slisbnb-withdrawal-request",
          providerPositionId,
          providerPositionState,
          ...(providerPositionAvailableOn ? { providerPositionAvailableOn } : {}),
          economicAssetKey: `lista-slisbnb-withdrawal:${providerPositionId}`,
          positionState: "redeeming",
        });
      }
    }
    return {
      balances,
      coverage: {
        product: "lista-slisbnb-withdrawal-request",
        capability: "detailed",
        freshness: "current",
        message: balances.length === 0
          ? "未发现未领取申请"
          : `已读取 ${balances.length} 笔未领取申请 · ${pending} 笔锁仓中、${claimable} 笔可领取`,
      },
      consumedContracts: [LISTA_STAKE_MANAGER],
    };
  },

  failure({ error }) {
    return {
      coverage: {
        product: "lista-slisbnb-withdrawal-request",
        capability: "unknown",
        freshness: "current",
        message: listaWithdrawalReason(error),
      },
      candidates: [],
    };
  },
};

const EVM_PROTOCOL_POSITION_ADAPTERS: readonly EvmProtocolPositionAdapter[] = [
  lidoWithdrawalAdapter,
  listaSlisBnbWithdrawalAdapter,
];

class CoinGeckoEvmPrices {
  constructor(
    private readonly services: Pick<ExternalServiceConfigurationReader, "coinGeckoDemoApiKey">,
    private readonly request: EvmFetch,
  ) {}

  private async headers(): Promise<HeadersInit | undefined> {
    const key = await this.services.coinGeckoDemoApiKey();
    if (!key) throw new Error("未配置 CoinGecko Demo API Key");
    return { "x-cg-demo-api-key": key };
  }

  private async get(url: URL, signal?: AbortSignal): Promise<Response | null> {
    try {
      return await this.request(url, {
        method: "GET",
        headers: await this.headers(),
        cache: "no-store",
        redirect: "error",
        signal,
      });
    } catch (error) {
      if (error instanceof TypeError) return null;
      throw error;
    }
  }

  async read(
    config: EvmChainConfig,
    contracts: string[],
    observedAt: string,
    signal?: AbortSignal,
    includeNative = true,
  ): Promise<Map<string, ReferencePrice>> {
    const prices = new Map<string, ReferencePrice>();
    if (includeNative) {
      const url = new URL("/api/v3/simple/price", COINGECKO_ORIGIN);
      url.searchParams.set("ids", config.coinGeckoCoinId);
      url.searchParams.set("vs_currencies", "usd");
      url.searchParams.set("include_last_updated_at", "true");
      const response = await this.get(url, signal);
      if (response && !response.ok) {
        throw assetResponseError(`CoinGecko ${config.nativeSymbol} 价格读取失败（HTTP ${response.status}）`, response);
      }
      if (response) {
        const root = record(await response.json(), `CoinGecko ${config.nativeSymbol} 价格响应`);
        const rawNative = root[config.coinGeckoCoinId];
        if (rawNative !== undefined) {
          const native = record(rawNative, `CoinGecko ${config.label} 价格响应`);
          const rawPrice = native.usd;
          const updatedAt = native.last_updated_at;
          const quotedAt = typeof updatedAt === "number" && Number.isSafeInteger(updatedAt)
            ? new Date(updatedAt * 1000)
            : null;
          if (rawPrice !== undefined && quotedAt && !Number.isNaN(quotedAt.getTime())) {
            prices.set(`evm:${config.chainId}:native`, {
              price: decimal(rawPrice, `${config.coinGeckoCoinId}.usd`),
              quotedAt: quotedAt.toISOString(),
              source: `CoinGecko ${config.label}/USD 参考价格`,
            });
          }
        }
      }
    }
    for (let index = 0; index < contracts.length; index += 30) {
      const batch = contracts.slice(index, index + 30);
      if (batch.length === 0) continue;
      const url = new URL(
        `/api/v3/onchain/simple/networks/${config.coinGeckoNetwork}/token_price/${batch.join(",")}`,
        COINGECKO_ORIGIN,
      );
      const response = await this.get(url, signal);
      if (response && !response.ok) {
        throw assetResponseError(`CoinGecko ${config.tokenStandard} 价格读取失败（HTTP ${response.status}）`, response);
      }
      if (!response) continue;
      const root = record(await response.json(), "CoinGecko 同质化代币价格响应");
      const data = record(root.data, "CoinGecko token data");
      const attributes = record(data.attributes, "CoinGecko token attributes");
      const tokenPrices = record(attributes.token_prices, "CoinGecko token_prices");
      for (const contract of batch) {
        const raw = tokenPrices[contract] ?? tokenPrices[contract.toLowerCase()];
        if (raw === undefined || raw === null) continue;
        try {
          prices.set(`evm:${config.chainId}:${contract}`, {
            price: decimal(raw, contract),
            quotedAt: observedAt,
            source: `CoinGecko ${config.label} ${contract}/USD 参考价格`,
          });
        } catch {
          // 单个异常报价等价于该资产缺价，不影响其他资产。
        }
      }
    }
    return prices;
  }
}

async function rpcUrl(
  services: Pick<ExternalServiceConfigurationReader, "rpcUrl">,
  config: EvmChainConfig,
): Promise<string> {
  const value = await services.rpcUrl(config.chain);
  if (!value) throw new Error(`未配置 ${config.label} RPC`);
  return value;
}

function parseCredentials(credentials: string): { config: EvmChainConfig; addresses: string[] } {
  try {
    const value = record(JSON.parse(credentials), "EVM 观察钱包配置");
    if ((value.chain !== "ethereum" && value.chain !== "bsc") || !Array.isArray(value.addresses) || !value.addresses.every((item) => typeof item === "string")) {
      throw new Error("EVM 观察钱包配置缺少 chain 或 addresses");
    }
    return { config: EVM_CHAINS[value.chain], addresses: normalizeAddresses(value.addresses) };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("EVM")) throw error;
    throw new Error("EVM 观察钱包配置格式无效");
  }
}

async function readFullSnapshot(input: {
  config: EvmChainConfig;
  addresses: string[];
  observedAt: string;
  rpcUrl: string;
  services: ExternalServiceConfigurationReader;
  request: EvmFetch;
  signal?: AbortSignal;
  ignoredAssetKeys?: string[];
  previousSnapshot?: AssetSnapshot;
}): Promise<AssetSnapshot> {
  const client = new EvmRpcClient(input.rpcUrl, input.request, input.signal);
  const returnedChainId = text(await client.chainId(), "eth_chainId");
  if (!/^0x[0-9a-fA-F]+$/.test(returnedChainId) || BigInt(returnedChainId) !== BigInt(input.config.chainId)) {
    throw new Error(`${input.config.label} RPC chain ID 不匹配`);
  }
  const rawTokens: Array<{ contract: string; balance: string }> = [];
  const nativeBalances: DiscoveredBalance[] = [];
  for (const address of input.addresses) {
    nativeBalances.push({
      sourceAsset: `evm:${input.config.chainId}:native`,
      contractAddress: null,
      symbol: input.config.nativeSymbol,
      name: input.config.label,
      quantity: units(await client.nativeBalance(address), 18, `${input.config.nativeSymbol} balance`),
    });
    rawTokens.push(...await client.tokenBalances(address));
  }
  const positiveTokens = rawTokens.filter(({ balance }) => {
    if (!/^0x[0-9a-fA-F]+$/.test(balance)) throw new Error("Alchemy 返回无效代币余额");
    return BigInt(balance) > 0n;
  });
  const matchedProtocolAdapters = EVM_PROTOCOL_POSITION_ADAPTERS.filter((adapter) =>
    adapter.matches({
      config: input.config,
      contracts: [...new Set(positiveTokens.map(({ contract }) => contract))],
    })
  );
  const protocolContracts = new Set(
    matchedProtocolAdapters.flatMap(({ contracts }) => contracts),
  );
  const protocolBalances: DiscoveredBalance[] = [];
  const protocolProducts: AssetProductCoverage[] = [];
  const protocolCandidates: EvmUnrecognizedToken[] = [];
  let protocolReadFailed = false;
  for (const adapter of matchedProtocolAdapters) {
    try {
      const result = await adapter.read({
        config: input.config,
        addresses: input.addresses,
        client,
      });
      protocolBalances.push(...result.balances);
      if (shouldExposeProtocolCoverage(result)) {
        protocolProducts.push(result.coverage);
      }
    } catch (error) {
      protocolReadFailed = true;
      const failure = adapter.failure({ config: input.config, error });
      protocolProducts.push(failure.coverage);
      protocolCandidates.push(...failure.candidates);
    }
  }
  const ignoredAssetKeys = new Set(input.ignoredAssetKeys ?? []);
  const visibleTokens = positiveTokens.filter(
    ({ contract }) =>
      !protocolContracts.has(contract) &&
      !ignoredAssetKeys.has(tokenAssetKey(input.config, contract)),
  );
  const contracts = [...new Set(visibleTokens.map(({ contract }) => contract))];
  if (contracts.length > 500) throw new Error("EVM 同质化代币数量超过安全上限");
  const metadata = new Map<string, TokenMetadata>();
  const unreadableTokens: EvmUnrecognizedToken[] = [];
  for (let index = 0; index < contracts.length; index += 8) {
    const batch = contracts.slice(index, index + 8);
    const values = await Promise.all(
      batch.map(async (contract) => [
        contract,
        await client.tokenMetadata(contract, input.config),
      ] as const),
    );
    for (const [contract, result] of values) {
      if (result.kind === "available") {
        metadata.set(contract, result.metadata);
      } else {
        unreadableTokens.push(result.token);
      }
    }
  }
  const tokenBalances = visibleTokens.flatMap(({ contract, balance }) => {
    const token = metadata.get(contract);
    if (!token) return [];
    return [{
      sourceAsset: tokenAssetKey(input.config, contract),
      contractAddress: contract,
      symbol: token.symbol,
      name: token.name,
      quantity: units(balance, token.decimals, `${contract} balance`),
    }];
  });
  const ignoredTokens = [...new Set(
    positiveTokens
      .filter(
        ({ contract }) =>
          !protocolContracts.has(contract) &&
          ignoredAssetKeys.has(tokenAssetKey(input.config, contract)),
      )
      .map(({ contract }) => tokenAssetKey(input.config, contract)),
  )].map((sourceAsset) =>
    previousUnrecognizedToken(input.previousSnapshot, sourceAsset)
  );
  const prices = await new CoinGeckoEvmPrices(
    input.services,
    input.request,
  ).read(
    input.config,
    [...metadata.keys()],
    input.observedAt,
    input.signal,
    nativeBalances.some(({ quantity }) => decimalCompare(quantity, "0") > 0) ||
      protocolBalances.some(({ priceAsset }) => priceAsset === `evm:${input.config.chainId}:native`),
  );
  const snapshot = snapshotTokenCandidates(
    buildSnapshot(
      [...nativeBalances, ...tokenBalances, ...protocolBalances],
      prices,
      input.observedAt,
    ),
    input.config,
    [...unreadableTokens, ...ignoredTokens, ...protocolCandidates],
  );
  if (matchedProtocolAdapters.length === 0) return snapshot;
  const hasUnvalued = snapshot.holdings.some(
    ({ valuation }) => valuation.status === "unvalued",
  ) || (snapshot.unrecognizedEvmTokens ?? []).some(
    ({ sourceAsset }) => !ignoredAssetKeys.has(sourceAsset),
  );
  return {
    ...snapshot,
    coverage: {
      status: protocolReadFailed || hasUnvalued ? "partial" : "complete",
      products: protocolProducts,
      unexplainedValue: null,
      excludedPositiveAccounts: [],
    },
  };
}

export class ProductionEvmWatchWallet implements EvmWatchWalletReadOnly {
  constructor(
    private readonly services: ExternalServiceConfigurationReader,
    private readonly request: EvmFetch = globalThis.fetch,
  ) {}

  async preview(input: { chain: EvmChain; addresses: string[]; observedAt: string }): Promise<EvmWatchAuthorizationResult> {
    const addresses = normalizeAddresses(input.addresses);
    return this.authorize(EVM_CHAINS[input.chain], addresses, input.observedAt);
  }

  async revalidate(input: { credentials: string; observedAt: string }): Promise<EvmWatchAuthorizationResult> {
    const stored = parseCredentials(input.credentials);
    return this.authorize(stored.config, stored.addresses, input.observedAt);
  }

  private async authorize(config: EvmChainConfig, addresses: string[], observedAt: string): Promise<EvmWatchAuthorizationResult> {
    return {
      credentials: JSON.stringify({ chain: config.chain, addresses }),
      chain: config.chain,
      permissions: ["public-address", "market-data", "positions"],
      account: {
        id: `evm:${config.chainId}:${createHash("sha256").update(addresses.join(",")).digest("hex").slice(0, 12)}`,
        label: `${config.label} 观察钱包 · ${addresses.length} 个地址`,
      },
      snapshot: await readFullSnapshot({
        config,
        addresses,
        observedAt,
        rpcUrl: await rpcUrl(this.services, config),
        services: this.services,
        request: this.request,
      }),
    };
  }
}

export class ProductionEvmWatchSourceRefresher implements AssetSourceRefresher {
  constructor(
    private readonly services: ExternalServiceConfigurationReader,
    private readonly request: EvmFetch = globalThis.fetch,
  ) {}

  async refresh({ source, credentials, mode, attemptedAt, signal }: Parameters<AssetSourceRefresher["refresh"]>[0]): Promise<AssetSourceRefreshResult> {
    const expectedConfig = Object.values(EVM_CHAINS).find(
      ({ sourceKind }) => sourceKind === source.kind,
    );
    if (!expectedConfig) throw new Error(`暂不支持刷新来源类型：${source.kind}`);
    const stored = parseCredentials(credentials);
    if (stored.config.chain !== expectedConfig.chain) throw new Error("EVM 来源链配置不匹配");
    const config = stored.config;
    if (mode === "prices") {
      const contracts = source.snapshot.holdings.flatMap((holding) =>
        holding.sourceAsset?.startsWith(`evm:${config.chainId}:0x`)
          ? [holding.sourceAsset.slice(`evm:${config.chainId}:`.length)]
          : [],
      );
      const prices = await new CoinGeckoEvmPrices(
        this.services,
        this.request,
      ).read(
        config,
        [...new Set(contracts)],
        attemptedAt,
        signal,
        source.snapshot.holdings.some(
          ({ sourceAsset, sourceProduct }) =>
            sourceAsset === `evm:${config.chainId}:native` ||
            sourceProduct === "lido-withdrawal-request" ||
            sourceProduct === "lista-slisbnb-withdrawal-request",
        ),
      );
      const balances: DiscoveredBalance[] = source.snapshot.holdings.map((holding) => ({
        sourceAsset: holding.sourceAsset ?? `evm:${config.chainId}:${holding.symbol}`,
        contractAddress: holding.sourceAsset?.startsWith(`evm:${config.chainId}:0x`)
          ? holding.sourceAsset.slice(`evm:${config.chainId}:`.length)
          : null,
        symbol: holding.symbol,
        name: holding.name,
        quantity: holding.quantity,
        ...(holding.sourceProduct === "lido-withdrawal-request" ||
          holding.sourceProduct === "lista-slisbnb-withdrawal-request"
          ? { priceAsset: `evm:${config.chainId}:native` }
          : {}),
        ...(holding.sourceAccount ? { sourceAccount: holding.sourceAccount } : {}),
        ...(holding.sourceProduct ? { sourceProduct: holding.sourceProduct } : {}),
        ...(holding.providerPositionId ? { providerPositionId: holding.providerPositionId } : {}),
        ...(holding.providerPositionState ? { providerPositionState: holding.providerPositionState } : {}),
        ...(holding.providerPositionAvailableOn
          ? { providerPositionAvailableOn: holding.providerPositionAvailableOn }
          : {}),
        ...(holding.economicAssetKey ? { economicAssetKey: holding.economicAssetKey } : {}),
        ...(holding.positionState ? { positionState: holding.positionState } : {}),
      }));
      const snapshot = snapshotTokenCandidates(
        buildSnapshot(balances, prices, attemptedAt),
        config,
        (source.snapshot.unrecognizedEvmTokens ?? []).filter(
          ({ quantity }) => quantity === null,
        ),
      );
      return {
        snapshot: source.snapshot.coverage === undefined
          ? snapshot
          : { ...snapshot, coverage: source.snapshot.coverage },
      };
    }
    return {
      snapshot: await readFullSnapshot({
        config,
        addresses: stored.addresses,
        observedAt: attemptedAt,
        rpcUrl: await rpcUrl(this.services, config),
        services: this.services,
        request: this.request,
        signal,
        ignoredAssetKeys: source.ignoredAssetKeys,
        previousSnapshot: source.snapshot,
      }),
    };
  }
}
