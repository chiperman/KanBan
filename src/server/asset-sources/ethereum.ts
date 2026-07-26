import { createHash, randomUUID } from "node:crypto";

import {
  decimalAdd,
  decimalCompare,
  decimalMultiply,
} from "@/domain/decimal";
import type {
  AssetHolding,
  AssetSnapshot,
  AssetSourceRefreshResult,
  AssetSourceRefresher,
  EvmChain,
  EvmWatchAuthorizationResult,
  EvmWatchWalletReadOnly,
} from "@/server/ports";

type JsonRecord = Record<string, unknown>;
type EvmFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const RPC_PAGE_LIMIT = 100;
const COINGECKO_ORIGIN = "https://api.coingecko.com";

interface EvmChainConfig {
  chain: EvmChain;
  chainId: "1" | "56";
  sourceKind: "evm-watch-ethereum" | "evm-watch-bsc";
  label: "Ethereum" | "BNB Smart Chain";
  nativeSymbol: "ETH" | "BNB";
  tokenStandard: "ERC-20" | "BEP-20";
  rpcEnv: "ETHEREUM_RPC_URL" | "BSC_RPC_URL";
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
    rpcEnv: "ETHEREUM_RPC_URL",
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
    rpcEnv: "BSC_RPC_URL",
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
  return normalized;
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
}

