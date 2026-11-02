import { decimalCompare } from "@/domain/decimal";
import { createJsonDecoder } from "../../sdk/json";
import type { AssetSnapshot, BitgetAccountMode } from "@/server/ports";
import type { Prices } from "../../sdk/host-capabilities";
import { usdtUsdValuation } from "../../sdk/valuation-policy";
import { BitgetClient } from "./bitget-client";

const { record, list, nonNegativeDecimal: decimal } = createJsonDecoder("Bitget");
import {
  validateClassicAccountInfo,
  validateUtaAccountInfo,
  type BitgetIdentity,
} from "./bitget-identity";
import {
  extractClassicPositions,
  extractUtaPositions,
} from "./bitget-positions";
import {
  bitgetCoverage,
  classicAccountCoverage,
  nativeUsdtUsdQuote,
  valuePositions,
} from "./bitget-valuation";

async function collectSavingsPages(
  client: BitgetClient,
  periodType: "flexible" | "fixed",
  registeredAt: string,
  observedAt: string,
): Promise<unknown[]> {
  const pages: unknown[] = [];
  const earliest = Number(registeredAt);
  const latest = Date.parse(observedAt);
  if (!Number.isSafeInteger(earliest) || earliest > latest) {
    throw new Error("Bitget Earn 注册时间范围无效");
  }
  const windowMs = 90 * 24 * 60 * 60_000;
  let windowEnd = latest;
  let requestCount = 0;
  while (windowEnd >= earliest) {
    const windowStart = Math.max(earliest, windowEnd - windowMs + 1);
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (;;) {
      requestCount += 1;
      if (requestCount > 1000) {
        throw new Error(`Bitget ${periodType} Earn 分页超过安全上限`);
      }
      const raw = await client.savings(
        periodType,
        String(windowStart),
        String(windowEnd),
        cursor,
      );
      const data = record(raw, `Bitget ${periodType} Earn data`);
      const rows = list(data.resultList, `Bitget ${periodType} Earn resultList`);
      pages.push(data);
      if (typeof data.endId !== "string") {
        throw new Error(`Bitget ${periodType} Earn 响应缺少 endId`);
      }
      const endId = data.endId;
      if (rows.length === 0 || endId === "") break;
      if (cursors.has(endId)) {
        throw new Error(`Bitget ${periodType} Earn 分页游标重复`);
      }
      cursors.add(endId);
      cursor = endId;
    }
    windowEnd = windowStart - 1;
  }
  return pages;
}

async function validateUtaCashOnly(client: BitgetClient): Promise<void> {
  for (const category of ["USDT-FUTURES", "USDC-FUTURES", "COIN-FUTURES"]) {
    const data = record(
      await client.utaPositions(category),
      `Bitget UTA ${category} positions`,
    );
    for (const position of list(data.list, `Bitget UTA ${category} position list`)) {
      if (decimalCompare(decimal(position.total, "total"), "0") !== 0) {
        throw new Error(`Bitget UTA ${category} 存在合约持仓`);
      }
    }
  }
  for (const category of [
    "MARGIN",
    "USDT-FUTURES",
    "USDC-FUTURES",
    "COIN-FUTURES",
  ]) {
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      const data = record(
        await client.utaOrders(category, cursor),
        `Bitget UTA ${category} open orders`,
      );
      if (list(data.list, `Bitget UTA ${category} order list`).length > 0) {
        throw new Error(`Bitget UTA ${category} 存在未成交挂单`);
      }
      if (typeof data.cursor !== "string") {
        throw new Error("Bitget UTA 挂单响应缺少 cursor");
      }
      const next = data.cursor;
      if (next === "") break;
      if (cursors.has(next)) throw new Error("Bitget UTA 挂单分页游标重复");
      cursors.add(next);
      cursor = next;
      if (page === 99) throw new Error("Bitget UTA 挂单分页超过安全上限");
    }
  }
}

export async function readFullSnapshot(input: {
  client: BitgetClient;
  prices: Prices;
  observedAt: string;
  accountMode: BitgetAccountMode;
}): Promise<{
  identity: BitgetIdentity;
  snapshot: AssetSnapshot;
}> {
  await input.client.syncTime();
  const accountInfo = await input.client.accountInfo(input.accountMode);
  const identity = input.accountMode === "classic"
    ? validateClassicAccountInfo(accountInfo)
    : validateUtaAccountInfo(accountInfo);
  if (input.accountMode === "uta") await validateUtaCashOnly(input.client);
  const accountAssetsObservation = await input.client.accountAssets(input.accountMode);
  const fundingObservation = await input.client.funding(input.accountMode);
  const botObservation = input.accountMode === "classic"
    ? await input.client.botAssets()
    : null;
  const allAccountBalance = input.accountMode === "classic"
    ? await input.client.allAccountBalance()
    : null;
  const accountAssets = accountAssetsObservation.data;
  const funding = fundingObservation.data;
  const savingsOverview = await input.client.earnOverview();
  const cashPlusAccount = await input.client.cashPlusAccount();
  const flexiblePages = await collectSavingsPages(
    input.client,
    "flexible",
    identity.registeredAt,
    input.observedAt,
  );
  const fixedPages = await collectSavingsPages(
    input.client,
    "fixed",
    identity.registeredAt,
    input.observedAt,
  );
  const sharkfinAccount = await input.client.sharkfinAccount();
  const eliteAssets = await input.client.eliteAssets();
  const [instruments, tickers] = await Promise.all([
    input.client.instruments(),
    input.client.tickers(),
  ]);
  const usdtUsd = await usdtUsdValuation({
    native: nativeUsdtUsdQuote(instruments, tickers, input.observedAt),
    nativeSource: "Bitget 现货 USDTUSD",
    observedAt: input.observedAt,
    prices: input.prices,
  });
  const positions = input.accountMode === "classic"
    ? extractClassicPositions({
        spot: accountAssets,
        funding,
        botFutures: botObservation?.data ?? [],
        savingsOverview,
        cashPlusAccount,
        flexiblePages,
        fixedPages,
        sharkfinAccount,
        eliteAssets,
        observedAt: input.observedAt,
        fundingObservedAt: fundingObservation.requestTime,
        botObservedAt: botObservation?.requestTime,
      })
    : extractUtaPositions({
        assets: accountAssets,
        funding,
        savingsOverview,
        cashPlusAccount,
        flexiblePages,
        fixedPages,
        sharkfinAccount,
        eliteAssets,
        observedAt: input.observedAt,
        assetsObservedAt: accountAssetsObservation.requestTime,
      });
  const provisionalCoverage = bitgetCoverage(input.accountMode, positions, {
    status: "complete",
    unexplainedValue: null,
    excludedPositiveAccounts: [],
  });
  const provisionalSnapshot = valuePositions({
      positions,
      instruments,
      tickers,
      observedAt: input.observedAt,
      usdtUsdQuote: usdtUsd.quote,
      usdtUsdSource: usdtUsd.source,
      targetCurrency: input.accountMode === "uta" ? "USD" : "USDT",
      coverage: provisionalCoverage,
      ...(input.accountMode === "classic"
        ? {
            authoritativeTotal: {
              amount: "0",
              currency: "USDT",
            },
          }
        : {}),
    });
  if (input.accountMode === "classic") {
    const accountCoverage = classicAccountCoverage({
      overview: allAccountBalance,
      positions,
    });
    provisionalSnapshot.total = accountCoverage.total;
    provisionalSnapshot.coverage = accountCoverage.coverage;
  }
  return {
    identity,
    snapshot: provisionalSnapshot,
  };
}
