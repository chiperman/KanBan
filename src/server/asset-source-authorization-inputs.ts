import type { AssetSourceProviderId } from "@/domain/asset-source-providers";
import type { BitgetAccountMode } from "@/server/ports";
import { parseConnectionInput } from "@/server/asset-sources/longbridge-connection";
import type { AssetSourceAuthorizationInput } from "@/server/asset-source-provider-adapters";

function parseBinanceInput(body: unknown) {
  const value = body as { apiKey?: unknown; apiSecret?: unknown } | null;
  return typeof value?.apiKey === "string" &&
    typeof value.apiSecret === "string"
    ? {
        provider: "binance" as const,
        apiKey: value.apiKey,
        apiSecret: value.apiSecret,
      }
    : null;
}

function parseOkxInput(body: unknown) {
  const value = body as {
    apiKey?: unknown;
    apiSecret?: unknown;
    passphrase?: unknown;
    region?: unknown;
  } | null;
  return typeof value?.apiKey === "string" &&
    typeof value.apiSecret === "string" &&
    typeof value.passphrase === "string" &&
    (value.region === "global" ||
      value.region === "us" ||
      value.region === "eea")
    ? {
        provider: "okx" as const,
        apiKey: value.apiKey,
        apiSecret: value.apiSecret,
        passphrase: value.passphrase,
        region: value.region as "global" | "us" | "eea",
      }
    : null;
}

function parseBitgetInput(body: unknown) {
  const value = body as {
    apiKey?: unknown;
    apiSecret?: unknown;
    passphrase?: unknown;
    accountMode?: unknown;
  } | null;
  return typeof value?.apiKey === "string" &&
    typeof value.apiSecret === "string" &&
    typeof value.passphrase === "string" &&
    (value.accountMode === "classic" || value.accountMode === "uta")
    ? {
        provider: "bitget" as const,
        apiKey: value.apiKey,
        apiSecret: value.apiSecret,
        passphrase: value.passphrase,
        accountMode: value.accountMode as BitgetAccountMode,
      }
    : null;
}

function parseBitInput(body: unknown) {
  const value = body as {
    apiKey?: unknown;
    apiSecret?: unknown;
    userId?: unknown;
  } | null;
  return typeof value?.apiKey === "string" &&
    typeof value.apiSecret === "string" &&
    typeof value.userId === "string"
    ? {
        provider: "bit" as const,
        apiKey: value.apiKey,
        apiSecret: value.apiSecret,
        userId: value.userId,
      }
    : null;
}

function parseEvmAddresses(body: unknown) {
  const value = body as { addresses?: unknown } | null;
  return Array.isArray(value?.addresses) &&
    value.addresses.every((address) => typeof address === "string")
    ? value.addresses
    : null;
}

function parseEvmInput(
  provider: "ethereum" | "bsc",
  body: unknown,
): AssetSourceAuthorizationInput | null {
  const value = body as { chain?: unknown } | null;
  if (value?.chain !== provider) return null;
  const addresses = parseEvmAddresses(body);
  return addresses === null ? null : { provider, addresses };
}

const INPUT_PARSERS: Record<
  AssetSourceProviderId,
  (body: unknown) => AssetSourceAuthorizationInput | null
> = {
  longbridge: parseConnectionInput,
  binance: parseBinanceInput,
  okx: parseOkxInput,
  bitget: parseBitgetInput,
  bit: parseBitInput,
  ethereum: (body) => parseEvmInput("ethereum", body),
  bsc: (body) => parseEvmInput("bsc", body),
};

const KIND_PROVIDER_IDS: Record<string, AssetSourceProviderId> = {
  longbridge: "longbridge",
  binance: "binance",
  okx: "okx",
  bitget: "bitget",
  bit: "bit",
  "evm-watch-ethereum": "ethereum",
  "evm-watch-bsc": "bsc",
};

export function assetSourceProviderForKind(
  kind: string,
): AssetSourceProviderId | null {
  return Object.hasOwn(KIND_PROVIDER_IDS, kind) ? KIND_PROVIDER_IDS[kind] : null;
}

export function parseAssetSourceAuthorizationInput(
  provider: AssetSourceProviderId,
  body: unknown,
): AssetSourceAuthorizationInput | null {
  return INPUT_PARSERS[provider](body);
}

export function parseAssetSourceReauthorizationInput(
  provider: AssetSourceProviderId,
  body: unknown,
): AssetSourceAuthorizationInput | null {
  if (provider !== "ethereum" && provider !== "bsc") {
    return parseAssetSourceAuthorizationInput(provider, body);
  }
  const addresses = parseEvmAddresses(body);
  return addresses === null ? null : { provider, addresses };
}