interface ReferencePrice {
  price: string;
  quotedAt: string;
  source: string;
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
    const quote = prices.get(balance.sourceAsset) ?? null;
    const marketValue = quote
      ? decimalMultiply(balance.quantity, quote.price)
      : null;
    return {
      symbol: balance.symbol,
      name: balance.name,
      sourceAsset: balance.sourceAsset,
      quantity: balance.quantity,
      currency: "USD",
      assetClass: "crypto" as const,
      currentPrice: quote ? { amount: quote.price, currency: "USD" } : null,
      marketValue,
      sourceMarketValue: marketValue
        ? { amount: marketValue, currency: "USD" }
        : null,
      valuation: quote
        ? { status: "valued" as const, priceSource: quote.source, pricedAt: quote.quotedAt }
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

class EvmRpcClient {
  private id = 0;

  constructor(
    private readonly rpcUrl: string,
    private readonly request: EvmFetch,
    private readonly signal?: AbortSignal,
  ) {}

  async call(method: string, params: unknown[]): Promise<unknown> {
    const response = await this.request(this.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
      cache: "no-store",
      redirect: "error",
      signal: this.signal,
    });
    const body = record(
      await response.json().catch(() => null),
      "EVM JSON-RPC 响应",
    );
    if (!response.ok || body.error !== undefined) {
      const error = typeof body.error === "object" && body.error !== null
        ? body.error as { message?: unknown }
        : null;
      throw new Error(
        `EVM RPC 读取失败${typeof error?.message === "string" ? `：${error.message}` : `（HTTP ${response.status}）`}`,
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

  async tokenMetadata(contract: string, config: EvmChainConfig): Promise<{ symbol: string; name: string; decimals: number }> {
    const metadata = record(
      await this.call("alchemy_getTokenMetadata", [contract]),
      "Alchemy Token Metadata 响应",
    );
    const decimals = metadata.decimals;
    if (!Number.isSafeInteger(decimals) || Number(decimals) < 0 || Number(decimals) > 255) {
      throw new Error(`Alchemy 代币 decimals 无效：${contract}`);
    }
    const symbol = text(metadata.symbol, "symbol").slice(0, 40);
    return {
      symbol,
      name: `${symbol} · ${config.label} ${config.tokenStandard}`,
      decimals: Number(decimals),
    };
  }
}

class CoinGeckoEvmPrices {
  constructor(private readonly request: EvmFetch) {}

  private headers(): HeadersInit | undefined {
    const key = process.env.COINGECKO_DEMO_API_KEY;
    return key ? { "x-cg-demo-api-key": key } : undefined;
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
      const response = await this.request(url, {
        method: "GET",
        headers: this.headers(),
        cache: "no-store",
        redirect: "error",
        signal,
      });
      if (!response.ok) {
        throw new Error(`CoinGecko ${config.nativeSymbol} 价格读取失败（HTTP ${response.status}）`);
      }
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
    for (let index = 0; index < contracts.length; index += 30) {
      const batch = contracts.slice(index, index + 30);
      if (batch.length === 0) continue;
      const url = new URL(
        `/api/v3/onchain/simple/networks/${config.coinGeckoNetwork}/token_price/${batch.join(",")}`,
        COINGECKO_ORIGIN,
      );
      const response = await this.request(url, {
        method: "GET",
        headers: this.headers(),
        cache: "no-store",
        redirect: "error",
        signal,
      });
      if (!response.ok) {
        throw new Error(`CoinGecko ${config.tokenStandard} 价格读取失败（HTTP ${response.status}）`);
      }
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

function rpcUrl(config: EvmChainConfig): string {
  const value = process.env[config.rpcEnv];
  if (!value) throw new Error(`未配置 ${config.rpcEnv}`);
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error(`${config.rpcEnv} 必须使用 HTTPS`);
  }
  return url.toString();
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
  request: EvmFetch;
  signal?: AbortSignal;
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
  const contracts = [...new Set(positiveTokens.map(({ contract }) => contract))];
  if (contracts.length > 500) throw new Error("EVM 同质化代币数量超过安全上限");
  const metadata = new Map<string, { symbol: string; name: string; decimals: number }>();
  for (let index = 0; index < contracts.length; index += 8) {
    const batch = contracts.slice(index, index + 8);
    const values = await Promise.all(
      batch.map(async (contract) => [
        contract,
        await client.tokenMetadata(contract, input.config),
      ] as const),
    );
    for (const value of values) metadata.set(...value);
  }
  const tokenBalances = positiveTokens.map(({ contract, balance }) => {
    const token = metadata.get(contract);
    if (!token) throw new Error(`EVM 代币元数据缺失：${contract}`);
    return {
      sourceAsset: `evm:${input.config.chainId}:${contract}`,
      contractAddress: contract,
      symbol: token.symbol,
      name: token.name,
      quantity: units(balance, token.decimals, `${contract} balance`),
    };
  });
  const prices = await new CoinGeckoEvmPrices(input.request).read(
    input.config,
    contracts,
    input.observedAt,
    input.signal,
    nativeBalances.some(({ quantity }) => decimalCompare(quantity, "0") > 0),
  );
  return buildSnapshot([...nativeBalances, ...tokenBalances], prices, input.observedAt);
}

export class ProductionEvmWatchWallet implements EvmWatchWalletReadOnly {
  constructor(
    private readonly request: EvmFetch = globalThis.fetch,
    private readonly endpoint: string | null = null,
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
        rpcUrl: this.endpoint ?? rpcUrl(config),
        request: this.request,
      }),
    };
  }
}

export class ProductionEvmWatchSourceRefresher implements AssetSourceRefresher {
  constructor(
    private readonly request: EvmFetch = globalThis.fetch,
    private readonly endpoint: string | null = null,
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
      const prices = await new CoinGeckoEvmPrices(this.request).read(
        config,
        [...new Set(contracts)],
        attemptedAt,
        signal,
        source.snapshot.holdings.some(({ sourceAsset }) => sourceAsset === `evm:${config.chainId}:native`),
      );
      const balances: DiscoveredBalance[] = source.snapshot.holdings.map((holding) => ({
        sourceAsset: holding.sourceAsset ?? `evm:${config.chainId}:${holding.symbol}`,
        contractAddress: holding.sourceAsset?.startsWith(`evm:${config.chainId}:0x`)
          ? holding.sourceAsset.slice(`evm:${config.chainId}:`.length)
          : null,
        symbol: holding.symbol,
        name: holding.name,
        quantity: holding.quantity,
      }));
      return { snapshot: buildSnapshot(balances, prices, attemptedAt) };
    }
    return {
      snapshot: await readFullSnapshot({
        config,
        addresses: stored.addresses,
        observedAt: attemptedAt,
        rpcUrl: this.endpoint ?? rpcUrl(config),
        request: this.request,
        signal,
      }),
    };
  }
}

export interface EvmPendingPreview extends EvmWatchAuthorizationResult {
  id: string;
  expiresAt: number;
}

export type EvmPublicPreview = Omit<EvmPendingPreview, "credentials">;

/** 公开地址预览仍只保留在服务端；浏览器只收到身份、范围与总额。 */
export class EvmConnectionState {
  private readonly previews = new Map<string, EvmPendingPreview>();
  private readonly claimed = new Set<string>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  private clear(id: string): void {
    this.previews.delete(id);
    this.claimed.delete(id);
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
  }

  rememberPreview(result: EvmWatchAuthorizationResult): string {
    const id = randomUUID();
    const expiresAt = Date.now() + 10 * 60_000;
    this.previews.set(id, { ...result, id, expiresAt });
    const timer = setTimeout(() => this.clear(id), expiresAt - Date.now());
    timer.unref();
    this.timers.set(id, timer);
    return id;
  }

  getPublicPreview(id: string): EvmPublicPreview | null {
    const value = this.previews.get(id) ?? null;
    if (value && value.expiresAt < Date.now()) {
      this.clear(id);
      return null;
    }
    if (!value) return null;
    const { credentials: _credentials, ...safe } = value;
    return safe;
  }

  claimPreview(id: string): EvmPendingPreview | null {
    if (this.claimed.has(id)) return null;
    const value = this.previews.get(id) ?? null;
    if (!value || value.expiresAt < Date.now()) {
      if (value) this.clear(id);
      return null;
    }
    this.claimed.add(id);
    return value;
  }

  releasePreview(id: string): void { this.claimed.delete(id); }
  completePreview(id: string): void { this.clear(id); }
  discardPreview(id: string): void { this.clear(id); }
}
