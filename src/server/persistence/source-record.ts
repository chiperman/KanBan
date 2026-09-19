import { randomUUID } from "node:crypto";

import type { AssetSourceSummary, BinanceAuthorizationResult, BitAuthorizationResult, BitgetAuthorizationResult, Card, EvmWatchAuthorizationResult, LongbridgeAuthorizationResult, OkxAuthorizationResult } from "@/server/ports";

export type SourceConnectionKind =
  | "longbridge"
  | "binance"
  | "okx"
  | "bitget"
  | "bit"
  | "evm";
export type SourceAuthorizationResult =
  | LongbridgeAuthorizationResult
  | BinanceAuthorizationResult
  | OkxAuthorizationResult
  | BitgetAuthorizationResult
  | BitAuthorizationResult
  | EvmWatchAuthorizationResult;

export function connectedSourceKind(
  sourceKind: SourceConnectionKind,
  result: SourceAuthorizationResult,
): AssetSourceSummary["kind"] {
  if (sourceKind !== "evm") return sourceKind;
  if (!("chain" in result)) throw new Error("EVM 重新授权缺少链信息");
  return result.chain === "ethereum" ? "evm-watch-ethereum" : "evm-watch-bsc";
}

const SOURCE_CARD_DETAILS = {
  longbridge: {
    kind: "longbridge",
    title: "长桥资产",
    body: "只读证券账户",
  },
  binance: {
    kind: "binance",
    title: "Binance 资产",
    body: "投资产品明细、钱包守恒与覆盖状态",
  },
  okx: {
    kind: "okx",
    title: "OKX 资产",
    body: "现货、资金与 Earn 只读账户",
  },
  bitget: {
    kind: "bitget",
    title: "Bitget 资产",
    body: "现货、资金与 Earn 只读账户",
  },
  bit: {
    kind: "bit",
    title: "BIT / Matrixport 资产",
    body: "Wallet 与理财产品只读账户",
  },
} as const;

export function buildConnectedSource(
  sourceKind: SourceConnectionKind,
  result: SourceAuthorizationResult,
  credentialReference: string,
): { source: AssetSourceSummary; card: Card } {
  const details = sourceKind === "evm"
    ? (() => {
        const evm = result as EvmWatchAuthorizationResult;
        return evm.chain === "ethereum"
          ? {
              kind: "evm-watch-ethereum",
              title: "Ethereum 观察钱包",
              body: "公开地址 ETH 与 ERC-20 只读来源",
            }
          : {
              kind: "evm-watch-bsc",
              title: "BNB Smart Chain 观察钱包",
              body: "公开地址 BNB 与 BEP-20 只读来源",
            };
      })()
    : SOURCE_CARD_DETAILS[sourceKind];
  const sourceId = randomUUID();
  return {
    source: {
      id: sourceId,
      kind: details.kind,
      label: result.account.label,
      accountId: result.account.id,
      permissions: result.permissions,
      credentialReference,
      snapshot: result.snapshot,
      sync: {
        status: "current",
        lastSuccessfulAt: result.snapshot.syncedAt,
        lastAttemptAt: result.snapshot.syncedAt,
        error: null,
      },
    },
    card: {
      id: randomUUID(),
      kind: "asset",
      title: details.title,
      body: details.body,
      sourceId,
      span: 1,
    },
  };
}
